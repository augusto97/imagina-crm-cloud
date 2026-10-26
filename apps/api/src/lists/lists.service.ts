import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
    CONFIGURABLE_ROLES,
    customRoleKey,
    parseCustomRoleKey,
    listSlugSchema,
    readStoreListMarker,
    slugify,
    SCAN_SEARCH_FIELD_TYPES,
    TITLE_FIELD_TYPES,
    recordLayoutV3Schema,
    type CreateListInput,
    type FieldType,
    type List,
    type ListPermissionsDoc,
    type ListRoleMeta,
    type RolePermissions,
    type UpdateListInput,
    type UpdateListPermissionsInput,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { customRoles, fields, listGroups, listSlugHistory, memberships, teamMembers, teams, users } from '../db/schema';
import { resolvePermissions } from './list-acl';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ListsRepository, type ListRow } from './lists.repository';
import { trashListCascade } from '../trash/trash-ops';

/** Roles del workspace cuyos permisos por lista se configuran. */
const CONFIGURABLE_ROLE_META: ListRoleMeta[] = [
    { slug: 'manager', label: 'Manager', can_configure: true },
    { slug: 'agent', label: 'Agente', can_configure: true },
    { slug: 'viewer', label: 'Visor', can_configure: true },
];

@Injectable()
export class ListsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: ListsRepository,
        private readonly realtime: RealtimeService,
    ) {}

    async list(tenantId: number): Promise<List[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listAll(tx, tenantId),
        );
        return rows.map(toList);
    }

    async get(tenantId: number, idOrSlug: string): Promise<List> {
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.resolve(tx, tenantId, idOrSlug),
        );
        return toList(row);
    }

    /**
     * Resuelve id-o-slug DENTRO de un tx ya abierto (PERF-02). Permite que el
     * hot path de records resuelva lista + fields + records en UNA sola
     * transacción con scope, en vez de abrir una por paso.
     */
    async getWithinTx(tx: Tx, tenantId: number, idOrSlug: string): Promise<List> {
        return toList(await this.resolve(tx, tenantId, idOrSlug));
    }

    /** Permisos por rol de la lista (ACL) + catálogo de roles configurables. */
    async getPermissions(tenantId: number, idOrSlug: string): Promise<ListPermissionsDoc> {
        const list = await this.get(tenantId, idOrSlug);
        const doc = resolvePermissions(list.settings);
        // v0.1.138 — accesos POR PERSONA. Se resuelven contra los miembros
        // vivos del workspace: si alguien dejó la empresa, su acceso no se
        // muestra (y tampoco sirve: el guard de tenant lo frena antes).
        const ids = Object.keys(doc.users)
            .map((k) => Number(k))
            .filter((n) => Number.isInteger(n) && n > 0);
        const people = ids.length > 0 ? await this.membersByIds(tenantId, ids) : [];
        // C1 — accesos POR EQUIPO, resueltos contra los equipos vivos (un
        // equipo borrado no se muestra y su acceso ya no sirve).
        const teamIds = Object.keys(doc.teams)
            .map((k) => Number(k))
            .filter((n) => Number.isInteger(n) && n > 0);
        const teamRows = teamIds.length > 0 ? await this.teamsByIds(tenantId, teamIds) : [];
        // C2 — una fila por rol PROPIO: la suya si la tiene; si no, la de su
        // rol base (y la UI la marca como heredada).
        const custom = await this.customRolesOf(tenantId);
        const permissions = { ...doc.permissions };
        const roles: ListRoleMeta[] = [...CONFIGURABLE_ROLE_META];
        for (const r of custom) {
            const key = customRoleKey(r.id);
            const inherited = !doc.permissions[key];
            if (inherited) permissions[key] = { ...doc.permissions[r.baseRole]! };
            roles.push({ slug: key, label: r.name, can_configure: true, custom_role_id: r.id, base_role: r.baseRole, inherited });
        }
        // Sólo las filas de roles que existen (una de un rol borrado no se muestra).
        for (const key of Object.keys(permissions)) {
            const id = parseCustomRoleKey(key);
            if (id !== null && !custom.some((r) => r.id === id)) delete permissions[key];
        }
        return {
            list_id: list.id,
            permissions,
            assignment_field_id: doc.assignment_field_id,
            assignment_team_field_id: doc.assignment_team_field_id,
            roles,
            users: people.map((u) => ({
                user_id: u.id,
                name: u.name,
                email: u.email,
                permissions: doc.users[String(u.id)]!,
                ...(u.role === 'guest' ? { is_guest: true, pending: u.invitedAt !== null } : {}),
            })),
            teams: teamRows.map((t) => ({
                team_id: t.id,
                name: t.name,
                color: t.color,
                icon: t.icon,
                member_count: t.memberCount,
                permissions: doc.teams[String(t.id)]!,
            })),
        };
    }

    /** C1 — equipos de la empresa por id, con cuántas personas tienen. */
    private async teamsByIds(
        tenantId: number,
        ids: number[],
    ): Promise<Array<{ id: number; name: string; color: string | null; icon: string | null; memberCount: number }>> {
        return this.tenantDb.withTenant(tenantId, async (tx) =>
            tx
                .select({
                    id: teams.id,
                    name: teams.name,
                    color: teams.color,
                    icon: teams.icon,
                    memberCount: sql<number>`(SELECT count(*)::int FROM ${teamMembers} tm WHERE tm.team_id = ${teams.id})`,
                })
                .from(teams)
                .where(and(eq(teams.tenantId, tenantId), inArray(teams.id, ids)))
                .orderBy(asc(teams.name)),
        );
    }

    /**
     * Todos los miembros del workspace con su rol (v0.1.201). Lo pide el
     * asistente / MCP: asignar un registro y compartir una lista con una
     * persona piden el ID, no el nombre.
     */
    async workspaceMembers(
        tenantId: number,
    ): Promise<Array<{ id: number; name: string; email: string; role: string; customRole: string | null }>> {
        return this.tenantDb.withTenant(tenantId, async (tx) =>
            tx
                .select({ id: users.id, name: users.name, email: users.email, role: memberships.role, customRole: customRoles.name })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                // C2 — el rol propio de cada persona (si tiene uno).
                .leftJoin(customRoles, and(eq(customRoles.id, memberships.customRoleId), eq(customRoles.tenantId, memberships.tenantId)))
                .where(eq(memberships.tenantId, tenantId))
                .orderBy(asc(users.name)),
        );
    }

    /** C3 — de estos ids, los que son INVITADOS de la empresa. */
    private async guestIdsAmong(tenantId: number, ids: number[]): Promise<Set<number>> {
        if (ids.length === 0) return new Set();
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: memberships.userId })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'guest'), inArray(memberships.userId, ids))),
        );
        return new Set(rows.map((r) => r.id));
    }

    /** C2 — roles propios de la empresa (para las filas de permisos por lista). */
    private async customRolesOf(tenantId: number): Promise<Array<{ id: number; name: string; baseRole: (typeof CONFIGURABLE_ROLES)[number] }>> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: customRoles.id, name: customRoles.name, baseRole: customRoles.baseRole })
                .from(customRoles)
                .where(eq(customRoles.tenantId, tenantId))
                .orderBy(asc(customRoles.name)),
        );
        return rows
            .filter((r) => (CONFIGURABLE_ROLES as readonly string[]).includes(r.baseRole))
            .map((r) => ({ id: r.id, name: r.name, baseRole: r.baseRole as (typeof CONFIGURABLE_ROLES)[number] }));
    }

    /** Miembros del workspace por id (para resolver los accesos por persona). */
    private async membersByIds(
        tenantId: number,
        ids: number[],
    ): Promise<Array<{ id: number; name: string; email: string; role: string; invitedAt: Date | null }>> {
        return this.tenantDb.withTenant(tenantId, async (tx) =>
            tx
                .select({ id: users.id, name: users.name, email: users.email, role: memberships.role, invitedAt: users.invitedAt })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, ids))),
        );
    }

    /** Actualiza el ACL de la lista (merge en settings.permissions). */
    async updatePermissions(
        tenantId: number,
        idOrSlug: string,
        input: UpdateListPermissionsInput,
    ): Promise<ListPermissionsDoc> {
        const list = await this.get(tenantId, idOrSlug);
        const current = resolvePermissions(list.settings);
        // C2 — filas válidas: los roles base configurables y los roles PROPIOS
        // de esta empresa (`custom:<id>`). Cualquier otra clave se rechaza.
        const customIds = new Set((await this.customRolesOf(tenantId)).map((r) => r.id));
        const badKeys = [...Object.keys(input.permissions ?? {}), ...(input.reset_roles ?? [])].filter((key) => {
            if ((CONFIGURABLE_ROLES as readonly string[]).includes(key)) return false;
            const id = parseCustomRoleKey(key);
            return id === null || !customIds.has(id);
        });
        if (badKeys.length > 0) {
            throw new BadRequestException({
                code: 'invalid_role',
                message: 'Sólo se configuran los roles de esta empresa',
                data: { status: 400, errors: { permissions: badKeys.join(', ') } },
            });
        }
        const nextPermissions: Record<string, RolePermissions> = input.permissions
            ? { ...current.permissions, ...input.permissions }
            : { ...current.permissions };
        // Volver a heredar la fila del rol base (sólo roles propios).
        for (const key of input.reset_roles ?? []) {
            if (parseCustomRoleKey(key) !== null) delete nextPermissions[key];
        }
        const nextAssignment =
            input.assignment_field_id !== undefined
                ? input.assignment_field_id
                : current.assignment_field_id;
        // v0.1.138 — los accesos por persona se reemplazan completos (la UI
        // manda el mapa entero). Sólo entran MIEMBROS de esta empresa: un id
        // cualquiera no puede quedar guardado con acceso a la lista.
        let nextUsers = current.users;
        if (input.users !== undefined) {
            const ids = Object.keys(input.users)
                .map((k) => Number(k))
                .filter((n) => Number.isInteger(n) && n > 0);
            const members = ids.length > 0 ? await this.membersByIds(tenantId, ids) : [];
            const allowed = new Set(members.map((m) => m.id));
            const invalid = ids.filter((id) => !allowed.has(id));
            if (invalid.length > 0) {
                throw new BadRequestException({
                    code: 'not_a_member',
                    message: 'Sólo se puede compartir con miembros de esta empresa',
                    data: { status: 400, errors: { users: invalid.join(', ') } },
                });
            }
            // C3 — los accesos de INVITADOS no se tocan desde aquí (tienen su
            // propio camino, con su nivel): se conservan tal cual estaban.
            const guestIds = new Set(members.filter((m) => m.role === 'guest').map((m) => m.id));
            const currentGuests = await this.guestIdsAmong(
                tenantId,
                Object.keys(current.users).map(Number).filter((n) => Number.isInteger(n) && n > 0),
            );
            nextUsers = Object.fromEntries([
                ...ids.filter((id) => !guestIds.has(id)).map((id) => [String(id), input.users![String(id)]!] as const),
                ...[...currentGuests].filter((id) => current.users[String(id)]).map((id) => [String(id), current.users[String(id)]!] as const),
            ]);
        }
        // C1 — accesos por EQUIPO (mapa completo, como el de personas): sólo
        // equipos de esta empresa.
        let nextTeams = current.teams;
        if (input.teams !== undefined) {
            const ids = Object.keys(input.teams)
                .map((k) => Number(k))
                .filter((n) => Number.isInteger(n) && n > 0);
            const found = ids.length > 0 ? await this.teamsByIds(tenantId, ids) : [];
            const allowed = new Set(found.map((t) => t.id));
            const invalid = ids.filter((id) => !allowed.has(id));
            if (invalid.length > 0) {
                throw new BadRequestException({
                    code: 'team_not_found',
                    message: 'Sólo se puede compartir con equipos de esta empresa',
                    data: { status: 400, errors: { teams: invalid.join(', ') } },
                });
            }
            nextTeams = Object.fromEntries(ids.map((id) => [String(id), input.teams![String(id)]!]));
        }
        // C1 — el campo «Equipo» de asignación tiene que ser un campo
        // «Equipo» de ESTA lista.
        let nextTeamAssignment = current.assignment_team_field_id;
        if (input.assignment_team_field_id !== undefined) {
            nextTeamAssignment = input.assignment_team_field_id;
            if (nextTeamAssignment !== null) {
                const ok = await this.tenantDb.withTenant(tenantId, async (tx) => {
                    const [f] = await tx
                        .select({ type: fields.type })
                        .from(fields)
                        .where(and(eq(fields.tenantId, tenantId), eq(fields.listId, list.id), eq(fields.id, nextTeamAssignment!)))
                        .limit(1);
                    return f?.type === 'team';
                });
                if (!ok) {
                    throw new BadRequestException({
                        code: 'invalid_assignment_team_field',
                        message: 'El campo de asignación por equipo tiene que ser un campo «Equipo» de esta lista',
                        data: { status: 400 },
                    });
                }
            }
        }
        const settings = {
            ...list.settings,
            permissions: {
                permissions: nextPermissions,
                assignment_field_id: nextAssignment,
                users: nextUsers,
                teams: nextTeams,
                assignment_team_field_id: nextTeamAssignment,
            },
        };
        await this.update(tenantId, idOrSlug, { settings });
        return this.getPermissions(tenantId, idOrSlug);
    }

    async create(tenantId: number, input: CreateListInput): Promise<List> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const slug = await this.resolveNewSlug(tx, tenantId, input.name, input.slug);
            const position = await this.repo.nextPosition(tx, tenantId);
            // v0.1.173 — nacer dentro de una carpeta (menú contextual de la
            // carpeta). Misma verificación que al mover: carpeta del tenant.
            const groupId = input.group_id ?? null;
            if (groupId !== null) await this.assertGroup(tx, tenantId, groupId);
            return this.repo.insert(tx, {
                tenantId,
                slug,
                name: input.name,
                icon: input.icon ?? null,
                color: input.color ?? null,
                position,
                groupId,
            });
        });
        this.realtime.lists(tenantId);
        return toList(row);
    }

    /** La carpeta existe y es de este tenant; si no, 404 (no una FK violation con 500). */
    private async assertGroup(tx: Tx, tenantId: number, groupId: number): Promise<void> {
        const [g] = await tx
            .select({ id: listGroups.id })
            .from(listGroups)
            .where(and(eq(listGroups.tenantId, tenantId), eq(listGroups.id, groupId)))
            .limit(1);
        if (!g) {
            throw new NotFoundException({
                code: 'list_group_not_found',
                message: 'Carpeta no encontrada',
                data: { status: 404 },
            });
        }
    }

    /**
     * v0.1.107 — Reordena el menú de listas: ids únicos y COMPLETOS del
     * tenant en el orden deseado → position = índice. Compartido por todo
     * el workspace (manage_lists), igual que el orden de campos.
     */
    async reorder(tenantId: number, listIds: number[]): Promise<List[]> {
        const rows = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const existing = await this.repo.listAll(tx, tenantId);
            const validIds = new Set(existing.map((l) => l.id));
            if (new Set(listIds).size !== listIds.length || listIds.some((id) => !validIds.has(id))) {
                throw new BadRequestException({
                    code: 'invalid_reorder',
                    message: 'list_ids debe contener ids únicos que pertenezcan al workspace',
                    data: { status: 400 },
                });
            }
            for (let i = 0; i < listIds.length; i++) {
                await this.repo.update(tx, tenantId, listIds[i]!, { position: i });
            }
            return this.repo.listAll(tx, tenantId);
        });
        this.realtime.lists(tenantId);
        return rows.map(toList);
    }

    async update(tenantId: number, idOrSlug: string, patch: UpdateListInput): Promise<List> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.resolve(tx, tenantId, idOrSlug);

            const changes: Partial<typeof import('../db/schema').lists.$inferInsert> = {};
            if (patch.name !== undefined) changes.name = patch.name;
            if (patch.icon !== undefined) changes.icon = patch.icon;
            if (patch.color !== undefined) changes.color = patch.color;
            if (patch.position !== undefined) changes.position = patch.position;
            if (patch.group_id !== undefined) {
                // Mover a una carpeta: se verifica que sea del MISMO tenant
                // (la RLS ya lo garantiza, pero un id ajeno debe dar 404 y no
                // una FK violation con 500).
                if (patch.group_id !== null) await this.assertGroup(tx, tenantId, patch.group_id);
                changes.groupId = patch.group_id;
            }
            if (patch.settings !== undefined) {
                // v0.1.136 — `title_field_id` (el campo que hace de título del
                // registro) tiene que ser un campo de TEXTO de ESTA lista: un
                // id ajeno o de otro tipo dejaría la ficha sin título editable.
                const chosen = Number((patch.settings as Record<string, unknown>).title_field_id);
                if (Number.isInteger(chosen) && chosen > 0) {
                    const [f] = await tx
                        .select({ id: fields.id, type: fields.type })
                        .from(fields)
                        .where(
                            and(
                                eq(fields.tenantId, tenantId),
                                eq(fields.listId, current.id),
                                eq(fields.id, chosen),
                            ),
                        )
                        .limit(1);
                    if (!f || !TITLE_FIELD_TYPES.includes(f.type as FieldType)) {
                        throw new BadRequestException({
                            code: 'invalid_title_field',
                            message: 'El campo de título tiene que ser un campo de texto de esta lista',
                            data: { status: 400 },
                        });
                    }
                }
                // H3 — `scan_field_id` (el campo «Código» que busca el
                // escáner y que se llena al crear con lo escaneado): de texto,
                // número o ID automático de ESTA lista.
                const scanChosen = Number((patch.settings as Record<string, unknown>).scan_field_id);
                if (Number.isInteger(scanChosen) && scanChosen > 0) {
                    const [f] = await tx
                        .select({ id: fields.id, type: fields.type })
                        .from(fields)
                        .where(and(eq(fields.tenantId, tenantId), eq(fields.listId, current.id), eq(fields.id, scanChosen)))
                        .limit(1);
                    if (!f || !SCAN_SEARCH_FIELD_TYPES.includes(f.type as FieldType)) {
                        throw new BadRequestException({
                            code: 'invalid_scan_field',
                            message: 'El campo del código tiene que ser de texto, número o ID automático de esta lista',
                            data: { status: 400 },
                        });
                    }
                }
                // v0.1.230 — la plantilla v3 de la ficha se valida aquí: el
                // editor y el asistente escriben el mismo shape y una plantilla
                // rota no se guarda (antes una v2 inválida se aceptaba y la
                // ficha caía en silencio al diseño por defecto).
                // v0.1.233 — el portal del cliente usa el mismo modelo (ADR-S26).
                for (const [key, what] of [
                    ['record_layout_v3', 'de la ficha'],
                    ['portal_layout_v3', 'del portal'],
                ] as const) {
                    const v3 = (patch.settings as Record<string, unknown>)[key];
                    if (v3 === undefined || v3 === null) continue;
                    const parsed = recordLayoutV3Schema.safeParse(v3);
                    if (!parsed.success) {
                        const issue = parsed.error.issues[0];
                        throw new BadRequestException({
                            code: 'invalid_record_layout',
                            message: `El diseño ${what} no es válido: ${issue?.message ?? 'forma inesperada'} (${(issue?.path ?? []).join('.')})`,
                            data: { status: 400 },
                        });
                    }
                }
                changes.settings = patch.settings;
            }

            if (patch.slug !== undefined && patch.slug !== current.slug) {
                if (await this.repo.slugExists(tx, tenantId, patch.slug, current.id)) {
                    throw new ConflictException({
                        code: 'slug_taken',
                        message: `El slug '${patch.slug}' ya existe en este workspace`,
                        data: { status: 409, errors: { slug: 'Ya está en uso' } },
                    });
                }
                // v0.1.117 — el slug VIEJO queda en el historial para que los
                // enlaces y marcadores guardados sigan funcionando. Si el slug
                // NUEVO estaba en el historial (de esta lista o de otra), se
                // libera: un slug vivo siempre gana al histórico.
                await tx
                    .delete(listSlugHistory)
                    .where(
                        and(
                            eq(listSlugHistory.tenantId, tenantId),
                            eq(listSlugHistory.slug, patch.slug),
                        ),
                    );
                await tx
                    .insert(listSlugHistory)
                    .values({ tenantId, listId: current.id, slug: current.slug })
                    .onConflictDoNothing();
                changes.slug = patch.slug;
            }

            const updated = await this.repo.update(tx, tenantId, current.id, changes);
            if (!updated) {
                throw new NotFoundException(notFound(idOrSlug));
            }
            return updated;
        });
        this.realtime.lists(tenantId);
        return toList(row);
    }

    /**
     * Manda la lista a la papelera con todo lo de adentro (campos, vistas,
     * automatizaciones, registros): para el resto de la app desaparece, y
     * restaurarla la deja como estaba. `permanent` es el borrado de verdad de
     * siempre (lo usan migraciones internas, p. ej. el pack de la tienda).
     */
    async remove(
        tenantId: number,
        idOrSlug: string,
        opts: { userId?: number | null; permanent?: boolean } = {},
    ): Promise<{ id: number; name: string; automationIds: number[] }> {
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.resolve(tx, tenantId, idOrSlug);
            if (opts.permanent) {
                await this.repo.remove(tx, tenantId, current.id);
                return { id: current.id, name: current.name, automationIds: [] };
            }
            // Una lista que mantiene la tienda se sigue escribiendo sola: si
            // se fuera a la papelera la sincronización quedaría escribiendo
            // en algo que no existe. Primero se deja de sincronizar.
            const marker = readStoreListMarker(current.settings);
            if (marker) {
                throw new ConflictException({
                    code: 'store_managed',
                    message: `Esta lista la mantiene ${marker.store_name ? `la tienda ${marker.store_name}` : 'la tienda'}: deja de sincronizarla antes de borrarla.`,
                    data: { status: 409 },
                });
            }
            const res = await trashListCascade(tx, tenantId, current.id, opts.userId ?? null);
            return { id: current.id, name: current.name, automationIds: res.automationIds };
        });
        this.realtime.lists(tenantId);
        this.realtime.records(tenantId, out.id);
        return out;
    }

    /** Resuelve una lista por id numérico o slug (CONTRACT.md §1). 404 si no existe. */
    private async resolve(tx: Tx, tenantId: number, idOrSlug: string): Promise<ListRow> {
        const row = /^\d+$/.test(idOrSlug)
            ? await this.repo.findById(tx, tenantId, Number(idOrSlug))
            : await this.repo.findBySlug(tx, tenantId, idOrSlug);
        if (row) return row;

        // v0.1.117 — Fallback al historial de slugs: si la lista se renombró,
        // el enlace viejo sigue llevando a la lista correcta en vez de un 404.
        // Se consulta SÓLO cuando el slug vivo no existe, así el camino normal
        // no paga nada.
        if (!/^\d+$/.test(idOrSlug)) {
            const [old] = await tx
                .select({ listId: listSlugHistory.listId })
                .from(listSlugHistory)
                .where(
                    and(
                        eq(listSlugHistory.tenantId, tenantId),
                        eq(listSlugHistory.slug, idOrSlug),
                    ),
                )
                .limit(1);
            if (old) {
                const byHistory = await this.repo.findById(tx, tenantId, old.listId);
                if (byHistory) return byHistory;
            }
        }
        throw new NotFoundException(notFound(idOrSlug));
    }

    /**
     * Slug para una lista nueva: si el usuario lo dio, valida formato/reservados
     * (ya cubierto por el schema) + unicidad. Si no, lo genera del nombre y
     * resuelve colisiones con sufijo `_2`, `_3`… (CONTRACT.md §2).
     */
    private async resolveNewSlug(
        tx: Tx,
        tenantId: number,
        name: string,
        provided?: string,
    ): Promise<string> {
        if (provided !== undefined) {
            if (await this.repo.slugExists(tx, tenantId, provided)) {
                throw new ConflictException({
                    code: 'slug_taken',
                    message: `El slug '${provided}' ya existe en este workspace`,
                    data: { status: 409, errors: { slug: 'Ya está en uso' } },
                });
            }
            return provided;
        }

        const base = ensureListSlug(slugify(name));
        for (let i = 0; i < 1000; i++) {
            const candidate = i === 0 ? base : ensureListSlug(`${base.slice(0, 60)}_${i + 1}`);
            if (!(await this.repo.slugExists(tx, tenantId, candidate))) {
                return candidate;
            }
        }
        throw new ConflictException('No se pudo generar un slug de lista disponible');
    }
}

function toList(row: ListRow): List {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        icon: row.icon,
        color: row.color,
        settings: row.settings,
        position: row.position,
        group_id: row.groupId ?? null,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

function notFound(idOrSlug: string) {
    return {
        code: 'list_not_found',
        message: `Lista '${idOrSlug}' no encontrada`,
        data: { status: 404 },
    };
}

/**
 * Un slug generado del nombre puede chocar con un reservado de lista
 * (ej. lista llamada "Records" → `records`). En ese caso lo prefijamos.
 */
function ensureListSlug(slug: string): string {
    return listSlugSchema.safeParse(slug).success ? slug : `lista_${slug}`.slice(0, 63);
}
