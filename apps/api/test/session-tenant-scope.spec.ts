import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { assertAccountWideSession, tenantBoundToHost } from '../src/auth/host-tenant';
import { SESSION_COOKIE, SessionGuard } from '../src/auth/session.guard';
import { SessionService } from '../src/auth/session.service';
import { totp } from '../src/auth/totp';
import { SuperadminGuard } from '../src/authz/superadmin.guard';
import { encryptSecret } from '../src/common/secret-box';
import { loadEnv, type Env } from '../src/config/env';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { MailService } from '../src/mail/mail.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantGuard } from '../src/tenancy/tenant.guard';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * La app se sirve igual por el dominio propio de cada empresa, y ese dominio lo
 * maneja la empresa (su DNS). Una sesión abierta ahí era una sesión de cuenta
 * completa: quien atiende el dominio veía la cookie y la usaba en la dirección
 * de la plataforma contra las OTRAS empresas de la persona — o, si era la de un
 * superadmin, contra la consola de plataforma.
 */
describe('Sesión abierta en la dirección de una empresa: sólo sirve para esa empresa', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let env: Env;
    let auth: AuthService;
    let sessions: SessionService;
    let acme: number;
    let beta: number;
    let anaId: number;
    let rootId: number;

    const http = (headers: Record<string, string>, cookies: Record<string, string>, url = '/api/v1/lists') => {
        const req = { url, cookies, headers, method: 'GET' } as unknown as Record<string, unknown>;
        const ctx = {
            switchToHttp: () => ({ getRequest: () => req }),
            getHandler: () => () => undefined,
            getClass: () => class {},
        } as unknown as ExecutionContext;
        return { req, ctx };
    };

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        env = loadEnv({
            REDIS_URL: redisBox.url,
            DATABASE_URL: pg.container.getConnectionUri(),
            APP_BASE_URL: 'https://app.plataforma.test',
            PUBLIC_BASE_DOMAIN: 'plataforma.test',
            PLATFORM_SUPERADMINS: 'root@plataforma.test',
        });
        sessions = new SessionService(redis, env);
        auth = new AuthService(pg.db, redis, env, new MailService(env, { name: 'test', send: async () => undefined }), sessions);
        await auth.onModuleInit();

        const ana = await auth.register({ email: 'ana@acme.test', password: 'secreto-123', name: 'Ana', workspace_name: 'Acme' });
        anaId = ana.user.id;
        acme = ana.memberships[0]!.tenant_id;
        await pg.db.update(tenants).set({ customDomain: 'crm.acme.test', portalDomain: 'clientes.acme.test' }).where(eq(tenants.id, acme));
        const [b] = await pg.db.insert(tenants).values({ slug: 'beta', name: 'Beta' }).returning();
        beta = b!.id;
        await withTenant(pg.db, beta, (tx) => tx.insert(memberships).values({ userId: anaId, tenantId: beta, role: 'admin' }));

        // El superadmin (pre-provisionado) con contraseña conocida.
        const [root] = await pg.db.select().from(users).where(eq(users.email, 'root@plataforma.test')).limit(1);
        rootId = root!.id;
        await redis.set('pwreset:root-token', String(rootId), 'EX', 60);
        await auth.resetPassword('root-token', 'clave-del-operador');
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    it('reconoce de qué empresa es cada dirección', async () => {
        expect(await tenantBoundToHost(pg.db, env, 'app.plataforma.test')).toBeNull();
        expect(await tenantBoundToHost(pg.db, env, 'plataforma.test')).toBeNull();
        expect(await tenantBoundToHost(pg.db, env, 'localhost:3000')).toBeNull();
        expect(await tenantBoundToHost(pg.db, env, undefined)).toBeNull();
        expect(await tenantBoundToHost(pg.db, env, 'CRM.Acme.test:443')).toBe(acme);
        expect(await tenantBoundToHost(pg.db, env, 'clientes.acme.test')).toBe(acme);
        expect(await tenantBoundToHost(pg.db, env, 'beta.plataforma.test')).toBe(beta);
        expect(await tenantBoundToHost(pg.db, env, 'nadie.plataforma.test')).toBeNull();
    });

    it('login en la plataforma: sesión de toda la cuenta; en el dominio de una empresa: sólo esa empresa', async () => {
        const global = await auth.login({ email: 'ana@acme.test', password: 'secreto-123' }, { host: 'app.plataforma.test' });
        if (!('token' in global)) throw new Error('se esperaba una sesión');
        expect(global.memberships.map((m) => m.tenant_id).sort()).toEqual([acme, beta].sort());
        expect((await sessions.get(global.token as string))!.boundTenantId).toBeUndefined();

        const bound = await auth.login({ email: 'ana@acme.test', password: 'secreto-123' }, { host: 'crm.acme.test' });
        if (!('token' in bound)) throw new Error('se esperaba una sesión');
        expect(bound.memberships.map((m) => m.tenant_id)).toEqual([acme]);
        const data = (await sessions.get(bound.token as string))!;
        expect(data.boundTenantId).toBe(acme);
        expect(data.via).toBe('password');

        // La cookie capturada, usada en la dirección de la plataforma (el Host no importa: manda la sesión).
        const sessionGuard = new SessionGuard(sessions);
        const tenantGuard = new TenantGuard(new TenantDb(pg.db), new Reflector());
        const own = http({ 'x-tenant-id': String(acme) }, { [SESSION_COOKIE]: bound.token as string });
        await sessionGuard.canActivate(own.ctx);
        expect(own.req.boundTenantId).toBe(acme);
        await expect(tenantGuard.canActivate(own.ctx)).resolves.toBe(true);
        const other = http({ 'x-tenant-id': String(beta) }, { [SESSION_COOKIE]: bound.token as string });
        await sessionGuard.canActivate(other.ctx);
        await expect(tenantGuard.canActivate(other.ctx)).rejects.toMatchObject({ response: { code: 'session_tenant_scope' } });
        // También por slug.
        const bySlug = http({ 'x-tenant-id': 'beta' }, { [SESSION_COOKIE]: bound.token as string });
        await sessionGuard.canActivate(bySlug.ctx);
        await expect(tenantGuard.canActivate(bySlug.ctx)).rejects.toBeInstanceOf(ForbiddenException);
        // /auth/me sólo lista esa empresa; lo que toca toda la cuenta se rechaza.
        const me = await auth.me(anaId, undefined, 'password', acme);
        expect(me.memberships.map((m) => m.tenant_id)).toEqual([acme]);
        expect(() => assertAccountWideSession(own.req as { boundTenantId?: number })).toThrow(ForbiddenException);

        // La sesión global sigue entrando a las dos.
        const free = http({ 'x-tenant-id': String(beta) }, { [SESSION_COOKIE]: global.token as string });
        await sessionGuard.canActivate(free.ctx);
        await expect(tenantGuard.canActivate(free.ctx)).resolves.toBe(true);
        expect(() => assertAccountWideSession(free.req as { boundTenantId?: number })).not.toThrow();
    });

    it('un superadmin que entra por el dominio de una empresa NO abre la consola de plataforma', async () => {
        const superGuard = new SuperadminGuard(env, pg.db);
        const sessionGuard = new SessionGuard(sessions);

        const onPlatform = await auth.login({ email: 'root@plataforma.test', password: 'clave-del-operador' }, { host: 'app.plataforma.test' });
        if (!('token' in onPlatform)) throw new Error('se esperaba una sesión');
        const ok = http({}, { [SESSION_COOKIE]: onPlatform.token as string }, '/api/v1/platform/stats');
        await sessionGuard.canActivate(ok.ctx);
        await expect(superGuard.canActivate(ok.ctx)).resolves.toBe(true);

        const onTenant = await auth.login({ email: 'root@plataforma.test', password: 'clave-del-operador' }, { host: 'crm.acme.test' });
        if (!('token' in onTenant)) throw new Error('se esperaba una sesión');
        expect(onTenant.memberships).toEqual([]);
        const stolen = http({}, { [SESSION_COOKIE]: onTenant.token as string }, '/api/v1/platform/stats');
        await sessionGuard.canActivate(stolen.ctx);
        // 403 (no `reauth_required`: la app no tiene que cerrar la sesión en bucle).
        await expect(superGuard.canActivate(stolen.ctx)).rejects.toBeInstanceOf(ForbiddenException);
        const me = await auth.me(rootId, undefined, 'password', acme);
        expect(me.is_superadmin).toBe(false);
        expect(me.platform_reauth).toBe(false);
        // En la plataforma sigue siendo el operador.
        expect((await auth.me(rootId, undefined, 'password')).is_superadmin).toBe(true);
    });

    it('con segundo factor, la sesión queda atada aunque el código se complete en otra dirección; registrarse ahí ata a la empresa nueva', async () => {
        const secret = 'JBSWY3DPEHPK3PXP';
        await pg.db
            .update(users)
            .set({ totpSecret: encryptSecret(secret, env.SECRETS_KEY), totpEnabledAt: new Date(), totpBackupCodes: [] })
            .where(eq(users.id, anaId));
        const step1 = await auth.login({ email: 'ana@acme.test', password: 'secreto-123' }, { host: 'crm.acme.test' });
        if (!('mfa_required' in step1)) throw new Error('se esperaba el desafío');
        const done = await auth.verifyTwoFactorLogin({ challenge: step1.challenge, code: totp(secret) }, { host: 'app.plataforma.test' });
        expect((await sessions.get(done.token as string))!.boundTenantId).toBe(acme);
        expect(done.memberships.map((m) => m.tenant_id)).toEqual([acme]);

        const fresh = await auth.register(
            { email: 'nueva@otra.test', password: 'secreto-123', name: 'Nueva', workspace_name: 'Otra' },
            { host: 'crm.acme.test' },
        );
        expect((await sessions.get(fresh.token as string))!.boundTenantId).toBe(fresh.memberships[0]!.tenant_id);
        const plain = await auth.register({ email: 'libre@otra.test', password: 'secreto-123', name: 'Libre', workspace_name: 'Libre' }, { host: 'app.plataforma.test' });
        expect((await sessions.get(plain.token as string))!.boundTenantId).toBeUndefined();
    });
});
