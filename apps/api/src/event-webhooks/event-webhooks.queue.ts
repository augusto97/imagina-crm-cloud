import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { createWorker, registerScheduler } from '../redis/queue-runtime';
import { EventWebhooksService } from './event-webhooks.service';

const QUEUE = 'event-webhooks';
const DRAIN_A = 'event-webhooks-drain';
const DRAIN_B = 'event-webhooks-drain-next';

/**
 * Despierta al servicio. BullMQ IGNORA un `add` con el id de un trabajo que ya
 * está corriendo: un evento que llega mientras se manda otro esperaría al tic
 * de 30 s. Por eso hay dos ids: si el primero está corriendo, se encola el
 * segundo (que espera su turno y toma lo nuevo). Uno esperando alcanza.
 */
export async function kickDrain(queue: Pick<Queue, 'getJobState' | 'add'>): Promise<string> {
    const state = await queue.getJobState(DRAIN_A).catch(() => 'unknown');
    const jobId = state === 'active' ? DRAIN_B : DRAIN_A;
    await queue.add('drain', {}, { jobId, removeOnComplete: true, removeOnFail: true });
    return jobId;
}

/**
 * v0.1.442 — El reloj de los webhooks de eventos. La verdad vive en
 * `webhook_deliveries` (Postgres): esta cola sólo DESPIERTA al servicio. Un
 * evento nuevo empuja un `drain` (sale en el momento) y un tic cada 30
 * segundos manda los reintentos que vencieron y lo que quedó a medias por un
 * corte. Entre procesos no se pisan (`FOR UPDATE SKIP LOCKED` + plazo).
 */
@Injectable()
export class EventWebhooksQueue implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(EventWebhooksQueue.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly webhooks: EventWebhooksService,
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
            this.queue.on('error', (err) => this.logger.warn(`Cola de webhooks con error: ${err.message}`));
            this.worker = createWorker(
                QUEUE,
                async () => {
                    await this.webhooks.drain();
                },
                { connection: conn(), concurrency: 1 },
            );
            this.worker?.on('failed', (job, err) => this.logger.warn(`Trabajo de webhooks (${job?.name ?? '?'}) falló: ${err.message}`));
            this.worker?.on('error', (err) => this.logger.warn(`Worker de webhooks con error: ${err.message}`));
            registerScheduler(this.queue, 'event-webhooks-tick', { every: 30_000 }, { name: 'tick', data: {} }, this.logger);
            const queue = this.queue;
            this.webhooks.setKicker(() => {
                void kickDrain(queue).catch((err: unknown) => this.logger.warn(`No se pudo despertar la cola de webhooks: ${String(err)}`));
            });
            this.logger.log('Cola de webhooks de eventos lista');
        } catch (err) {
            this.logger.warn(`Cola de webhooks deshabilitada (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        this.webhooks.setKicker(null);
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
