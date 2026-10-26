import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';

export const HELPDESK_QUEUE = 'helpdesk';
const TICK_JOB = 'tick';

export interface HelpdeskPollJob {
    tenantId: number;
    mailboxId: number;
}

export interface HelpdeskSlaListJob {
    tenantId: number;
    listId: number;
}

/**
 * D2/E5 — Cola propia de la mesa de ayuda: un buzón lento (o un proveedor que
 * tarda en contestar) no frena las automatizaciones ni el correo de nadie.
 *
 *  - `tick` cada minuto: busca los buzones que toca leer y los tickets cuyo
 *    SLA cambia de estado (`next_check_at` vencido).
 *  - `poll`: leer UN buzón. El `jobId` deduplica: el tick y «Revisar ahora»
 *    no apilan dos lecturas del mismo buzón (y además hay un candado en Redis
 *    por buzón, para varios nodos).
 *  - `sla-list`: recalcular el SLA de los tickets de una lista (cambió la
 *    política o se activó).
 *
 * Por qué NO hay IDLE (conexión abierta esperando avisos del servidor): con
 * varios nodos habría que elegir quién mantiene la conexión de cada buzón,
 * reconectar cuando el proveedor la corta (Gmail y Outlook la cierran cada
 * ~30 min) y repartir cientos de conexiones abiertas. Para un SLA medido en
 * horas, un minuto de demora no cambia nada y la lectura periódica es simple
 * y robusta. Sin Redis (tests) la cola es no-op.
 */
@Injectable()
export class HelpdeskQueue {
    private readonly logger = new Logger(HelpdeskQueue.name);
    private queue: Queue | null = null;

    setQueue(queue: Queue): void {
        this.queue = queue;
    }

    enqueuePoll(tenantId: number, mailboxId: number, delayMs = 0): void {
        if (!this.queue) return;
        const data: HelpdeskPollJob = { tenantId, mailboxId };
        this.queue
            .add('poll', data, {
                jobId: `poll-${mailboxId}${delayMs > 0 ? '-later' : ''}`,
                delay: delayMs,
                removeOnComplete: true,
                removeOnFail: 100,
            })
            .catch((err) => this.logger.error(`No se pudo encolar la lectura del buzón #${mailboxId}: ${String(err)}`));
    }

    enqueueSlaList(tenantId: number, listId: number): void {
        if (!this.queue) return;
        const data: HelpdeskSlaListJob = { tenantId, listId };
        this.queue
            .add('sla-list', data, { jobId: `sla-list-${listId}`, delay: 500, removeOnComplete: true, removeOnFail: 100 })
            .catch((err) => this.logger.error(`No se pudo encolar el SLA de la lista #${listId}: ${String(err)}`));
    }
}

export interface HelpdeskHandlers {
    tick(): Promise<unknown>;
    poll(job: HelpdeskPollJob): Promise<boolean>;
    slaList(job: HelpdeskSlaListJob): Promise<unknown>;
}

@Injectable()
export class HelpdeskQueueBootstrap implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(HelpdeskQueueBootstrap.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];
    private handlers: HelpdeskHandlers | null = null;

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly dispatcher: HelpdeskQueue,
    ) {}

    setHandlers(h: HelpdeskHandlers): void {
        this.handlers = h;
    }

    async onModuleInit(): Promise<void> {
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, 'helpdesk');
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(HELPDESK_QUEUE, { connection: conn(), defaultJobOptions: QUEUE_JOB_RETENTION });
            this.queue.on('error', (err) => this.logger.warn(`Cola de la mesa de ayuda con error: ${err.message}`));
            this.worker = new Worker(
                HELPDESK_QUEUE,
                async (job) => {
                    if (!this.handlers) return;
                    if (job.name === TICK_JOB) {
                        await this.handlers.tick();
                        return;
                    }
                    if (job.name === 'sla-list') {
                        await this.handlers.slaList(job.data as HelpdeskSlaListJob);
                        return;
                    }
                    const data = job.data as HelpdeskPollJob;
                    const ran = await this.handlers.poll(data);
                    // Otro nodo lo estaba leyendo: se reintenta en un rato.
                    if (!ran) this.dispatcher.enqueuePoll(data.tenantId, data.mailboxId, 30_000);
                },
                { connection: conn(), concurrency: 3, lockDuration: 5 * 60_000 },
            );
            this.worker.on('failed', (job, err) => this.logger.error(`Mesa de ayuda: ${job?.name} ${job?.id} falló: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de la mesa de ayuda con error: ${err.message}`));
            this.dispatcher.setQueue(this.queue);
            await this.queue.upsertJobScheduler(TICK_JOB, { every: 60_000 }, { name: TICK_JOB, data: {} });
            this.logger.log('Cola de la mesa de ayuda lista');
        } catch (err) {
            this.logger.warn(`Mesa de ayuda sin cola (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
