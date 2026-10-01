import { ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv, type Env } from '../src/config/env';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { LogMailTransport } from '../src/mail/transports/log.transport';
import { MembersRepository } from '../src/members/members.repository';
import { MembersService } from '../src/members/members.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

describe('MembersService (Postgres real, RLS)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let env: Env;
    let auth: AuthService;
    let billing: BillingService;
    let members: MembersService;
    let tenantId: number;
    let otherTenantId: number;
    let adminId: number;
    const sent: MailMessage[] = [];

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        env = loadEnv({
            REDIS_URL: redisBox.url,
            DATABASE_URL: pg.container.getConnectionUri(),
            PLATFORM_SUPERADMINS: 'boss@platform.test',
        });
        const tenantDb = new TenantDb(pg.db);
        const mail = new MailService(env, {
            name: 'capture',
            send: async (m) => {
                sent.push(m);
            },
        });
        auth = new AuthService(pg.db, redis, env, mail, new SessionService(redis, env));
        const plans = new PlansService(pg.db);
        billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        members = new MembersService(tenantDb, new MembersRepository(), auth, billing);
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    let counter = 0;
    async function makeUser(name: string): Promise<{ id: number; email: string }> {
        counter += 1;
        const email = `${name}-${counter}@acme.test`;
        const [u] = await pg.db.insert(users).values({ email, passwordHash: 'x', name }).returning();
        return { id: u!.id, email };
    }

    /** Espera el correo (las invitaciones se encolan) y devuelve el último que coincida. */
    async function mailTo(email: string, subject: RegExp): Promise<MailMessage> {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
            const hit = [...sent].reverse().find((m) => m.to === email && subject.test(m.subject));
            if (hit) return hit;
            await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error(`no llegó el correo a ${email}`);
    }

    beforeEach(async () => {
        counter += 1;
        sent.length = 0;
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: `acme-${counter}`, name: 'ACME', plan: 'pro', status: 'trialing' })
            .returning();
        tenantId = t!.id;
        const [o] = await pg.db
            .insert(tenants)
            .values({ slug: `other-${counter}`, name: 'Other', plan: 'pro', status: 'trialing' })
            .returning();
        otherTenantId = o!.id;

        // Un admin fundador en el tenant activo (insertado en su propio tx).
        const admin = await makeUser('admin');
        adminId = admin.id;
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values({ userId: adminId, tenantId, role: 'admin' }),
        );
    });

    it('list: sólo devuelve miembros del tenant activo (RLS) y deja fuera a los clientes del portal', async () => {
        const bob = await makeUser('bob');
        await withTenant(pg.db, otherTenantId, (tx) =>
            tx.insert(memberships).values({ userId: bob.id, tenantId: otherTenantId, role: 'admin' }),
        );
        const client = await makeUser('cliente');
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values({ userId: client.id, tenantId, role: 'client' }),
        );

        const list = await members.list(tenantId);
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ user_id: adminId, role: 'admin', pending: false });
    });

    it('add: suma una cuenta existente y le avisa por correo', async () => {
        const bob = await makeUser('bob');
        const added = await members.add(tenantId, { email: bob.email.toUpperCase(), role: 'manager' }, { invitedById: adminId });
        expect(added).toMatchObject({ user_id: bob.id, role: 'manager', invited: false, pending: false, notified: true });
        expect(await members.list(tenantId)).toHaveLength(2);
        const mail = await mailTo(bob.email, /Te sumaron a «ACME»/);
        expect(mail.html).toContain('admin te sumó');
    });

    it('add: sin cuenta, la crea por INVITACIÓN; definir la contraseña cierra la invitación y verifica el email', async () => {
        const added = await members.add(tenantId, { email: 'Nueva@Acme.test', role: 'agent', name: 'Nora Nueva' }, { invitedById: adminId });
        expect(added).toMatchObject({ email: 'nueva@acme.test', name: 'Nora Nueva', role: 'agent', invited: true, pending: true });

        const [row] = await pg.db.select().from(users).where(eq(users.id, added.user_id));
        expect(row!.invitedAt).not.toBeNull();
        expect(row!.emailVerifiedAt).toBeNull();
        expect((await members.list(tenantId)).find((m) => m.user_id === added.user_id)?.pending).toBe(true);

        const mail = await mailTo('nueva@acme.test', /Te invitaron a «ACME»/);
        expect(mail.text).toContain('7 días');
        expect(mail.text).toContain('&invite=1');
        const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text ?? '')![1]!;
        // El enlace dura 7 días, no los 30 minutos del reset.
        expect(await redis.ttl(`pwreset:${token}`)).toBeGreaterThan(6 * 24 * 60 * 60);

        await auth.resetPassword(token, 'una-clave-nueva-123');
        const [after] = await pg.db.select().from(users).where(eq(users.id, added.user_id));
        expect(after!.invitedAt).toBeNull();
        expect(after!.emailVerifiedAt).not.toBeNull();
        expect((await members.list(tenantId)).find((m) => m.user_id === added.user_id)?.pending).toBe(false);
    });

    it('add: sin nombre usa la parte local del email', async () => {
        const added = await members.add(tenantId, { email: 'sin.nombre@acme.test', role: 'viewer' });
        expect(added.name).toBe('sin.nombre');
    });

    it('add: rechaza duplicados, clientes del portal, cuentas desactivadas y emails reservados — sin crear nada', async () => {
        const bob = await makeUser('bob');
        await members.add(tenantId, { email: bob.email, role: 'agent' });
        await expect(members.add(tenantId, { email: bob.email, role: 'viewer' })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'already_member' }),
        });

        const client = await makeUser('cliente');
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: client.id, tenantId, role: 'client' }));
        await expect(members.add(tenantId, { email: client.email, role: 'agent' })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'portal_client' }),
        });

        const off = await makeUser('apagado');
        await pg.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, off.id));
        await expect(members.add(tenantId, { email: off.email, role: 'agent' })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'account_disabled' }),
        });

        await expect(members.add(tenantId, { email: 'boss@platform.test', role: 'agent' })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'email_reserved' }),
        });
        const [ghost] = await pg.db.select().from(users).where(eq(users.email, 'boss@platform.test'));
        expect(ghost).toBeUndefined();
    });

    it('add: en producción sin correo de cuenta corta ANTES de crear la cuenta', async () => {
        const prodEnv = { ...env, NODE_ENV: 'production' } as Env;
        const prodAuth = new AuthService(pg.db, redis, prodEnv, new MailService(prodEnv, new LogMailTransport()), new SessionService(redis, prodEnv));
        const prodMembers = new MembersService(new TenantDb(pg.db), new MembersRepository(), prodAuth, billing);
        await expect(prodMembers.add(tenantId, { email: 'nadie@acme.test', role: 'agent' })).rejects.toMatchObject({ status: 503 });
        const [row] = await pg.db.select().from(users).where(eq(users.email, 'nadie@acme.test'));
        expect(row).toBeUndefined();
    });

    it('add: aplica el límite de USUARIOS del plan (los clientes del portal no cuentan); la consola lo saltea', async () => {
        await pg.db.update(tenants).set({ plan: 'trial' }).where(eq(tenants.id, tenantId)); // trial: 3 usuarios
        const client = await makeUser('cliente');
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: client.id, tenantId, role: 'client' }));

        await members.add(tenantId, { email: 'dos@acme.test', role: 'agent' });
        await members.add(tenantId, { email: 'tres@acme.test', role: 'agent' });
        const err = await members.add(tenantId, { email: 'cuatro@acme.test', role: 'agent' }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'plan_limit_reached' });
        expect((await billing.summary(tenantId)).usage.users).toBe(3);

        const forced = await members.add(tenantId, { email: 'cuatro@acme.test', role: 'agent' }, { enforcePlan: false });
        expect(forced.invited).toBe(true);
    });

    it('resendInvite: sólo para invitaciones pendientes de ESTA empresa, con freno por hora', async () => {
        const invited = await members.add(tenantId, { email: 'pendiente@acme.test', role: 'agent' });
        await mailTo('pendiente@acme.test', /Te invitaron/);
        sent.length = 0;
        await members.resendInvite(tenantId, invited.user_id);
        await mailTo('pendiente@acme.test', /Te invitaron a «ACME»/);

        // Desde otra empresa: no es miembro → 404.
        await expect(members.resendInvite(otherTenantId, invited.user_id)).rejects.toBeInstanceOf(NotFoundException);
        // Ya definió su contraseña → no hay nada que reenviar.
        await expect(members.resendInvite(tenantId, adminId)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'not_pending' }),
        });
        // Tope de 3 por hora.
        await members.resendInvite(tenantId, invited.user_id);
        await members.resendInvite(tenantId, invited.user_id);
        const err = await members.resendInvite(tenantId, invited.user_id).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(429);
    });

    it('add: una cuenta con invitación pendiente que se suma a otra empresa recibe un enlace nuevo', async () => {
        const first = await members.add(otherTenantId, { email: 'doble@acme.test', role: 'agent' });
        expect(first.invited).toBe(true);
        sent.length = 0;
        const second = await members.add(tenantId, { email: 'doble@acme.test', role: 'viewer' });
        expect(second).toMatchObject({ invited: false, pending: true });
        await mailTo('doble@acme.test', /Te invitaron a «ACME»/);
    });

    it('updateRole: cambia el rol; 409 si degrada al último admin; los clientes del portal no se tocan', async () => {
        const bob = await makeUser('bob');
        await members.add(tenantId, { email: bob.email, role: 'agent' });
        expect((await members.updateRole(tenantId, bob.id, { role: 'manager' })).role).toBe('manager');
        await expect(members.updateRole(tenantId, adminId, { role: 'viewer' })).rejects.toBeInstanceOf(ConflictException);

        const client = await makeUser('cliente');
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: client.id, tenantId, role: 'client' }));
        await expect(members.updateRole(tenantId, client.id, { role: 'agent' })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'portal_client' }),
        });
    });

    it('updateRole: permite degradar un admin si queda otro', async () => {
        const bob = await makeUser('bob');
        await members.add(tenantId, { email: bob.email, role: 'admin' });
        const updated = await members.updateRole(tenantId, bob.id, { role: 'viewer' });
        expect(updated.role).toBe('viewer');
    });

    it('remove: quita a un miembro y devuelve quién era', async () => {
        const bob = await makeUser('bob');
        await members.add(tenantId, { email: bob.email, role: 'agent' });
        const gone = await members.remove(tenantId, adminId, bob.id);
        expect(gone).toMatchObject({ user_id: bob.id, email: bob.email, role: 'agent' });
        expect(await members.list(tenantId)).toHaveLength(1);
    });

    it('remove: 403 al quitarse a uno mismo', async () => {
        await expect(members.remove(tenantId, adminId, adminId)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('remove: 409 al quitar al último admin', async () => {
        const bob = await makeUser('bob');
        await members.add(tenantId, { email: bob.email, role: 'admin' });
        await members.remove(tenantId, bob.id, adminId);
        await expect(members.remove(tenantId, 999999, bob.id)).rejects.toBeInstanceOf(ConflictException);
    });
});
