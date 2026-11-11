import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import { poolMax } from '../db/pool-size';
import { Worker, type JobsOptions, type Processor, type Queue, type RepeatOptions, type WorkerOptions } from 'bullmq';

/**
 * Piezas comunes a TODAS las colas de BullMQ del API. Viven en un solo lugar
 * para que el modo de proceso, el arranque sin Redis y el apagado ordenado no
 * dependan de que cada cola se acuerde de hacerlo bien.
 */
const logger = new Logger('QueueRuntime');

/**
 * `WORKERS=off` deja al proceso como API pura: puede ENCOLAR (las colas se
 * crean igual) pero no toma trabajos ni registra las tareas periódicas. Otro
 * proceso con `WORKERS=on` (el default) hace el trabajo en segundo plano.
 */
export function workersEnabled(): boolean {
    const v = (process.env.WORKERS ?? 'on').trim().toLowerCase();
    return !(v === 'off' || v === '0' || v === 'false' || v === 'no');
}

interface Tracked {
    worker: Worker;
    queue: string;
    concurrency: number;
}
const tracked = new Set<Tracked>();
let draining = false;

/** `true` desde que empezó el apagado: un barrido largo puede cortar entre tandas. */
export function isShuttingDown(): boolean {
    return draining;
}

/**
 * Crea el worker de una cola (o `null` con `WORKERS=off`) y lo anota para el
 * apagado ordenado y para la cuenta de concurrencia del arranque.
 */
export function createWorker<T = unknown, R = unknown>(queue: string, processor: Processor<T, R>, opts: WorkerOptions): Worker<T, R> | null {
    if (!workersEnabled()) return null;
    const worker = new Worker<T, R>(queue, processor, opts);
    const entry: Tracked = { worker: worker as unknown as Worker, queue, concurrency: opts.concurrency ?? 1 };
    tracked.add(entry);
    worker.on('closed', () => tracked.delete(entry));
    return worker;
}

/** Suma de la concurrencia de los workers vivos de este proceso. */
export function workerConcurrencyTotal(): number {
    let n = 0;
    for (const t of tracked) n += t.concurrency;
    return n;
}

type SchedulerTemplate = Parameters<Queue['upsertJobScheduler']>[2];

/**
 * Registra una tarea periódica SIN bloquear el arranque. Las conexiones de
 * BullMQ usan `maxRetriesPerRequest: null`: con Redis caído, un `await
 * upsertJobScheduler` no termina nunca (el comando queda en espera) y el
 * `onModuleInit` que lo esperaba dejaba al API sin escuchar. Aquí el registro
 * sigue en segundo plano y se reintenta si falla; `upsertJobScheduler` es
 * idempotente. Con `WORKERS=off` no registra nada.
 */
export function registerScheduler(
    queue: Pick<Queue, 'upsertJobScheduler'>,
    id: string,
    repeat: Omit<RepeatOptions, 'key'>,
    template: SchedulerTemplate,
    log: Logger = logger,
): void {
    if (!workersEnabled()) return;
    const attempt = (n: number): void => {
        if (draining) return;
        void Promise.resolve()
            .then(() => queue.upsertJobScheduler(id, repeat, template))
            .then(() => undefined)
            .catch((err: unknown) => {
                log.warn(`No se pudo registrar la tarea periódica «${id}» (se reintenta): ${String(err)}`);
                const timer = setTimeout(() => attempt(n + 1), Math.min(60_000, 2_000 * 2 ** Math.min(n, 5)));
                timer.unref?.();
            });
    };
    attempt(0);
}

/**
 * Encola un trabajo con `jobId` fijo (uno por buzón, tienda, sitio o
 * sincronización) sin que un fallo viejo lo deje mudo. BullMQ ignora un `add`
 * cuyo id ya existe EN CUALQUIER ESTADO: con `removeOnFail: 100` el trabajo
 * fallido (o el que se dio por colgado tras un reinicio) seguía ocupando el id
 * y cada `add` posterior era un no-op silencioso — ese buzón o esa tienda no
 * se volvía a leer. Aquí, si el id está ocupado por un trabajo TERMINADO, se
 * quita antes de encolar; uno en espera, diferido o corriendo sigue
 * deduplicando como siempre. Además el trabajo no se conserva al fallar (el
 * estado y el error viven en Postgres).
 */
export async function addDedupedJob(queue: Queue, name: string, data: unknown, opts: JobsOptions & { jobId: string }): Promise<void> {
    const state = await queue.getJobState(opts.jobId).catch(() => 'unknown' as const);
    if (state === 'failed' || state === 'completed') await queue.remove(opts.jobId).catch(() => undefined);
    await queue.add(name, data, { removeOnComplete: true, ...opts, removeOnFail: true });
}

/**
 * Deja de tomar trabajos en TODOS los workers a la vez y espera a los que
 * están corriendo hasta `deadlineMs`. Pasado el plazo se cierran a la fuerza:
 * esos trabajos quedan "colgados" para BullMQ y otro proceso los retoma (por
 * eso las tareas tienen que tolerar repetirse).
 */
export async function drainWorkers(deadlineMs: number): Promise<{ closed: number; forced: number }> {
    draining = true;
    const list = [...tracked];
    if (!list.length) return { closed: 0, forced: 0 };
    const pending = new Set(list);
    // `pause()` corta la espera de trabajos nuevos y resuelve cuando terminan
    // los que están corriendo. No se usa `close()` para esperar: una vez
    // llamado, `close(true)` devuelve la MISMA promesa y ya no se puede forzar.
    const all = Promise.all(
        list.map((t) =>
            t.worker
                .pause()
                .catch(() => undefined)
                .then(() => void pending.delete(t)),
        ),
    );
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
        all.then(() => false),
        new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(true), Math.max(0, deadlineMs));
        }),
    ]);
    if (timer) clearTimeout(timer);
    const forced = timedOut ? [...pending] : [];
    if (forced.length) {
        logger.warn(`Apagado: ${forced.length} cola(s) con trabajos en curso tras ${deadlineMs} ms (${forced.map((t) => t.queue).join(', ')}); se cierran a la fuerza`);
    }
    // Los que terminaron cierran limpio; los que no, a la fuerza (sin esperar).
    await Promise.all(list.map((t) => t.worker.close(forced.includes(t)).catch(() => undefined)));
    return { closed: list.length - forced.length, forced: forced.length };
}

// ── Trabajos que BullMQ repite ──────────────────────────────────────────
//
// BullMQ entrega "al menos una vez": si el proceso se cae (o se queda sin
// renovar el candado del trabajo) con un trabajo a medias, otro worker lo
// vuelve a correr DESDE EL PRINCIPIO. Para lo que no se puede repetir (un
// correo, un WhatsApp, un cobro) el trabajo se parte en unidades y cada una se
// reclama en Redis con el id del trabajo: en la repetición, la unidad que ya
// había empezado no vuelve a correr.

interface JobScope {
    queue: string;
    jobId: string;
}
const jobScope = new AsyncLocalStorage<JobScope>();
/** Más que cualquier reintento por trabajo colgado (segundos a minutos). */
const JOB_UNIT_TTL_S = 2 * 86_400;

/** Corre el procesador de un trabajo dejando su id a mano para `claimJobUnit`. */
export function runInJobScope<T>(queue: string, jobId: string | undefined, fn: () => Promise<T>): Promise<T> {
    return jobId ? jobScope.run({ queue, jobId }, fn) : fn();
}

export interface JobUnitRedis {
    set(key: string, value: string, mode: 'EX', ttl: number, nx: 'NX'): Promise<unknown>;
    set(key: string, value: string, mode: 'EX', ttl: number, xx: 'XX'): Promise<unknown>;
    get(key: string): Promise<string | null>;
}

const unitKey = (scope: JobScope, unit: string): string => `jobunit:${scope.queue}:${scope.jobId}:${unit}`;

/**
 * Reclama una unidad del trabajo en curso. `first: false` = este mismo trabajo
 * ya la había empezado en una corrida anterior (se repite tras un corte):
 * `previous` trae lo que se anotó con `noteJobUnit`. Fuera de un trabajo, sin
 * Redis o con Redis fallando responde `first: true` (no se pierde trabajo por
 * no poder preguntar).
 */
export async function claimJobUnit(redis: JobUnitRedis | undefined, unit: string): Promise<{ first: boolean; previous: string | null }> {
    const scope = jobScope.getStore();
    if (!scope || !redis) return { first: true, previous: null };
    try {
        const ok = await redis.set(unitKey(scope, unit), '1', 'EX', JOB_UNIT_TTL_S, 'NX');
        if (ok === 'OK') return { first: true, previous: null };
        return { first: false, previous: await redis.get(unitKey(scope, unit)) };
    } catch {
        return { first: true, previous: null };
    }
}

/** Anota un dato de la unidad reclamada (el id de la corrida que abrió). */
export async function noteJobUnit(redis: JobUnitRedis | undefined, unit: string, value: string): Promise<void> {
    const scope = jobScope.getStore();
    if (!scope || !redis) return;
    await redis.set(unitKey(scope, unit), value, 'EX', JOB_UNIT_TTL_S, 'XX').catch(() => undefined);
}

/** Sólo para tests: olvida los workers anotados y el estado de apagado. */
export function resetQueueRuntimeForTests(): void {
    tracked.clear();
    draining = false;
}

function drainDeadlineMs(): number {
    const n = Number(process.env.WORKERS_DRAIN_MS);
    return Number.isInteger(n) && n >= 0 && n <= 600_000 ? n : 14_000;
}

/**
 * Ciclo de vida común: al arrancar avisa si la concurrencia configurada de los
 * workers supera el pool de la base; al apagar (`beforeApplicationShutdown`
 * corre ANTES que cualquier `onApplicationShutdown`) frena todos los workers
 * juntos. Sin esto Nest cerraba cola por cola: un trabajo largo en la primera
 * retenía el apagado mientras las demás seguían TOMANDO trabajos nuevos, y a
 * los 20 s systemd mataba el proceso con todo a medias.
 */
@Injectable()
export class QueueRuntimeLifecycle implements OnApplicationBootstrap, BeforeApplicationShutdown {
    onApplicationBootstrap(): void {
        if (!workersEnabled()) {
            logger.log('WORKERS=off: este proceso no toma trabajos en segundo plano ni registra tareas periódicas');
            return;
        }
        const total = workerConcurrencyTotal();
        const pool = poolMax();
        // Los workers pasan casi todo su tiempo en la red, no en la base: sólo se avisa cuando la suma
        // supera con holgura al pool (con los valores por defecto no avisa).
        if (total > pool * 2.5) {
            logger.warn(
                `La concurrencia de los workers suma ${total} y el pool de la base tiene ${pool} conexiones (DB_POOL_MAX). ` +
                    'Bajo carga, el trabajo en segundo plano puede dejar esperando a los pedidos: sube DB_POOL_MAX o separa los workers (WORKERS=off en el proceso del API).',
            );
        }
    }

    async beforeApplicationShutdown(): Promise<void> {
        await drainWorkers(drainDeadlineMs());
    }
}
