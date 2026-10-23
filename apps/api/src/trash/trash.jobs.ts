import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { TrashService } from './trash.service';

const QUEUE = 'trash';

/**
 * Papelera — el barrido diario que borra de verdad lo que pasó el plazo
 * (30 días por defecto). Scheduler de BullMQ: vive en Redis, sobrevive a
 * reinicios y corre en UN solo nodo por disparo. Una vez al día, de
 * madrugada (UTC), cuando la base está tranquila.
 */
@Injectable()
export class TrashJobs implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(TrashJobs.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly trash: TrashService,
    ) {}

    async onModuleInit(): Promise<void> {
        if (this.env.NODE_ENV === 'test') return;
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, QUEUE);
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(QUEUE, { connection: conn(), defaultJobOptions: QUEUE_JOB_RETENTION });
            this.queue.on('error', (err) => this.logger.warn(`Cola de la papelera con error: ${err.message}`));
            this.worker = new Worker(
                QUEUE,
                async () => {
                    const n = await this.trash.purgeExpired();
                    if (n > 0) this.logger.log(`Papelera: se borraron para siempre ${n} cosas vencidas.`);
                },
                { connection: conn() },
            );
            this.worker.on('failed', (_job, err) => this.logger.error(`El vaciado de la papelera falló: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de la papelera con error: ${err.message}`));
            await this.queue.upsertJobScheduler('purge', { pattern: '17 4 * * *' }, { name: 'purge', data: {} });
        } catch (err) {
            this.logger.warn(`Vaciado automático de la papelera deshabilitado (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
