import { existsSync } from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { Logger } from '@nestjs/common';

import type { DashboardPdfInput } from '../dashboard-sharing/dashboard-pdf';
import type { GanttPdfInput } from '../gantt/gantt-pdf';
import type { DocRenderOutput, RecordedDocInput } from './document-render';
import { PDF_RENDER_GATE } from './pdf-limits';

/**
 * v0.1.439 — Los PDF se maquetan en un HILO APARTE (`worker_threads`).
 *
 * pdfmake maqueta en un tramo sincrónico: un documento con una tabla grande,
 * cien etiquetas con QR o un Gantt de varias páginas tardaban segundos, y
 * durante esos segundos el proceso no atendía NADA más (ni un pedido, ni el
 * tiempo real, ni un aviso de un proveedor). La compuerta de `pdf-limits.ts`
 * acotaba el daño haciéndolos de a uno; ahora el hilo principal sólo espera la
 * respuesta y sigue atendiendo.
 *
 * - Al hilo viajan DATOS (las entradas de cada armador), nunca funciones.
 * - Un hilo por defecto (`PDF_WORKERS`, 0 = maquetar aquí como antes); se
 *   crea al primer PDF y se cierra tras `IDLE_MS` sin uso.
 * - Cada hilo tiene tope de memoria: un documento desbocado lo tumba a él,
 *   no al proceso. Un trabajo que no termina en `TASK_TIMEOUT_MS` cierra su
 *   hilo y responde «no se pudo».
 * - Sin el archivo compilado del hilo (pruebas desde el código fuente) no hay
 *   pool: se maqueta aquí, igual que antes. `PDF_WORKER_TS=1` lo levanta
 *   desde el `.ts` con tsx (sólo pruebas).
 */

export type PdfTask =
    | { kind: 'document'; input: RecordedDocInput }
    | { kind: 'definition'; def: Record<string, unknown> }
    | { kind: 'gantt'; input: GanttPdfInput }
    | { kind: 'dashboard'; input: DashboardPdfInput };

export type PdfTaskResult = DocRenderOutput | Buffer;

/** Lo que manda el hilo de vuelta. */
export interface PdfWorkerReply {
    id: number;
    ok: boolean;
    /** El PDF (o el del documento) como bytes. */
    bytes?: Uint8Array;
    /** Documento: lo demás de `DocRenderOutput`. */
    meta?: Omit<DocRenderOutput, 'buffer'>;
    error?: string;
    /** El hilo no pudo rearmar el documento con lo grabado: se arma aquí. */
    fallback?: boolean;
}

/** El hilo no tiene lo que necesita: se maqueta en el hilo principal. */
export class PdfTaskFallback extends Error {
    readonly fallback = true;
}

const TASK_TIMEOUT_MS = 60_000;
const IDLE_MS = 10 * 60_000;

interface Pending {
    id: number;
    task: PdfTask;
    timeoutMs?: number;
    resolve: (v: PdfTaskResult) => void;
    reject: (e: Error) => void;
}

interface Slot {
    worker: Worker;
    current: Pending | null;
    timer: ReturnType<typeof setTimeout> | null;
    idle: ReturnType<typeof setTimeout> | null;
}

export interface PdfPoolOptions {
    size: number;
    entry: string;
    execArgv?: string[];
    /** `entry` es código JS (arranque con tsx en pruebas), no un archivo. */
    eval?: boolean;
    timeoutMs?: number;
    idleMs?: number;
    maxMemoryMb?: number;
}

export class PdfPool {
    private readonly logger = new Logger('PdfPool');
    private readonly slots: Slot[] = [];
    private readonly queue: Pending[] = [];
    private nextId = 1;
    private closed = false;
    /** Cuántos hilos se crearon (para pruebas y el registro). */
    spawned = 0;

    constructor(private readonly opts: PdfPoolOptions) {}

    get size(): number {
        return this.opts.size;
    }

    run(task: PdfTask, opts: { timeoutMs?: number } = {}): Promise<PdfTaskResult> {
        if (this.closed) return Promise.reject(new Error('El hilo de PDF está cerrado.'));
        return new Promise<PdfTaskResult>((resolve, reject) => {
            this.queue.push({ id: this.nextId++, task, resolve, reject, timeoutMs: opts.timeoutMs });
            this.dispatch();
        });
    }

    /** Hilos vivos ahora (para pruebas y el registro). */
    get alive(): number {
        return this.slots.length;
    }

    async close(): Promise<void> {
        this.closed = true;
        for (const p of this.queue.splice(0)) p.reject(new Error('El hilo de PDF se cerró.'));
        await Promise.all(this.slots.splice(0).map((s) => this.stop(s)));
    }

    private dispatch(): void {
        while (this.queue.length > 0) {
            let slot = this.slots.find((s) => s.current === null);
            if (!slot && this.slots.length < this.opts.size) slot = this.spawn();
            if (!slot) return;
            const job = this.queue.shift()!;
            this.assign(slot, job);
        }
    }

    private spawn(): Slot {
        const worker = new Worker(this.opts.entry, {
            eval: this.opts.eval ?? false,
            execArgv: this.opts.execArgv ?? [],
            resourceLimits: { maxOldGenerationSizeMb: this.opts.maxMemoryMb ?? 768 },
        });
        // Un hilo sin trabajo no mantiene vivo el proceso.
        worker.unref();
        this.spawned++;
        const slot: Slot = { worker, current: null, timer: null, idle: null };
        worker.on('message', (msg: PdfWorkerReply) => this.onReply(slot, msg));
        worker.on('error', (err) => this.onDeath(slot, err));
        worker.on('exit', (code) => {
            if (this.slots.includes(slot)) this.onDeath(slot, new Error(`El hilo de PDF terminó (código ${code}).`));
        });
        this.slots.push(slot);
        return slot;
    }

    private assign(slot: Slot, job: Pending): void {
        if (slot.idle) clearTimeout(slot.idle);
        slot.idle = null;
        slot.current = job;
        slot.worker.ref();
        const timeoutMs = job.timeoutMs ?? this.opts.timeoutMs ?? TASK_TIMEOUT_MS;
        slot.timer = setTimeout(() => {
            this.logger.warn(`Un PDF tardó más de ${Math.round(timeoutMs / 1000)} s: se cierra su hilo.`);
            this.fail(slot, new Error('El PDF tardó demasiado en generarse.'));
            this.remove(slot);
            void slot.worker.terminate();
            this.dispatch();
        }, timeoutMs);
        slot.worker.postMessage({ id: job.id, task: job.task });
    }

    private onReply(slot: Slot, msg: PdfWorkerReply): void {
        const job = slot.current;
        if (!job || msg.id !== job.id) return;
        this.release(slot);
        if (msg.fallback) job.reject(new PdfTaskFallback(msg.error ?? 'fallback'));
        else if (!msg.ok || !msg.bytes) job.reject(new Error(msg.error || 'No se pudo generar el PDF.'));
        else {
            const buffer = Buffer.from(msg.bytes.buffer, msg.bytes.byteOffset, msg.bytes.byteLength);
            job.resolve(msg.meta ? { ...msg.meta, buffer } : buffer);
        }
        this.dispatch();
    }

    private onDeath(slot: Slot, err: Error): void {
        this.logger.warn(`El hilo de PDF se cayó: ${err.message}`);
        this.fail(slot, new Error('No se pudo generar el PDF: el documento es demasiado grande o el generador se detuvo.'));
        this.remove(slot);
        this.dispatch();
    }

    private fail(slot: Slot, err: Error): void {
        const job = slot.current;
        this.release(slot);
        job?.reject(err);
    }

    /** El hilo quedó libre: sin reloj de tope, con reloj de inactividad. */
    private release(slot: Slot): void {
        if (slot.timer) clearTimeout(slot.timer);
        slot.timer = null;
        slot.current = null;
        slot.worker.unref();
        if (!this.slots.includes(slot)) return;
        slot.idle = setTimeout(() => {
            if (slot.current) return;
            this.remove(slot);
            void slot.worker.terminate();
        }, this.opts.idleMs ?? IDLE_MS);
        slot.idle.unref?.();
    }

    private remove(slot: Slot): void {
        const i = this.slots.indexOf(slot);
        if (i >= 0) this.slots.splice(i, 1);
        if (slot.idle) clearTimeout(slot.idle);
        if (slot.timer) clearTimeout(slot.timer);
        slot.idle = null;
        slot.timer = null;
    }

    private async stop(slot: Slot): Promise<void> {
        this.remove(slot);
        await slot.worker.terminate().catch(() => undefined);
    }
}

/** Cuántos hilos de PDF: `PDF_WORKERS` (0 = ninguno), o 1. */
export function pdfWorkerCount(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.PDF_WORKERS;
    if (raw === undefined || raw.trim() === '') return 1;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) return 1;
    return Math.min(n, Math.max(1, cpus().length));
}

export interface PdfWorkerEntry {
    entry: string;
    execArgv: string[];
    eval?: boolean;
}

/**
 * Dónde está el archivo del hilo: el compilado, o el `.ts` sólo si se pide.
 * El `.ts` arranca con el registro CJS de tsx (con `--import tsx` el hilo no
 * hereda los ganchos de resolución y no encuentra los imports sin extensión).
 */
export function pdfWorkerEntry(env: NodeJS.ProcessEnv = process.env): PdfWorkerEntry | null {
    const js = path.join(__dirname, 'pdf-worker.js');
    if (existsSync(js)) return { entry: js, execArgv: [] };
    const ts = path.join(__dirname, 'pdf-worker.ts');
    if (env.PDF_WORKER_TS === '1' && existsSync(ts)) {
        return { entry: `require('tsx/cjs'); require(${JSON.stringify(ts)});`, execArgv: [], eval: true };
    }
    return null;
}

let shared: PdfPool | null | undefined;

/** El pool del proceso (o null: se maqueta en el hilo principal). */
export function pdfPool(): PdfPool | null {
    if (shared !== undefined) return shared;
    const size = pdfWorkerCount();
    const entry = size > 0 ? pdfWorkerEntry() : null;
    shared = entry ? new PdfPool({ size, ...entry }) : null;
    if (shared) PDF_RENDER_GATE.setConcurrency(size);
    return shared;
}

/** Sólo pruebas: cambia el pool del proceso. */
export function setPdfPoolForTests(pool: PdfPool | null | undefined): void {
    shared = pool;
    PDF_RENDER_GATE.setConcurrency(pool ? pool.size : 1);
}

/**
 * Corre una tarea en el hilo de PDF (con la misma compuerta de antes: fila
 * acotada y espera máxima) o, sin pool, en el hilo principal. `build` arma la
 * tarea sólo si hay pool (grabar un documento tiene su costo).
 */
export async function renderViaPool<T extends PdfTaskResult>(build: () => PdfTask, local: () => Promise<T>): Promise<T> {
    const pool = pdfPool();
    if (!pool) return local();
    const task = build();
    try {
        return (await PDF_RENDER_GATE.run(() => pool.run(task))) as T;
    } catch (err) {
        if (err instanceof PdfTaskFallback) return local();
        throw err;
    }
}
