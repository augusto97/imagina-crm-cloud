import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

/**
 * Adjunta un listener `error` a un cliente ioredis y lo devuelve.
 *
 * Sin este listener, un error de conexión que ioredis emite de forma ASÍNCRONA
 * (p.ej. `NOAUTH Authentication required`, `ECONNREFUSED`) no tiene quién lo
 * escuche y Node tumba el proceso con "Unhandled 'error' event" — un try/catch
 * alrededor del `new Redis()` NO lo atrapa porque la conexión ocurre después.
 *
 * Con el listener el error se loguea (rate-limited para no floodear) y el
 * proceso SOBREVIVE; ioredis reintenta la conexión solo. El estado real de la
 * dependencia lo sigue reportando `/health/ready` (503 si Redis no responde),
 * así el balanceador/monitoreo actúa sin necesidad de reiniciar el proceso.
 */
export function guardRedis(client: Redis, logger: Logger, label = 'redis'): Redis {
    let lastLoggedAt = 0;
    client.on('error', (err: Error) => {
        const now = Date.now();
        // Rate-limit: un error de conexión se repite en cada reintento.
        if (now - lastLoggedAt > 5_000) {
            lastLoggedAt = now;
            logger.warn(`Conexión Redis (${label}) con error, reintentando: ${err.message}`);
        }
    });
    return client;
}

/**
 * Retención de jobs terminados para TODA cola de BullMQ (`defaultJobOptions`).
 * Sin esto, los jobs de las tareas programadas (`upsertJobScheduler`) nunca
 * se borraban: miles de hashes por día acumulándose en Redis. Un `add` con sus
 * propias opciones las sigue pisando.
 */
export const QUEUE_JOB_RETENTION = { removeOnComplete: 100, removeOnFail: 500 } as const;

/**
 * v0.1.393 — Contador con vencimiento en UN paso (Lua). El patrón de antes,
 * `INCR` y después `EXPIRE` si es el primero, dejaba el contador SIN
 * vencimiento si el proceso se cortaba entre las dos órdenes: un freno de
 * intentos (login, correos, enlaces del portal) quedaba trabado para siempre.
 * Además repara un contador que ya hubiera quedado sin vencimiento.
 * Ventana fija: el vencimiento se pone al primer incremento.
 */
const INCR_TTL_LUA = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

export interface IncrRedis {
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<unknown>;
    eval?: (script: string, numKeys: number, ...args: Array<string | number>) => Promise<unknown>;
}

export async function incrWithTtl(redis: IncrRedis, key: string, ttlSeconds: number): Promise<number> {
    if (typeof redis.eval === 'function') return Number(await redis.eval(INCR_TTL_LUA, 1, key, String(ttlSeconds)));
    // Clientes en memoria de los tests (sin Lua).
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, ttlSeconds);
    return n;
}
