import type { PersonalTokenScope } from '@imagina-base/shared';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/**
 * Helpers PUROS del servidor OAuth 2.1 del MCP (v0.1.184). Sin DB ni Redis:
 * se testean solos y no dependen de Nest.
 */

/** Error de protocolo con el shape de RFC 6749 §5.2 (`{error, error_description}`). */
export class OauthError extends Error {
    constructor(
        readonly error: string,
        readonly description: string,
        readonly status = 400,
    ) {
        super(`${error}: ${description}`);
    }
}

/**
 * Origen público de la request (`https://app.acme.com`), respetando el proxy
 * (`trustProxy` en Fastify resuelve `protocol`/`host` desde X-Forwarded-*).
 * El issuer OAuth y la URL del recurso MCP se derivan de acá — cada dominio
 * (plataforma o dominio propio de una empresa, ADR-S17) es su propio issuer,
 * y la cookie de sesión de la pantalla "Autorizar" es de ese mismo host.
 */
export function requestOrigin(req: Pick<FastifyRequest, 'protocol' | 'host'>): string {
    return `${req.protocol}://${req.host}`;
}

/**
 * Redirect URIs admitidas al registrar un cliente (RFC 8252):
 * - `https://…` (claude.ai, claude.com, cualquier app web);
 * - `http://` SÓLO en loopback (Claude Code / Inspector abren un puerto local);
 * - esquemas privados (`cursor://…`) para apps nativas.
 * Nada de `javascript:`/`data:`/`file:` ni fragmentos.
 */
export function isAllowedRedirectUri(uri: string): boolean {
    if (typeof uri !== 'string' || uri.length === 0 || uri.length > 2048 || uri.includes('#')) return false;
    let url: URL;
    try {
        url = new URL(uri);
    } catch {
        return false;
    }
    const scheme = url.protocol.replace(/:$/, '').toLowerCase();
    if (scheme === 'https') return url.hostname.length > 0;
    if (scheme === 'http') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    if (['javascript', 'data', 'file', 'blob', 'vbscript', 'about'].includes(scheme)) return false;
    return /^[a-z][a-z0-9+.-]*$/.test(scheme);
}

/** Comparación EXACTA (RFC 6749 §3.1.2.3) — nada de prefijos ni wildcards. */
export function redirectUriMatches(registered: string[], candidate: string): boolean {
    return registered.some((r) => r === candidate);
}

/** PKCE S256: `base64url(sha256(verifier)) === challenge`, en tiempo constante. */
export function pkceMatches(verifier: string, challenge: string): boolean {
    if (typeof verifier !== 'string' || verifier.length < 43 || verifier.length > 128) return false;
    if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false;
    const computed = createHash('sha256').update(verifier).digest('base64url');
    const a = Buffer.from(computed);
    const b = Buffer.from(challenge);
    return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `scope` (separado por espacios) → el alcance que se ofrece en la pantalla
 * de autorización. `full` gana si está; desconocidos se ignoran; sin scope →
 * `full` (la persona lo ve y lo cambia en la pantalla — el default no se
 * aplica a ciegas). Devuelve `null` si pidieron SÓLO scopes desconocidos.
 */
export function parseRequestedScope(scope: string | undefined): PersonalTokenScope | null {
    if (!scope || scope.trim() === '') return 'full';
    const parts = scope.split(/\s+/).filter(Boolean);
    const known = parts.filter((p) => p === 'read' || p === 'full');
    if (known.length === 0) return null;
    return known.includes('full') ? 'full' : 'read';
}

/**
 * El `resource` (RFC 8707) tiene que ser NUESTRO recurso MCP: mismo path
 * (`/api/v1/mcp`, sin barra final ni fragmento) y esquema http(s). El HOST
 * puede diferir del de la request a propósito (v0.1.186): con el
 * descubrimiento estático, una empresa que entra por su dominio propio
 * (ADR-S17) autoriza en el dominio de la plataforma y usa el MCP en el suyo —
 * el token es de la app, no del host.
 */
export function resourceMatches(mcpUrl: string, resource: string | undefined): boolean {
    if (resource === undefined) return true;
    try {
        const r = new URL(resource);
        const m = new URL(mcpUrl);
        return (r.protocol === 'https:' || r.protocol === 'http:') && r.pathname.replace(/\/+$/, '') === m.pathname.replace(/\/+$/, '') && r.hash === '';
    } catch {
        return false;
    }
}

/** Agrega parámetros a la query de un redirect URI (conserva los que ya tenía). */
export function appendQuery(uri: string, params: Record<string, string | undefined>): string {
    const url = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    return url.toString();
}

/** Credenciales de cliente en `Authorization: Basic` (RFC 6749 §2.3.1) o en el body. */
export function extractClientCredentials(
    body: Record<string, unknown>,
    authorization: string | undefined,
): { clientId: string | null; clientSecret: string | null; viaHeader: boolean } {
    if (authorization?.startsWith('Basic ')) {
        try {
            const decoded = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8');
            const idx = decoded.indexOf(':');
            if (idx > 0) {
                return {
                    clientId: decodeURIComponent(decoded.slice(0, idx)),
                    clientSecret: decodeURIComponent(decoded.slice(idx + 1)),
                    viaHeader: true,
                };
            }
        } catch {
            // cae al body
        }
    }
    const clientId = typeof body.client_id === 'string' && body.client_id !== '' ? body.client_id : null;
    const clientSecret = typeof body.client_secret === 'string' && body.client_secret !== '' ? body.client_secret : null;
    return { clientId, clientSecret, viaHeader: false };
}

export function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function secretsEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
}
