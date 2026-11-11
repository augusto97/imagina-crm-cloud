import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import type { SiteSyncHookJob } from './site-realtime.service';
import { addDedupedJob, createWorker, registerScheduler } from '../redis/queue-runtime';

/**
 * Cola de la sincronización con sitios WordPress (v0.1.333, ADR-S83). Propia
 * (no la de la tienda) para que traer un sitio de miles de entradas no frene
 * los pedidos de una tienda, y al revés. Mismo patrón que `StoreSyncQueue`:
 * sin cola (tests, sin Redis) es no-op y el que llama sabe qué hacer.
 */

export const SITE_SYNC_QUEUE = 'site-sync';
/** v0.1.393 — avisos y envíos aparte de las corridas largas (ver `STORE_SYNC_LIVE_QUEUE`). */
export const SITE_SYNC_LIVE_QUEUE = 'site-sync-live';
const TICK_JOB = 'tick';
const RUN_JOB = 'run';
const PUSH_JOB = 'push';
const HOOK_JOB = 'hook';

export interface SiteSyncRunJob {
    tenantId: number;
    syncId: number;
    full?: boolean;
    only?: string[];
}

/** Un registro editado en la app que tiene que viajar al sitio. */
export interface SiteSyncPushJob {
    tenantId: number;
    syncId: number;
    recordId: number;
    fieldIds: number[];
}

@Injectable()
export class SiteSyncQueue {
    private readonly logger = new Logger(SiteSyncQueue.name);
    private queue: Queue | null = null;
    private live: Queue | null = null;

    setQueue(queue: Queue, live?: Queue): void {
        this.queue = queue;
        this.live = live ?? null;
    }

    /** El `jobId` deduplica: el tick de cada minuto y un «Sincronizar ahora» no se apilan. */
    enqueueRun(tenantId: number, syncId: number, opts: { full?: boolean; only?: string[] }, delayMs = 0): void {
        if (!this.queue) return;
        const suffix = `${opts.full ? '-full' : ''}${opts.only?.length ? `-${[...opts.only].sort().join('_').replace(/[^a-z0-9_-]/gi, '_')}` : ''}`;
        const data: SiteSyncRunJob = { tenantId, syncId, ...opts };
        addDedupedJob(this.queue, RUN_JOB, data, { jobId: `run-${syncId}${suffix}${delayMs > 0 ? '-retry' : ''}`, delay: delayMs })
            .catch((err) => this.logger.error(`No se pudo encolar la sincronización del sitio #${syncId}: ${String(err)}`));
    }

    /**
     * Un cambio hecho en la app que viaja al sitio. Con una pequeña espera para
     * que la transacción de la edición termine; cada cambio es su propio envío
     * (juntarlos haría mandar campos que nadie tocó).
     */
    enqueuePush(job: SiteSyncPushJob): boolean {
        const queue = this.live ?? this.queue;
        if (!queue) return false;
        queue
            .add(PUSH_JOB, job, { delay: 1_500, removeOnComplete: true, removeOnFail: 100 })
            .catch((err) => this.logger.error(`No se pudo encolar el envío al sitio: ${String(err)}`));
        return true;
    }

    /**
     * Un aviso del complemento (v0.1.334): se procesa en la cola para que el
     * sitio reciba la respuesta enseguida. Reintenta lo pasajero (el sitio
     * caído un momento) con espera creciente.
     */
    enqueueHook(job: SiteSyncHookJob): boolean {
        const queue = this.live ?? this.queue;
        if (!queue) return false;
        queue
            .add(HOOK_JOB, job, { attempts: 4, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: 100 })
            .catch((err) => this.logger.error(`No se pudo encolar un aviso del sitio: ${String(err)}`));
        return true;
    }
}

export interface SiteSyncHandlers {
    tick(): Promise<unknown>;
    runJob(job: SiteSyncRunJob): Promise<boolean>;
    pushJob(job: SiteSyncPushJob): Promise<unknown>;
    hookJob(job: SiteSyncHookJob): Promise<unknown>;
}

@Injectable()
export class SiteSyncQueueBootstrap implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(SiteSyncQueueBootstrap.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private liveQueue: Queue | null = null;
    private liveWorker: Worker | null = null;
    private connections: IORedis[] = [];
    private handlers: SiteSyncHandlers | null = null;

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly dispatcher: SiteSyncQueue,
    ) {}

    setHandlers(h: SiteSyncHandlers): void {
        this.handlers = h;
    }

    async onModuleInit(): Promise<void> {
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, 'site-sync');
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(SITE_SYNC_QUEUE, { connection: conn(), defaultJobOptions: QUEUE_JOB_RETENTION });
            this.queue.on('error', (err) => this.logger.warn(`Cola de sitios con error: ${err.message}`));
            const process = async (job: { name: string; data: unknown }): Promise<void> => {
                if (!this.handlers) return;
                if (job.name === TICK_JOB) {
                    await this.handlers.tick();
                    return;
                }
                if (job.name === PUSH_JOB) {
                    await this.handlers.pushJob(job.data as SiteSyncPushJob);
                    return;
                }
                if (job.name === HOOK_JOB) {
                    await this.handlers.hookJob(job.data as SiteSyncHookJob);
                    return;
                }
                const data = job.data as SiteSyncRunJob;
                const ran = await this.handlers.runJob(data);
                // Otra corrida la tenía tomada: se reintenta en un rato.
                if (!ran) this.dispatcher.enqueueRun(data.tenantId, data.syncId, { full: data.full, only: data.only }, 30_000);
            };
            this.worker = createWorker(SITE_SYNC_QUEUE, process, { connection: conn(), concurrency: 2, lockDuration: 120_000 });
            this.worker?.on('failed', (job, err) => this.logger.error(`Sincronización de sitio ${job?.id} falló: ${err.message}`));
            this.worker?.on('error', (err) => this.logger.warn(`Worker de sitios con error: ${err.message}`));
            this.liveQueue = new Queue(SITE_SYNC_LIVE_QUEUE, { connection: conn(), defaultJobOptions: QUEUE_JOB_RETENTION });
            this.liveQueue.on('error', (err) => this.logger.warn(`Cola de avisos de sitios con error: ${err.message}`));
            this.liveWorker = createWorker(SITE_SYNC_LIVE_QUEUE, process, { connection: conn(), concurrency: 4, lockDuration: 120_000 });
            this.liveWorker?.on('failed', (job, err) => this.logger.error(`Aviso de sitio ${job?.id} falló: ${err.message}`));
            this.liveWorker?.on('error', (err) => this.logger.warn(`Worker de avisos de sitios con error: ${err.message}`));
            this.dispatcher.setQueue(this.queue, this.liveQueue);
            registerScheduler(this.queue, TICK_JOB, { every: 60_000 }, { name: TICK_JOB, data: {} }, this.logger);
            this.logger.log('Cola de sincronización con sitios lista');
        } catch (err) {
            this.logger.warn(`Sincronización con sitios deshabilitada (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.liveWorker?.close();
        await this.queue?.close();
        await this.liveQueue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
