import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { RecurrencesService } from '../recurrences/recurrences.service';
import { guardRedis } from '../redis/redis.util';
import { AutomationBulkRunner } from './automation-bulk-runner.service';
import { AutomationDispatcher, type BulkEditJob, type TriggerEvent, type WhatsEventJob } from './automation-dispatcher.service';
import { AutomationEngine } from './automation-engine.service';
import { AutomationScheduler } from './automation-scheduler.service';
import { AutomationWaitsService } from './automation-waits.service';
import { AutomationsService } from './automations.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { IncidentHub, errorText } from '../incidents/incident-hub';
import { createWorker, registerScheduler, runInJobScope, workersEnabled } from '../redis/queue-runtime';

interface SchedulerJobData {
    tenantId: number;
    automationId: number;
}

export const AUTOMATIONS_QUEUE = 'automations';

/** Tick GLOBAL de recurrencias (barrido de las trigger=schedule) cada 5 min. */
const RECURRENCES_TICK_JOB = 'recurrences-tick';
const RECURRENCES_TICK_PATTERN = '*/5 * * * *';

/** v0.1.288 — reloj de las esperas («Esperar»): cada minuto, uno por disparo. */
const WAITS_TICK_JOB = 'waits-tick';

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
        private readonly waits: AutomationWaitsService,
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
            this.worker = createWorker(
                AUTOMATIONS_QUEUE,
                (job) => runInJobScope(AUTOMATIONS_QUEUE, job.id, async () => {
                    // Despacho por tipo de job: evento de record, cron o due-date.
                    if (job.name === 'scheduled') {
                        const d = job.data as SchedulerJobData;
                        await this.engine.runScheduled(d.tenantId, d.automationId);
                    } else if (job.name === 'due') {
                        const d = job.data as SchedulerJobData;
                        await this.engine.runDueDate(d.tenantId, d.automationId);
                    } else if (job.name === 'matches') {
                        // v0.1.455 — «empieza a cumplir una condición»: quién entró y quién salió.
                        const d = job.data as SchedulerJobData;
                        await this.engine.runMatchScan(d.tenantId, d.automationId);
                    } else if (job.name === 'webhook') {
                        const d = job.data as SchedulerJobData & { payload: Record<string, unknown> };
                        await this.engine.runWebhook(d.tenantId, d.automationId, d.payload);
                    } else if (job.name === 'whats-event') {
                        // v0.1.402 — «Cuando pasa algo en Whats», con el registro ya encontrado.
                        await this.engine.runWhatsEvent(job.data as WhatsEventJob);
                    } else if (job.name === 'bulk-edit') {
                        // Una edición en lote que se repite tras un corte volvería a
                        // sumar o multiplicar sobre lo ya cambiado: no se repite (lo
                        // aplicado queda en el historial de ediciones, con Deshacer).
                        if (!(await this.engine.firstTimeInJob('bulk-edit'))) {
                            this.logger.warn(`Edición en lote ${job.id}: el trabajo se repitió tras un corte; no se vuelve a ejecutar.`);
                            return undefined;
                        }
                        await this.bulkRunner.run(job.data as BulkEditJob);
                    } else if (job.name === WAITS_TICK_JOB) {
                        await this.waits.tick();
                    } else if (job.name === 'resume') {
                        const d = job.data as { tenantId: number; runId: number };
                        await this.waits.resume(d.tenantId, d.runId);
                    } else if (job.name === 'scheduled-batch') {
                        const d = job.data as SchedulerJobData & { recordIds: number[] };
                        await this.engine.runScheduledBatch(d.tenantId, d.automationId, d.recordIds);
                    } else if (job.name === RECURRENCES_TICK_JOB) {
                        await this.recurrences.tick();
                        await this.maintainRuns();
                    } else {
                        // Las corridas que abrió quedan como resultado del job:
                        // un botón pregunta por ellas para decir cómo terminaron.
                        return this.engine.process(job.data as TriggerEvent);
                    }
                    return undefined;
                }),
                // v0.1.392 — antes 5 fijas. Los pasos de red ya no retienen una
                // conexión a la base mientras esperan (ver `runPlainAction`).
                // `lockDuration` 90 s (default 30): BullMQ da un trabajo por colgado si
                // su candado no se renueva a tiempo; con 30 s alcanzaba un render de
                // PDF o un export grande ocupando el proceso para que otro nodo lo
                // tomara y lo corriera a la par.
                { connection: conn(), concurrency: this.env.AUTOMATIONS_CONCURRENCY, lockDuration: 90_000 },
            );
            // v0.1.392 — la tarea terminó: se libera el turno de su empresa.
            const releaseTurn = (job: { opts?: { priority?: number }; data?: unknown } | undefined): void => {
                const tenantId = (job?.data as { tenantId?: unknown } | undefined)?.tenantId;
                if (job?.opts?.priority && typeof tenantId === 'number') void this.dispatcher.release(tenantId);
            };
            this.worker?.on('completed', (job) => releaseTurn(job));
            this.worker?.on('failed', (job, err) => {
                releaseTurn(job);
                this.logger.error(`Job ${job?.id} falló: ${err.message}`);
                // v0.1.285 (ADR-S44) — el trabajo se cayó ANTES de poder
                // registrar la corrida: sin esto, sólo quedaba en el log.
                const d = (job?.data ?? {}) as Partial<SchedulerJobData & TriggerEvent>;
                if (!job || job.name === RECURRENCES_TICK_JOB || job.name === WAITS_TICK_JOB || typeof d.tenantId !== 'number') return;
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
            this.worker?.on('error', (err) => this.logger.warn(`Worker de automatizaciones con error: ${err.message}`));
            this.dispatcher.setQueue(this.queue);
            this.scheduler.setQueue(this.queue);
            // Job repeatable global (persiste en Redis → sobrevive reinicios).
            registerScheduler(this.queue, RECURRENCES_TICK_JOB, { pattern: RECURRENCES_TICK_PATTERN }, { name: RECURRENCES_TICK_JOB, data: {} }, this.logger);
            // v0.1.288 — el reloj de las esperas (corridas en un «Esperar»).
            registerScheduler(this.queue, WAITS_TICK_JOB, { every: 60_000 }, { name: WAITS_TICK_JOB, data: {} }, this.logger);
            // v0.1.221 — Re-registra los horarios en segundo plano (no demora el arranque).
            if (workersEnabled()) {
                void this.automations
                    .resyncSchedules()
                    .then((n) => n > 0 && this.logger.log(`Horarios de automatizaciones sincronizados: ${n}`))
                    .catch((err) => this.logger.warn(`No se pudieron sincronizar los horarios: ${String(err)}`));
            }
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
        // Turnos que quedaron contados de más (sólo corrige con la cola vacía).
        const fixed = await this.dispatcher.reconcileTurns();
        if (fixed > 0) this.logger.log(`Turnos de la cola de automatizaciones corregidos: ${fixed}`);
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
