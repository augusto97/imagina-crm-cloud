import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { RecurrencesService } from '../recurrences/recurrences.service';
import { guardRedis } from '../redis/redis.util';
import { AutomationBulkRunner } from './automation-bulk-runner.service';
import { AutomationDispatcher, type BulkEditJob, type TriggerEvent } from './automation-dispatcher.service';
import { AutomationEngine } from './automation-engine.service';
import { AutomationScheduler } from './automation-scheduler.service';
import { AutomationsService } from './automations.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { IncidentHub, errorText } from '../incidents/incident-hub';

interface SchedulerJobData {
    tenantId: number;
    automationId: number;
}

export const AUTOMATIONS_QUEUE = 'automations';

/** Tick GLOBAL de recurrencias (barrido de las trigger=schedule) cada 5 min. */
const RECURRENCES_TICK_JOB = 'recurrences-tick';
const RECURRENCES_TICK_PATTERN = '*/5 * * * *';

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
        private readonly recurrences: RecurrencesService,
        private readonly bulkRunner: AutomationBulkRunner,
        private readonly automations: AutomationsService,
        @Optional() private readonly timeZones?: TenantTimeZones,
        @Optional() private readonly incidents?: IncidentHub,
    ) {}

    async onModuleInit(): Promise<void> {
        try {
            const conn = () => {
                const c = guardRedis(
                    new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }),
                    this.logger,
                    'automations',
                );
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(AUTOMATIONS_QUEUE, { connection: conn(), defaultJobOptions: { removeOnComplete: 100, removeOnFail: 500 } });
            this.queue.on('error', (err) => this.logger.warn(`Cola de automatizaciones con error: ${err.message}`));
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
                    } else if (job.name === 'webhook') {
                        const d = job.data as SchedulerJobData & { payload: Record<string, unknown> };
                        await this.engine.runWebhook(d.tenantId, d.automationId, d.payload);
                    } else if (job.name === 'bulk-edit') {
                        await this.bulkRunner.run(job.data as BulkEditJob);
                    } else if (job.name === RECURRENCES_TICK_JOB) {
                        await this.recurrences.tick();
                        await this.maintainRuns();
                    } else {
                        await this.engine.process(job.data as TriggerEvent);
                    }
                },
                { connection: conn(), concurrency: 5 },
            );
            this.worker.on('failed', (job, err) => {
                this.logger.error(`Job ${job?.id} falló: ${err.message}`);
                // v0.1.285 (ADR-S44) — el trabajo se cayó ANTES de poder
                // registrar la corrida: sin esto, sólo quedaba en el log.
                const d = (job?.data ?? {}) as Partial<SchedulerJobData & TriggerEvent>;
                if (!job || job.name === RECURRENCES_TICK_JOB || typeof d.tenantId !== 'number') return;
                const automationId = typeof d.automationId === 'number' ? d.automationId : null;
                this.incidents?.report({
                    tenantId: d.tenantId,
                    key: automationId ? `automation:${automationId}` : `automations:list:${d.listId ?? 0}`,
                    source: 'automation',
                    sourceId: automationId,
                    listId: typeof d.listId === 'number' ? d.listId : null,
                    title: automationId ? 'Una automatización no pudo correr' : 'Las automatizaciones de una lista no pudieron correr',
                    message: `El motor se detuvo antes de terminar: ${errorText(err)}`,
                });
            });
            this.worker.on('error', (err) => this.logger.warn(`Worker de automatizaciones con error: ${err.message}`));
            this.dispatcher.setQueue(this.queue);
            this.scheduler.setQueue(this.queue);
            // Job repeatable global (persiste en Redis → sobrevive reinicios).
            await this.queue.upsertJobScheduler(
                RECURRENCES_TICK_JOB,
                { pattern: RECURRENCES_TICK_PATTERN },
                { name: RECURRENCES_TICK_JOB, data: {} },
            );
            // v0.1.221 — Re-registra los horarios en segundo plano (no demora el arranque).
            void this.automations
                .resyncSchedules()
                .then((n) => n > 0 && this.logger.log(`Horarios de automatizaciones sincronizados: ${n}`))
                .catch((err) => this.logger.warn(`No se pudieron sincronizar los horarios: ${String(err)}`));
            // v0.1.263 — cambiar la zona de la empresa re-registra sus horarios.
            this.timeZones?.onChange((tenantId) =>
                this.automations.resyncTenantSchedules(tenantId).then(() => undefined),
            );
            this.logger.log('Cola de automatizaciones lista');
        } catch (err) {
            this.logger.warn(`Automatizaciones deshabilitadas (sin Redis): ${String(err)}`);
        }
    }

    /**
     * Mantenimiento del historial de corridas, colgado del tick periódico
     * (cada 5 min) pero a lo sumo una vez por hora por proceso: retención de
     * 90 días y corridas que quedaron «en curso» por un reinicio.
     */
    private lastMaintenance = 0;
    private async maintainRuns(): Promise<void> {
        if (Date.now() - this.lastMaintenance < 60 * 60 * 1000) return;
        this.lastMaintenance = Date.now();
        try {
            const out = await this.automations.maintainRuns();
            if (out.pruned > 0 || out.interrupted > 0) {
                this.logger.log(`Historial de automatizaciones: ${out.pruned} corridas viejas borradas, ${out.interrupted} interrumpidas.`);
            }
        } catch (err) {
            this.logger.warn(`No se pudo mantener el historial de automatizaciones: ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
