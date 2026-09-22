import { createHash } from 'node:crypto';
import { oauthConfigSchema, OAUTH_PROVIDER_PRESETS } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';
import {
    buildAuthorizeUrl,
    buildRefreshBody,
    buildTokenExchangeBody,
    createPkce,
    needsRefresh,
    parseTokenResponse,
    REFRESH_MARGIN_MS,
} from '../src/connectors/oauth-client';

/**
 * v0.1.199 (ADR-S22 fase 3) — OAuth 2.0 como CLIENTE.
 *
 * Las piezas son puras justamente para poder probarlas contra el protocolo:
 * un `code_challenge` mal derivado o un `redirect_uri` que no coincide fallan
 * recién contra el proveedor real, donde el mensaje no dice nada útil.
 */

const cfg = oauthConfigSchema.parse({
    client_id: 'cliente-123',
    authorize_url: 'https://accounts.example.test/o/auth',
    token_url: 'https://accounts.example.test/token',
    scopes: 'read write',
});

describe('createPkce', () => {
    it('el challenge es el SHA-256 del verifier en base64url (RFC 7636)', () => {
        const { verifier, challenge } = createPkce();
        expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
        // base64url: nada de +, / ni relleno, o el proveedor lo rechaza.
        expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(verifier.length).toBeGreaterThanOrEqual(43);
    });

    it('cada autorización usa un verifier distinto', () => {
        expect(createPkce().verifier).not.toBe(createPkce().verifier);
    });
});

describe('buildAuthorizeUrl', () => {
    it('arma la URL con PKCE y el state', () => {
        const url = new URL(
            buildAuthorizeUrl(cfg, {
                redirectUri: 'https://app.test/api/v1/connections/oauth/callback',
                state: 'st-1',
                challenge: 'ch-1',
            }),
        );
        expect(url.origin + url.pathname).toBe('https://accounts.example.test/o/auth');
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('client_id')).toBe('cliente-123');
        expect(url.searchParams.get('redirect_uri')).toBe(
            'https://app.test/api/v1/connections/oauth/callback',
        );
        expect(url.searchParams.get('state')).toBe('st-1');
        expect(url.searchParams.get('code_challenge')).toBe('ch-1');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('scope')).toBe('read write');
    });

    it('los extra_params del preset viajan (el `access_type=offline` de Google)', () => {
        const google = OAUTH_PROVIDER_PRESETS.find((p) => p.key === 'google')!;
        const url = new URL(
            buildAuthorizeUrl(
                oauthConfigSchema.parse({
                    client_id: 'g',
                    authorize_url: google.authorize_url,
                    token_url: google.token_url,
                    extra_params: google.extra_params,
                }),
                { redirectUri: 'https://app.test/cb', state: 's', challenge: 'c' },
            ),
        );
        // Sin esto Google no entrega refresh token y la conexión muere a la hora.
        expect(url.searchParams.get('access_type')).toBe('offline');
        expect(url.searchParams.get('prompt')).toBe('consent');
    });
});

describe('cuerpos del canje y del refresh', () => {
    it('el canje incluye el verifier y el redirect_uri exacto', () => {
        const body = new URLSearchParams(
            buildTokenExchangeBody({
                code: 'abc/def',
                redirectUri: 'https://app.test/cb',
                clientId: 'cliente-123',
                clientSecret: 's3cr3t',
                verifier: 'ver-1',
            }),
        );
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code')).toBe('abc/def');
        expect(body.get('redirect_uri')).toBe('https://app.test/cb');
        expect(body.get('code_verifier')).toBe('ver-1');
        expect(body.get('client_secret')).toBe('s3cr3t');
    });

    it('un cliente público (sin secreto) no manda `client_secret` vacío', () => {
        const body = new URLSearchParams(
            buildTokenExchangeBody({
                code: 'c',
                redirectUri: 'https://app.test/cb',
                clientId: 'cliente-123',
                clientSecret: '',
                verifier: 'v',
            }),
        );
        // Mandarlo vacío hace que varios proveedores rechacen el canje.
        expect(body.has('client_secret')).toBe(false);
    });

    it('el refresh usa el mismo endpoint con otro grant_type', () => {
        const body = new URLSearchParams(
            buildRefreshBody({ refreshToken: 'rt-1', clientId: 'c', clientSecret: 's' }),
        );
        expect(body.get('grant_type')).toBe('refresh_token');
        expect(body.get('refresh_token')).toBe('rt-1');
    });
});

describe('parseTokenResponse', () => {
    const now = 1_700_000_000_000;

    it('lee la respuesta JSON y calcula el vencimiento', () => {
        const out = parseTokenResponse(
            JSON.stringify({
                access_token: 'at',
                refresh_token: 'rt',
                expires_in: 3600,
                scope: 'read',
            }),
            'application/json',
            now,
        );
        expect(out).toEqual({
            accessToken: 'at',
            refreshToken: 'rt',
            expiresAt: now + 3_600_000,
            scope: 'read',
        });
    });

    it('acepta x-www-form-urlencoded (GitHub responde así por defecto)', () => {
        const out = parseTokenResponse(
            'access_token=at&scope=repo&token_type=bearer',
            'application/x-www-form-urlencoded',
            now,
        );
        expect(out.accessToken).toBe('at');
        expect(out.scope).toBe('repo');
        // Sin `expires_in` no se inventa un vencimiento.
        expect(out.expiresAt).toBeNull();
        expect(out.refreshToken).toBeNull();
    });

    it('propaga el error del proveedor TAL CUAL (invalid_grant es el diagnóstico)', () => {
        expect(() =>
            parseTokenResponse(
                JSON.stringify({ error: 'invalid_grant', error_description: 'Token has expired' }),
                'application/json',
                now,
            ),
        ).toThrow(/invalid_grant.*Token has expired/);
    });

    it('una respuesta sin access_token es un error, no un token vacío', () => {
        expect(() => parseTokenResponse('{}', 'application/json', now)).toThrow(/access_token/);
        expect(() => parseTokenResponse('<html>502</html>', 'text/html', now)).toThrow();
    });
});

describe('needsRefresh', () => {
    const now = 1_700_000_000_000;

    it('renueva con margen: un token que vence "ahora" llega vencido al otro lado', () => {
        expect(needsRefresh(now + REFRESH_MARGIN_MS + 1000, now)).toBe(false);
        expect(needsRefresh(now + REFRESH_MARGIN_MS - 1000, now)).toBe(true);
        expect(needsRefresh(now - 1, now)).toBe(true);
    });

    it('sin vencimiento declarado NO renueva a ciegas', () => {
        // Hay proveedores cuyos tokens no caducan; pedir un refresh de más
        // puede consumir cupo o rotar un token que andaba bien.
        expect(needsRefresh(null, now)).toBe(false);
    });
});
