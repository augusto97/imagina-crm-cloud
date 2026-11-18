import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { createWorker, registerScheduler } from '../redis/queue-runtime';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { SignaturesService } from './signatures.service';

const QUEUE = 'signature-tasks';

/**
 * D6 (v0.1.446) — Lo que la firma hace sola, cada 10 minutos: vencer las
 * solicitudes cuyo plazo pasó y recordarle a quien no firmó (cada `remind_days`
 * días, máximo 3). Un scheduler de BullMQ: corre en UN nodo por disparo.
 */
@Injectable()
export class SignatureTasksService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(SignatureTasksService.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly signatures: SignaturesService,
    ) {}

    onModuleInit(): void {
        if (this.env.NODE_ENV === 'test') return;
        try {
            const conn = (): IORedis => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, QUEUE);
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(QUEUE, { connection: conn(), defaultJobOptions: QUEUE_JOB_RETENTION });
            this.queue.on('error', (err) => this.logger.warn(`Cola de firmas con error: ${err.message}`));
            this.worker = createWorker(
                QUEUE,
                async () => {
                    const r = await this.signatures.tick();
                    if (r.expired + r.reminded > 0) this.logger.log(`Firmas: ${r.expired} vencida(s), ${r.reminded} recordatorio(s).`);
                },
                { connection: conn() },
            );
            this.worker?.on('failed', (_job, err) => this.logger.error(`Tareas de firmas fallaron: ${err.message}`));
            this.worker?.on('error', (err) => this.logger.warn(`Worker de firmas con error: ${err.message}`));
            registerScheduler(this.queue, 'signature-tasks', { every: 10 * 60_000 }, { name: 'tick', data: {} }, this.logger);
        } catch (err) {
            this.logger.warn(`Tareas de firmas deshabilitadas (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
