import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
    listSlugSchema,
    slugify,
    type CreateListInput,
    type List,
    type ListPermissionsDoc,
    type ListRoleMeta,
    type UpdateListInput,
    type UpdateListPermissionsInput,
} from '@imagina-base/shared';
import type { Tx } from '../db/client';
import { resolvePermissions } from './list-acl';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ListsRepository, type ListRow } from './lists.repository';

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
        return {
            list_id: list.id,
            permissions: doc.permissions,
            assignment_field_id: doc.assignment_field_id,
            roles: CONFIGURABLE_ROLE_META,
        };
    }

    /** Actualiza el ACL de la lista (merge en settings.permissions). */
    async updatePermissions(
        tenantId: number,
        idOrSlug: string,
        input: UpdateListPermissionsInput,
    ): Promise<ListPermissionsDoc> {
        const list = await this.get(tenantId, idOrSlug);
        const current = resolvePermissions(list.settings);
        const nextPermissions = input.permissions
            ? { ...current.permissions, ...input.permissions }
            : current.permissions;
        const nextAssignment =
            input.assignment_field_id !== undefined
                ? input.assignment_field_id
                : current.assignment_field_id;
        const settings = {
            ...list.settings,
            permissions: { permissions: nextPermissions, assignment_field_id: nextAssignment },
        };
        await this.update(tenantId, idOrSlug, { settings });
        return this.getPermissions(tenantId, idOrSlug);
    }

    async create(tenantId: number, input: CreateListInput): Promise<List> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const slug = await this.resolveNewSlug(tx, tenantId, input.name, input.slug);
            const position = await this.repo.nextPosition(tx, tenantId);
            return this.repo.insert(tx, {
                tenantId,
                slug,
                name: input.name,
                icon: input.icon ?? null,
                color: input.color ?? null,
                position,
            });
        });
        this.realtime.lists(tenantId);
        return toList(row);
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
            if (patch.settings !== undefined) changes.settings = patch.settings;

            if (patch.slug !== undefined && patch.slug !== current.slug) {
                // TODO(F1-slugs): registrar el rename en slug_history para redirects.
                if (await this.repo.slugExists(tx, tenantId, patch.slug, current.id)) {
                    throw new ConflictException({
                        code: 'slug_taken',
                        message: `El slug '${patch.slug}' ya existe en este workspace`,
                        data: { status: 409, errors: { slug: 'Ya está en uso' } },
                    });
                }
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

    async remove(tenantId: number, idOrSlug: string): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.resolve(tx, tenantId, idOrSlug);
            await this.repo.remove(tx, tenantId, current.id);
        });
        this.realtime.lists(tenantId);
    }

    /** Resuelve una lista por id numérico o slug (CONTRACT.md §1). 404 si no existe. */
    private async resolve(tx: Tx, tenantId: number, idOrSlug: string): Promise<ListRow> {
        const row = /^\d+$/.test(idOrSlug)
            ? await this.repo.findById(tx, tenantId, Number(idOrSlug))
            : await this.repo.findBySlug(tx, tenantId, idOrSlug);
        if (!row) {
            throw new NotFoundException(notFound(idOrSlug));
        }
        return row;
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
