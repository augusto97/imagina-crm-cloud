import { ForbiddenException, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { BillingService } from '../src/billing/billing.service';
import { loadEnv } from '../src/config/env';
import { automations, fields, lists as listsTable, memberships, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
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
        platform = new PlatformService(pg.db, env, new BillingService(tenantDb), auth);
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    let seq = 0;
    beforeEach(async () => {
        // Limpieza total entre tests (el operador ve TODO; los tests miden totales).
        // Orden FK-safe: hijos → lists → tenants → users.
        await pg.db.delete(automations);
        await pg.db.delete(records);
        await pg.db.delete(fields);
        await pg.db.delete(listsTable);
        await pg.db.delete(memberships);
        await pg.db.delete(tenants);
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
});
