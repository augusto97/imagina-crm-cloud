import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { guardRedis } from '../src/redis/redis.util';

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
