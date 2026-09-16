import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OauthApproveInput, OauthAuthorizationRequest, OauthDecision, PersonalTokenScope, Role } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { DRIZZLE, type Db } from '../db/client';
import { memberships, oauthClients } from '../db/schema';
import { REDIS } from '../redis/redis.module';
import {
    OauthError,
    appendQuery,
    extractClientCredentials,
    isAllowedRedirectUri,
    parseRequestedScope,
    pkceMatches,
    redirectUriMatches,
    resourceMatches,
    secretsEqual,
    sha256Hex,
} from './oauth.util';
import { PersonalTokensService, assertNotClient } from './tokens.service';

/** Rutas públicas del servidor (bajo el prefijo del API salvo `.well-known`). */
export const OAUTH_PATHS = {
    mcp: '/api/v1/mcp',
    authorize: '/api/v1/oauth/authorize',
    token: '/api/v1/oauth/token',
    register: '/api/v1/oauth/register',
    revoke: '/api/v1/oauth/revoke',
    /** Página del SPA (fuera del hash router) que muestra "Autorizar". */
    consentPage: '/oauth/authorize',
    asMetadata: '/.well-known/oauth-authorization-server',
    prMetadata: '/.well-known/oauth-protected-resource',
} as const;

const SCOPES = ['read', 'full'] as const;
const AUTH_METHODS = ['none', 'client_secret_basic', 'client_secret_post'] as const;
type AuthMethod = (typeof AUTH_METHODS)[number];

/** El pedido de autorización espera a la persona 10 minutos; el code, 5. */
const REQUEST_TTL_SECONDS = 10 * 60;
const CODE_TTL_SECONDS = 5 * 60;
/** Acceso corto + refresh rotativo (cada renovación estira 30 días más). */
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 86_400_000;

interface PendingRequest {
    client_id: string;
    client_name: string;
    redirect_uri: string;
    state?: string;
    scope: PersonalTokenScope;
    code_challenge: string;
    resource?: string;
    created_at: number;
}

interface IssuedCode {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    user_id: number;
    tenant_id: number;
    scope: PersonalTokenScope;
}

export interface RegisteredClient {
    client_id: string;
    client_secret?: string;
    client_id_issued_at: number;
    client_secret_expires_at?: number;
    client_name: string;
    redirect_uris: string[];
    token_endpoint_auth_method: AuthMethod;
    grant_types: string[];
    response_types: string[];
}

export interface TokenResponse {
    access_token: string;
    token_type: 'Bearer';
    expires_in: number;
    refresh_token: string;
    scope: PersonalTokenScope;
}

/** Resultado de `startAuthorization`: o vamos a la pantalla, o devolvemos el error al cliente por redirect. */
export type AuthorizationStart = { kind: 'consent'; requestId: string } | { kind: 'redirect'; to: string };

/**
 * Servidor de autorización OAuth 2.1 del MCP (ADR-S21 fase 4, v0.1.184).
 *
 * Es la puerta que usan claude.ai, Claude Desktop y Cursor: "Agregar conector"
 * → descubren la metadata, se registran solos (RFC 7591), mandan a la persona
 * a NUESTRA pantalla "Autorizar" (sesión normal de la app: elige workspace y
 * alcance) y canjean el code por un token. El token emitido es una fila de
 * `personal_access_tokens` con cliente + refresh rotativo, así el MCP, la
 * revocación desde Ajustes y la bitácora son EXACTAMENTE los de v0.1.183.
 *
 * Reglas que no se negocian: PKCE S256 obligatorio (también con secreto),
 * redirect_uri por igualdad exacta, code de un solo uso (GETDEL), refresh de
 * un solo uso (rotación con WHERE del hash viejo) y `resource` (RFC 8707)
 * que, si viene, tiene que ser nuestro MCP.
 */
@Injectable()
export class OauthService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly redis: Redis,
        private readonly tokens: PersonalTokensService,
    ) {}

    // ── Metadata (RFC 8414 / RFC 9728) ────────────────────────────────────

    authorizationServerMetadata(origin: string): Record<string, unknown> {
        return {
            issuer: origin,
            authorization_endpoint: `${origin}${OAUTH_PATHS.authorize}`,
            token_endpoint: `${origin}${OAUTH_PATHS.token}`,
            registration_endpoint: `${origin}${OAUTH_PATHS.register}`,
            revocation_endpoint: `${origin}${OAUTH_PATHS.revoke}`,
            response_types_supported: ['code'],
            response_modes_supported: ['query'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: [...AUTH_METHODS],
            revocation_endpoint_auth_methods_supported: [...AUTH_METHODS],
            scopes_supported: [...SCOPES],
            service_documentation: 'https://github.com/augusto97/imagina-crm-cloud/blob/main/docs/mcp.md',
        };
    }

    protectedResourceMetadata(origin: string): Record<string, unknown> {
        return {
            resource: `${origin}${OAUTH_PATHS.mcp}`,
            authorization_servers: [origin],
            scopes_supported: [...SCOPES],
            bearer_methods_supported: ['header'],
            resource_name: 'Imagina Base MCP',
            resource_documentation: 'https://github.com/augusto97/imagina-crm-cloud/blob/main/docs/mcp.md',
        };
    }

    /** Lo que va en el `WWW-Authenticate` del 401 del MCP para que el cliente descubra el servidor. */
    wwwAuthenticate(origin: string): string {
        return `Bearer realm="imagina-base", error="invalid_token", resource_metadata="${origin}${OAUTH_PATHS.prMetadata}${OAUTH_PATHS.mcp}"`;
    }

    // ── Registro dinámico de clientes (RFC 7591) ──────────────────────────

    async registerClient(input: unknown): Promise<RegisteredClient> {
        const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
        const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
        if (uris.length === 0 || uris.length > 10) throw new OauthError('invalid_redirect_uri', 'redirect_uris: se requiere entre 1 y 10');
        for (const u of uris) {
            if (!isAllowedRedirectUri(u as string)) {
                throw new OauthError('invalid_redirect_uri', `redirect_uri no admitida: ${String(u).slice(0, 120)} (https, http en localhost o esquema de app nativa)`);
            }
        }
        const method = (body.token_endpoint_auth_method ?? 'none') as AuthMethod;
        if (!AUTH_METHODS.includes(method)) throw new OauthError('invalid_client_metadata', `token_endpoint_auth_method no soportado: ${String(method)}`);
        const grants = Array.isArray(body.grant_types) && body.grant_types.length > 0 ? (body.grant_types as string[]) : ['authorization_code', 'refresh_token'];
        for (const g of grants) if (g !== 'authorization_code' && g !== 'refresh_token') throw new OauthError('invalid_client_metadata', `grant_type no soportado: ${g}`);
        const responses = Array.isArray(body.response_types) && body.response_types.length > 0 ? (body.response_types as string[]) : ['code'];
        for (const r of responses) if (r !== 'code') throw new OauthError('invalid_client_metadata', `response_type no soportado: ${r}`);
        const rawName = typeof body.client_name === 'string' ? body.client_name.trim() : '';
        const clientName = (rawName === '' ? hostOf(uris[0] as string) : rawName).slice(0, 80);

        const clientId = `ibc_${randomBytes(16).toString('base64url')}`;
        const secret = method === 'none' ? undefined : randomBytes(32).toString('base64url');
        await this.db.insert(oauthClients).values({
            clientId,
            clientSecretHash: secret ? sha256Hex(secret) : null,
            clientName,
            redirectUris: uris as string[],
            tokenEndpointAuthMethod: method,
        });
        return {
            client_id: clientId,
            ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
            client_id_issued_at: Math.floor(Date.now() / 1000),
            client_name: clientName,
            redirect_uris: uris as string[],
            token_endpoint_auth_method: method,
            grant_types: grants,
            response_types: responses,
        };
    }

    // ── Autorización ──────────────────────────────────────────────────────

    /**
     * `GET /oauth/authorize?…`: valida y guarda el pedido. Cliente o
     * redirect_uri inválidos → lanza (se muestra el error, NUNCA se redirige a
     * una URL no registrada); el resto de errores vuelven al cliente por
     * redirect con `error=`.
     */
    async startAuthorization(origin: string, query: Record<string, unknown>): Promise<AuthorizationStart> {
        const q = (k: string): string | undefined => (typeof query[k] === 'string' && query[k] !== '' ? (query[k] as string) : undefined);
        const clientId = q('client_id');
        const redirectUri = q('redirect_uri');
        if (!clientId) throw new OauthError('invalid_request', 'Falta client_id');
        const client = await this.client(clientId);
        if (!client) throw new OauthError('invalid_client', 'Cliente desconocido: volvé a agregar el conector para que se registre de nuevo', 400);
        if (!redirectUri || !redirectUriMatches(client.redirectUris, redirectUri)) {
            throw new OauthError('invalid_request', 'redirect_uri no coincide con la registrada por el cliente');
        }
        const state = q('state');
        const back = (error: string, description: string): AuthorizationStart => ({
            kind: 'redirect',
            to: appendQuery(redirectUri, { error, error_description: description, state }),
        });
        if (q('response_type') !== 'code') return back('unsupported_response_type', 'Sólo response_type=code');
        const challenge = q('code_challenge');
        if (!challenge || (q('code_challenge_method') ?? 'plain') !== 'S256') return back('invalid_request', 'PKCE S256 es obligatorio (code_challenge + code_challenge_method=S256)');
        if (!/^[A-Za-z0-9\-_]{43}$/.test(challenge)) return back('invalid_request', 'code_challenge inválido');
        const scope = parseRequestedScope(q('scope'));
        if (scope === null) return back('invalid_scope', `Alcances válidos: ${SCOPES.join(', ')}`);
        const resource = q('resource');
        if (!resourceMatches(`${origin}${OAUTH_PATHS.mcp}`, resource)) return back('invalid_target', `resource tiene que ser ${origin}${OAUTH_PATHS.mcp}`);

        const requestId = randomBytes(18).toString('base64url');
        const pending: PendingRequest = {
            client_id: client.clientId,
            client_name: client.clientName,
            redirect_uri: redirectUri,
            state,
            scope,
            code_challenge: challenge,
            resource,
            created_at: Date.now(),
        };
        await this.redis.set(reqKey(requestId), JSON.stringify(pending), 'EX', REQUEST_TTL_SECONDS);
        await this.db.update(oauthClients).set({ lastUsedAt: new Date() }).where(eq(oauthClients.clientId, client.clientId)).catch(() => undefined);
        return { kind: 'consent', requestId };
    }

    /** Para la pantalla "Autorizar" (con sesión): qué cliente pide y qué alcance. */
    async getRequest(requestId: string): Promise<OauthAuthorizationRequest> {
        const pending = await this.pending(requestId);
        return {
            id: requestId,
            client_name: pending.client_name,
            scope: pending.scope,
            redirect_host: hostOf(pending.redirect_uri),
            expires_at: new Date(pending.created_at + REQUEST_TTL_SECONDS * 1000).toISOString(),
        };
    }

    /**
     * La persona aprobó: emite el code (un solo uso, 5 min) atado al cliente,
     * redirect, PKCE, usuario, workspace y alcance. Sólo un workspace del que
     * ES miembro — el id viene del navegador y se verifica acá.
     */
    async approve(requestId: string, userId: number, input: OauthApproveInput): Promise<OauthDecision> {
        const pending = await this.pending(requestId);
        const [member] = await this.db
            .select({ tenantId: memberships.tenantId, role: memberships.role })
            .from(memberships)
            .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, input.tenant_id)))
            .limit(1);
        if (!member) throw new NotFoundException({ code: 'not_a_member', message: 'No sos miembro de ese workspace', data: { status: 404 } });
        // v0.1.185 — el usuario del portal (rol client) no autoriza conectores.
        assertNotClient(member.role as Role);
        // GETDEL: el pedido se consume — un segundo "Autorizar" (doble click,
        // pestaña duplicada) no emite dos codes.
        const raw = await this.redis.getdel(reqKey(requestId));
        if (!raw) throw new NotFoundException({ code: 'oauth_request_expired', message: 'El pedido de autorización venció o ya se usó', data: { status: 404 } });
        const code = randomBytes(32).toString('base64url');
        const issued: IssuedCode = {
            client_id: pending.client_id,
            redirect_uri: pending.redirect_uri,
            code_challenge: pending.code_challenge,
            user_id: userId,
            tenant_id: input.tenant_id,
            scope: input.scope,
        };
        await this.redis.set(codeKey(code), JSON.stringify(issued), 'EX', CODE_TTL_SECONDS);
        return { redirect_to: appendQuery(pending.redirect_uri, { code, state: pending.state }) };
    }

    async deny(requestId: string): Promise<OauthDecision> {
        const pending = await this.pending(requestId);
        await this.redis.del(reqKey(requestId));
        return { redirect_to: appendQuery(pending.redirect_uri, { error: 'access_denied', error_description: 'La persona no autorizó el acceso', state: pending.state }) };
    }

    // ── Token (RFC 6749 §4.1.3 / §6) ──────────────────────────────────────

    async token(body: Record<string, unknown>, authorization: string | undefined): Promise<TokenResponse> {
        const client = await this.authenticateClient(body, authorization);
        const grant = body.grant_type;
        if (grant === 'authorization_code') {
            const code = typeof body.code === 'string' ? body.code : '';
            const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
            if (!code || code.length > 128) throw new OauthError('invalid_request', 'Falta code');
            if (!verifier) throw new OauthError('invalid_request', 'Falta code_verifier (PKCE)');
            // Un solo uso: si el canje falla después (PKCE malo), el code ya se
            // quemó — es lo que pide OAuth 2.1 (un code robado no se reintenta).
            const raw = await this.redis.getdel(codeKey(code));
            if (!raw) throw new OauthError('invalid_grant', 'code inválido, vencido o ya usado');
            const issued = JSON.parse(raw) as IssuedCode;
            if (issued.client_id !== client.clientId) throw new OauthError('invalid_grant', 'El code no es de este cliente');
            const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : undefined;
            if (redirectUri !== undefined && redirectUri !== issued.redirect_uri) throw new OauthError('invalid_grant', 'redirect_uri no coincide con la de la autorización');
            if (!pkceMatches(verifier, issued.code_challenge)) throw new OauthError('invalid_grant', 'code_verifier no coincide con el code_challenge');
            const out = await this.tokens.issueForClient({
                userId: issued.user_id,
                tenantId: issued.tenant_id,
                scope: issued.scope,
                clientId: client.clientId,
                clientName: client.clientName,
                accessTtlMs: ACCESS_TTL_MS,
                refreshTtlMs: REFRESH_TTL_MS,
            });
            return { access_token: out.accessToken, token_type: 'Bearer', expires_in: out.expiresIn, refresh_token: out.refreshToken, scope: issued.scope };
        }
        if (grant === 'refresh_token') {
            const refresh = typeof body.refresh_token === 'string' ? body.refresh_token : '';
            if (!refresh) throw new OauthError('invalid_request', 'Falta refresh_token');
            const out = await this.tokens.rotate(refresh, client.clientId, ACCESS_TTL_MS, REFRESH_TTL_MS);
            if (!out) throw new OauthError('invalid_grant', 'refresh_token inválido, vencido, revocado o de otro cliente');
            // Un refresh no puede AMPLIAR el alcance; sí podría acotarlo, pero
            // acá se conserva el otorgado (los clientes MCP no lo cambian).
            return { access_token: out.accessToken, token_type: 'Bearer', expires_in: out.expiresIn, refresh_token: out.refreshToken, scope: out.token.scope };
        }
        throw new OauthError('unsupported_grant_type', 'grant_type: authorization_code o refresh_token');
    }

    /** RFC 7009. Siempre 200 (no revela si el token existía). */
    async revoke(body: Record<string, unknown>, authorization: string | undefined): Promise<void> {
        const client = await this.authenticateClient(body, authorization);
        const token = typeof body.token === 'string' ? body.token : '';
        if (token) await this.tokens.revokeBySecret(token, client.clientId);
    }

    // ── internos ──────────────────────────────────────────────────────────

    private async authenticateClient(body: Record<string, unknown>, authorization: string | undefined): Promise<typeof oauthClients.$inferSelect> {
        const creds = extractClientCredentials(body, authorization);
        if (!creds.clientId) throw new OauthError('invalid_client', 'Falta client_id', 401);
        const client = await this.client(creds.clientId);
        if (!client) throw new OauthError('invalid_client', 'Cliente desconocido', 401);
        if (client.tokenEndpointAuthMethod === 'none') return client;
        if (!creds.clientSecret || !client.clientSecretHash || !secretsEqual(sha256Hex(creds.clientSecret), client.clientSecretHash)) {
            throw new OauthError('invalid_client', 'client_secret inválido', 401);
        }
        return client;
    }

    private async client(clientId: string): Promise<typeof oauthClients.$inferSelect | null> {
        if (clientId.length > 64) return null;
        const [row] = await this.db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
        return row ?? null;
    }

    private async pending(requestId: string): Promise<PendingRequest> {
        if (!/^[A-Za-z0-9\-_]{16,40}$/.test(requestId)) {
            throw new NotFoundException({ code: 'oauth_request_expired', message: 'El pedido de autorización venció o ya se usó', data: { status: 404 } });
        }
        const raw = await this.redis.get(reqKey(requestId));
        if (!raw) throw new NotFoundException({ code: 'oauth_request_expired', message: 'El pedido de autorización venció o ya se usó', data: { status: 404 } });
        return JSON.parse(raw) as PendingRequest;
    }
}

function reqKey(id: string): string {
    return `oauthreq:${id}`;
}
function codeKey(code: string): string {
    return `oauthcode:${sha256Hex(code)}`;
}
function hostOf(uri: string): string {
    try {
        const u = new URL(uri);
        return u.host || u.protocol.replace(/:$/, '');
    } catch {
        return uri.slice(0, 40);
    }
}
