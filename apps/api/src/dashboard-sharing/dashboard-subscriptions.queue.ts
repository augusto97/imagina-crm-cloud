import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { guardRedis } from '../redis/redis.util';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { DASHBOARD_REPORTS_QUEUE, DashboardSubscriptionScheduler, SEND_JOB } from './dashboard-subscription-scheduler';
import { DashboardSubscriptionsService } from './dashboard-subscriptions.service';

/**
 * v0.1.292 (ADR-S50) — Cola y worker de los envíos programados de tableros.
 * Sin Redis, degrada sin romper el arranque (los envíos no salen y la prueba
 * manual sigue andando).
 */
@Injectable()
export class DashboardSubscriptionsQueue implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(DashboardSubscriptionsQueue.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly scheduler: DashboardSubscriptionScheduler,
        private readonly subscriptions: DashboardSubscriptionsService,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    async onModuleInit(): Promise<void> {
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, 'dashboard-reports');
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(DASHBOARD_REPORTS_QUEUE, { connection: conn(), defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 } });
            this.queue.on('error', (err) => this.logger.warn(`Cola de envíos de tableros con error: ${err.message}`));
            this.worker = new Worker(
                DASHBOARD_REPORTS_QUEUE,
                async (job) => {
                    if (job.name !== SEND_JOB) return;
                    const d = job.data as { tenantId: number; subscriptionId: number };
                    await this.subscriptions.run(d.tenantId, d.subscriptionId);
                },
                { connection: conn(), concurrency: 2 },
            );
            this.worker.on('failed', (job, err) => this.logger.error(`Envío de tablero ${job?.id} falló: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de envíos de tableros con error: ${err.message}`));
            this.scheduler.setQueue(this.queue);
            // Re-registra los horarios en segundo plano (no demora el arranque).
            void this.subscriptions
                .resyncSchedules()
                .then((n) => n > 0 && this.logger.log(`Horarios de envíos de tableros sincronizados: ${n}`))
                .catch((err) => this.logger.warn(`No se pudieron sincronizar los envíos de tableros: ${String(err)}`));
            // Cambiar la zona de la empresa mueve los envíos sin zona propia.
            this.timeZones?.onChange((tenantId) => this.subscriptions.resyncTenantSchedules(tenantId));
        } catch (err) {
            this.logger.warn(`Envíos programados de tableros deshabilitados (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
