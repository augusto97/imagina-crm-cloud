import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { AgencyBillingService } from '../src/agency/agency-billing.service';
import { AgencyService } from '../src/agency/agency.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { auditLog, memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { MembersRepository } from '../src/members/members.repository';
import { MembersService } from '../src/members/members.service';
import { PlatformService } from '../src/platform/platform.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantGuard } from '../src/tenancy/tenant.guard';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * v0.1.449 (I3, ADR-S108) — Modo agencia: la agencia crea y maneja las
 * empresas de sus clientes, entra como administrador con rastro en la
 * bitácora del cliente, y el acceso del cliente sigue al de la agencia.
 */
describe('Modo agencia (Postgres real)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let auth: AuthService;
    let agencySvc: AgencyService;
    let members: MembersService;
    let platform: PlatformService;
    let guard: TenantGuard;
    let counter = 0;

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({ REDIS_URL: redisBox.url, DATABASE_URL: pg.container.getConnectionUri(), PLATFORM_SUPERADMINS: 'root@plataforma.test' });
        const tenantDb = new TenantDb(pg.db);
        const mail = new MailService(env, { name: 'test', send: async () => undefined });
        auth = new AuthService(pg.db, redis, env, mail, new SessionService(redis, env));
        const plans = new PlansService(pg.db);
        const emailQuota = new EmailQuotaService(pg.db, plans);
        const tenantSmtp = new TenantSmtpService(pg.db, env);
        const billing = new BillingService(tenantDb, plans, emailQuota, tenantSmtp);
        const audit = new AuditService(tenantDb);
        members = new MembersService(tenantDb, new MembersRepository(), auth, billing, undefined, undefined, undefined, pg.db);
        agencySvc = new AgencyService(pg.db, auth, plans, new AgencyBillingService(pg.db, plans, audit), audit);
        platform = new PlatformService(pg.db, env, billing, auth, plans, emailQuota, tenantSmtp, undefined, undefined, undefined, members, audit);
        guard = new TenantGuard(tenantDb, new Reflector(), audit, redis);
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    beforeEach(() => {
        counter += 1;
    });

    async function makeUser(name: string): Promise<number> {
        const [u] = await pg.db
            .insert(users)
            .values({ email: `${name}-${counter}-${Math.random().toString(36).slice(2, 7)}@agencia.test`, passwordHash: 'x', name, emailVerifiedAt: new Date() })
            .returning();
        return u!.id;
    }

    async function makeTenant(input: Partial<typeof tenants.$inferInsert> & { name: string }): Promise<number> {
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: `${input.name.toLowerCase().replace(/\W+/g, '-')}-${counter}-${Math.random().toString(36).slice(2, 6)}`, plan: 'pro', status: 'active', ...input })
            .returning();
        return t!.id;
    }

    async function addMember(tenantId: number, userId: number, role: 'admin' | 'manager' | 'client', viaAgency = false): Promise<void> {
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId, role, viaAgency }));
    }

    /** Corre el TenantGuard como lo haría un pedido de la app. */
    async function asUser(userId: number, tenantId: number, method = 'GET'): Promise<FastifyRequest> {
        const req = { url: '/api/v1/lists', method, headers: { 'x-tenant-id': String(tenantId) }, cookies: {}, authUserId: userId } as unknown as FastifyRequest;
        const ctx = {
            switchToHttp: () => ({ getRequest: () => req }),
            getHandler: () => () => undefined,
            getClass: () => class {},
        } as unknown as ExecutionContext;
        await guard.canActivate(ctx);
        return req;
    }

    async function auditOf(tenantId: number, action: string) {
        return pg.db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, action)));
    }

    async function setupAgency(settings: Record<string, unknown> = {}): Promise<{ agency: number; admin: number }> {
        const agency = await makeTenant({ name: 'Agencia Norte', isAgency: true, settings: { agency: settings } });
        const admin = await makeUser('ana');
        await addMember(agency, admin, 'admin');
        return { agency, admin };
    }

    it('crear una empresa cliente: plan elegido, quien la crea queda «por la agencia», rastro en las dos bitácoras y tope', async () => {
        const { agency, admin } = await setupAgency({ client_plan: 'starter', max_clients: 2 });
        const created = await agencySvc.createClient(agency, admin, { name: 'Café Luna' });
        expect(created).toMatchObject({ name: 'Café Luna', plan: 'starter', paused: false, entered: true, users: 0, admins: [] });
        expect(created.access.state).toBe('full');

        const [row] = await pg.db.select().from(tenants).where(eq(tenants.id, created.id));
        expect(row).toMatchObject({ agencyId: agency, status: 'active', trialEndsAt: null, isAgency: false });
        const [m] = await pg.db.select().from(memberships).where(and(eq(memberships.tenantId, created.id), eq(memberships.userId, admin)));
        expect(m).toMatchObject({ role: 'admin', viaAgency: true });
        expect(await auditOf(created.id, 'agency.client_create')).toHaveLength(1);
        expect(await auditOf(agency, 'agency.client_create')).toHaveLength(1);

        // Con un administrador propio del cliente: queda invitado y aparece.
        const second = await agencySvc.createClient(agency, admin, { name: 'Ferretería Sol', admin_email: 'dueno-sol@cliente.test', admin_name: 'Dueño Sol' });
        expect(second.admins).toEqual([{ name: 'Dueño Sol', email: 'dueno-sol@cliente.test', pending: true }]);
        expect(second.users).toBe(1);

        const overview = await agencySvc.overview(agency);
        expect(overview).toMatchObject({ clients: 2, can_create: false, client_plan: { slug: 'starter' } });
        await expect(agencySvc.createClient(agency, admin, { name: 'Una más' })).rejects.toMatchObject({ response: { code: 'agency_client_limit' } });
        expect((await agencySvc.listClients(agency, admin)).map((c) => c.name)).toEqual(['Café Luna', 'Ferretería Sol']);
    });

    it('entrar: acceso con rastro una vez por hora, revalidado en cada pedido, y sólo a clientes propios', async () => {
        const { agency, admin } = await setupAgency();
        const client = await makeTenant({ name: 'Panadería', agencyId: agency });
        const owner = await makeUser('dueno');
        await addMember(client, owner, 'admin');

        // Un admin de la agencia que todavía no entró: no es miembro del cliente.
        await expect(asUser(admin, client)).rejects.toBeTruthy();
        const res = await agencySvc.enter(agency, admin, client);
        expect(res.tenant_id).toBe(client);
        await agencySvc.enter(agency, admin, client); // idempotente
        expect(await auditOf(client, 'agency.enter')).toHaveLength(1);

        const req = await asUser(admin, client);
        expect(req.tenant).toMatchObject({ role: 'admin', viaAgency: true, agencyId: agency });
        await asUser(admin, client, 'POST');
        // El rastro se anota sin frenar el pedido: espera a que llegue.
        const deadline = Date.now() + 3_000;
        while ((await auditOf(client, 'agency.access')).length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
        expect(await auditOf(client, 'agency.access')).toHaveLength(1); // una por hora

        // El dueño del cliente (miembro directo) no deja rastro de agencia.
        await asUser(owner, client);
        expect((await auditOf(client, 'agency.access')).filter((a) => a.userId === owner)).toHaveLength(0);

        // Si deja de ser admin de la agencia, pierde el acceso en el acto.
        await withTenant(pg.db, agency, (tx) =>
            tx.update(memberships).set({ role: 'manager' }).where(and(eq(memberships.tenantId, agency), eq(memberships.userId, admin))),
        );
        await expect(asUser(admin, client)).rejects.toMatchObject({ response: { code: 'agency_access_revoked' } });

        // Un cliente de otra agencia: 404.
        const other = await setupAgency();
        const foreign = await makeTenant({ name: 'Ajena', agencyId: other.agency });
        await expect(agencySvc.enter(agency, admin, foreign)).rejects.toMatchObject({ response: { code: 'agency_client_not_found' } });

        // Quien es cliente del portal de esa empresa no entra como agencia.
        const portalUser = await makeUser('portal');
        await withTenant(pg.db, agency, (tx) => tx.insert(memberships).values({ tenantId: agency, userId: portalUser, role: 'admin' }));
        await addMember(client, portalUser, 'client');
        await expect(agencySvc.enter(agency, portalUser, client)).rejects.toMatchObject({ response: { code: 'agency_member_conflict' } });
    });

    it('el acceso del cliente sigue a la agencia: pausada por la agencia o agencia sin plan = solo lectura, nunca pausada', async () => {
        const { agency, admin } = await setupAgency();
        const client = await makeTenant({ name: 'Taller', agencyId: agency });
        await agencySvc.enter(agency, admin, client);

        expect((await asUser(admin, client)).tenant?.access).toMatchObject({ state: 'full' });

        const paused = await agencySvc.updateClient(agency, admin, client, { paused: true });
        expect(paused).toMatchObject({ paused: true });
        expect(paused.access).toMatchObject({ state: 'read_only', reason: 'agency_paused' });
        await expect(asUser(admin, client, 'POST')).rejects.toBeTruthy();
        expect((await auditOf(client, 'agency.client_pause')).length).toBe(1);
        await agencySvc.updateClient(agency, admin, client, { paused: false, name: 'Taller Centro' });
        expect((await auditOf(client, 'agency.client_resume')).length).toBe(1);
        expect((await auditOf(client, 'agency.client_rename')).length).toBe(1);

        // La agencia queda sin plan (impaga): el cliente en solo lectura, no pausado.
        await pg.db.update(tenants).set({ status: 'unpaid' }).where(eq(tenants.id, agency));
        const req = await asUser(admin, client);
        expect(req.tenant?.access).toMatchObject({ state: 'read_only', reason: 'agency' });
        await pg.db.update(tenants).set({ status: 'active' }).where(eq(tenants.id, agency));
    });

    it('miembros: el equipo de la agencia no ocupa lugar ni se toca desde el cliente, y quitarlo de la agencia le quita los clientes', async () => {
        const { agency, admin } = await setupAgency();
        const client = await agencySvc.createClient(agency, admin, { name: 'Óptica' });

        const list = await members.list(client.id);
        expect(list.find((m) => m.user_id === admin)).toMatchObject({ via_agency: true });
        await expect(members.updateRole(client.id, admin, { role: 'viewer' })).rejects.toMatchObject({ response: { code: 'agency_member' } });
        await expect(members.remove(client.id, admin, admin)).rejects.toMatchObject({ response: { code: 'agency_member' } });

        // Bajarlo de rol en la agencia borra sus entradas «por la agencia».
        const other = await makeUser('otro-admin');
        await addMember(agency, other, 'admin');
        await members.updateRole(agency, admin, { role: 'manager' });
        const left = await pg.db.select().from(memberships).where(and(eq(memberships.tenantId, client.id), eq(memberships.userId, admin)));
        expect(left).toHaveLength(0);
    });

    it('plataforma: marcar agencia, asignar y quitar un cliente, y no borrar una agencia con clientes', async () => {
        const agency = await makeTenant({ name: 'Agencia Sur' });
        const admin = await makeUser('sur');
        await addMember(agency, admin, 'admin');
        const t = await platform.updateTenant(agency, { is_agency: true, agency_settings: { client_plan: null, max_clients: 5, client_plans: [] } });
        expect(t).toMatchObject({ is_agency: true, agency_settings: { max_clients: 5 } });

        const client = await makeTenant({ name: 'Floristería' });
        const linked = await platform.updateTenant(client, { agency_id: agency });
        expect(linked.agency).toMatchObject({ id: agency, name: 'Agencia Sur' });
        await expect(platform.updateTenant(client, { is_agency: true })).rejects.toMatchObject({ response: { code: 'agency_is_client' } });

        await agencySvc.enter(agency, admin, client);
        await expect(platform.updateTenant(agency, { is_agency: false })).rejects.toMatchObject({ response: { code: 'agency_has_clients' } });
        await expect(platform.deleteTenant(agency)).rejects.toMatchObject({ response: { code: 'agency_has_clients' } });

        const listed = await platform.listTenants({ agencies: true, search: 'Agencia Sur' });
        expect(listed.data[0]).toMatchObject({ id: agency, agency_clients: 1 });

        // Quitarla de la agencia corta el acceso de la agencia al instante.
        await platform.updateTenant(client, { agency_id: null });
        const left = await pg.db.select().from(memberships).where(and(eq(memberships.tenantId, client), eq(memberships.viaAgency, true)));
        expect(left).toHaveLength(0);
        expect(await auditOf(client, 'agency.unlink')).toHaveLength(1);
    });
});
