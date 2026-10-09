import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { guardRedis } from '../redis/redis.util';
import { NotificationsService } from './notifications.service';

const QUEUE = 'notifications';

/**
 * v0.1.276 — Dos relojes: los recordatorios (cada minuto) y el resumen diario
 * (cada hora; a cada persona le llega a SU hora en la zona de la empresa).
 * Los schedulers de BullMQ viven en Redis: sobreviven a reinicios y corren en
 * UN solo nodo por disparo.
 */
@Injectable()
export class NotificationsJobs implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(NotificationsJobs.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly notifications: NotificationsService,
    ) {}

    async onModuleInit(): Promise<void> {
        if (this.env.NODE_ENV === 'test') return;
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, QUEUE);
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(QUEUE, { connection: conn() });
            this.queue.on('error', (err) => this.logger.warn(`Cola de avisos con error: ${err.message}`));
            this.worker = new Worker(
                QUEUE,
                async (job) => (job.name === 'digest' ? this.notifications.digestTick() : this.notifications.reminderTick()),
                { connection: conn() },
            );
            this.worker.on('failed', (job, err) => this.logger.error(`Avisos (${job?.name ?? '?'}) fallaron: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de avisos con error: ${err.message}`));
            await this.queue.upsertJobScheduler('reminders', { every: 60_000 }, { name: 'reminders', data: {} });
            await this.queue.upsertJobScheduler('digest', { pattern: '2 * * * *' }, { name: 'digest', data: {} });
        } catch (err) {
            this.logger.warn(`Recordatorios y resumen diario deshabilitados (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
