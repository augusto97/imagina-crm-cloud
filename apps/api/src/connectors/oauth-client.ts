import { createHash, randomBytes } from 'node:crypto';
import type { ConnectorPair, OAuthConfig } from '@imagina-base/shared';

/**
 * OAuth 2.0 como CLIENTE (v0.1.199, ADR-S22 fase 3).
 *
 * Hasta acá toda credencial era un secreto ESTÁTICO que alguien pegaba. Para
 * Google, Slack, Microsoft o HubSpot eso no existe: la empresa autoriza la app
 * una vez y el proveedor entrega un token que caduca y se renueva solo.
 *
 * Las piezas de acá son PURAS —armar la URL de autorización, armar el cuerpo
 * del canje, leer la respuesta— por el mismo motivo que `connectionParts` y
 * `compileConnectorCall`: se prueban solas y no pueden divergir de lo que
 * después ejecuta el servicio.
 */

export interface PkcePair {
    verifier: string;
    challenge: string;
}

/**
 * PKCE (RFC 7636) **siempre**, aunque la app tenga client secret: es barato y
 * varios proveedores ya lo exigen. El `verifier` queda del lado del servidor;
 * al proveedor sólo viaja su SHA-256.
 */
export function createPkce(): PkcePair {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

/** Los parámetros extra que el proveedor necesita, ya filtrados. */
function extras(pairs: readonly ConnectorPair[]): Array<[string, string]> {
    return pairs
        .map((p) => [p.key.trim(), p.value] as [string, string])
        .filter(([key]) => key !== '');
}

/**
 * URL a la que se manda el navegador para que la persona autorice.
 *
 * `state` es la defensa contra CSRF del callback: el servidor lo guarda y no
 * acepta ningún código cuyo `state` no haya emitido él.
 */
export function buildAuthorizeUrl(
    cfg: OAuthConfig,
    args: { redirectUri: string; state: string; challenge: string },
): string {
    const url = new URL(cfg.authorize_url);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', cfg.client_id);
    url.searchParams.set('redirect_uri', args.redirectUri);
    url.searchParams.set('state', args.state);
    url.searchParams.set('code_challenge', args.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (cfg.scopes.trim() !== '') url.searchParams.set('scope', cfg.scopes.trim());
    // Los extra van AL FINAL: un preset puede necesitar pisar algo (por
    // ejemplo Google, que pide `access_type=offline` para dar refresh token).
    for (const [key, value] of extras(cfg.extra_params)) url.searchParams.set(key, value);
    return url.toString();
}

/** Cuerpo `x-www-form-urlencoded` del canje de código por tokens. */
export function buildTokenExchangeBody(args: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
    verifier: string;
}): string {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: args.code,
        redirect_uri: args.redirectUri,
        client_id: args.clientId,
        code_verifier: args.verifier,
    });
    // Un cliente público (sin secreto) es legítimo: PKCE lo cubre.
    if (args.clientSecret !== '') body.set('client_secret', args.clientSecret);
    return body.toString();
}

/** Cuerpo del refresh. Mismo endpoint, otro `grant_type`. */
export function buildRefreshBody(args: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
}): string {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: args.refreshToken,
        client_id: args.clientId,
    });
    if (args.clientSecret !== '') body.set('client_secret', args.clientSecret);
    return body.toString();
}

export interface TokenResponse {
    accessToken: string;
    /** `null` cuando el proveedor no rota ni entrega uno nuevo. */
    refreshToken: string | null;
    /** Epoch ms de vencimiento, o `null` si el proveedor no lo dice. */
    expiresAt: number | null;
    scope: string;
}

/**
 * Lee la respuesta del proveedor. Acepta JSON (lo normal) y
 * `x-www-form-urlencoded`, que algunos proveedores viejos todavía devuelven.
 *
 * Devuelve el error del proveedor TAL CUAL cuando lo hay: "invalid_grant" es
 * exactamente lo que hay que leer para entender que el refresh token murió.
 */
export function parseTokenResponse(raw: string, contentType: string, now: number): TokenResponse {
    let data: Record<string, unknown>;
    if (contentType.includes('json') || raw.trim().startsWith('{')) {
        try {
            data = JSON.parse(raw) as Record<string, unknown>;
        } catch {
            throw new Error(`El proveedor devolvió algo que no es JSON: ${raw.slice(0, 200)}`);
        }
    } else {
        data = Object.fromEntries(new URLSearchParams(raw));
    }

    const error = typeof data.error === 'string' ? data.error : '';
    if (error !== '') {
        const detail =
            typeof data.error_description === 'string' ? `: ${data.error_description}` : '';
        throw new Error(`El proveedor rechazó el pedido (${error})${detail}`);
    }

    const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
    if (accessToken === '') {
        throw new Error('El proveedor no devolvió `access_token`.');
    }
    const refreshToken =
        typeof data.refresh_token === 'string' && data.refresh_token !== ''
            ? data.refresh_token
            : null;
    const expiresIn = Number(data.expires_in);
    return {
        accessToken,
        refreshToken,
        expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : null,
        scope: typeof data.scope === 'string' ? data.scope : '',
    };
}

/**
 * ¿Hay que renovar? Con margen de 60 s: un token que vence "ahora mismo"
 * llega vencido al otro lado, entre la red y el tiempo de proceso.
 */
export const REFRESH_MARGIN_MS = 60_000;

export function needsRefresh(expiresAt: number | null, now: number): boolean {
    // Sin vencimiento declarado no se renueva a ciegas: hay proveedores cuyos
    // tokens no caducan, y pedir un refresh de más puede consumir cupo.
    if (expiresAt === null) return false;
    return expiresAt - REFRESH_MARGIN_MS <= now;
}
