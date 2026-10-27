import 'reflect-metadata';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import {
    CAPABILITIES_BY_ROLE,
    CUSTOM_ROLE_BASES,
    TOGGLEABLE_CAPABILITIES,
    capabilitiesMap,
    effectiveCapabilities,
    guestLevelOf,
    guestListPermissions,
    type Field,
} from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { assertNotClient } from '../src/ai/tokens.service';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { CommentsService } from '../src/comments/comments.service';
import { loadEnv, type Env } from '../src/config/env';
import { attachments, customRoles, memberships, recordShares, records, tenants, users } from '../src/db/schema';
import { withTenant, withUser } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { FilesService } from '../src/files/files.service';
import { GuestsService } from '../src/guests/guests.service';
import { dashboardVisibleTo } from '../src/dashboards/dashboards.service';
import { effectivePermissions, guestCanOpenList, guestExtraHidden } from '../src/lists/list-acl';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { MeRepository } from '../src/me/me.repository';
import { MeService } from '../src/me/me.service';
import { MembersRepository } from '../src/members/members.repository';
import { MembersService } from '../src/members/members.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { CustomRolesService } from '../src/roles/custom-roles.service';
import { ALLOW_GUEST } from '../src/tenancy/allow-guest.decorator';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantGuard, type TenantContext } from '../src/tenancy/tenant.guard';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

class NullDispatcher extends AutomationDispatcher {
    override dispatch(_event: TriggerEvent): void {}
}

// ───────────────────────── C2 — capacidades (puro) ─────────────────────────

describe('C2 — capacidades efectivas (puro)', () => {
    it('los roles base conservan EXACTAMENTE sus capacidades', () => {
        for (const role of ['admin', 'manager', 'agent', 'viewer', 'client', 'guest'] as const) {
            expect(effectiveCapabilities(role)).toEqual(CAPABILITIES_BY_ROLE[role]);
            // Sin rol propio, un rol propio vacío o nulo no cambia nada.
            expect(effectiveCapabilities(role, null)).toEqual(CAPABILITIES_BY_ROLE[role]);
        }
        // Lo que antes era «todo el equipo» sigue siéndolo: ver tableros y el asistente.
        for (const role of ['admin', 'manager', 'agent', 'viewer'] as const) {
            expect(CAPABILITIES_BY_ROLE[role]).toContain('view_dashboards');
            expect(CAPABILITIES_BY_ROLE[role]).toContain('use_ai_assistant');
        }
        // Y lo que antes exigía `manage_lists` (formularios, documentos) sigue siendo del admin.
        expect(CAPABILITIES_BY_ROLE.manager).not.toContain('manage_forms');
        expect(CAPABILITIES_BY_ROLE.manager).not.toContain('manage_documents');
        expect(CAPABILITIES_BY_ROLE.admin).toContain('manage_forms');
        expect(CAPABILITIES_BY_ROLE.admin).toContain('manage_documents');
    });

    it('un rol propio decide sus capacidades; admin, cliente e invitado no se tocan', () => {
        const custom = ['access_admin', 'view_records', 'export_records'] as const;
        expect(effectiveCapabilities('agent', [...custom])).toEqual(expect.arrayContaining([...custom]));
        expect(effectiveCapabilities('agent', [...custom])).not.toContain('use_ai_assistant');
        // Una capacidad que no es elegible (p. ej. `manage_options` del admin) no entra.
        expect(effectiveCapabilities('manager', ['view_records', 'workspace_admin' as never])).not.toContain('workspace_admin');
        expect(effectiveCapabilities('admin', ['view_records'])).toEqual(CAPABILITIES_BY_ROLE.admin);
        expect(effectiveCapabilities('guest', ['manage_lists'])).toEqual(CAPABILITIES_BY_ROLE.guest);
        expect(effectiveCapabilities('client', ['manage_lists'])).toEqual(CAPABILITIES_BY_ROLE.client);
        // Todo lo elegible existe en la matriz del admin.
        for (const c of TOGGLEABLE_CAPABILITIES) expect(CAPABILITIES_BY_ROLE.admin).toContain(c);
        expect(capabilitiesMap('viewer').manage_lists).toBe(false);
        expect(CUSTOM_ROLE_BASES).toEqual(['manager', 'agent', 'viewer']);
    });

    it('MCP / asistente: ni invitados ni roles sin «Usar el asistente IA» conectan', () => {
        expect(() => assertNotClient('guest')).toThrow(ForbiddenException);
        expect(() => assertNotClient('client')).toThrow(ForbiddenException);
        expect(() => assertNotClient('agent', effectiveCapabilities('agent', ['access_admin', 'view_records']))).toThrow(ForbiddenException);
        expect(() => assertNotClient('agent', effectiveCapabilities('agent'))).not.toThrow();
    });

    it('niveles de invitado ↔ acceso por persona de la lista', () => {
        expect(guestLevelOf(guestListPermissions('view'))).toBe('view');
        expect(guestLevelOf(guestListPermissions('comment'))).toBe('comment');
        expect(guestLevelOf(guestListPermissions('edit'))).toBe('edit');
        // Ni «editar» deja borrar.
        expect(guestListPermissions('edit').delete).toBe('none');
    });

    it('tableros: un invitado no los ve (ni por correo) y un rol propio sin «Ver tableros» tampoco', () => {
        const dash = { created_by: 1, visibility: 'workspace' as const, allowed_roles: [] };
        expect(dashboardVisibleTo(dash, { userId: 2, role: 'viewer' })).toBe(true);
        expect(dashboardVisibleTo(dash, { userId: 2, role: 'guest' })).toBe(false);
        expect(dashboardVisibleTo({ ...dash, created_by: 2 }, { userId: 2, role: 'guest' })).toBe(false);
        expect(dashboardVisibleTo(dash, { userId: 2, role: 'agent', capabilities: effectiveCapabilities('agent', ['create_records']) })).toBe(false);
        expect(dashboardVisibleTo(dash, { userId: 2, role: 'agent', capabilities: effectiveCapabilities('agent') })).toBe(true);
    });

    it('un invitado no ve relaciones, botones ni lo que resume la operación interna (tiempo, aprobación, checklists)', () => {
        const types = ['text', 'relation', 'lookup', 'rollup', 'button', 'time_tracked', 'approval', 'checklist_progress', 'number'];
        const fs = types.map((type, i) => ({ id: i + 1, type }));
        expect(guestExtraHidden(fs, { role: 'guest' })).toEqual([2, 3, 4, 5, 6, 7, 8]);
        expect(guestExtraHidden(fs, { role: 'viewer' })).toEqual([]);
    });
});

// ───────────────── C3 — auditoría de rutas abiertas a invitados ─────────────────

/**
 * Fail-closed: el TenantGuard le responde 403 a un invitado en TODO endpoint
 * que no esté marcado con @AllowGuest. Este test recorre los controllers y
 * exige que la lista de marcados sea EXACTAMENTE ésta: abrir uno nuevo a
 * invitados obliga a revisar su ACL y a sumarlo aquí a propósito.
 */
describe('C3 — rutas abiertas a invitados', () => {
    const EXPECTED = [
        'DELETE lists/:list/records/:recordId/comments/:id',
        'GET files',
        'GET files/:id/download',
        'GET lists',
        'GET lists/:idOrSlug',
        'GET lists/:list/fields',
        'GET lists/:list/records',
        'GET lists/:list/records/:id',
        'GET lists/:list/records/:id/activity',
        'GET lists/:list/records/:id/description',
        'GET lists/:list/records/:id/fields/:fieldId/history',
        'GET lists/:list/records/:id/view',
        'GET lists/:list/records/:recordId/comments',
        'GET lists/:list/views',
        'GET me/notification-prefs',
        'GET me/notifications',
        'GET me/shared',
        'GET me/users',
        'GET me/users-search',
        'GET me/users/:id',
        // Fase 7 — novedades: a un invitado sólo le llegan avisos (lo filtra el servicio).
        'GET me/whats-new',
        'GET workspaces/current',
        'GET workspaces/current/branding',
        'GET workspaces/current/format',
        'PATCH lists/:list/records/:id',
        'PATCH lists/:list/records/:id/description',
        'PATCH lists/:list/records/:recordId/comments/:id',
        'PATCH lists/:list/records/batch',
        'PATCH me/notification-prefs',
        'POST files',
        'POST lists/:list/records',
        'POST lists/:list/records/:recordId/comments',
        'POST lists/:list/records/:recordId/comments/:id/reactions',
        'POST me/notifications/read',
        'POST me/whats-new/:id/events',
        'POST me/whats-new/seen',
    ];
    const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

    function controllerFiles(dir: string): string[] {
        const out: string[] = [];
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
            else if (name.endsWith('.controller.ts')) out.push(full);
        }
        return out;
    }

    it('sólo los endpoints revisados aceptan invitados', async () => {
        const found: string[] = [];
        for (const file of controllerFiles(path.join(__dirname, '..', 'src'))) {
            const mod = (await import(file)) as Record<string, unknown>;
            for (const exp of Object.values(mod)) {
                if (typeof exp !== 'function') continue;
                const base = Reflect.getMetadata(PATH_METADATA, exp) as string | string[] | undefined;
                if (base === undefined) continue;
                const classAllows = Reflect.getMetadata(ALLOW_GUEST, exp) === true;
                const proto = (exp as { prototype: Record<string, unknown> }).prototype;
                for (const key of Object.getOwnPropertyNames(proto)) {
                    // Los getters no son handlers (y leerlos puede tirar).
                    const handler = Object.getOwnPropertyDescriptor(proto, key)?.value as unknown;
                    if (key === 'constructor' || typeof handler !== 'function') continue;
                    const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
                    const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
                    if (sub === undefined || method === undefined) continue;
                    const allows = classAllows || Reflect.getMetadata(ALLOW_GUEST, handler) === true;
                    if (!allows) continue;
                    const join = (b: string): string => [b, sub].filter((p) => p && p !== '/').join('/').replace(/\/+/g, '/');
                    for (const b of Array.isArray(base) ? base : [base]) found.push(`${METHODS[method]} ${join(b)}`);
                }
            }
        }
        expect([...new Set(found)].sort()).toEqual([...EXPECTED].sort());
    }, 60_000);

    /**
     * Un actor armado a mano desde el request con sólo `{ userId, role }`
     * pierde los equipos, el rol propio, las capacidades efectivas y lo
     * compartido con un invitado: el acceso por equipo no contaría y un rol
     * propio valdría como su base. Todo actor de un request pasa por `aclOf`.
     */
    it('todo actor armado desde un request lleva aclOf (equipos, rol propio, capacidades, compartidos)', () => {
        const files = (dir: string): string[] =>
            readdirSync(dir).flatMap((name) => {
                const full = path.join(dir, name);
                return statSync(full).isDirectory() ? files(full) : name.endsWith('.ts') ? [full] : [];
            });
        const offenders: string[] = [];
        for (const file of files(path.join(__dirname, '..', 'src'))) {
            readFileSync(file, 'utf8')
                .split('\n')
                .forEach((line, i) => {
                    if (/role:\s*req\.tenant!?\.role\b/.test(line) && !line.includes('aclOf(req)')) offenders.push(`${path.relative(path.join(__dirname, '..'), file)}:${i + 1}`);
                });
        }
        expect(offenders).toEqual([]);
    });

    /**
     * C2 — Las capacidades se consultan SÓLO en `authz/can.ts` (que mira las
     * EFECTIVAS del rol propio): un `roleHasCapability(role, …)` suelto
     * ignoraría el rol propio de la persona.
     */
    it('el API consulta la matriz de roles sólo en el helper `can`', () => {
        const files = (dir: string): string[] =>
            readdirSync(dir).flatMap((name) => {
                const full = path.join(dir, name);
                return statSync(full).isDirectory() ? files(full) : name.endsWith('.ts') ? [full] : [];
            });
        const src = path.join(__dirname, '..', 'src');
        const offenders = files(src)
            .filter((f) => path.relative(src, f) !== path.join('authz', 'can.ts'))
            .filter((f) => /\broleHasCapability\b/.test(readFileSync(f, 'utf8')))
            .map((f) => path.relative(src, f));
        expect(offenders).toEqual([]);
    });
});

// ─────────────── C2 + C3 — Postgres + Redis reales ───────────────

describe('C2/C3 — roles propios e invitados (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let env: Env;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let comments: CommentsService;
    let activity: ActivityService;
    let files: FilesService;
    let auth: AuthService;
    let billing: BillingService;
    let members: MembersService;
    let roles: CustomRolesService;
    let guests: GuestsService;
    let meSvc: MeService;
    let guard: TenantGuard;
    let tenantId: number;
    let otherTenant: number;
    let ana: number; // admin
    let beto: number; // agent
    const f: Record<string, Field> = {};
    const sent: MailMessage[] = [];
    let counter = 0;

    const key = (s: string): string => `f${f[s]!.id}`;
    const admin = (): Actor => ({ userId: ana, role: 'admin', teamIds: [] });

    /** Corre el TenantGuard como en un request real y devuelve el actor resuelto. */
    async function resolve(userId: number, opts: { allowGuest?: boolean; tenant?: number } = {}): Promise<TenantContext> {
        const handler = function handler(): void {};
        if (opts.allowGuest) Reflect.defineMetadata(ALLOW_GUEST, true, handler);
        const req = { authUserId: userId, headers: { 'x-tenant-id': String(opts.tenant ?? tenantId) }, method: 'GET' } as Record<string, unknown>;
        const ctx = {
            switchToHttp: () => ({ getRequest: () => req }),
            getHandler: () => handler,
            getClass: () => class Ctrl {},
        } as unknown as ExecutionContext;
        await guard.canActivate(ctx);
        return req.tenant as TenantContext;
    }
    async function actorOf(userId: number): Promise<Actor> {
        const t = await resolve(userId, { allowGuest: true });
        return { userId, role: t.role, teamIds: t.teamIds, customRoleId: t.customRoleId, capabilities: t.capabilities, shares: t.shares };
    }
    async function mkUser(name: string): Promise<{ id: number; email: string }> {
        counter += 1;
        const email = `${name}-${counter}@acme.test`;
        const [u] = await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning();
        return { id: u!.id, email };
    }

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        env = loadEnv({
            REDIS_URL: rd.url,
            DATABASE_URL: pg.container.getConnectionUri(),
            PLATFORM_SUPERADMINS: 'boss@platform.test',
            APP_BASE_URL: 'https://app.test',
        });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const audit = new AuditService(tenantDb);
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        activity = new ActivityService(tenantDb, new ActivityRepository(), lists);
        recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, activity, new NullDispatcher(), new RelationsRepository());
        comments = new CommentsService(tenantDb, new CommentsRepository(), lists, recs, rt);
        files = new FilesService(tenantDb, { write: async () => undefined } as never, env);
        const mail = new MailService(env, {
            name: 'capture',
            send: async (m) => {
                sent.push(m);
            },
        });
        auth = new AuthService(pg.db, redis, env, mail, new SessionService(redis, env));
        const plans = new PlansService(pg.db);
        billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        roles = new CustomRolesService(tenantDb, rt, audit);
        members = new MembersService(tenantDb, new MembersRepository(), auth, billing, undefined, roles, rt);
        guests = new GuestsService(tenantDb, auth, billing, lists, recs, rt, audit);
        meSvc = new MeService(pg.db, tenantDb, new MeRepository());
        guard = new TenantGuard(tenantDb, new Reflector());

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', plan: 'pro', status: 'trialing' }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra', plan: 'pro', status: 'trialing' }).returning();
        otherTenant = o!.id;
        ana = (await mkUser('ana')).id;
        beto = (await mkUser('beto')).id;
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { tenantId, userId: ana, role: 'admin' },
                { tenantId, userId: beto, role: 'agent' },
            ]),
        );
        await lists.create(tenantId, { name: 'Proyectos' });
        await lists.create(tenantId, { name: 'Clientes' });
        await lists.create(tenantId, { name: 'Nómina' });
        f.titulo = await fieldsSvc.create(tenantId, 'proyectos', { label: 'Título', type: 'text', slug: 'titulo' });
        f.costo = await fieldsSvc.create(tenantId, 'proyectos', { label: 'Costo', type: 'currency', slug: 'costo' });
        f.adjunto = await fieldsSvc.create(tenantId, 'proyectos', { label: 'Adjunto', type: 'file', slug: 'adjunto' });
        const clientes = await lists.get(tenantId, 'clientes');
        f.cliente = await fieldsSvc.create(tenantId, 'proyectos', {
            label: 'Cliente',
            type: 'relation',
            slug: 'cliente',
            config: { target_list_id: clientes.id },
        });
        f.nombre = await fieldsSvc.create(tenantId, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' });
        // El «Lector» no ve el costo: un invitado tampoco.
        await lists.updatePermissions(tenantId, 'proyectos', {
            permissions: { viewer: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['costo'] } },
        });
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(() => {
        sent.length = 0;
    });

    // ─── C2 ───

    it('roles propios: alta desde un base, nombre único, cambio y borrado que devuelve las personas a su base', async () => {
        const r = await roles.create(tenantId, ana, { name: 'Coordinador', base_role: 'agent' });
        // Nace con las capacidades del base.
        expect(r.capabilities.sort()).toEqual(CAPABILITIES_BY_ROLE.agent.filter((c) => TOGGLEABLE_CAPABILITIES.includes(c)).sort());
        await expect(roles.create(tenantId, ana, { name: 'coordinador', base_role: 'viewer' })).rejects.toBeInstanceOf(ConflictException);

        const carla = await mkUser('carla');
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: carla.id, role: 'viewer' }));
        // Asignar el rol propio: el rol base pasa a ser el del rol propio.
        const m = await members.updateRole(tenantId, carla.id, { role: 'viewer', custom_role_id: r.id });
        expect(m).toMatchObject({ role: 'agent', custom_role_id: r.id, custom_role_name: 'Coordinador' });
        expect((await roles.list(tenantId)).custom.find((x) => x.id === r.id)?.member_count).toBe(1);

        // Quitarle «Usar el asistente IA» y sumarle «Exportar»: lo resuelve el guard.
        await roles.update(tenantId, ana, r.id, {
            capabilities: [...r.capabilities.filter((c) => c !== 'use_ai_assistant'), 'export_records'],
        });
        const t = await resolve(carla.id);
        expect(t.role).toBe('agent');
        expect(t.customRoleId).toBe(r.id);
        expect(t.capabilities).not.toContain('use_ai_assistant');
        expect(t.capabilities).toContain('export_records');

        // Un rol de OTRA empresa no se asigna.
        const [foreign] = await withTenant(pg.db, otherTenant, (tx) =>
            tx.insert(customRoles).values({ tenantId: otherTenant, name: 'Ajeno', baseRole: 'manager', capabilities: [] }).returning(),
        );
        await expect(members.updateRole(tenantId, carla.id, { role: 'viewer', custom_role_id: foreign!.id })).rejects.toBeInstanceOf(
            NotFoundException,
        );

        // Borrar el rol: la persona queda en su rol base, con las capacidades del base.
        expect(await roles.remove(tenantId, ana, r.id)).toEqual({ moved: 1 });
        const after = await resolve(carla.id);
        expect(after.customRoleId).toBeNull();
        expect(after.capabilities).toEqual(CAPABILITIES_BY_ROLE.agent);
    });

    it('RLS: los roles propios son de su empresa; cada persona lee el SUYO sin empresa activa', async () => {
        const r = await roles.create(tenantId, ana, { name: 'Analista', base_role: 'viewer' });
        const fromOther = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(customRoles).where(eq(customRoles.id, r.id)));
        expect(fromOther).toHaveLength(0);
        await expect(
            withTenant(pg.db, otherTenant, (tx) => tx.insert(customRoles).values({ tenantId, name: 'Intruso', baseRole: 'viewer', capabilities: [] })),
        ).rejects.toThrow();
        const dora = await mkUser('dora');
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: dora.id, role: 'viewer', customRoleId: r.id }));
        const mine = await withUser(pg.db, dora.id, (tx) => tx.select({ id: customRoles.id }).from(customRoles));
        expect(mine.map((x) => x.id)).toEqual([r.id]);
        const none = await withUser(pg.db, beto, (tx) => tx.select({ id: customRoles.id }).from(customRoles));
        expect(none).toHaveLength(0);
        await roles.remove(tenantId, ana, r.id);
    });

    it('permisos por lista: el rol propio hereda la fila de su base hasta que tiene la suya', async () => {
        const r = await roles.create(tenantId, ana, { name: 'Supervisor', base_role: 'agent' });
        const doc = await lists.getPermissions(tenantId, 'proyectos');
        const row = doc.roles.find((x) => x.custom_role_id === r.id)!;
        expect(row).toMatchObject({ slug: `custom:${r.id}`, base_role: 'agent', inherited: true });
        expect(doc.permissions[`custom:${r.id}`]).toEqual(doc.permissions.agent);

        const eva = await mkUser('eva');
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: eva.id, role: 'agent', customRoleId: r.id }));
        const list = await lists.get(tenantId, 'proyectos');
        expect(effectivePermissions(list.settings, { userId: eva.id, role: 'agent', customRoleId: r.id }).view).toBe(doc.permissions.agent!.view);

        // Fila propia: ve todo (el agente sigue con lo suyo).
        await lists.updatePermissions(tenantId, 'proyectos', {
            permissions: { [`custom:${r.id}`]: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [] } },
        });
        const list2 = await lists.get(tenantId, 'proyectos');
        expect(effectivePermissions(list2.settings, { userId: eva.id, role: 'agent', customRoleId: r.id }).view).toBe('all');
        expect(effectivePermissions(list2.settings, { userId: beto, role: 'agent' }).view).toBe(doc.permissions.agent!.view);
        expect((await lists.getPermissions(tenantId, 'proyectos')).roles.find((x) => x.custom_role_id === r.id)?.inherited).toBe(false);

        // Volver a heredar; y una clave que no es de esta empresa se rechaza.
        await lists.updatePermissions(tenantId, 'proyectos', { reset_roles: [`custom:${r.id}`] });
        expect((await lists.getPermissions(tenantId, 'proyectos')).roles.find((x) => x.custom_role_id === r.id)?.inherited).toBe(true);
        await expect(
            lists.updatePermissions(tenantId, 'proyectos', {
                permissions: { 'custom:999999': { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [] } },
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            lists.updatePermissions(tenantId, 'proyectos', {
                permissions: { admin: { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] } },
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await withTenant(pg.db, tenantId, (tx) => tx.delete(memberships).where(eq(memberships.userId, eva.id)));
        await roles.remove(tenantId, ana, r.id);
    });

    // ─── C3 ───

    it('invitado con UN registro compartido: no ve ni toca nada más de la empresa', async () => {
        const mine = await recs.create(tenantId, admin(), 'proyectos', { data: { [key('titulo')]: 'Compartido', [key('costo')]: 900 } });
        const other = await recs.create(tenantId, admin(), 'proyectos', { data: { [key('titulo')]: 'Secreto', [key('costo')]: 5000 } });
        const share = await guests.shareRecord(tenantId, admin(), 'proyectos', mine.id, { email: 'freelance@afuera.test', level: 'view' });
        expect(share.level).toBe('view');
        // Le llega la invitación con lo que se le compartió.
        await new Promise((r) => setTimeout(r, 50));
        expect(sent.some((m) => m.to === 'freelance@afuera.test' && /compartió contigo «Compartido»/.test(m.subject))).toBe(true);
        const guestId = share.user_id;

        // El guard: rol guest, sólo en endpoints marcados.
        await expect(resolve(guestId)).rejects.toMatchObject({ response: { code: 'guest_forbidden' } });
        const g = await actorOf(guestId);
        expect(g.role).toBe('guest');
        expect([...(g.shares?.keys() ?? [])]).toEqual([mine.id]);

        // Listado: SÓLO el registro compartido, sin el campo oculto del lector.
        const page = await recs.list(tenantId, g, 'proyectos', { limit: 50 } as never);
        expect(page.data.map((r) => r.id)).toEqual([mine.id]);
        expect(page.data[0]!.data[key('costo')]).toBeUndefined();
        expect(page.data[0]!.relations?.[key('cliente')]).toBeUndefined();
        // Búsqueda y filtro por un campo oculto no revelan nada.
        expect((await recs.list(tenantId, g, 'proyectos', { limit: 50, search: 'Secreto' } as never)).data).toHaveLength(0);
        // Por id: el otro no existe para él.
        await expect(recs.get(tenantId, g, 'proyectos', other.id)).rejects.toBeInstanceOf(NotFoundException);
        expect((await recs.get(tenantId, g, 'proyectos', mine.id)).id).toBe(mine.id);
        // «Ver»: no edita, no comenta.
        await expect(recs.update(tenantId, g, 'proyectos', mine.id, { data: { [key('titulo')]: 'X' } })).rejects.toBeInstanceOf(NotFoundException);
        await expect(comments.create(tenantId, g, 'proyectos', mine.id, { body: 'hola', kind: 'note' })).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        // Los comentarios / la actividad de otro registro: 404 / vacío.
        await expect(comments.list(tenantId, g, 'proyectos', other.id)).rejects.toBeInstanceOf(NotFoundException);
        const act = await activity.list(tenantId, 'proyectos', { viewer: g, limit: 50 });
        expect(act.data.every((a) => a.record_id === mine.id)).toBe(true);
        expect(act.data.some((a) => JSON.stringify(a).includes('5000'))).toBe(false);
        await expect(
            activity.fieldHistory(tenantId, 'proyectos', other.id, f.titulo!.id, { viewer: g }),
        ).rejects.toBeInstanceOf(NotFoundException);
        // Ni el historial de un campo oculto del registro que sí ve.
        await expect(activity.fieldHistory(tenantId, 'proyectos', mine.id, f.costo!.id, { viewer: g })).rejects.toBeInstanceOf(
            NotFoundException,
        );

        // Otras listas: no existen para él.
        const clientes = await lists.get(tenantId, 'clientes');
        const proyectos = await lists.get(tenantId, 'proyectos');
        expect(guestCanOpenList(clientes.settings, g, clientes.id)).toBe(false);
        expect(guestCanOpenList(proyectos.settings, g, proyectos.id)).toBe(true);
        expect((await recs.list(tenantId, g, 'clientes', { limit: 50 } as never)).data).toHaveLength(0);

        // Directorio del equipo: nada; y los nombres sin correos.
        expect(await meSvc.searchUsers(tenantId, 'a', 10, 'guest')).toEqual([]);
        const names = await meSvc.getUsers(tenantId, [ana, beto], 'guest');
        expect(names.map((n) => n.display_name).sort()).toEqual(['ana', 'beto']);
        expect(names.every((n) => n.login === '')).toBe(true);
        // El equipo sí ve al invitado, marcado.
        expect((await meSvc.getUsers(tenantId, [guestId])).find((u) => u.id === guestId)?.is_guest).toBe(true);

        // Archivos: el del registro compartido sí, el del otro no.
        const [a1] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(attachments).values({ tenantId, filename: 'ok.pdf', storageKey: 'k1', createdBy: ana }).returning(),
        );
        const [a2] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(attachments).values({ tenantId, filename: 'no.pdf', storageKey: 'k2', createdBy: ana }).returning(),
        );
        await recs.update(tenantId, admin(), 'proyectos', mine.id, { data: { [key('adjunto')]: [a1!.id] } });
        await recs.update(tenantId, admin(), 'proyectos', other.id, { data: { [key('adjunto')]: [a2!.id] } });
        const g2 = await actorOf(guestId);
        const seen = await files.resolve(tenantId, [a1!.id, a2!.id], g2);
        expect(seen.map((x) => x.id)).toEqual([a1!.id]);

        // El guard lo deja pasar donde se marcó, y no en otra empresa.
        await expect(resolve(guestId, { allowGuest: true, tenant: otherTenant })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('niveles: «comentar» comenta pero no edita; «editar» edita lo visible y nunca borra ni escribe lo oculto', async () => {
        const rec = await recs.create(tenantId, admin(), 'proyectos', { data: { [key('titulo')]: 'Nivel' } });
        const s = await guests.shareRecord(tenantId, admin(), 'proyectos', rec.id, { email: 'niveles@afuera.test', level: 'comment' });
        let g = await actorOf(s.user_id);
        const c = await comments.create(tenantId, g, 'proyectos', rec.id, { body: 'Visto', kind: 'note', visibility: 'client' });
        // Un invitado no escribe para el portal del cliente.
        expect(c.visibility).toBe('internal');
        await expect(recs.update(tenantId, g, 'proyectos', rec.id, { data: { [key('titulo')]: 'X' } })).rejects.toBeInstanceOf(NotFoundException);

        await guests.updateRecordShare(tenantId, admin(), 'proyectos', rec.id, s.id, 'edit');
        g = await actorOf(s.user_id);
        const upd = await recs.update(tenantId, g, 'proyectos', rec.id, { data: { [key('titulo')]: 'Editado' } });
        expect(upd.data[key('titulo')]).toBe('Editado');
        await expect(recs.update(tenantId, g, 'proyectos', rec.id, { data: { [key('costo')]: 1 } })).rejects.toBeInstanceOf(ForbiddenException);
        await expect(recs.remove(tenantId, g, 'proyectos', rec.id)).rejects.toBeInstanceOf(NotFoundException);
        // Con un registro suelto no crea en la lista.
        await expect(recs.create(tenantId, g, 'proyectos', { data: { [key('titulo')]: 'Nuevo' } })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lista entera compartida: ve todo lo de esa lista (sin lo oculto), «editar» crea y no borra', async () => {
        const res = await guests.shareList(tenantId, admin(), 'nomina', { email: 'contador@afuera.test', level: 'edit' });
        const g = await actorOf(res.user_id);
        const nomina = await lists.get(tenantId, 'nomina');
        expect(guestCanOpenList(nomina.settings, g, nomina.id)).toBe(true);
        const f1 = await fieldsSvc.create(tenantId, 'nomina', { label: 'Mes', type: 'text', slug: 'mes' });
        const created = await recs.create(tenantId, g, 'nomina', { data: { [`f${f1.id}`]: 'Enero' } });
        const otherRec = await recs.create(tenantId, admin(), 'nomina', { data: { [`f${f1.id}`]: 'Febrero' } });
        expect((await recs.list(tenantId, g, 'nomina', { limit: 50 } as never)).data.map((r) => r.id).sort()).toEqual(
            [created.id, otherRec.id].sort(),
        );
        await expect(recs.remove(tenantId, g, 'nomina', otherRec.id)).rejects.toBeInstanceOf(NotFoundException);
        // «Personas con acceso» (equipo) no pisa el acceso del invitado al guardarse.
        await lists.updatePermissions(tenantId, 'nomina', { users: {} });
        expect(guestLevelOf((await lists.getPermissions(tenantId, 'nomina')).users.find((u) => u.user_id === res.user_id)?.permissions)).toBe('edit');
        // Bajarle el nivel y quitárselo: sin nada compartido, sale de la empresa.
        await guests.setListLevel(tenantId, admin(), 'nomina', res.user_id, 'view');
        const gv = await actorOf(res.user_id);
        await expect(recs.create(tenantId, gv, 'nomina', { data: { [`f${f1.id}`]: 'Marzo' } })).rejects.toBeInstanceOf(ForbiddenException);
        await guests.setListLevel(tenantId, admin(), 'nomina', res.user_id, null);
        const [m] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, res.user_id))),
        );
        expect(m).toBeUndefined();
    });

    it('reglas de alta: alguien del equipo no es invitado, el superadmin tampoco y el plan tiene tope de invitados', async () => {
        const rec = await recs.create(tenantId, admin(), 'proyectos', { data: { [key('titulo')]: 'Tope' } });
        const betoEmail = (await pg.db.select().from(users).where(eq(users.id, beto)))[0]!.email;
        await expect(guests.shareRecord(tenantId, admin(), 'proyectos', rec.id, { email: betoEmail, level: 'view' })).rejects.toMatchObject({
            response: { code: 'already_team_member' },
        });
        await expect(
            guests.shareRecord(tenantId, admin(), 'proyectos', rec.id, { email: 'boss@platform.test', level: 'view' }),
        ).rejects.toMatchObject({ response: { code: 'email_reserved' } });
        // Un agente que no puede editar el registro no lo comparte.
        await expect(
            guests.shareRecord(tenantId, { userId: beto, role: 'agent' }, 'proyectos', rec.id, { email: 'x@afuera.test', level: 'view' }),
        ).rejects.toBeInstanceOf(NotFoundException);

        // Tope: el plan trial deja 5 invitados; compartirle más a uno que ya está no suma.
        const usersBefore = (await billing.summary(tenantId)).usage.users;
        await pg.db.update(tenants).set({ plan: 'trial' }).where(eq(tenants.id, tenantId));
        try {
        const current = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'guest'))),
        );
        for (let i = current.length; i < 5; i++) {
            await guests.shareRecord(tenantId, admin(), 'proyectos', rec.id, { email: `tope${i}@afuera.test`, level: 'view' });
        }
        await expect(
            guests.shareRecord(tenantId, admin(), 'proyectos', rec.id, { email: 'sexto@afuera.test', level: 'view' }),
        ).rejects.toMatchObject({ response: { code: 'plan_limit_reached' } });
        const otherRec = await recs.create(tenantId, admin(), 'proyectos', { data: { [key('titulo')]: 'Otro' } });
        await guests.shareRecord(tenantId, admin(), 'proyectos', otherRec.id, { email: 'tope4@afuera.test', level: 'view' });
        // No ocupan usuario del plan.
        const summary = await billing.summary(tenantId);
        expect(summary.usage.guests).toBe(5);
        expect(summary.usage.users).toBe(usersBefore);
        expect(summary.limits.max_guests).toBe(5);
        } finally {
            await pg.db.update(tenants).set({ plan: 'pro' }).where(eq(tenants.id, tenantId));
        }
    });

    it('Invitados (admin): resumen, pasar a miembro ocupa un usuario y quitar borra lo compartido', async () => {
        const rec = await recs.create(tenantId, admin(), 'proyectos', { data: { [key('titulo')]: 'Promo' } });
        const s = await guests.shareRecord(tenantId, admin(), 'proyectos', rec.id, { email: 'promo@afuera.test', level: 'edit' });
        const summary = (await guests.listGuests(tenantId)).find((g) => g.user_id === s.user_id)!;
        expect(summary.records).toEqual([expect.objectContaining({ record_id: rec.id, title: 'Promo', level: 'edit' })]);
        // El panel de Miembros no lista invitados.
        expect((await members.list(tenantId)).some((m) => m.user_id === s.user_id)).toBe(false);
        // Pasar a miembro ocupa un usuario del plan: con el plan lleno, no.
        await pg.db.update(tenants).set({ plan: 'trial' }).where(eq(tenants.id, tenantId));
        try {
            await expect(members.updateRole(tenantId, s.user_id, { role: 'viewer' })).rejects.toMatchObject({
                response: { code: 'plan_limit_reached' },
            });
        } finally {
            await pg.db.update(tenants).set({ plan: 'pro' }).where(eq(tenants.id, tenantId));
        }
        // Pasar a miembro: rol de equipo y sus registros sueltos dejan de aplicar.
        const promoted = await members.updateRole(tenantId, s.user_id, { role: 'viewer' });
        expect(promoted.role).toBe('viewer');
        const left = await withTenant(pg.db, tenantId, (tx) => tx.select().from(recordShares).where(eq(recordShares.userId, s.user_id)));
        expect(left).toHaveLength(0);

        const s2 = await guests.shareRecord(tenantId, admin(), 'proyectos', rec.id, { email: 'quitar@afuera.test', level: 'view' });
        await guests.shareList(tenantId, admin(), 'clientes', { email: 'quitar@afuera.test', level: 'view' });
        await guests.removeGuest(tenantId, ana, s2.user_id);
        expect((await lists.getPermissions(tenantId, 'clientes')).users.some((u) => u.user_id === s2.user_id)).toBe(false);
        const rows = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, s2.user_id))),
        );
        expect(rows).toHaveLength(0);
    });

    it('RLS: los registros compartidos son de su empresa', async () => {
        const fromOther = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(recordShares));
        expect(fromOther).toHaveLength(0);
        const [any] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).limit(1));
        await expect(
            withTenant(pg.db, otherTenant, (tx) =>
                tx.insert(recordShares).values({ tenantId, listId: any!.listId, recordId: any!.id, userId: ana, level: 'view' }),
            ),
        ).rejects.toThrow();
    });
});
