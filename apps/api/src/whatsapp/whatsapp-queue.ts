import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { WhatsappService, type WhatsappJob } from './whatsapp.service';

const QUEUE = 'whatsapp';

/**
 * D3 — La cola de los avisos de Meta y el refresco de las plantillas.
 *
 * Meta corta si no se le contesta en unos segundos y REINTENTA el mismo aviso
 * durante días: el POST sólo verifica la firma y encola. Cada mensaje/estado
 * entra con un id propio (el job no se duplica mientras viva) y el servicio
 * además lo recuerda una semana en Redis: un aviso repetido no se procesa dos
 * veces. Las plantillas se refrescan solas cada 6 horas.
 */
@Injectable()
export class WhatsappQueue implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(WhatsappQueue.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly whatsapp: WhatsappService,
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
            this.queue.on('error', (err) => this.logger.warn(`Cola de WhatsApp con error: ${err.message}`));
            this.worker = new Worker(
                QUEUE,
                async (job) => {
                    if (job.name === 'templates-refresh') {
                        await this.whatsapp.syncAllTemplates();
                        return;
                    }
                    await this.whatsapp.process(job.data as WhatsappJob);
                },
                { connection: conn(), concurrency: 4 },
            );
            this.worker.on('failed', (job, err) => this.logger.warn(`Aviso de WhatsApp (${job?.name ?? '?'}) falló: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de WhatsApp con error: ${err.message}`));
            await this.queue.upsertJobScheduler('templates-refresh', { pattern: '17 */6 * * *' }, { name: 'templates-refresh', data: {} });
            const queue = this.queue;
            this.whatsapp.setSink({
                add: async (job, dedup) => {
                    await queue.add(job.kind, job, {
                        ...(dedup ? { jobId: `wa-${job.tenantId}-${createHash('sha1').update(dedup).digest('hex')}` } : {}),
                        attempts: 3,
                        backoff: { type: 'exponential', delay: 5_000 },
                        removeOnComplete: { age: 24 * 3600, count: 5000 },
                        removeOnFail: { age: 7 * 24 * 3600 },
                    });
                },
            });
        } catch (err) {
            this.logger.warn(`Avisos de WhatsApp en segundo plano deshabilitados (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        this.whatsapp.setSink(null);
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
