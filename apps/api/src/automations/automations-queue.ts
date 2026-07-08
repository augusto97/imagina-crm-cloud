import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { AutomationDispatcher, type TriggerEvent } from './automation-dispatcher.service';
import { AutomationEngine } from './automation-engine.service';
import { AutomationScheduler } from './automation-scheduler.service';

interface SchedulerJobData {
    tenantId: number;
    automationId: number;
}

export const AUTOMATIONS_QUEUE = 'automations';

/**
 * Cablea la cola BullMQ y el worker (STANDALONE §8). El worker procesa los
 * eventos de trigger con el motor. Si Redis no está disponible, degrada sin
 * romper el arranque (las automatizaciones simplemente no corren).
 */
@Injectable()
export class AutomationsQueueBootstrap implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(AutomationsQueueBootstrap.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly dispatcher: AutomationDispatcher,
        private readonly scheduler: AutomationScheduler,
        private readonly engine: AutomationEngine,
    ) {}

    async onModuleInit(): Promise<void> {
        try {
            const conn = () => {
                const c = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(AUTOMATIONS_QUEUE, { connection: conn() });
            this.worker = new Worker(
                AUTOMATIONS_QUEUE,
                async (job) => {
                    // Despacho por tipo de job: evento de record, cron o due-date.
                    if (job.name === 'scheduled') {
                        const d = job.data as SchedulerJobData;
                        await this.engine.runScheduled(d.tenantId, d.automationId);
                    } else if (job.name === 'due') {
                        const d = job.data as SchedulerJobData;
                        await this.engine.runDueDate(d.tenantId, d.automationId);
                    } else {
                        await this.engine.process(job.data as TriggerEvent);
                    }
                },
                { connection: conn(), concurrency: 5 },
            );
            this.worker.on('failed', (job, err) =>
                this.logger.error(`Job ${job?.id} falló: ${err.message}`),
            );
            this.dispatcher.setQueue(this.queue);
            this.scheduler.setQueue(this.queue);
            this.logger.log('Cola de automatizaciones lista');
        } catch (err) {
            this.logger.warn(`Automatizaciones deshabilitadas (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
