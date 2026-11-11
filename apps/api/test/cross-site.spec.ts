import { describe, expect, it } from 'vitest';
import { isAllowedSocketOrigin, isBlockedCrossSite, isFormBodyOnOperatorRoute, ownOriginOf } from '../src/common/cross-site';
import { socketHandshakeAllowed } from '../src/realtime/realtime.gateway';

/** SEC-35 (v0.1.239) — freno a pedidos que cambian algo desde otro sitio. */
describe('isBlockedCrossSite', () => {
    const base = { method: 'POST', path: '/api/v1/auth/login', host: 'app.acme.test' };

    it('login CSRF: un formulario de otro sitio se rechaza (Fetch Metadata u Origin)', () => {
        expect(isBlockedCrossSite({ ...base, secFetchSite: 'cross-site', origin: 'https://evil.test' })).toBe(true);
        // Navegador viejo sin Sec-Fetch-Site: decide el Origin.
        expect(isBlockedCrossSite({ ...base, origin: 'https://evil.test' })).toBe(true);
        expect(isBlockedCrossSite({ ...base, origin: 'null' })).toBe(true);
    });

    it('la propia app pasa (mismo origen, o Origin = host)', () => {
        expect(isBlockedCrossSite({ ...base, secFetchSite: 'same-origin' })).toBe(false);
        expect(isBlockedCrossSite({ ...base, secFetchSite: 'none' })).toBe(false);
        expect(isBlockedCrossSite({ ...base, origin: 'https://app.acme.test' })).toBe(false);
    });

    it('lo que no es un navegador (sin metadata ni Origin) pasa: webhooks de pagos, curl', () => {
        expect(isBlockedCrossSite({ ...base })).toBe(false);
    });

    it('las lecturas nunca se frenan', () => {
        expect(isBlockedCrossSite({ ...base, method: 'GET', secFetchSite: 'cross-site' })).toBe(false);
    });

    it('las superficies públicas pensadas para otros sitios siguen abiertas', () => {
        for (const path of [
            '/api/v1/public/hooks/abc123',
            '/api/v1/public/store-hooks/abc',
            '/api/v1/oauth/token',
            '/api/v1/mcp',
            '/api/v1/billing/webhook/paypal',
        ]) {
            expect(isBlockedCrossSite({ ...base, path, secFetchSite: 'cross-site', origin: 'https://cliente.test' })).toBe(false);
        }
        // …pero el resto del API no, aunque empiece parecido.
        expect(isBlockedCrossSite({ ...base, path: '/api/v1/publicx', secFetchSite: 'cross-site' })).toBe(true);
    });

    it('un origen cross-origin declarado por el despliegue pasa', () => {
        expect(
            isBlockedCrossSite({ ...base, secFetchSite: 'cross-site', origin: 'https://front.acme.test', allowedOrigins: ['https://front.acme.test'] }),
        ).toBe(false);
    });

    it('`same-site` no alcanza: un subdominio HERMANO (otra app del mismo dominio) se rechaza; el propio origen pasa', () => {
        const platform = { method: 'POST', path: '/api/v1/platform/tenants/7/members', host: 'app.acme.test', protocol: 'https' };
        const portal = { method: 'POST', path: '/api/v1/portal/consume', host: 'app.acme.test', protocol: 'https' };
        for (const req of [platform, portal, { ...base, protocol: 'https' }, { ...platform, path: '/api/v1/system/backups/x/restore' }]) {
            // La cookie Lax viaja desde blog.acme.test: decide el Origin.
            expect(isBlockedCrossSite({ ...req, secFetchSite: 'same-site', origin: 'https://blog.acme.test' })).toBe(true);
            expect(isBlockedCrossSite({ ...req, secFetchSite: 'same-site', origin: 'https://evil.app.acme.test' })).toBe(true);
            // Sin Origin no se puede saber de dónde viene: se rechaza.
            expect(isBlockedCrossSite({ ...req, secFetchSite: 'same-site' })).toBe(true);
            expect(isBlockedCrossSite({ ...req, secFetchSite: 'same-site', origin: 'null' })).toBe(true);
            // Mismo host (mismo origen): pasa.
            expect(isBlockedCrossSite({ ...req, secFetchSite: 'same-site', origin: 'https://app.acme.test' })).toBe(false);
            expect(isBlockedCrossSite({ ...req, secFetchSite: 'same-origin', origin: 'https://app.acme.test' })).toBe(false);
            // Mismo host pero bajando a http (otro origen): no.
            expect(isBlockedCrossSite({ ...req, secFetchSite: 'same-site', origin: 'http://app.acme.test' })).toBe(true);
        }
        // Un valor desconocido de la cabecera se trata igual (decide el Origin).
        expect(isBlockedCrossSite({ ...platform, secFetchSite: 'raro', origin: 'https://blog.acme.test' })).toBe(true);
        expect(isBlockedCrossSite({ ...platform, secFetchSite: 'raro' })).toBe(true);
    });

    it('el dominio propio o el subdominio de una empresa valen sólo cuando SON el host pedido; APP_BASE_URL también', () => {
        const req = { method: 'POST', path: '/api/v1/auth/logout', protocol: 'https', secFetchSite: 'same-site' };
        expect(isBlockedCrossSite({ ...req, host: 'acme.base.test', origin: 'https://acme.base.test' })).toBe(false);
        expect(isBlockedCrossSite({ ...req, host: 'app.base.test', origin: 'https://acme.base.test' })).toBe(true);
        // El proxy no pasó el Host original: vale el origen de APP_BASE_URL.
        const appOrigin = ownOriginOf('https://app.base.test/');
        expect(appOrigin).toBe('https://app.base.test');
        expect(isBlockedCrossSite({ ...req, host: '127.0.0.1:3001', origin: 'https://app.base.test', appOrigin })).toBe(false);
        expect(isBlockedCrossSite({ ...req, host: '127.0.0.1:3001', origin: 'https://otra.base.test', appOrigin })).toBe(true);
        expect(ownOriginOf('javascript:alert(1)')).toBeUndefined();
        expect(ownOriginOf(undefined)).toBeUndefined();
    });

    it('lo que no es un navegador sigue pasando: token personal / MCP / curl sin Origin ni Fetch Metadata', () => {
        for (const path of ['/api/v1/platform/tenants', '/api/v1/lists/1/records', '/api/v1/portal/consume', '/api/v1/mcp']) {
            expect(isBlockedCrossSite({ method: 'POST', path, host: 'app.acme.test', protocol: 'https' })).toBe(false);
        }
    });

    it('OAuth: registrar, canjear y revocar son para terceros; aprobar o rechazar usan la sesión y NO quedan exentos', () => {
        const third = { method: 'POST', host: 'app.acme.test', secFetchSite: 'cross-site', origin: 'https://claude.ai' };
        for (const path of ['/api/v1/oauth/register', '/api/v1/oauth/token', '/api/v1/oauth/revoke']) {
            expect(isBlockedCrossSite({ ...third, path })).toBe(false);
        }
        for (const path of ['/api/v1/oauth/authorize/abc/approve', '/api/v1/oauth/authorize/abc/deny']) {
            expect(isBlockedCrossSite({ ...third, path })).toBe(true);
            expect(isBlockedCrossSite({ ...third, path, secFetchSite: 'same-site', origin: 'https://blog.acme.test' })).toBe(true);
            expect(isBlockedCrossSite({ ...third, path, secFetchSite: 'same-origin', origin: 'https://app.acme.test' })).toBe(false);
        }
        // Lo público pensado para sitios ajenos (formularios, agenda, widget) sigue abierto también con same-site.
        expect(isBlockedCrossSite({ method: 'POST', host: 'app.acme.test', path: '/api/v1/public/forms/tok/submit', secFetchSite: 'same-site', origin: 'https://www.acme.test' })).toBe(false);
    });

    it('consolas del operador: un cuerpo de <form> (urlencoded / text/plain) no se acepta; JSON y subidas sí', () => {
        const p = { method: 'POST', path: '/api/v1/platform/tenants/7/members' };
        expect(isFormBodyOnOperatorRoute({ ...p, contentType: 'application/x-www-form-urlencoded' })).toBe(true);
        expect(isFormBodyOnOperatorRoute({ ...p, contentType: 'Application/X-WWW-Form-Urlencoded; charset=UTF-8' })).toBe(true);
        expect(isFormBodyOnOperatorRoute({ ...p, contentType: 'text/plain' })).toBe(true);
        expect(isFormBodyOnOperatorRoute({ method: 'POST', path: '/api/v1/system/backups/x/restore', contentType: 'text/plain;charset=UTF-8' })).toBe(true);
        expect(isFormBodyOnOperatorRoute({ ...p, contentType: 'application/json' })).toBe(false);
        expect(isFormBodyOnOperatorRoute({ ...p })).toBe(false);
        expect(isFormBodyOnOperatorRoute({ method: 'POST', path: '/api/v1/platform/brand/images', contentType: 'multipart/form-data; boundary=x' })).toBe(false);
        expect(isFormBodyOnOperatorRoute({ method: 'GET', path: p.path, contentType: 'text/plain' })).toBe(false);
        // Fuera de las consolas no cambia nada (el canje de OAuth es urlencoded).
        expect(isFormBodyOnOperatorRoute({ method: 'POST', path: '/api/v1/oauth/token', contentType: 'application/x-www-form-urlencoded' })).toBe(false);
    });

    it('WebSocket: el Origin del handshake tiene que ser el del propio pedido (o uno declarado); sin Origin no es un navegador', () => {
        expect(isAllowedSocketOrigin({ host: 'app.acme.test' })).toBe(true);
        expect(isAllowedSocketOrigin({ host: 'app.acme.test', origin: 'https://app.acme.test' })).toBe(true);
        expect(isAllowedSocketOrigin({ host: 'app.acme.test', origin: 'https://blog.acme.test' })).toBe(false);
        expect(isAllowedSocketOrigin({ host: 'app.acme.test', origin: 'https://evil.test' })).toBe(false);
        expect(isAllowedSocketOrigin({ host: 'app.acme.test', origin: 'https://front.acme.test', allowedOrigins: ['https://front.acme.test'] })).toBe(true);
        // El handshake real: vale el Host o el X-Forwarded-Host que pasa el proxy, o APP_BASE_URL.
        expect(socketHandshakeAllowed({ host: 'app.acme.test', origin: 'https://app.acme.test' })).toBe(true);
        expect(socketHandshakeAllowed({ host: 'localhost:3001', 'x-forwarded-host': 'localhost:5174', origin: 'http://localhost:5174' })).toBe(true);
        expect(socketHandshakeAllowed({ host: '127.0.0.1:3001', origin: 'https://app.acme.test' }, { appOrigin: 'https://app.acme.test' })).toBe(true);
        expect(socketHandshakeAllowed({ host: 'app.acme.test', origin: 'https://blog.acme.test' }, { appOrigin: 'https://app.acme.test' })).toBe(false);
        expect(socketHandshakeAllowed({ host: 'app.acme.test' })).toBe(true);
    });
});
