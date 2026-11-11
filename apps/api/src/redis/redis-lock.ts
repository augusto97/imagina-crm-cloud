import { randomBytes } from 'node:crypto';

/**
 * Candado en Redis con DUEÑO. Los candados de las tareas periódicas guardaban
 * `'1'` y se soltaban con un `DEL` a secas: si el trabajo duraba más que el
 * vencimiento, otro nodo tomaba el candado y el primero, al terminar, borraba
 * el del segundo (y un tercero entraba). Aquí cada toma guarda un token al azar
 * y soltar o renovar sólo actúan si el token sigue siendo el propio (Lua: leer
 * y borrar en un paso).
 *
 * Un error de Redis NO cuenta como "candado tomado": se devuelve `null` y la
 * tarea no corre en este nodo esta vez. Antes, con Redis fallando, todos los
 * nodos corrían el barrido a la vez.
 */
const RELEASE_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;
const RENEW_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return 0`;

/** Lo mínimo de ioredis que usa el candado (los clientes en memoria de los tests lo cumplen). */
export interface LockRedis {
    set(key: string, value: string, mode: 'EX', ttl: number, nx: 'NX'): Promise<unknown>;
    get(key: string): Promise<string | null>;
    del(key: string): Promise<unknown>;
    expire?: (key: string, seconds: number) => Promise<unknown>;
    eval?: (script: string, numKeys: number, ...args: Array<string | number>) => Promise<unknown>;
}

/** Toma el candado. Devuelve el token del dueño, o `null` si lo tiene otro o Redis falló. */
export async function acquireRedisLock(redis: LockRedis, key: string, ttlSeconds: number): Promise<string | null> {
    const token = randomBytes(12).toString('hex');
    try {
        const ok = await redis.set(key, token, 'EX', ttlSeconds, 'NX');
        return ok === 'OK' ? token : null;
    } catch {
        return null;
    }
}

/** Suelta el candado sólo si sigue siendo de este dueño. Nunca lanza. */
export async function releaseRedisLock(redis: Pick<LockRedis, 'get' | 'del' | 'eval'>, key: string, token: string): Promise<boolean> {
    try {
        if (typeof redis.eval === 'function') return Number(await redis.eval(RELEASE_LUA, 1, key, token)) === 1;
        // Clientes en memoria de los tests (sin Lua).
        if ((await redis.get(key)) !== token) return false;
        await redis.del(key);
        return true;
    } catch {
        return false;
    }
}

/** Estira el vencimiento sólo si el candado sigue siendo de este dueño. `false` = se perdió. */
export async function renewRedisLock(redis: Pick<LockRedis, 'get' | 'expire' | 'eval'>, key: string, token: string, ttlSeconds: number): Promise<boolean> {
    try {
        if (typeof redis.eval === 'function') return Number(await redis.eval(RENEW_LUA, 1, key, token, String(ttlSeconds))) === 1;
        if ((await redis.get(key)) !== token) return false;
        await redis.expire?.(key, ttlSeconds);
        return true;
    } catch {
        return false;
    }
}

/**
 * Corre `fn` con el candado tomado y lo renueva solo mientras dura (cada
 * tercio del vencimiento). Devuelve `{ ran: false }` si el candado es de otro.
 * `fn` recibe `stillMine()` para cortar un barrido largo si el candado se
 * perdió (Redis reiniciado, proceso congelado más que el vencimiento).
 */
export async function withRedisLock<T>(
    redis: LockRedis,
    key: string,
    ttlSeconds: number,
    fn: (stillMine: () => boolean) => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }> {
    const token = await acquireRedisLock(redis, key, ttlSeconds);
    if (!token) return { ran: false };
    let mine = true;
    const timer = setInterval(
        () => {
            void renewRedisLock(redis, key, token, ttlSeconds).then((ok) => {
                if (!ok) mine = false;
            });
        },
        Math.max(1_000, Math.floor((ttlSeconds * 1000) / 3)),
    );
    timer.unref?.();
    try {
        return { ran: true, result: await fn(() => mine) };
    } finally {
        clearInterval(timer);
        await releaseRedisLock(redis, key, token);
    }
}
