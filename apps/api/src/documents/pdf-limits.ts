import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { incrWithTtl, type IncrRedis } from '../redis/redis.util';

/**
 * Límites de la generación de PDF.
 *
 * pdfmake maqueta el documento en UN tramo sincrónico sobre el mismo hilo
 * que atiende los pedidos: mientras maqueta, nadie más avanza. Hasta mover
 * la maquetación a otro hilo, estas piezas acotan el daño:
 *
 *  - `PdfRenderGate`: un PDF a la vez, cediendo el hilo entre uno y otro, con
 *    fila corta y espera máxima (→ 503 «ocupado»).
 *  - `LiveLinkCache`: el enlace público firmado arma el PDF como mucho una vez
 *    cada pocos minutos por documento (visitas simultáneas esperan ese mismo
 *    armado) y con un solo armado público en curso.
 *  - `HitLimiter`: pedidos por IP y por enlace.
 *  - `DOC_MAX_RENDER_CELLS`: celdas de tablas de ítems por documento, revisado
 *    ANTES de maquetar.
 */

/** Celdas (filas × columnas) de todas las tablas de ítems de un documento. */
export const DOC_MAX_RENDER_CELLS = 20_000;

export function pdfBusy(): ServiceUnavailableException {
    return new ServiceUnavailableException({
        code: 'pdf_busy',
        message: 'Se están generando muchos documentos en este momento. Vuelve a intentarlo en unos segundos.',
        data: { status: 503 },
    });
}

interface Waiter {
    go: () => void;
    fail: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/** Semáforo con fila acotada y espera máxima. */
export class PdfRenderGate {
    private active = 0;
    private readonly waiters: Waiter[] = [];
    /** Lo más que tardó un render (ms): para el registro y los tests. */
    slowestMs = 0;

    constructor(
        private concurrency: number,
        private readonly maxQueue: number,
        private readonly waitMs: number,
    ) {}

    /** v0.1.439 — con hilos de PDF, tantos a la vez como hilos haya. */
    setConcurrency(n: number): void {
        this.concurrency = Math.max(1, Math.floor(n));
        while (this.active < this.concurrency && this.waiters.length > 0) {
            this.active += 1;
            this.waiters.shift()!.go();
        }
    }

    get inFlight(): number {
        return this.active;
    }

    get queued(): number {
        return this.waiters.length;
    }

    async run<T>(task: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            // Cede el hilo antes de cada render: entre un PDF y el siguiente
            // se atienden los pedidos que estaban esperando.
            await new Promise<void>((resolve) => setImmediate(resolve));
            const t0 = Date.now();
            const out = await task();
            this.slowestMs = Math.max(this.slowestMs, Date.now() - t0);
            return out;
        } finally {
            this.release();
        }
    }

    private acquire(): Promise<void> {
        if (this.active < this.concurrency) {
            this.active += 1;
            return Promise.resolve();
        }
        if (this.waiters.length >= this.maxQueue) return Promise.reject(pdfBusy());
        return new Promise<void>((resolve, reject) => {
            const waiter: Waiter = {
                go: () => {
                    clearTimeout(waiter.timer);
                    resolve();
                },
                fail: reject,
                timer: setTimeout(() => {
                    const i = this.waiters.indexOf(waiter);
                    if (i >= 0) this.waiters.splice(i, 1);
                    reject(pdfBusy());
                }, this.waitMs),
            };
            waiter.timer.unref?.();
            this.waiters.push(waiter);
        });
    }

    private release(): void {
        const next = this.waiters.shift();
        if (next) next.go();
        else this.active -= 1;
    }
}

/** La compuerta de TODOS los PDF del proceso (documentos, etiquetas, tableros, Gantt). */
export const PDF_RENDER_GATE = new PdfRenderGate(1, 32, 30_000);

interface CachedPdf<T> {
    value: T;
    bytes: number;
    expires: number;
}

/**
 * Caché corta del PDF de un enlace público + un solo armado público a la vez.
 * `T` lleva el buffer; `bytesOf` dice cuánto pesa (tope total en memoria).
 */
export class LiveLinkCache<T> {
    private readonly entries = new Map<string, CachedPdf<T>>();
    private readonly pending = new Map<string, Promise<T>>();
    private totalBytes = 0;
    private readonly gate: PdfRenderGate;

    constructor(
        private readonly bytesOf: (value: T) => number,
        private readonly opts: { ttlMs: number; maxEntries: number; maxBytes: number; maxQueue: number; waitMs: number } = {
            ttlMs: 120_000,
            maxEntries: 40,
            maxBytes: 48 * 1024 * 1024,
            maxQueue: 6,
            waitMs: 15_000,
        },
        private readonly now: () => number = Date.now,
    ) {
        this.gate = new PdfRenderGate(1, opts.maxQueue, opts.waitMs);
    }

    async get(key: string, loader: () => Promise<T>): Promise<T> {
        const hit = this.entries.get(key);
        if (hit && hit.expires > this.now()) {
            this.entries.delete(key);
            this.entries.set(key, hit);
            return hit.value;
        }
        if (hit) this.drop(key);
        const inFlight = this.pending.get(key);
        if (inFlight) return inFlight;
        const job = this.gate.run(loader).then((value) => {
            this.store(key, value);
            return value;
        });
        this.pending.set(key, job);
        try {
            return await job;
        } finally {
            if (this.pending.get(key) === job) this.pending.delete(key);
        }
    }

    clear(): void {
        this.entries.clear();
        this.totalBytes = 0;
    }

    private drop(key: string): void {
        const e = this.entries.get(key);
        if (!e) return;
        this.totalBytes -= e.bytes;
        this.entries.delete(key);
    }

    private store(key: string, value: T): void {
        const bytes = this.bytesOf(value);
        if (bytes > this.opts.maxBytes / 4) return; // uno solo no se come la caché
        this.drop(key);
        this.entries.set(key, { value, bytes, expires: this.now() + this.opts.ttlMs });
        this.totalBytes += bytes;
        while (this.entries.size > this.opts.maxEntries || this.totalBytes > this.opts.maxBytes) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.drop(oldest);
        }
    }
}

/**
 * Contador de pedidos por ventana. Con Redis vale para todos los servidores;
 * sin Redis (tests, Redis caído) cuenta en memoria de este proceso.
 */
export class HitLimiter {
    private readonly local = new Map<string, { n: number; until: number }>();

    constructor(private readonly redis?: IncrRedis | null) {}

    /** Suma un pedido; `false` si con éste se pasó de `max` en la ventana. */
    async hit(key: string, max: number, windowSeconds: number): Promise<boolean> {
        if (this.redis) {
            try {
                return (await incrWithTtl(this.redis, key, windowSeconds)) <= max;
            } catch {
                // Redis caído: se cuenta aquí.
            }
        }
        const now = Date.now();
        if (this.local.size > 5000) for (const [k, v] of this.local) if (v.until <= now) this.local.delete(k);
        const cur = this.local.get(key);
        if (!cur || cur.until <= now) {
            this.local.set(key, { n: 1, until: now + windowSeconds * 1000 });
            return 1 <= max;
        }
        cur.n += 1;
        return cur.n <= max;
    }
}

export function tooManyRequests(message: string): HttpException {
    return new HttpException({ code: 'rate_limited', message, data: { status: 429 } }, 429);
}
