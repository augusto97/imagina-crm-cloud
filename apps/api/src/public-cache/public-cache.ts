/**
 * v0.1.352 (ADR-S95) — Caché en memoria de lo público (la página de un
 * formulario, la de una agenda, los horarios libres). Tres cosas juntas:
 *
 *  1. **Guardar por un rato** lo que se arma igual para todas las visitas,
 *     así una página con miles de visitas no consulta la base en cada una.
 *  2. **Un solo armado a la vez por clave** (single-flight): si mil visitas
 *     piden la misma página justo cuando venció, la arma UNA y las demás
 *     esperan ese resultado. Sin esto, el vencimiento de una página popular
 *     es una avalancha contra la base.
 *  3. **Un tope de armados simultáneos** entre TODAS las claves: lo público
 *     no puede llevarse todas las conexiones a la base y frenar la app del
 *     equipo (alguien que prueba miles de direcciones distintas, por ejemplo).
 *     Lo que no entra espera en fila un rato; si la fila está llena o la
 *     espera se alarga, falla con `PublicBusyError` (la página dice «muchas
 *     visitas, prueba en unos segundos») en vez de hacer esperar para siempre.
 *
 * Es puro (sin Nest ni Redis) para probarlo solo; `PublicCacheService` le
 * suma el aviso entre servidores cuando algo se invalida.
 */
export class PublicBusyError extends Error {
    constructor() {
        super('public_busy');
        this.name = 'PublicBusyError';
    }
}

export interface PublicCacheOptions {
    /** Cuántas claves como mucho (las más viejas salen primero). */
    maxEntries: number;
    /** Armados simultáneos entre todas las claves. */
    concurrency: number;
    /** Cuántos armados pueden esperar en fila. */
    maxQueue: number;
    /** Cuánto espera uno en la fila antes de rendirse. */
    queueTimeoutMs: number;
    now?: () => number;
}

export interface PublicCacheStats {
    hits: number;
    misses: number;
    coalesced: number;
    busy: number;
    entries: number;
    active: number;
    queued: number;
}

interface Entry {
    value: unknown;
    expires: number;
}

export class PublicCache {
    private readonly entries = new Map<string, Entry>();
    /** Versión por espacio (`slots:<empresa>`): subirla deja viejas todas sus claves sin recorrerlas. */
    private readonly versions = new Map<string, number>();
    private readonly pending = new Map<string, Promise<unknown>>();
    private readonly waiters: Array<{ resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
    /** Sube con cada invalidación: un armado que empezó antes no se guarda (podría ser viejo). */
    private epoch = 0;
    private active = 0;
    private readonly stat = { hits: 0, misses: 0, coalesced: 0, busy: 0 };
    private readonly now: () => number;

    constructor(private readonly opts: PublicCacheOptions) {
        this.now = opts.now ?? Date.now;
    }

    /**
     * El valor de `key`: el guardado si sigue vigente; si no, lo arma `loader`
     * (uno a la vez por clave y dentro del tope de armados). `ttlMs` es cuánto
     * vale; `negativeTtlMs`, cuánto vale un `null` (lo que no existe: así una
     * dirección inventada que piden mil veces tampoco consulta mil veces).
     */
    async get<T>(key: string, ttlMs: number, loader: () => Promise<T>, negativeTtlMs = ttlMs): Promise<T> {
        const hit = this.entries.get(key);
        if (hit && hit.expires > this.now()) {
            this.stat.hits += 1;
            // LRU: la que se usa pasa al final.
            this.entries.delete(key);
            this.entries.set(key, hit);
            return hit.value as T;
        }
        if (hit) this.entries.delete(key);
        const inFlight = this.pending.get(key);
        if (inFlight) {
            this.stat.coalesced += 1;
            return inFlight as Promise<T>;
        }
        this.stat.misses += 1;
        const startEpoch = this.epoch;
        const job = (async () => {
            await this.acquire();
            try {
                const value = await loader();
                if (this.epoch === startEpoch) {
                    const ttl = value === null ? negativeTtlMs : ttlMs;
                    if (ttl > 0) this.store(key, value, ttl);
                }
                return value;
            } finally {
                this.release();
            }
        })();
        this.pending.set(key, job);
        try {
            return await job;
        } finally {
            if (this.pending.get(key) === job) this.pending.delete(key);
        }
    }

    /**
     * Corre `task` dentro del tope de armados SIN guardar nada (lo que no se
     * puede cachear pero toca la base igual).
     */
    async gate<T>(task: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await task();
        } finally {
            this.release();
        }
    }

    /** Borra una clave (y suelta un armado en curso: lo que pida después arma de nuevo). */
    invalidate(key: string): void {
        this.epoch += 1;
        this.entries.delete(key);
        this.pending.delete(key);
    }

    /** Borra todas las claves que empiezan con `prefix`. */
    invalidatePrefix(prefix: string): void {
        this.epoch += 1;
        for (const k of [...this.entries.keys()]) if (k.startsWith(prefix)) this.entries.delete(k);
        for (const k of [...this.pending.keys()]) if (k.startsWith(prefix)) this.pending.delete(k);
    }

    /** La versión vigente de un espacio de claves (va dentro de la clave). */
    version(ns: string): number {
        return this.versions.get(ns) ?? 0;
    }

    /**
     * Deja viejas todas las claves de un espacio (`slots:12`) en O(1): las que
     * llevan la versión anterior ya no se piden y salen solas por antigüedad.
     */
    bump(ns: string): void {
        this.epoch += 1;
        this.versions.set(ns, (this.versions.get(ns) ?? 0) + 1);
        if (this.versions.size > 20_000) this.versions.clear();
    }

    clear(): void {
        this.epoch += 1;
        this.entries.clear();
        this.pending.clear();
    }

    stats(): PublicCacheStats {
        return { ...this.stat, entries: this.entries.size, active: this.active, queued: this.waiters.length };
    }

    private store(key: string, value: unknown, ttlMs: number): void {
        this.entries.delete(key);
        this.entries.set(key, { value, expires: this.now() + ttlMs });
        while (this.entries.size > this.opts.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
        }
    }

    private acquire(): Promise<void> {
        if (this.active < this.opts.concurrency) {
            this.active += 1;
            return Promise.resolve();
        }
        if (this.waiters.length >= this.opts.maxQueue) {
            this.stat.busy += 1;
            return Promise.reject(new PublicBusyError());
        }
        return new Promise<void>((resolve, reject) => {
            const waiter = {
                resolve: () => {
                    clearTimeout(waiter.timer);
                    resolve();
                },
                reject,
                timer: setTimeout(() => {
                    const i = this.waiters.indexOf(waiter);
                    if (i >= 0) this.waiters.splice(i, 1);
                    this.stat.busy += 1;
                    reject(new PublicBusyError());
                }, this.opts.queueTimeoutMs),
            };
            this.waiters.push(waiter);
        });
    }

    private release(): void {
        const next = this.waiters.shift();
        // El lugar pasa directo al siguiente de la fila (no se libera y se vuelve a tomar).
        if (next) next.resolve();
        else this.active -= 1;
    }
}

/**
 * Sin caché (los tests que arman los servicios a mano, y lo que corre sin la
 * app completa): todo se arma en el momento, como antes de v0.1.352.
 */
export const NO_PUBLIC_CACHE: Pick<PublicCache, 'get' | 'gate' | 'invalidate' | 'invalidatePrefix' | 'version' | 'bump'> = {
    get: <T>(_key: string, _ttl: number, loader: () => Promise<T>) => loader(),
    gate: <T>(task: () => Promise<T>) => task(),
    invalidate: () => undefined,
    invalidatePrefix: () => undefined,
    version: () => 0,
    bump: () => undefined,
};

export type PublicCacheLike = typeof NO_PUBLIC_CACHE;
