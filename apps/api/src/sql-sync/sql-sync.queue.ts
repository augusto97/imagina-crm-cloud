import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { guardRedis } from '../redis/redis.util';

export const SQL_SYNC_QUEUE = 'sql-sync';
const TICK_JOB = 'tick';
const RUN_JOB = 'run';

export interface SqlSyncRunJob {
    tenantId: number;
    syncId: number;
}

/**
 * Encola corridas de sincronización desde SQL Server (v0.1.243). Cola propia:
 * una consulta de un minuto contra la base de un cliente no frena las
 * automatizaciones ni la sincronización de tiendas de nadie. Sin Redis (tests)
 * es no-op. El `jobId` deduplica: el tick y un «Sincronizar ahora» no apilan
 * dos corridas de la misma sincronización.
 */
@Injectable()
export class SqlSyncQueue {
    private readonly logger = new Logger(SqlSyncQueue.name);
    private queue: Queue | null = null;

    setQueue(queue: Queue): void {
        this.queue = queue;
    }

    enqueueRun(tenantId: number, syncId: number, delayMs = 0): void {
        if (!this.queue) return;
        const data: SqlSyncRunJob = { tenantId, syncId };
        this.queue
            .add(RUN_JOB, data, {
                jobId: `run-${syncId}${delayMs > 0 ? '-retry' : ''}`,
                delay: delayMs,
                removeOnComplete: true,
                removeOnFail: 100,
            })
            .catch((err) => this.logger.error(`No se pudo encolar la sincronización SQL #${syncId}: ${String(err)}`));
    }
}

export interface SqlSyncHandlers {
    tick(): Promise<unknown>;
    runJob(job: SqlSyncRunJob): Promise<boolean>;
}

@Injectable()
export class SqlSyncQueueBootstrap implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(SqlSyncQueueBootstrap.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];
    private handlers: SqlSyncHandlers | null = null;

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly dispatcher: SqlSyncQueue,
    ) {}

    setHandlers(h: SqlSyncHandlers): void {
        this.handlers = h;
    }

    async onModuleInit(): Promise<void> {
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, 'sql-sync');
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(SQL_SYNC_QUEUE, { connection: conn() });
            this.queue.on('error', (err) => this.logger.warn(`Cola de SQL con error: ${err.message}`));
            this.worker = new Worker(
                SQL_SYNC_QUEUE,
                async (job) => {
                    if (!this.handlers) return;
                    if (job.name === TICK_JOB) {
                        await this.handlers.tick();
                        return;
                    }
                    const data = job.data as SqlSyncRunJob;
                    const ran = await this.handlers.runJob(data);
                    // Otra corrida la tenía tomada: se reintenta en un rato.
                    if (!ran) this.dispatcher.enqueueRun(data.tenantId, data.syncId, 60_000);
                },
                // Dos a la vez: la base lenta de una empresa no frena la de otra.
                { connection: conn(), concurrency: 2, lockDuration: 6 * 60_000 },
            );
            this.worker.on('failed', (job, err) => this.logger.error(`Sincronización SQL ${job?.id} falló: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de SQL con error: ${err.message}`));
            this.dispatcher.setQueue(this.queue);
            await this.queue.upsertJobScheduler(TICK_JOB, { every: 60_000 }, { name: TICK_JOB, data: {} });
            this.logger.log('Cola de sincronización SQL lista');
        } catch (err) {
            this.logger.warn(`Sincronización SQL deshabilitada (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
