import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { StoreMetaResource, StoreSyncResource } from '@imagina-base/shared';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { guardRedis } from '../redis/redis.util';

export const STORE_SYNC_QUEUE = 'store-sync';
const TICK_JOB = 'tick';
const RUN_JOB = 'run';
const HOOK_JOB = 'hook';
const PUSH_JOB = 'push';

export interface StoreSyncRunJob {
    tenantId: number;
    syncId: number;
    full?: boolean;
    only?: StoreSyncResource[];
}

/** Un aviso de la tienda, ya verificado (v0.1.207). */
export interface StoreSyncHookJob {
    tenantId: number;
    syncId: number;
    topic: string;
    payload: Record<string, unknown>;
}

/** Un registro editado en la app que tiene que viajar a la tienda (v0.1.207). */
export interface StoreSyncPushJob {
    tenantId: number;
    syncId: number;
    resource: StoreMetaResource;
    recordId: number;
    fieldIds: number[];
}

/**
 * Encola corridas de sincronización (v0.1.206). Mismo patrón que el
 * `AutomationDispatcher`: sin cola (tests, sin Redis) es no-op.
 *
 * El `jobId` deduplica: si ya hay una corrida ESPERANDO para esa tienda, pedir
 * otra no suma una segunda (el tick de cada minuto y un «Sincronizar ahora»
 * no se apilan). Las completas y las parciales llevan ids distintos.
 */
@Injectable()
export class StoreSyncQueue {
    private readonly logger = new Logger(StoreSyncQueue.name);
    private queue: Queue | null = null;

    setQueue(queue: Queue): void {
        this.queue = queue;
    }

    enqueueRun(tenantId: number, syncId: number, opts: { full?: boolean; only?: StoreSyncResource[] }, delayMs = 0): void {
        if (!this.queue) return;
        const suffix = `${opts.full ? '-full' : ''}${opts.only?.length ? `-${[...opts.only].sort().join('_')}` : ''}`;
        const data: StoreSyncRunJob = { tenantId, syncId, ...opts };
        this.queue
            .add(RUN_JOB, data, {
                // Un reintento diferido no puede reusar el id: el job que lo
                // pide todavía existe (está corriendo) y BullMQ lo descartaría.
                jobId: `run-${syncId}${suffix}${delayMs > 0 ? '-retry' : ''}`,
                delay: delayMs,
                removeOnComplete: true,
                removeOnFail: 100,
            })
            .catch((err) => this.logger.error(`No se pudo encolar la sincronización #${syncId}: ${String(err)}`));
    }

    /** Un aviso de la tienda: se procesa enseguida y fuera de la request (la tienda espera 5 s). */
    enqueueHook(job: StoreSyncHookJob): boolean {
        if (!this.queue) return false;
        this.queue
            .add(HOOK_JOB, job, { removeOnComplete: true, removeOnFail: 100, attempts: 3, backoff: { type: 'exponential', delay: 5_000 } })
            .catch((err) => this.logger.error(`No se pudo encolar el aviso de la tienda: ${String(err)}`));
        return true;
    }

    /**
     * Un cambio hecho en la app que viaja a la tienda. Con una pequeña espera
     * para que la transacción de la edición termine; cada cambio es su propio
     * envío (juntarlos haría mandar campos que nadie tocó).
     */
    enqueuePush(job: StoreSyncPushJob): void {
        if (!this.queue) return;
        this.queue
            .add(PUSH_JOB, job, { delay: 1_500, removeOnComplete: true, removeOnFail: 100 })
            .catch((err) => this.logger.error(`No se pudo encolar el envío a la tienda: ${String(err)}`));
    }
}

/** Los handlers los pone el módulo (evita el ciclo service ↔ queue). */
export interface StoreSyncHandlers {
    tick(): Promise<unknown>;
    runJob(job: StoreSyncRunJob): Promise<boolean>;
    hookJob(job: StoreSyncHookJob): Promise<unknown>;
    pushJob(job: StoreSyncPushJob): Promise<unknown>;
}

@Injectable()
export class StoreSyncQueueBootstrap implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(StoreSyncQueueBootstrap.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];
    private handlers: StoreSyncHandlers | null = null;

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly dispatcher: StoreSyncQueue,
    ) {}

    setHandlers(h: StoreSyncHandlers): void {
        this.handlers = h;
    }

    async onModuleInit(): Promise<void> {
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, 'store-sync');
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(STORE_SYNC_QUEUE, { connection: conn() });
            this.queue.on('error', (err) => this.logger.warn(`Cola de sincronización con error: ${err.message}`));
            this.worker = new Worker(
                STORE_SYNC_QUEUE,
                async (job) => {
                    if (!this.handlers) return;
                    if (job.name === TICK_JOB) {
                        await this.handlers.tick();
                        return;
                    }
                    if (job.name === HOOK_JOB) {
                        await this.handlers.hookJob(job.data as StoreSyncHookJob);
                        return;
                    }
                    if (job.name === PUSH_JOB) {
                        await this.handlers.pushJob(job.data as StoreSyncPushJob);
                        return;
                    }
                    const data = job.data as StoreSyncRunJob;
                    const ran = await this.handlers.runJob(data);
                    // Otra corrida la tenía tomada: se reintenta en un rato
                    // (sin perder el pedido, p. ej. un «Sincronizar ahora»).
                    if (!ran) {
                        this.dispatcher.enqueueRun(data.tenantId, data.syncId, { full: data.full, only: data.only }, 30_000);
                    }
                },
                // Dos a la vez: una tienda enorme no frena la de otra empresa.
                { connection: conn(), concurrency: 2, lockDuration: 120_000 },
            );
            this.worker.on('failed', (job, err) => this.logger.error(`Sincronización ${job?.id} falló: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de sincronización con error: ${err.message}`));
            this.dispatcher.setQueue(this.queue);
            await this.queue.upsertJobScheduler(TICK_JOB, { every: 60_000 }, { name: TICK_JOB, data: {} });
            this.logger.log('Cola de sincronización con tiendas lista');
        } catch (err) {
            this.logger.warn(`Sincronización con tiendas deshabilitada (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
