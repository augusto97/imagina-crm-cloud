import { ForbiddenException, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { BillingService } from '../src/billing/billing.service';
import { loadEnv } from '../src/config/env';
import { automations, fields, impersonationLog, lists as listsTable, memberships, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import { PlansService } from '../src/billing/plans.service';
import { PlatformService } from '../src/platform/platform.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

const rt = new RealtimeService();
const SUPERADMIN = 'boss@platform.test';

describe('PlatformService (consola de operador, cross-tenant)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let lists: ListsService;
    let platform: PlatformService;
    let auth: AuthService;
    let sessions: SessionService;
    let billing: BillingService;
    const sentMail: Array<{ to: string; subject: string }> = [];

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({
            REDIS_URL: redisBox.url,
            DATABASE_URL: pg.container.getConnectionUri(),
            PLATFORM_SUPERADMINS: SUPERADMIN,
        });
        const tenantDb = new TenantDb(pg.db);
        sessions = new SessionService(redis, env);
        const mail = new MailService(env, {
            name: 'test',
            send: async (m) => {
                sentMail.push({ to: m.to, subject: m.subject });
            },
        });
        auth = new AuthService(pg.db, redis, env, mail, sessions);
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const plansSvc = new PlansService(pg.db);
        billing = new BillingService(tenantDb, plansSvc);
        platform = new PlatformService(pg.db, env, billing, auth, plansSvc);
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    let seq = 0;
    beforeEach(async () => {
        // Limpieza total entre tests (el operador ve TODO; los tests miden totales).
        // Orden FK-safe: hijos → lists → tenants → impersonation_log → users.
        await pg.db.delete(automations);
        await pg.db.delete(records);
        await pg.db.delete(fields);
        await pg.db.delete(listsTable);
        await pg.db.delete(memberships);
        await pg.db.delete(tenants);
        await pg.db.delete(impersonationLog);
        await pg.db.delete(users);
    });

    async function seedTenant(opts: {
        name: string;
        plan?: 'trial' | 'starter' | 'pro' | 'enterprise';
        status?: 'trialing' | 'active' | 'past_due' | 'canceled';
        ownerEmail?: string;
        records?: number;
        automations?: number;
    }): Promise<number> {
        seq += 1;
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: `${opts.name.toLowerCase()}-${seq}`, name: opts.name, plan: opts.plan ?? 'trial', status: opts.status ?? 'trialing' })
            .returning();
        const tenantId = t!.id;

        if (opts.ownerEmail) {
            const [u] = await pg.db
                .insert(users)
                .values({ email: opts.ownerEmail, passwordHash: 'x', name: `Owner ${opts.name}` })
                .returning();
            await withTenant(pg.db, tenantId, (tx) =>
                tx.insert(memberships).values({ userId: u!.id, tenantId, role: 'admin' }),
            );
        }
        if (opts.records || opts.automations) {
            const list = await lists.create(tenantId, { name: 'L' });
            if (opts.records) {
                await withTenant(pg.db, tenantId, (tx) =>
                    tx.insert(records).values(
                        Array.from({ length: opts.records! }, () => ({ tenantId, listId: list.id, createdBy: 0, data: {} })),
                    ),
                );
            }
            for (let i = 0; i < (opts.automations ?? 0); i++) {
                await withTenant(pg.db, tenantId, (tx) =>
                    tx.insert(automations).values({ tenantId, listId: list.id, name: `A${i}`, triggerType: 'record_created', triggerConfig: {}, actions: [] }),
                );
            }
        }
        return tenantId;
    }

    it('listTenants: ve TODAS las empresas con uso y owner', async () => {
        const a = await seedTenant({ name: 'Acme', plan: 'pro', status: 'active', ownerEmail: 'ana@acme.test', records: 3, automations: 2 });
        await seedTenant({ name: 'Beta', plan: 'trial', status: 'trialing', ownerEmail: 'beto@beta.test', records: 1 });

        const all = await platform.listTenants();
        expect(all).toHaveLength(2);
        const acme = all.find((t) => t.id === a)!;
        expect(acme).toMatchObject({ name: 'Acme', plan: 'pro', status: 'active', read_only: false });
        expect(acme.owner).toMatchObject({ email: 'ana@acme.test' });
        expect(acme.usage).toMatchObject({ records: 3, users: 1, automations: 2 });
    });

    it('listTenants: tenant sin admin → owner null', async () => {
        await seedTenant({ name: 'Sinowner' });
        const [t] = await platform.listTenants();
        expect(t!.owner).toBeNull();
        expect(t!.usage).toMatchObject({ records: 0, users: 0, automations: 0 });
    });

    it('getStats: totales por estado/plan, read-only, altas', async () => {
        await seedTenant({ name: 'A', plan: 'pro', status: 'active', ownerEmail: 'a@a.test', records: 2 });
        await seedTenant({ name: 'B', plan: 'trial', status: 'trialing' });
        await seedTenant({ name: 'C', plan: 'starter', status: 'past_due' });

        const s = await platform.getStats();
        expect(s.tenants_total).toBe(3);
        expect(s.by_status.active).toBe(1);
        expect(s.by_status.trialing).toBe(1);
        expect(s.by_status.past_due).toBe(1);
        expect(s.by_plan.pro).toBe(1);
        expect(s.read_only_tenants).toBe(1); // past_due
        expect(s.users_total).toBe(1);
        expect(s.records_total).toBe(2);
        expect(s.signups_last_30d).toBe(3);
    });

    it('updateTenant: cambia plan y suspende (past_due → read_only)', async () => {
        const id = await seedTenant({ name: 'Acme', plan: 'trial', status: 'trialing', ownerEmail: 'a@a.test' });

        let t = await platform.updateTenant(id, { plan: 'enterprise', status: 'active' });
        expect(t).toMatchObject({ plan: 'enterprise', status: 'active', read_only: false });

        t = await platform.updateTenant(id, { status: 'past_due' });
        expect(t.read_only).toBe(true);
    });

    it('getTenant: 404 si no existe', async () => {
        await expect(platform.getTenant(999999)).rejects.toBeInstanceOf(NotFoundException);
    });

    // ─────────────────────────── Usuarios (F2) ───────────────────────────

    it('createUser: crea la cuenta, envía invitación y aparece en listUsers', async () => {
        sentMail.length = 0;
        const u = await platform.createUser('nuevo@cliente.test', 'Nuevo Cliente');
        expect(u).toMatchObject({ email: 'nuevo@cliente.test', name: 'Nuevo Cliente', disabled: false, is_superadmin: false, workspaces: 0 });
        expect(sentMail.some((m) => m.to === 'nuevo@cliente.test' && /crearon una cuenta/i.test(m.subject))).toBe(true);

        const all = await platform.listUsers();
        expect(all.find((x) => x.id === u.id)).toBeTruthy();
    });

    it('createUser: email duplicado → 409', async () => {
        await platform.createUser('dup@cliente.test', 'Dup');
        await expect(platform.createUser('dup@cliente.test', 'Dup2')).rejects.toThrow();
    });

    it('createUser: no permite crear con email de superadmin (reservado)', async () => {
        await expect(platform.createUser(SUPERADMIN, 'Boss')).rejects.toThrow();
    });

    it('listUsers: marca is_superadmin al email de la allowlist', async () => {
        await pg.db.insert(users).values({ email: SUPERADMIN, passwordHash: 'x', name: 'Boss' });
        const all = await platform.listUsers();
        const boss = all.find((x) => x.email === SUPERADMIN);
        expect(boss?.is_superadmin).toBe(true);
    });

    it('desactivar: bloquea el login y revoca las sesiones activas', async () => {
        const session = await auth.register({ email: 'act@cliente.test', password: 'password123', name: 'Act', workspace_name: 'ActWS' });
        expect(await sessions.get(session.token as string)).toBeTruthy();

        const u = await platform.setUserDisabled(session.user.id, true);
        expect(u.disabled).toBe(true);
        // Sesión revocada de inmediato.
        expect(await sessions.get(session.token as string)).toBeNull();
        // Login bloqueado aunque la contraseña sea correcta.
        await expect(auth.login({ email: 'act@cliente.test', password: 'password123' })).rejects.toBeInstanceOf(ForbiddenException);

        // Reactivar → login OK de nuevo.
        await platform.setUserDisabled(session.user.id, false);
        const relog = await auth.login({ email: 'act@cliente.test', password: 'password123' });
        expect(relog.token).toBeTruthy();
    });

    it('no se puede desactivar a un superadmin de plataforma', async () => {
        const [boss] = await pg.db.insert(users).values({ email: SUPERADMIN, passwordHash: 'x', name: 'Boss' }).returning();
        await expect(platform.setUserDisabled(boss!.id, true)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resetUserPassword: dispara el email de reset', async () => {
        const [u] = await pg.db.insert(users).values({ email: 'reset@cliente.test', passwordHash: 'x', name: 'R' }).returning();
        sentMail.length = 0;
        await platform.resetUserPassword(u!.id);
        expect(sentMail.some((m) => m.to === 'reset@cliente.test' && /restablecer/i.test(m.subject))).toBe(true);
    });

    // ─────────────────────────── Planes (F3) ───────────────────────────

    it('listPlans: incluye los 4 built-in sembrados con sus límites', async () => {
        const list = await platform.listPlans();
        expect(list.map((p) => p.slug)).toEqual(expect.arrayContaining(['trial', 'starter', 'pro', 'enterprise']));
        expect(list.find((p) => p.slug === 'trial')?.max_records).toBe(500);
        expect(list.find((p) => p.slug === 'enterprise')?.max_records).toBeNull();
    });

    it('crear plan + asignarlo: billing usa los límites del plan de DB (y update los cambia)', async () => {
        const id = await seedTenant({ name: 'Custo', ownerEmail: 'custo@c.test' });
        await platform.createPlan({ slug: 'probe', name: 'Probe', max_records: 5, max_users: 2, max_automations: 1, price_usd: null, price_cop: null, is_active: true });

        const t = await platform.updateTenant(id, { plan: 'probe' });
        expect(t.plan).toBe('probe');
        expect((await billing.summary(id)).limits.max_records).toBe(5);

        await platform.updatePlan('probe', { max_records: 9 });
        expect((await billing.summary(id)).limits.max_records).toBe(9);
    });

    it('updateTenant con plan inexistente → 400', async () => {
        const id = await seedTenant({ name: 'X' });
        await expect(platform.updateTenant(id, { plan: 'no_existe' })).rejects.toThrow();
    });

    it('precios de checkout: create/update los persiste (para vender planes custom)', async () => {
        await platform.createPlan({ slug: 'growth', name: 'Growth', max_records: 50000, max_users: 25, max_automations: 100, price_usd: 29, price_cop: 119000, is_active: true });
        const created = (await platform.listPlans()).find((p) => p.slug === 'growth');
        expect(created).toMatchObject({ price_usd: 29, price_cop: 119000 });

        // Quitar el precio USD → deja de venderse por PayPal, sigue por COP.
        await platform.updatePlan('growth', { price_usd: null });
        const updated = (await platform.listPlans()).find((p) => p.slug === 'growth');
        expect(updated).toMatchObject({ price_usd: null, price_cop: 119000 });
    });

    it('removePlan: rechaza si está en uso, borra si no', async () => {
        const id = await seedTenant({ name: 'Temp' });
        await platform.createPlan({ slug: 'temp', name: 'Temp', max_records: 1, max_users: 1, max_automations: 1, price_usd: null, price_cop: null, is_active: true });
        await platform.updateTenant(id, { plan: 'temp' });
        await expect(platform.removePlan('temp')).rejects.toThrow(); // en uso
        await platform.updateTenant(id, { plan: 'trial' });
        await expect(platform.removePlan('temp')).resolves.toBeUndefined();
        expect((await platform.listPlans()).some((p) => p.slug === 'temp')).toBe(false);
    });

    // ─────────────── Alta + detalle de empresa (F4) ───────────────

    it('createTenant: alta empresa + admin (invita) con el plan pedido', async () => {
        sentMail.length = 0;
        const t = await platform.createTenant({
            workspace_name: 'Nueva Empresa',
            admin_email: 'ceo@nueva.test',
            admin_name: 'CEO Nueva',
            plan: 'pro',
        });
        expect(t).toMatchObject({ name: 'Nueva Empresa', plan: 'pro' });
        expect(t.owner).toMatchObject({ email: 'ceo@nueva.test' });
        expect(t.usage.users).toBe(1);
        expect(sentMail.some((m) => m.to === 'ceo@nueva.test')).toBe(true);

        // El admin puede loguearse tras definir su contraseña (flujo de invitación
        // simulado: reset directo). Verificamos que la cuenta existe y es admin.
        const detail = await platform.tenantDetail(t.id);
        expect(detail.members).toHaveLength(1);
        expect(detail.members[0]!).toMatchObject({ email: 'ceo@nueva.test', role: 'admin' });
        expect(detail.limits.max_records).toBe(200_000);
    });

    it('createTenant: si el email ya existe, lo suma como admin (no re-invita)', async () => {
        await auth.register({ email: 'ya@existe.test', password: 'password123', name: 'Ya', workspace_name: 'PrimerWS' });
        sentMail.length = 0;
        const t = await platform.createTenant({
            workspace_name: 'Segunda Empresa',
            admin_email: 'ya@existe.test',
            admin_name: 'Ya',
        });
        expect(t.owner).toMatchObject({ email: 'ya@existe.test' });
        expect(sentMail).toHaveLength(0); // no se invita a alguien que ya tiene cuenta
        // El usuario ahora es admin de dos workspaces.
        const all = await platform.listUsers();
        expect(all.find((u) => u.email === 'ya@existe.test')?.workspaces).toBe(2);
    });

    it('createTenant con plan inexistente → 400', async () => {
        await expect(
            platform.createTenant({ workspace_name: 'X', admin_email: 'x@x.test', admin_name: 'X', plan: 'no_existe' }),
        ).rejects.toThrow();
    });

    it('tenantDetail: 404 si la empresa no existe', async () => {
        await expect(platform.tenantDetail(999999)).rejects.toBeInstanceOf(NotFoundException);
    });

    // ─────────────── Impersonación de soporte (F5) ───────────────

    it('impersonar: abre sesión como el objetivo, me() marca impersonating, audita', async () => {
        const [op] = await pg.db.insert(users).values({ email: 'op@plat.test', passwordHash: 'x', name: 'Operador' }).returning();
        const sess = await auth.register({ email: 'cliente@imp.test', password: 'password123', name: 'Cliente', workspace_name: 'ClienteWS' });
        const opToken = await sessions.create(op!.id);

        const { token, target } = await platform.impersonate(op!.id, opToken, sess.user.id);
        expect(target).toMatchObject({ email: 'cliente@imp.test' });

        // La sesión de impersonación actúa como el objetivo + recuerda al operador.
        const data = await sessions.get(token);
        expect(data).toMatchObject({ userId: sess.user.id, impersonatedBy: op!.id, origToken: opToken });

        // me() con el impersonatedBy expone el banner.
        const meAs = await auth.me(sess.user.id, op!.id);
        expect(meAs.impersonating).toMatchObject({ operator_id: op!.id, operator_name: 'Operador' });

        // Auditoría abierta.
        const log = await platform.listImpersonations();
        const entry = log.find((l) => l.actor_email === 'op@plat.test' && l.target_email === 'cliente@imp.test');
        expect(entry).toBeTruthy();
        expect(entry!.ended_at).toBeNull();

        // Salir: restaura el token del operador, cierra la sesión y la auditoría.
        const { origToken } = await auth.stopImpersonation(token);
        expect(origToken).toBe(opToken);
        expect(await sessions.get(token)).toBeNull();
        const log2 = await platform.listImpersonations();
        expect(log2.find((l) => l.id === entry!.id)!.ended_at).not.toBeNull();
    });

    it('no se puede impersonar a un superadmin', async () => {
        const [op] = await pg.db.insert(users).values({ email: 'op2@plat.test', passwordHash: 'x', name: 'Op2' }).returning();
        const [boss] = await pg.db.insert(users).values({ email: SUPERADMIN, passwordHash: 'x', name: 'Boss' }).returning();
        const opToken = await sessions.create(op!.id);
        await expect(platform.impersonate(op!.id, opToken, boss!.id)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('no se puede impersonar a una cuenta desactivada', async () => {
        const [op] = await pg.db.insert(users).values({ email: 'op3@plat.test', passwordHash: 'x', name: 'Op3' }).returning();
        const sess = await auth.register({ email: 'off@imp.test', password: 'password123', name: 'Off', workspace_name: 'OffWS' });
        await platform.setUserDisabled(sess.user.id, true);
        const opToken = await sessions.create(op!.id);
        await expect(platform.impersonate(op!.id, opToken, sess.user.id)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('stopImpersonation sobre una sesión normal → error', async () => {
        const sess = await auth.register({ email: 'normal@imp.test', password: 'password123', name: 'Normal', workspace_name: 'NormalWS' });
        await expect(auth.stopImpersonation(sess.token as string)).rejects.toThrow();
    });
});
