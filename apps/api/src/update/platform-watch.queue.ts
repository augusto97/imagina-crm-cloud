import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { createWorker, registerScheduler } from '../redis/queue-runtime';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { PlatformWatchService } from './platform-watch.service';

export const PLATFORM_WATCH_QUEUE = 'platform-watch';

/**
 * v0.1.431 (ADR-S104) — Cola PROPIA de la vigilancia del servidor, una vez por
 * minuto. No va en la cola del actualizador: ahí corren de a uno trabajos de
 * hasta media hora (instalar una versión, una copia de seguridad) y el latido
 * al monitoreo externo se atrasaría — Better Stack avisaría una caída falsa.
 */
@Injectable()
export class PlatformWatchQueue implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(PlatformWatchQueue.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly watch: PlatformWatchService,
    ) {}

    onModuleInit(): void {
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, 'platform-watch');
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(PLATFORM_WATCH_QUEUE, { connection: conn(), defaultJobOptions: QUEUE_JOB_RETENTION });
            this.queue.on('error', (err) => this.logger.warn(`Cola de vigilancia con error: ${err.message}`));
            this.worker = createWorker(
                PLATFORM_WATCH_QUEUE,
                async () => {
                    await this.watch.tick();
                },
                // Un tick a la vez: el lento (copias, certificado) no debe pisarse con el siguiente.
                { connection: conn(), concurrency: 1, lockDuration: 120_000 },
            );
            this.worker?.on('error', (err) => this.logger.warn(`Worker de vigilancia con error: ${err.message}`));
            registerScheduler(this.queue, 'platform-watch-minute', { pattern: '* * * * *' }, { name: 'tick' }, this.logger);
        } catch (err) {
            this.logger.warn(`Vigilancia del servidor deshabilitada (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
