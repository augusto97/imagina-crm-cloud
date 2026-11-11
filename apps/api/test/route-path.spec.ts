import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isHealthProbe, isSensitiveRoute, rateLimitMaxFor } from '../src/common/rate-limit-policy';
import { normalizeUrlPath, routePath } from '../src/common/route-path';

/**
 * Las políticas por ruta (límite estricto del login, «sesión del portal») se
 * decidían sobre el texto crudo de la dirección. El router decodifica `%XX` y
 * descarta `#…` antes de buscar la ruta, así que `/auth/logi%6e` llegaba al
 * login con el límite general.
 */
describe('routePath — decisiones por la ruta que resolvió el router', () => {
    it('usa el patrón de la ruta; sin ruta, el path decodificado sin query ni fragmento', () => {
        expect(routePath({ url: '/api/v1/auth/logi%6e?x=1', routeOptions: { url: '/api/v1/auth/login' } })).toBe('/api/v1/auth/login');
        expect(routePath({ url: '/api/v1/auth/logi%6e?x=1' })).toBe('/api/v1/auth/login');
        expect(routePath({ url: '/api/v1/auth/login#x' })).toBe('/api/v1/auth/login');
        expect(normalizeUrlPath('/api/v1/%70ortal/me?a=%2F')).toBe('/api/v1/portal/me');
        // Mal codificado o con una barra codificada: queda como vino (no afloja nada).
        expect(normalizeUrlPath('/api/v1/auth/logi%zz')).toBe('/api/v1/auth/logi%zz');
        expect(normalizeUrlPath('/api/v1/auth%2Flogin')).toBe('/api/v1/auth%2Flogin');
        expect(routePath({})).toBe('');
    });

    it('la política del límite reconoce la ruta se escriba como se escriba', () => {
        const env = { RATE_LIMIT_AUTH_MAX: 15, RATE_LIMIT_MAX: 600 };
        for (const url of ['/api/v1/auth/login', '/api/v1/auth/logi%6e', '/api/v1/auth/login#x', '/api/v1/auth/login?/health']) {
            expect(rateLimitMaxFor({ url }, env)).toBe(15);
            expect(isHealthProbe({ url })).toBe(false);
        }
        expect(isSensitiveRoute({ url: '/x', routeOptions: { url: '/api/v1/portal/request-access' } })).toBe(true);
        expect(isSensitiveRoute({ url: '/x', routeOptions: { url: '/api/v1/auth/login/2fa' } })).toBe(true);
        // Otra ruta que sólo TERMINA igual no es sensible (antes era `endsWith`).
        expect(rateLimitMaxFor({ url: '/api/v1/lists/auth/login-log' }, env)).toBe(600);
        expect(rateLimitMaxFor({ url: '/api/v1/public/store-hooks/abc' }, env)).toBe(6000);
        expect(isHealthProbe({ url: '/api/v1/health/live?x' })).toBe(true);
    });

    describe('con el router de verdad', () => {
        let app: FastifyInstance;
        const seen: string[] = [];

        beforeAll(async () => {
            app = Fastify();
            await app.register(fastifyRateLimit, {
                global: true,
                max: (req) => rateLimitMaxFor(req, { RATE_LIMIT_AUTH_MAX: 15, RATE_LIMIT_MAX: 600 }),
                timeWindow: '1 minute',
                allowList: (req) => isHealthProbe(req),
            });
            app.addHook('onRequest', (req, _reply, done) => {
                seen.push(`${req.url} → ${routePath(req)}`);
                done();
            });
            app.post('/api/v1/auth/login', async () => ({ ok: true }));
            app.get('/api/v1/lists', async () => ({ ok: true }));
            await app.ready();
        });

        afterAll(async () => {
            await app.close();
        });

        it('la dirección codificada llega al login y recibe el límite ESTRICTO (15 por minuto)', async () => {
            const codes: number[] = [];
            for (let i = 0; i < 16; i++) {
                const url = i % 2 === 0 ? '/api/v1/auth/logi%6e' : '/api/v1/auth/login#x';
                codes.push((await app.inject({ method: 'POST', url, remoteAddress: '203.0.113.9' })).statusCode);
            }
            expect(codes.slice(0, 15).every((c) => c === 200)).toBe(true);
            expect(codes[15]).toBe(429);
            expect(seen).toContain('/api/v1/auth/logi%6e → /api/v1/auth/login');
            // Una ruta común, desde otra IP, sigue con el límite general.
            const other = await app.inject({ method: 'GET', url: '/api/v1/lists', remoteAddress: '203.0.113.10' });
            expect(other.headers['x-ratelimit-limit']).toBe('600');
        });
    });
});
