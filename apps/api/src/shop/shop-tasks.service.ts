import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { createWorker, registerScheduler } from '../redis/queue-runtime';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { ShopOrdersService } from './shop-orders.service';

const QUEUE = 'shop-tasks';

/**
 * v0.1.413 (ADR-S103) — Lo que la tienda hace sola: cada minuto vence los
 * pedidos de pago en línea cuyo tiempo para pagar pasó (vuelve el stock). Un
 * scheduler de BullMQ (vive en Redis: corre en UN nodo por disparo y
 * sobrevive reinicios); cancelar es idempotente con la fila bloqueada.
 */
@Injectable()
export class ShopTasksService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(ShopTasksService.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly orders: ShopOrdersService,
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
            this.queue.on('error', (err) => this.logger.warn(`Cola de la tienda con error: ${err.message}`));
            this.worker = createWorker(
                QUEUE,
                async () => {
                    const n = await this.orders.expireDue();
                    if (n > 0) this.logger.log(`Tienda: ${n} pedido(s) sin pagar a tiempo se cancelaron.`);
                },
                { connection: conn() },
            );
            this.worker?.on('failed', (_job, err) => this.logger.error(`Tareas de la tienda fallaron: ${err.message}`));
            this.worker?.on('error', (err) => this.logger.warn(`Worker de la tienda con error: ${err.message}`));
            registerScheduler(this.queue, 'shop-tasks', { every: 60_000 }, { name: 'tick', data: {} }, this.logger);
        } catch (err) {
            this.logger.warn(`Tareas de la tienda deshabilitadas (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
