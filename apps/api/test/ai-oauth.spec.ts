import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_TTL_MS, OauthService, REFRESH_TTL_MS } from '../src/ai/oauth.service';
import {
    OauthError,
    extractClientCredentials,
    isAllowedRedirectUri,
    parseRequestedScope,
    pkceMatches,
    resourceMatches,
} from '../src/ai/oauth.util';
import { PersonalTokensService, REFRESH_PREFIX, TOKEN_PREFIX } from '../src/ai/tokens.service';
import { memberships, oauthClients, personalAccessTokens, tenants, users } from '../src/db/schema';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

const ORIGIN = 'https://app.test.local';
const MCP = `${ORIGIN}/api/v1/mcp`;

function pkce(): { verifier: string; challenge: string } {
    const verifier = randomBytes(48).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

describe('OAuth util (puro)', () => {
    it('redirect URIs: https siempre, http sólo en loopback, esquemas de app nativa; nada peligroso', () => {
        expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
        expect(isAllowedRedirectUri('http://localhost:53421/callback')).toBe(true);
        expect(isAllowedRedirectUri('http://127.0.0.1:8080/cb')).toBe(true);
        expect(isAllowedRedirectUri('cursor://anysphere.cursor-retrieval/oauth/user-x/callback')).toBe(true);
        expect(isAllowedRedirectUri('http://evil.com/cb')).toBe(false);
        expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
        expect(isAllowedRedirectUri('data:text/html,hi')).toBe(false);
        expect(isAllowedRedirectUri('https://claude.ai/cb#frag')).toBe(false);
        expect(isAllowedRedirectUri('no es una url')).toBe(false);
    });

    it('PKCE S256 en tiempo constante; verifier fuera de rango → false', () => {
        const { verifier, challenge } = pkce();
        expect(pkceMatches(verifier, challenge)).toBe(true);
        expect(pkceMatches(verifier + 'x', challenge)).toBe(false);
        expect(pkceMatches('corto', challenge)).toBe(false);
        expect(pkceMatches(verifier, challenge.slice(0, -1))).toBe(false);
    });

    it('scope: full gana, desconocidos se ignoran, vacío → full, sólo desconocidos → null', () => {
        expect(parseRequestedScope(undefined)).toBe('full');
        expect(parseRequestedScope('read')).toBe('read');
        expect(parseRequestedScope('read full')).toBe('full');
        expect(parseRequestedScope('read openid')).toBe('read');
        expect(parseRequestedScope('openid profile')).toBeNull();
    });

    it('resource (RFC 8707): mismo origen y path (barra final tolerada); otro → no', () => {
        expect(resourceMatches(MCP, undefined)).toBe(true);
        expect(resourceMatches(MCP, MCP)).toBe(true);
        expect(resourceMatches(MCP, `${MCP}/`)).toBe(true);
        expect(resourceMatches(MCP, 'https://otro.local/api/v1/mcp')).toBe(false);
        expect(resourceMatches(MCP, `${ORIGIN}/api/v1/otro`)).toBe(false);
        expect(resourceMatches(MCP, 'basura')).toBe(false);
    });

    it('credenciales de cliente: Basic gana sobre el body; body como fallback', () => {
        const basic = `Basic ${Buffer.from('abc:s3cret').toString('base64')}`;
        expect(extractClientCredentials({ client_id: 'x' }, basic)).toEqual({ clientId: 'abc', clientSecret: 's3cret', viaHeader: true });
        expect(extractClientCredentials({ client_id: 'x', client_secret: 'y' }, undefined)).toEqual({ clientId: 'x', clientSecret: 'y', viaHeader: false });
        expect(extractClientCredentials({}, undefined)).toEqual({ clientId: null, clientSecret: null, viaHeader: false });
    });
});

describe('Servidor OAuth 2.1 del MCP (v0.1.184, Postgres + Redis reales)', () => {
    let pg: TestPg;
    let redisC: TestRedis;
    let redis: Redis;
    let oauth: OauthService;
    let tokens: PersonalTokensService;
    let tenantId: number;
    let otherTenantId: number;
    let userId: number;
    const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

    beforeAll(async () => {
        [pg, redisC] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisC.url);
        tokens = new PersonalTokensService(pg.db);
        oauth = new OauthService(pg.db, redis, tokens);
        const [t] = await pg.db.insert(tenants).values({ slug: 'oauth', name: 'OAuth SA', plan: 'pro' }).returning();
        const [o] = await pg.db.insert(tenants).values({ slug: 'ajena', name: 'Ajena', plan: 'pro' }).returning();
        tenantId = t!.id;
        otherTenantId = o!.id;
        const [u] = await pg.db.insert(users).values({ email: 'ana@oauth.local', name: 'Ana', passwordHash: 'x' }).returning();
        userId = u!.id;
        await pg.db.insert(memberships).values({ tenantId, userId, role: 'manager' });
    }, 180_000);

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisC?.stop()]);
    });

    /** Flujo completo hasta el code: registrar → authorize → approve. */
    async function authorizeFlow(opts: { scope?: string; clientId?: string; approveScope?: 'read' | 'full' } = {}): Promise<{ clientId: string; code: string; verifier: string; state: string }> {
        const clientId = opts.clientId ?? (await oauth.registerClient({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' })).client_id;
        const { verifier, challenge } = pkce();
        const state = randomBytes(8).toString('hex');
        const start = await oauth.startAuthorization(ORIGIN, {
            response_type: 'code',
            client_id: clientId,
            redirect_uri: REDIRECT,
            state,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            resource: MCP,
            ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
        });
        if (start.kind !== 'consent') throw new Error(`esperaba consent, vino ${start.to}`);
        const decision = await oauth.approve(start.requestId, userId, { tenant_id: tenantId, scope: opts.approveScope ?? 'full' });
        const url = new URL(decision.redirect_to);
        expect(url.origin + url.pathname).toBe(REDIRECT);
        expect(url.searchParams.get('state')).toBe(state);
        return { clientId, code: url.searchParams.get('code')!, verifier, state };
    }

    it('metadata: issuer = origen de la request, endpoints bajo /api/v1, PKCE S256, recurso = el MCP', () => {
        const as = oauth.authorizationServerMetadata(ORIGIN);
        expect(as).toMatchObject({
            issuer: ORIGIN,
            authorization_endpoint: `${ORIGIN}/api/v1/oauth/authorize`,
            token_endpoint: `${ORIGIN}/api/v1/oauth/token`,
            registration_endpoint: `${ORIGIN}/api/v1/oauth/register`,
            code_challenge_methods_supported: ['S256'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
        });
        const pr = oauth.protectedResourceMetadata(ORIGIN);
        expect(pr).toMatchObject({ resource: MCP, authorization_servers: [ORIGIN], scopes_supported: ['read', 'full'] });
        expect(oauth.wwwAuthenticate(ORIGIN)).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/v1/mcp"`);
    });

    it('registro dinámico: público sin secreto, confidencial con secreto hasheado, redirect inválida rechazada', async () => {
        const pub = await oauth.registerClient({ client_name: 'Claude', redirect_uris: [REDIRECT, 'https://claude.com/api/mcp/auth_callback'] });
        expect(pub.client_id.startsWith('ibc_')).toBe(true);
        expect(pub.client_secret).toBeUndefined();
        expect(pub.token_endpoint_auth_method).toBe('none');
        expect(pub.grant_types).toEqual(['authorization_code', 'refresh_token']);

        const conf = await oauth.registerClient({ client_name: 'Cursor', redirect_uris: ['cursor://anysphere.cursor-retrieval/oauth/cb'], token_endpoint_auth_method: 'client_secret_post' });
        expect(conf.client_secret).toBeDefined();
        const [row] = await pg.db.select().from(oauthClients).where(eq(oauthClients.clientId, conf.client_id));
        expect(row!.clientSecretHash).toBe(createHash('sha256').update(conf.client_secret!).digest('hex'));
        expect(JSON.stringify(row)).not.toContain(conf.client_secret!);

        await expect(oauth.registerClient({ redirect_uris: ['http://evil.com/cb'] })).rejects.toMatchObject({ error: 'invalid_redirect_uri' });
        await expect(oauth.registerClient({ redirect_uris: [] })).rejects.toMatchObject({ error: 'invalid_redirect_uri' });
        await expect(oauth.registerClient({ redirect_uris: [REDIRECT], grant_types: ['implicit'] })).rejects.toMatchObject({ error: 'invalid_client_metadata' });
        // Sin nombre → el host del redirect.
        expect((await oauth.registerClient({ redirect_uris: [REDIRECT] })).client_name).toBe('claude.ai');
    });

    it('authorize: cliente/redirect desconocidos LANZAN (sin redirect); otros errores vuelven al cliente; OK → pedido pendiente', async () => {
        const reg = await oauth.registerClient({ client_name: 'Claude', redirect_uris: [REDIRECT] });
        const { challenge } = pkce();
        const base = { response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's1' };

        await expect(oauth.startAuthorization(ORIGIN, { ...base, client_id: 'ibc_nope' })).rejects.toBeInstanceOf(OauthError);
        await expect(oauth.startAuthorization(ORIGIN, { ...base, redirect_uri: 'https://claude.ai/otra' })).rejects.toMatchObject({ error: 'invalid_request' });

        const noPkce = await oauth.startAuthorization(ORIGIN, { ...base, code_challenge: undefined, code_challenge_method: undefined });
        expect(noPkce.kind).toBe('redirect');
        expect(new URL((noPkce as { to: string }).to).searchParams.get('error')).toBe('invalid_request');
        const plain = await oauth.startAuthorization(ORIGIN, { ...base, code_challenge_method: 'plain' });
        expect(new URL((plain as { to: string }).to).searchParams.get('error')).toBe('invalid_request');
        const badResource = await oauth.startAuthorization(ORIGIN, { ...base, resource: 'https://otro.local/api/v1/mcp' });
        expect(new URL((badResource as { to: string }).to).searchParams.get('error')).toBe('invalid_target');
        const badScope = await oauth.startAuthorization(ORIGIN, { ...base, scope: 'openid' });
        expect(new URL((badScope as { to: string }).to).searchParams.get('error')).toBe('invalid_scope');
        expect(new URL((badScope as { to: string }).to).searchParams.get('state')).toBe('s1');

        const ok = await oauth.startAuthorization(ORIGIN, { ...base, scope: 'read' });
        expect(ok.kind).toBe('consent');
        const req = await oauth.getRequest((ok as { requestId: string }).requestId);
        expect(req).toMatchObject({ client_name: 'Claude', scope: 'read', redirect_host: 'claude.ai' });
        await expect(oauth.getRequest('no-existe-0000000000')).rejects.toMatchObject({ status: 404 });
    });

    it('approve: sólo un workspace propio; el pedido se consume (segundo approve → 404); deny → access_denied', async () => {
        const reg = await oauth.registerClient({ client_name: 'Claude', redirect_uris: [REDIRECT] });
        const { challenge } = pkce();
        const params = { response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st' };
        const start = (await oauth.startAuthorization(ORIGIN, params)) as { requestId: string };
        await expect(oauth.approve(start.requestId, userId, { tenant_id: otherTenantId, scope: 'full' })).rejects.toMatchObject({ status: 404 });
        const decision = await oauth.approve(start.requestId, userId, { tenant_id: tenantId, scope: 'full' });
        expect(new URL(decision.redirect_to).searchParams.get('code')).toBeTruthy();
        await expect(oauth.approve(start.requestId, userId, { tenant_id: tenantId, scope: 'full' })).rejects.toMatchObject({ status: 404 });

        const start2 = (await oauth.startAuthorization(ORIGIN, params)) as { requestId: string };
        const denied = await oauth.deny(start2.requestId);
        const u = new URL(denied.redirect_to);
        expect(u.searchParams.get('error')).toBe('access_denied');
        expect(u.searchParams.get('state')).toBe('st');
        expect(u.searchParams.get('code')).toBeNull();
    });

    it('token: PKCE malo quema el code; canje OK → token que el MCP resuelve con la identidad y el alcance elegidos', async () => {
        const bad = await authorizeFlow({ approveScope: 'read' });
        await expect(oauth.token({ grant_type: 'authorization_code', client_id: bad.clientId, code: bad.code, code_verifier: 'x'.repeat(50), redirect_uri: REDIRECT }, undefined))
            .rejects.toMatchObject({ error: 'invalid_grant' });
        // El code ya se quemó: ni con el verifier correcto.
        await expect(oauth.token({ grant_type: 'authorization_code', client_id: bad.clientId, code: bad.code, code_verifier: bad.verifier }, undefined))
            .rejects.toMatchObject({ error: 'invalid_grant' });

        const ok = await authorizeFlow({ scope: 'full', approveScope: 'read' });
        // Otro cliente no puede canjear ese code.
        const intruder = await oauth.registerClient({ client_name: 'Intruso', redirect_uris: [REDIRECT] });
        await expect(oauth.token({ grant_type: 'authorization_code', client_id: intruder.client_id, code: ok.code, code_verifier: ok.verifier }, undefined))
            .rejects.toMatchObject({ error: 'invalid_grant' });
        // …y como el code es de un solo uso, el intento del intruso lo quemó → repetimos el flujo.
        const ok2 = await authorizeFlow({ clientId: ok.clientId, approveScope: 'read' });
        const res = await oauth.token({ grant_type: 'authorization_code', client_id: ok2.clientId, code: ok2.code, code_verifier: ok2.verifier, redirect_uri: REDIRECT }, undefined);
        expect(res).toMatchObject({ token_type: 'Bearer', scope: 'read', expires_in: Math.floor(ACCESS_TTL_MS / 1000) });
        expect(res.access_token.startsWith(TOKEN_PREFIX)).toBe(true);
        expect(res.refresh_token.startsWith(REFRESH_PREFIX)).toBe(true);
        const resolved = await tokens.resolve(res.access_token);
        expect(resolved).toMatchObject({ userId, tenantId, role: 'manager', scope: 'read' });
        // En Ajustes se ve como conexión del cliente, sin secretos.
        const listed = (await tokens.list(userId, tenantId)).find((t) => t.id === resolved!.tokenId)!;
        expect(listed).toMatchObject({ client_name: 'Claude', name: 'Claude', scope: 'read' });
        const [row] = await pg.db.select().from(personalAccessTokens).where(eq(personalAccessTokens.id, listed.id));
        expect(row!.clientId).toBe(ok2.clientId);
        expect(JSON.stringify(row)).not.toContain(res.access_token.slice(10));
        expect(JSON.stringify(row)).not.toContain(res.refresh_token.slice(10));
        expect(row!.refreshExpiresAt!.getTime()).toBeGreaterThan(Date.now() + REFRESH_TTL_MS - 60_000);
    });

    it('refresh: rota los dos secretos en la misma fila; el par viejo muere; otro cliente no puede; revocar desde Ajustes mata el refresh', async () => {
        const flow = await authorizeFlow();
        const first = await oauth.token({ grant_type: 'authorization_code', client_id: flow.clientId, code: flow.code, code_verifier: flow.verifier }, undefined);
        const idBefore = (await tokens.resolve(first.access_token))!.tokenId;

        const second = await oauth.token({ grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: first.refresh_token }, undefined);
        expect(second.access_token).not.toBe(first.access_token);
        expect(second.refresh_token).not.toBe(first.refresh_token);
        expect(second.scope).toBe('full');
        expect((await tokens.resolve(second.access_token))!.tokenId).toBe(idBefore); // misma fila
        expect(await tokens.resolve(first.access_token)).toBeNull();
        await expect(oauth.token({ grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: first.refresh_token }, undefined)).rejects.toMatchObject({ error: 'invalid_grant' });
        const other = await oauth.registerClient({ client_name: 'Otro', redirect_uris: [REDIRECT] });
        await expect(oauth.token({ grant_type: 'refresh_token', client_id: other.client_id, refresh_token: second.refresh_token }, undefined)).rejects.toMatchObject({ error: 'invalid_grant' });

        // Revocación desde la card (v0.1.183) → ni acceso ni refresh.
        await tokens.revoke(userId, tenantId, idBefore);
        expect(await tokens.resolve(second.access_token)).toBeNull();
        await expect(oauth.token({ grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: second.refresh_token }, undefined)).rejects.toMatchObject({ error: 'invalid_grant' });
    });

    it('revoke (RFC 7009) por acceso o refresh; cliente confidencial exige secreto (Basic o body)', async () => {
        const conf = await oauth.registerClient({ client_name: 'Cursor', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' });
        const flow = await authorizeFlow({ clientId: conf.client_id });
        await expect(oauth.token({ grant_type: 'authorization_code', client_id: conf.client_id, code: flow.code, code_verifier: flow.verifier }, undefined))
            .rejects.toMatchObject({ error: 'invalid_client', status: 401 });
        // El intento sin secreto NO quemó el code (falla antes de tocarlo).
        const basic = `Basic ${Buffer.from(`${conf.client_id}:${conf.client_secret}`).toString('base64')}`;
        const issued = await oauth.token({ grant_type: 'authorization_code', code: flow.code, code_verifier: flow.verifier }, basic);
        expect(await tokens.resolve(issued.access_token)).not.toBeNull();
        await expect(oauth.token({ grant_type: 'refresh_token', client_id: conf.client_id, client_secret: 'mal', refresh_token: issued.refresh_token }, undefined))
            .rejects.toMatchObject({ error: 'invalid_client' });

        await oauth.revoke({ token: issued.refresh_token }, basic);
        expect(await tokens.resolve(issued.access_token)).toBeNull();
        // Silencioso si ya no existe.
        await oauth.revoke({ token: issued.access_token, client_id: conf.client_id, client_secret: conf.client_secret }, undefined);
        await expect(oauth.token({ grant_type: 'password', client_id: conf.client_id, client_secret: conf.client_secret }, undefined)).rejects.toMatchObject({ error: 'unsupported_grant_type' });
    });
});
