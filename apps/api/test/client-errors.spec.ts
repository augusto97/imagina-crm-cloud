import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClientErrorReport } from '@imagina-base/shared';
import { ClientErrorsController } from '../src/observability/client-errors.controller';
import {
    browserLabel,
    cleanStack,
    clearClientErrors,
    isNoiseMessage,
    normalizeRoute,
    readClientErrors,
    recordClientError,
} from '../src/observability/client-errors';
import { startRedis, type TestRedis } from './helpers/containers';

/**
 * v0.1.435 — Los errores de las pantallas (el navegador) llegan a Plataforma →
 * Diagnóstico agrupados, sin datos de la persona y con freno.
 */
const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

const report = (over: Partial<ClientErrorReport> = {}): ClientErrorReport => ({
    kind: 'error',
    surface: 'app',
    message: "Cannot read properties of undefined (reading 'label')",
    route: '/lists/12/records?view=3&token=secreto#x',
    stack: "TypeError: Cannot read properties of undefined (reading 'label')\n    at Cell (https://base.acme.co/assets/index-abc123.js?v=9:4:1200)\n    at renderWithHooks (https://base.acme.co/assets/vendor-react.js:1:2000)",
    ...over,
});

describe('errores de pantalla — piezas puras', () => {
    it('la ruta sin consulta ni ancla, con los números y los tokens cambiados', () => {
        expect(normalizeRoute('/lists/12/records?view=3&token=x#y')).toBe('/lists/:id/records');
        expect(normalizeRoute('/portal/acceso/AbCdEf0123456789xyzQRS')).toBe('/portal/acceso/:token');
        expect(normalizeRoute('/settings')).toBe('/settings');
        expect(normalizeRoute('')).toBe('/');
    });

    it('el stack sin el dominio ni la consulta de cada archivo', () => {
        const s = cleanStack(report().stack)!;
        expect(s).not.toContain('base.acme.co');
        expect(s).not.toContain('?v=9');
        expect(s).toContain('/assets/index-abc123.js:4:1200');
        expect(cleanStack(undefined)).toBeNull();
    });

    it('el navegador y el sistema en una línea', () => {
        expect(browserLabel(CHROME)).toBe('Chrome 131 · Android');
        expect(browserLabel(SAFARI)).toBe('Safari 18 · iPhone');
        expect(browserLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0')).toBe(
            'Edge 131 · Windows',
        );
        expect(browserLabel(undefined)).toBeNull();
    });

    it('lo que no dice nada de la app (extensiones, la red, un despliegue nuevo) es ruido', () => {
        for (const m of ['Script error.', 'ResizeObserver loop completed with undelivered notifications.', 'Failed to fetch dynamically imported module: /assets/x.js', 'Load failed', 'AbortError: The user aborted a request.', '']) {
            expect(isNoiseMessage(m)).toBe(true);
        }
        expect(isNoiseMessage(report().message)).toBe(false);
    });
});

describe('errores de pantalla — con Redis real', () => {
    let redisC: TestRedis;
    let redis: Redis;

    beforeAll(async () => {
        redisC = await startRedis();
        redis = new Redis(redisC.url);
    }, 120_000);

    afterAll(async () => {
        await redis?.quit();
        await redisC?.stop();
    });

    beforeEach(async () => {
        await redis.flushall();
    });

    it('el mismo error en la misma pantalla es UN grupo con su contador (aunque cambie el número del registro)', async () => {
        const t0 = new Date('2026-11-18T10:00:00Z');
        const k1 = await recordClientError(redis, report(), CHROME, t0);
        const k2 = await recordClientError(redis, report({ route: '/lists/99/records' }), SAFARI, new Date('2026-11-18T11:00:00Z'));
        expect(k1).toBe(k2);
        await recordClientError(redis, report({ message: 'Otra cosa', route: '/settings' }), CHROME, new Date('2026-11-18T09:00:00Z'));
        expect(await recordClientError(redis, report({ message: 'Script error.' }), CHROME)).toBeNull();
        const rows = await readClientErrors(redis, 100, Date.parse('2026-11-18T12:00:00Z'));
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            count: 2,
            route: '/lists/:id/records',
            first_at: '2026-11-18T10:00:00.000Z',
            last_at: '2026-11-18T11:00:00.000Z',
            browser: 'Safari 18 · iPhone',
            surface: 'app',
            kind: 'error',
        });
        expect(rows[0]!.version).toBeTruthy();
        expect(JSON.stringify(rows)).not.toContain('secreto');
        expect(rows[1]!.message).toBe('Otra cosa');
        await clearClientErrors(redis);
        expect(await readClientErrors(redis)).toEqual([]);
    });

    it('lo de hace más de 14 días no se muestra, y nunca guarda más de 200 grupos', async () => {
        await recordClientError(redis, report({ message: 'viejo' }), CHROME, new Date('2026-10-01T00:00:00Z'));
        expect(await readClientErrors(redis, 100, Date.parse('2026-11-18T00:00:00Z'))).toEqual([]);
        await redis.flushall();
        for (let i = 0; i < 205; i++) {
            await recordClientError(redis, report({ message: `Error número ${'x'.repeat(i % 50)}-${String.fromCharCode(97 + (i % 26))}${i}`, route: `/r${String.fromCharCode(97 + (i % 26))}` }), CHROME, new Date(Date.UTC(2026, 10, 18, 0, 0, i)));
        }
        expect(await redis.hlen('diag:cerr')).toBeLessThanOrEqual(200);
        const rows = await readClientErrors(redis, 500, Date.parse('2026-11-18T01:00:00Z'));
        // Se queda con los más recientes.
        expect(rows[0]!.last_at).toBe('2026-11-18T00:03:24.000Z');
    });

    it('el endpoint siempre responde sin contar nada y frena a una misma IP', async () => {
        const ctrl = new ClientErrorsController(redis);
        const req = { ip: '190.25.1.2', headers: { 'user-agent': CHROME } } as never;
        for (let i = 0; i < 30; i++) await ctrl.report(req, report({ message: `Falla ${String.fromCharCode(97 + (i % 26))}${'y'.repeat(i)}`, route: `/p${String.fromCharCode(97 + (i % 26))}${i}` }));
        expect((await readClientErrors(redis)).length).toBe(20);
        // Otra IP sí entra.
        await ctrl.report({ ip: '2001:db8::1', headers: {} } as never, report({ message: 'desde otra red' }));
        expect((await readClientErrors(redis)).some((r) => r.message === 'desde otra red')).toBe(true);
    });
});
