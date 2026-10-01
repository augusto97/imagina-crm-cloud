import { describe, expect, it } from 'vitest';
import { isBlockedCrossSite } from '../src/common/cross-site';

/** SEC-35 (v0.1.239) — freno a pedidos que cambian algo desde otro sitio. */
describe('isBlockedCrossSite', () => {
    const base = { method: 'POST', path: '/api/v1/auth/login', host: 'app.acme.test' };

    it('login CSRF: un formulario de otro sitio se rechaza (Fetch Metadata u Origin)', () => {
        expect(isBlockedCrossSite({ ...base, secFetchSite: 'cross-site', origin: 'https://evil.test' })).toBe(true);
        // Navegador viejo sin Sec-Fetch-Site: decide el Origin.
        expect(isBlockedCrossSite({ ...base, origin: 'https://evil.test' })).toBe(true);
        expect(isBlockedCrossSite({ ...base, origin: 'null' })).toBe(true);
    });

    it('la propia app pasa (mismo origen, mismo sitio, o Origin = host)', () => {
        expect(isBlockedCrossSite({ ...base, secFetchSite: 'same-origin' })).toBe(false);
        expect(isBlockedCrossSite({ ...base, secFetchSite: 'same-site' })).toBe(false);
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
});
