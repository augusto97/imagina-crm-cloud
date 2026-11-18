import { ForbiddenException, HttpException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PersonalTokensService } from '../src/ai/tokens.service';
import { API_TOKEN_ROUTES, apiTokenRouteAllowed, checkApiBudget } from '../src/auth/api-token';
import { SessionGuard } from '../src/auth/session.guard';
import { SessionService } from '../src/auth/session.service';
import { loadEnv } from '../src/config/env';
import { customRoles, memberships, personalAccessTokens, plans, tenants, users } from '../src/db/schema';
import { buildOpenApiDocument, openApiPathOf } from '../src/public-api/openapi';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantGuard } from '../src/tenancy/tenant.guard';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * v0.1.441 (G1) — API pública con tokens: un token «para la API» actúa como su
 * persona en SU empresa, sólo en las rutas de la lista blanca, con sólo-lectura
 * y freno propios. Un token del MCP no sirve aquí ni uno de la API en el MCP.
 */
describe('API pública: reglas puras', () => {
    it('lista blanca por ruta y método; sólo-lectura sólo hace GET', () => {
        expect(apiTokenRouteAllowed('GET', '/api/v1/lists/:list/records', 'read')).toEqual({ ok: true });
        expect(apiTokenRouteAllowed('POST', '/api/v1/lists/:list/records', 'full')).toEqual({ ok: true });
        expect(apiTokenRouteAllowed('DELETE', '/api/v1/lists/:list/records/:id', 'full')).toEqual({ ok: true });
        expect(apiTokenRouteAllowed('POST', '/api/v1/lists/:list/records', 'read')).toMatchObject({ ok: false, code: 'api_read_only' });
        // Borrar una lista o un campo, sólo desde la app.
        expect(apiTokenRouteAllowed('DELETE', '/api/v1/lists/:idOrSlug', 'full')).toMatchObject({ ok: false, code: 'api_route_not_allowed' });
        expect(apiTokenRouteAllowed('DELETE', '/api/v1/lists/:list/fields/:field', 'full')).toMatchObject({ ok: false, code: 'api_route_not_allowed' });
        // Cuenta, miembros, tokens, consola: nunca.
        for (const route of ['/api/v1/me/tokens', '/api/v1/auth/change-password', '/api/v1/workspaces/current/members', '/api/v1/platform/stats', '/api/v1/mcp']) {
            expect(apiTokenRouteAllowed('POST', route, 'full').ok).toBe(false);
            expect(apiTokenRouteAllowed('GET', route, 'full').ok).toBe(false);
        }
        // La ruta es el PATRÓN del router: un id concreto no coincide (y el router nunca lo da así).
        expect(apiTokenRouteAllowed('GET', '/api/v1/lists/5/records', 'full').ok).toBe(false);
    });

    it('el documento OpenAPI describe exactamente las rutas que deja usar un token', () => {
        const doc = buildOpenApiDocument({ serverUrl: 'https://app.test/api/v1', version: '0.0.0' }) as {
            openapi: string;
            servers: Array<{ url: string }>;
            paths: Record<string, Record<string, unknown>>;
            components: { schemas: Record<string, unknown> };
        };
        expect(doc.openapi).toBe('3.1.0');
        expect(doc.servers[0]!.url).toBe('https://app.test/api/v1');
        const allowed = new Set<string>();
        for (const r of API_TOKEN_ROUTES) for (const m of r.methods) if (m !== 'HEAD') allowed.add(`${m.toLowerCase()} ${openApiPathOf(r.route)}`);
        const documented = new Set<string>();
        for (const [path, ops] of Object.entries(doc.paths)) for (const m of Object.keys(ops)) documented.add(`${m} ${path}`);
        expect([...documented].sort()).toEqual([...allowed].sort());
        // Cada $ref apunta a un schema que existe.
        const refs = JSON.stringify(doc).match(/#\/components\/schemas\/[A-Za-z]+/g) ?? [];
        for (const ref of new Set(refs)) expect(doc.components.schemas[ref.split('/').pop()!], ref).toBeDefined();
        // Los schemas salen de shared: el registro lleva `data` y su id.
        expect(JSON.stringify(doc.components.schemas.Record)).toContain('"data"');
    });
});

describe('API pública: tokens y guards (Postgres + Redis)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let tokens: PersonalTokensService;
    let sessionGuard: SessionGuard;
    let tenantGuard: TenantGuard;
    let tenantId: number;
    let otherTenantId: number;
    let adminId: number;
    let agentId: number;

    function ctxFor(input: { method: string; route: string; auth?: string; tenantHeader?: string }) {
        const headers: Record<string, string> = {};
        if (input.auth) headers.authorization = `Bearer ${input.auth}`;
        if (input.tenantHeader) headers['x-tenant-id'] = input.tenantHeader;
        const req = { method: input.method, url: input.route, routeOptions: { url: input.route }, headers, cookies: {} } as unknown as Record<string, unknown>;
        const sent: Record<string, string> = {};
        const reply = { header: (k: string, v: string) => (sent[k] = v) };
        const ctx = {
            switchToHttp: () => ({ getRequest: () => req, getResponse: () => reply }),
            getHandler: () => () => undefined,
            getClass: () => class {},
        } as unknown as ExecutionContext;
        return { req, ctx, sent };
    }

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({ REDIS_URL: redisBox.url, DATABASE_URL: pg.container.getConnectionUri() });
        tokens = new PersonalTokensService(pg.db);
        sessionGuard = new SessionGuard(new SessionService(redis, env), tokens, redis);
        tenantGuard = new TenantGuard(new TenantDb(pg.db), new Reflector());
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-api', name: 'Acme', plan: 'pro' }).returning();
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra-api', name: 'Otra', plan: 'pro' }).returning();
        tenantId = t!.id;
        otherTenantId = o!.id;
        const [a] = await pg.db.insert(users).values({ email: 'admin@api.test', name: 'Admin', passwordHash: 'x' }).returning();
        const [g] = await pg.db.insert(users).values({ email: 'agente@api.test', name: 'Agente', passwordHash: 'x' }).returning();
        adminId = a!.id;
        agentId = g!.id;
        await pg.db.insert(memberships).values([
            { tenantId, userId: adminId, role: 'admin' },
            { tenantId: otherTenantId, userId: adminId, role: 'admin' },
            { tenantId, userId: agentId, role: 'agent' },
        ]);
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    it('crear un token para la API exige «Usar la API»; cada token sirve sólo para lo suyo', async () => {
        const api = await tokens.create(adminId, tenantId, { name: 'n8n', scope: 'full', use: 'api', expires_in_days: 30 }, 'admin');
        expect(api.token.use).toBe('api');
        const mcp = await tokens.create(adminId, tenantId, { name: 'claude', scope: 'full', expires_in_days: 30 }, 'admin');
        expect(mcp.token.use).toBe('mcp');

        expect(await tokens.resolveForApi(api.secret)).toMatchObject({ userId: adminId, tenantId, scope: 'full' });
        expect(await tokens.resolveForApi(mcp.secret)).toBeNull();
        expect(await tokens.resolve(api.secret)).toBeNull();
        expect(await tokens.resolve(mcp.secret)).toMatchObject({ userId: adminId });

        // Un agente no tiene «Usar la API» de fábrica.
        await expect(tokens.create(agentId, tenantId, { name: 'x', scope: 'read', use: 'api', expires_in_days: 7 }, 'agent')).rejects.toMatchObject({
            response: { code: 'api_not_allowed' },
        });
        // Invitados y clientes del portal, nunca.
        await expect(tokens.create(agentId, tenantId, { name: 'x', scope: 'read', use: 'api', expires_in_days: 7 }, 'guest')).rejects.toBeInstanceOf(ForbiddenException);
        await expect(tokens.create(agentId, tenantId, { name: 'x', scope: 'read', use: 'api', expires_in_days: 7 }, 'client')).rejects.toBeInstanceOf(ForbiddenException);

        // Un rol propio con la capacidad sí puede; si después se la quitan, el token deja de servir.
        const [role] = await pg.db
            .insert(customRoles)
            .values({ tenantId, name: 'Integraciones', baseRole: 'agent', capabilities: ['view_records', 'use_api'] })
            .returning();
        await pg.db.update(memberships).set({ customRoleId: role!.id }).where(eq(memberships.userId, agentId));
        const agentTok = await tokens.create(agentId, tenantId, { name: 'script', scope: 'read', use: 'api', expires_in_days: 7 }, 'agent', ['view_records', 'use_api']);
        expect(await tokens.resolveForApi(agentTok.secret)).toMatchObject({ userId: agentId });
        await pg.db.update(customRoles).set({ capabilities: ['view_records'] }).where(eq(customRoles.id, role!.id));
        expect(await tokens.resolveForApi(agentTok.secret)).toBeNull();
    });

    it('SessionGuard + TenantGuard: lista blanca, sólo-lectura, empresa del token y token inválido', async () => {
        const full = await tokens.create(adminId, tenantId, { name: 'full', scope: 'full', use: 'api', expires_in_days: 30 }, 'admin');
        const read = await tokens.create(adminId, tenantId, { name: 'read', scope: 'read', use: 'api', expires_in_days: 30 }, 'admin');

        // Ruta permitida: la persona y la empresa salen del token.
        const ok = ctxFor({ method: 'GET', route: '/api/v1/lists/:list/records', auth: full.secret });
        await expect(sessionGuard.canActivate(ok.ctx)).resolves.toBe(true);
        expect(ok.req.authUserId).toBe(adminId);
        expect(ok.req.apiToken).toMatchObject({ tenantId, scope: 'full' });
        expect(ok.sent['X-RateLimit-Limit']).toBe('300');
        await expect(tenantGuard.canActivate(ok.ctx)).resolves.toBe(true);
        expect((ok.req.tenant as { tenantId: number }).tenantId).toBe(tenantId);

        // El header de empresa es opcional; por id o por slug tiene que ser la del token.
        const bySlug = ctxFor({ method: 'GET', route: '/api/v1/lists', auth: full.secret, tenantHeader: 'acme-api' });
        await sessionGuard.canActivate(bySlug.ctx);
        await expect(tenantGuard.canActivate(bySlug.ctx)).resolves.toBe(true);
        const other = ctxFor({ method: 'GET', route: '/api/v1/lists', auth: full.secret, tenantHeader: String(otherTenantId) });
        await sessionGuard.canActivate(other.ctx);
        await expect(tenantGuard.canActivate(other.ctx)).rejects.toMatchObject({ response: { code: 'api_token_tenant_mismatch' } });

        // Fuera de la lista blanca → 403 aunque la persona sea admin.
        const tokensRoute = ctxFor({ method: 'POST', route: '/api/v1/me/tokens', auth: full.secret });
        await expect(sessionGuard.canActivate(tokensRoute.ctx)).rejects.toMatchObject({ response: { code: 'api_route_not_allowed' } });

        // Sólo-lectura: GET sí, POST no.
        await expect(sessionGuard.canActivate(ctxFor({ method: 'GET', route: '/api/v1/lists', auth: read.secret }).ctx)).resolves.toBe(true);
        await expect(sessionGuard.canActivate(ctxFor({ method: 'POST', route: '/api/v1/lists/:list/records', auth: read.secret }).ctx)).rejects.toMatchObject({
            response: { code: 'api_read_only' },
        });

        // Inválido, revocado y vencido → 401.
        await expect(sessionGuard.canActivate(ctxFor({ method: 'GET', route: '/api/v1/lists', auth: 'ib_pat_no-existe-0000000000000000000000' }).ctx)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
        await tokens.revoke(adminId, tenantId, read.token.id);
        await expect(sessionGuard.canActivate(ctxFor({ method: 'GET', route: '/api/v1/lists', auth: read.secret }).ctx)).rejects.toMatchObject({
            response: { code: 'api_token_invalid' },
        });
        await pg.db.update(personalAccessTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(personalAccessTokens.id, full.token.id));
        await expect(sessionGuard.canActivate(ctxFor({ method: 'GET', route: '/api/v1/lists', auth: full.secret }).ctx)).rejects.toBeInstanceOf(UnauthorizedException);

        // Plan sin «API»: el token se conserva pero no sirve; vuelve con el plan.
        const again = await tokens.create(adminId, tenantId, { name: 'plan', scope: 'full', use: 'api', expires_in_days: 30 }, 'admin');
        await pg.db.insert(plans).values({ slug: 'sin-api', name: 'Sin API', disabledModules: ['api'] });
        await pg.db.update(tenants).set({ plan: 'sin-api' }).where(eq(tenants.id, tenantId));
        expect(await tokens.resolveForApi(again.secret)).toBeNull();
        await pg.db.update(tenants).set({ plan: 'pro' }).where(eq(tenants.id, tenantId));
        expect(await tokens.resolveForApi(again.secret)).not.toBeNull();
    });

    it('freno por token y por empresa (ventana de un minuto, compartida en Redis)', async () => {
        const now = Date.UTC(2026, 10, 18, 12, 0, 10);
        const limits = { perToken: 3, perTenant: 5 };
        for (let i = 0; i < 3; i++) expect((await checkApiBudget(redis, { tokenId: 900, tenantId: 77 }, limits, now)).ok).toBe(true);
        const over = await checkApiBudget(redis, { tokenId: 900, tenantId: 77 }, limits, now);
        expect(over).toMatchObject({ ok: false, limit: 3, remaining: 0, retryAfter: 50 });
        // Otro token de la misma empresa: suma al cupo de la empresa (el pedido
        // rechazado por el cupo del token no cuenta): 3 + 2 = 5, el 6.º no.
        expect((await checkApiBudget(redis, { tokenId: 901, tenantId: 77 }, limits, now)).ok).toBe(true);
        expect((await checkApiBudget(redis, { tokenId: 901, tenantId: 77 }, limits, now)).ok).toBe(true);
        expect(await checkApiBudget(redis, { tokenId: 901, tenantId: 77 }, limits, now)).toMatchObject({ ok: false, limit: 5 });
        // El minuto siguiente arranca de cero.
        expect((await checkApiBudget(redis, { tokenId: 900, tenantId: 77 }, limits, now + 60_000)).ok).toBe(true);
        // Redis caído: no bloquea.
        const broken = { eval: async () => Promise.reject(new Error('down')), incr: async () => Promise.reject(new Error('down')) } as unknown as Redis;
        expect((await checkApiBudget(broken, { tokenId: 1, tenantId: 1 }, limits, now)).ok).toBe(true);
    });

    it('al pasarse del freno responde 429 con Retry-After', async () => {
        const tk = await tokens.create(adminId, tenantId, { name: 'ráfaga', scope: 'full', use: 'api', expires_in_days: 30 }, 'admin');
        const prev = process.env.API_TOKEN_PER_MINUTE;
        process.env.API_TOKEN_PER_MINUTE = '2';
        try {
            await sessionGuard.canActivate(ctxFor({ method: 'GET', route: '/api/v1/lists', auth: tk.secret }).ctx);
            await sessionGuard.canActivate(ctxFor({ method: 'GET', route: '/api/v1/lists', auth: tk.secret }).ctx);
            const third = ctxFor({ method: 'GET', route: '/api/v1/lists', auth: tk.secret });
            const err = await sessionGuard.canActivate(third.ctx).catch((e: unknown) => e);
            expect(err).toBeInstanceOf(HttpException);
            expect((err as HttpException).getStatus()).toBe(429);
            expect(Number(third.sent['Retry-After'])).toBeGreaterThan(0);
        } finally {
            if (prev === undefined) delete process.env.API_TOKEN_PER_MINUTE;
            else process.env.API_TOKEN_PER_MINUTE = prev;
        }
    });
});
