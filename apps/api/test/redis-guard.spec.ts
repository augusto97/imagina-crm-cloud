import { EventEmitter } from 'node:events';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { HealthController, withinTimeout } from '../src/health/health.controller';
import { createCoreRedis } from '../src/redis/redis.module';
import { guardRedis } from '../src/redis/redis.util';
import { startPostgres, startRedis } from './helpers/containers';

/**
 * Regresión: un cliente ioredis sin listener `error` tumba el proceso cuando la
 * conexión falla de forma asíncrona (p.ej. NOAUTH). `guardRedis` debe absorber
 * ese evento y mantener el proceso vivo (el estado lo reporta /health/ready).
 */
describe('guardRedis', () => {
    it('sin guard, un evento error en un EventEmitter lanza (documenta el crash)', () => {
        const emitter = new EventEmitter();
        expect(() => emitter.emit('error', new Error('NOAUTH'))).toThrow('NOAUTH');
    });

    it('con guard, el evento error NO lanza y se loguea', () => {
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const client = new EventEmitter() as unknown as Redis;

        const guarded = guardRedis(client, new Logger('test'), 'unit');
        expect(guarded).toBe(client);

        // El emit ya NO tira: hay un listener registrado.
        expect(() => (client as unknown as EventEmitter).emit('error', new Error('NOAUTH'))).not.toThrow();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain('unit');
        expect(warn.mock.calls[0]?.[0]).toContain('NOAUTH');

        warn.mockRestore();
    });

    it('rate-limita el log ante errores repetidos (no floodea)', () => {
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const client = new EventEmitter() as unknown as Redis;
        guardRedis(client, new Logger('test'), 'unit');

        const em = client as unknown as EventEmitter;
        em.emit('error', new Error('e1'));
        em.emit('error', new Error('e2'));
        em.emit('error', new Error('e3'));

        // Ráfaga dentro de la ventana de 5s → un solo log.
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe('Redis colgado: el cliente principal y /health/ready no esperan para siempre', () => {
    it('con Redis en pausa, un comando falla al vencer el tope y la sonda responde 503 rápido', async () => {
        const redis = await startRedis();
        const pg = await startPostgres();
        const core = createCoreRedis(redis.url, 300);
        const admin = new IORedis(redis.url);
        try {
            expect(await core.ping()).toBe('PONG');
            // CLIENT PAUSE: Redis deja de atender comandos (como un proceso colgado).
            await admin.call('CLIENT', 'PAUSE', '5000', 'ALL');
            const t0 = Date.now();
            await expect(core.ping()).rejects.toThrow(/timed out/i);
            expect(Date.now() - t0).toBeLessThan(2000);

            const health = new HealthController(pg.db, core);
            const t1 = Date.now();
            await expect(health.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
            expect(Date.now() - t1).toBeLessThan(3500);
        } finally {
            await admin.call('CLIENT', 'UNPAUSE').catch(() => undefined);
            admin.disconnect();
            core.disconnect();
            await pg.stop();
            await redis.stop();
        }
    });

    it('withinTimeout: true si cumple a tiempo, false si falla o tarda', async () => {
        expect(await withinTimeout(Promise.resolve(1), 50)).toBe(true);
        expect(await withinTimeout(Promise.reject(new Error('x')), 50)).toBe(false);
        expect(await withinTimeout(new Promise(() => undefined), 50)).toBe(false);
    });
});
