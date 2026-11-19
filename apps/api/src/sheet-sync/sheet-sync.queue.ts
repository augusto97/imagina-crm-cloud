import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { addDedupedJob, createWorker, registerScheduler } from '../redis/queue-runtime';

export const SHEET_SYNC_QUEUE = 'sheet-sync';
const TICK_JOB = 'tick';
const RUN_JOB = 'run';

/** Un cambio en la app sale a la hoja a los pocos segundos (los cambios seguidos se juntan). */
export const SHEET_PUSH_DELAY_MS = 10_000;

export interface SheetSyncRunJob {
    tenantId: number;
    syncId: number;
}

/**
 * v0.1.459 (G3) — Corridas de la sincronización con Google Sheets. Cola propia:
 * una planilla lenta de una empresa no frena las automatizaciones ni las otras
 * sincronizaciones. Sin Redis (tests) es no-op. El `jobId` deduplica: el tick,
 * un «Sincronizar ahora» y los cambios de la app no apilan corridas.
 */
@Injectable()
export class SheetSyncQueue {
    private readonly logger = new Logger(SheetSyncQueue.name);
    private queue: Queue | null = null;

    setQueue(queue: Queue): void {
        this.queue = queue;
    }

    enqueueRun(tenantId: number, syncId: number, delayMs = 0): void {
        this.add(tenantId, syncId, `run-${syncId}${delayMs > 0 ? '-retry' : ''}`, delayMs);
    }

    /**
     * Un registro cambió en la app: corrida en unos segundos. Los cambios que
     * caen en la misma ventana comparten la corrida.
     */
    enqueuePush(tenantId: number, syncId: number, now = Date.now()): void {
        this.add(tenantId, syncId, `push-${syncId}-${Math.floor(now / SHEET_PUSH_DELAY_MS)}`, SHEET_PUSH_DELAY_MS);
    }

    private add(tenantId: number, syncId: number, jobId: string, delay: number): void {
        if (!this.queue) return;
        const data: SheetSyncRunJob = { tenantId, syncId };
        addDedupedJob(this.queue, RUN_JOB, data, { jobId, delay }).catch((err) =>
            this.logger.error(`No se pudo encolar la sincronización con Google Sheets #${syncId}: ${String(err)}`),
        );
    }
}

export interface SheetSyncHandlers {
    tick(): Promise<unknown>;
    runJob(job: SheetSyncRunJob): Promise<boolean>;
}

@Injectable()
export class SheetSyncQueueBootstrap implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(SheetSyncQueueBootstrap.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];
    private handlers: SheetSyncHandlers | null = null;

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly dispatcher: SheetSyncQueue,
    ) {}

    setHandlers(h: SheetSyncHandlers): void {
        this.handlers = h;
    }

    async onModuleInit(): Promise<void> {
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, 'sheet-sync');
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(SHEET_SYNC_QUEUE, { connection: conn(), defaultJobOptions: QUEUE_JOB_RETENTION });
            this.queue.on('error', (err) => this.logger.warn(`Cola de Google Sheets con error: ${err.message}`));
            this.worker = createWorker(
                SHEET_SYNC_QUEUE,
                async (job) => {
                    if (!this.handlers) return;
                    if (job.name === TICK_JOB) {
                        await this.handlers.tick();
                        return;
                    }
                    const data = job.data as SheetSyncRunJob;
                    const ran = await this.handlers.runJob(data);
                    // Otra corrida la tenía tomada: se reintenta en un rato.
                    if (!ran) this.dispatcher.enqueueRun(data.tenantId, data.syncId, 30_000);
                },
                { connection: conn(), concurrency: 2, lockDuration: 6 * 60_000 },
            );
            this.worker?.on('failed', (job, err) => this.logger.error(`Sincronización con Google Sheets ${job?.id} falló: ${err.message}`));
            this.worker?.on('error', (err) => this.logger.warn(`Worker de Google Sheets con error: ${err.message}`));
            this.dispatcher.setQueue(this.queue);
            registerScheduler(this.queue, TICK_JOB, { every: 60_000 }, { name: TICK_JOB, data: {} }, this.logger);
            this.logger.log('Cola de sincronización con Google Sheets lista');
        } catch (err) {
            this.logger.warn(`Sincronización con Google Sheets deshabilitada (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
