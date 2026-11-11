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
        // Cuenta con el correo CONFIRMADO (una sin confirmar pasa a invitación: ver abajo).
        const [u] = await pg.db.insert(users).values({ email, passwordHash: 'x', name, emailVerifiedAt: new Date() }).returning();
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

    it('add: una cuenta REGISTRADA sin confirmar el correo no recibe el acceso — pasa a invitación y entra quien abre el enlace', async () => {
        // Alguien registra el correo de otra persona y se queda esperando.
        const squat = await auth.register({ email: `victima-${counter}@acme.test`, password: 'clave-del-intruso', name: 'Intruso', workspace_name: `Trampa ${counter}` });
        const sessions = new SessionService(redis, env);
        const squatToken = squat.token as string;
        const email = `victima-${counter}@acme.test`;
        // Con segundo factor puesto por el intruso, para que el dueño no pueda entrar.
        await pg.db.update(users).set({ totpSecret: 'x', totpEnabledAt: new Date(), totpBackupCodes: ['a'] }).where(eq(users.id, squat.user.id));
        sent.length = 0;

        const r = await members.add(tenantId, { email, role: 'admin' }, { invitedById: adminId });
        expect(r.user_id).toBe(squat.user.id);
        expect(r.pending).toBe(true);
        expect(r.invited).toBe(true);
        // La sesión del intruso murió y su contraseña ya no entra.
        expect(await sessions.get(squatToken)).toBeNull();
        await expect(auth.login({ email, password: 'clave-del-intruso' })).rejects.toThrow();
        const [row] = await pg.db.select().from(users).where(eq(users.id, squat.user.id));
        expect(row!.invitedAt).not.toBeNull();
        expect(row!.totpEnabledAt).toBeNull();
        expect(row!.totpSecret).toBeNull();
        expect(row!.totpBackupCodes).toBeNull();
        // A la casilla llega la invitación (no un «te sumaron»): quien la abre define la contraseña.
        const mail = await mailTo(email, /Te invitaron a «ACME»/);
        const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text ?? '')![1]!;
        await auth.resetPassword(token, 'clave-de-la-duena');
        const ok = await auth.login({ email, password: 'clave-de-la-duena' });
        expect('token' in ok).toBe(true);
        const [after] = await pg.db.select().from(users).where(eq(users.id, squat.user.id));
        expect(after!.emailVerifiedAt).not.toBeNull();
        expect(after!.invitedAt).toBeNull();

        // Una cuenta CONFIRMADA no se toca: sigue con su contraseña y sus sesiones.
        const fine = await auth.register({ email: `ok-${counter}@acme.test`, password: 'mi-clave-123', name: 'Ok', workspace_name: `Ok ${counter}` });
        await pg.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, fine.user.id));
        const r2 = await members.add(tenantId, { email: `ok-${counter}@acme.test`, role: 'agent' }, { invitedById: adminId });
        expect(r2.pending).toBe(false);
        expect(await sessions.get(fine.token as string)).not.toBeNull();
        expect('token' in (await auth.login({ email: `ok-${counter}@acme.test`, password: 'mi-clave-123' }))).toBe(true);
    });

    it('restablecer la contraseña de una cuenta NUNCA confirmada le quita el segundo factor; a una confirmada no', async () => {
        const mk = async (tag: string, verified: boolean): Promise<number> => {
            const s = await auth.register({ email: `${tag}-${counter}@acme.test`, password: 'clave-123456', name: tag, workspace_name: `${tag} ${counter}` });
            await pg.db
                .update(users)
                .set({ totpSecret: 'x', totpEnabledAt: new Date(), totpBackupCodes: ['a'], emailVerifiedAt: verified ? new Date() : null })
                .where(eq(users.id, s.user.id));
            return s.user.id;
        };
        const reset = async (id: number): Promise<void> => {
            const token = `t-${id}-${Date.now()}`;
            await redis.set(`pwreset:${token}`, String(id), 'EX', 60);
            await auth.resetPassword(token, 'otra-clave-123');
        };
        const never = await mk('nunca', false);
        const proven = await mk('confirmada', true);
        await reset(never);
        await reset(proven);
        const [a] = await pg.db.select().from(users).where(eq(users.id, never));
        const [b] = await pg.db.select().from(users).where(eq(users.id, proven));
        expect(a!.totpEnabledAt).toBeNull();
        expect(a!.totpSecret).toBeNull();
        expect(a!.emailVerifiedAt).not.toBeNull();
        expect(b!.totpEnabledAt).not.toBeNull();
        expect(b!.totpSecret).toBe('x');
    });

    it('add: los correos de invitación tienen cupo por destinatario — sumar y quitar en bucle no inunda una casilla', async () => {
        const email = `bucle-${counter}@acme.test`;
        const invites = () => sent.filter((m) => m.to === email).length;
        for (let i = 0; i < 3; i++) {
            const r = await members.add(tenantId, { email, role: 'agent' }, { invitedById: adminId });
            await mailTo(email, /Te invitaron/);
            await members.remove(tenantId, adminId, r.user_id);
        }
        await new Promise((r) => setTimeout(r, 50));
        expect(invites()).toBe(3);
        // El 4.º en la hora se rechaza y NO deja a la persona sumada.
        const err = await members.add(tenantId, { email, role: 'agent' }, { invitedById: adminId }).catch((e) => e);
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(429);
        expect((await members.list(tenantId)).some((m) => m.email === email)).toBe(false);
        // Tampoco desde OTRA empresa: el cupo es de la casilla.
        const err2 = await members.add(otherTenantId, { email, role: 'agent' }, { enforcePlan: true }).catch((e) => e);
        expect((err2 as HttpException).getStatus()).toBe(429);
        await new Promise((r) => setTimeout(r, 50));
        expect(invites()).toBe(3);
        // La consola de plataforma (el operador) no gasta el cupo.
        const viaOperator = await members.add(tenantId, { email, role: 'agent' }, { enforcePlan: false });
        expect(viaOperator.pending).toBe(true);

        // Una cuenta que ya existía (confirmada): sin cupo queda sumada, pero sin correo.
        const known = await makeUser('conocida');
        await redis.set(`invite-to:h:${(await import('node:crypto')).createHash('sha256').update(known.email).digest('hex')}`, '3', 'EX', 600);
        sent.length = 0;
        const r = await members.add(tenantId, { email: known.email, role: 'viewer' }, { invitedById: adminId });
        expect(r.pending).toBe(false);
        await new Promise((res) => setTimeout(res, 50));
        expect(sent.filter((m) => m.to === known.email)).toHaveLength(0);
        expect((await members.list(tenantId)).some((m) => m.email === known.email)).toBe(true);
    });

    it('add: el cupo por EMPRESA corta una ráfaga de invitaciones a casillas distintas; los nombres largos se recortan', async () => {
        // Plan trial: 3 usuarios + 5 invitados → 20 por día (el mínimo).
        await pg.db.update(tenants).set({ plan: 'trial' }).where(eq(tenants.id, tenantId));
        await redis.set(`invite-by:d:${tenantId}`, '19', 'EX', 600);
        const largo = 'Visita https://malo.example ahora '.repeat(20);
        await pg.db.update(users).set({ name: largo }).where(eq(users.id, adminId));
        const a = await members.add(tenantId, { email: `rafaga-a-${counter}@acme.test`, role: 'agent' }, { invitedById: adminId });
        expect(a.pending).toBe(true);
        const mail = await mailTo(`rafaga-a-${counter}@acme.test`, /Te invitaron/);
        expect((mail.html ?? '').length).toBeLessThan(900);
        const err = await members.add(tenantId, { email: `rafaga-b-${counter}@acme.test`, role: 'agent' }, { invitedById: adminId }).catch((e) => e);
        expect((err as HttpException).getStatus()).toBe(429);
        const [ghost] = await pg.db.select().from(users).where(eq(users.email, `rafaga-b-${counter}@acme.test`));
        expect(ghost).toBeUndefined();
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
