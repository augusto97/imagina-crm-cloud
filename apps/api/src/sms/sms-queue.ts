import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { SmsService } from './sms.service';

const QUEUE = 'sms';

/**
 * SMS (ADR-S82) — El reloj de los SMS. La verdad vive en `sms_messages`
 * (Postgres): esta cola sólo DESPIERTA al servicio. Cada minuto un tic manda
 * lo programado cuya hora llegó (Ley 2300), cierra lo que quedó «enviando» por
 * un corte y pregunta el estado a los proveedores sin avisos (Onurix); un
 * envío masivo además empuja un `drain` para no esperar al tic. Un solo
 * trabajo a la vez por nodo: el ritmo por proveedor se respeta dentro de él y
 * entre nodos no se pisan (`FOR UPDATE SKIP LOCKED`).
 */
@Injectable()
export class SmsQueue implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(SmsQueue.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly sms: SmsService,
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
            this.queue.on('error', (err) => this.logger.warn(`Cola de SMS con error: ${err.message}`));
            this.worker = new Worker(
                QUEUE,
                async (job) => {
                    if (job.name === 'tick') {
                        await this.sms.tick();
                        return;
                    }
                    await this.sms.drain();
                },
                { connection: conn(), concurrency: 1 },
            );
            this.worker.on('failed', (job, err) => this.logger.warn(`Trabajo de SMS (${job?.name ?? '?'}) falló: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de SMS con error: ${err.message}`));
            await this.queue.upsertJobScheduler('sms-tick', { every: 60_000 }, { name: 'tick', data: {} });
            const queue = this.queue;
            this.sms.setKicker(() => {
                void queue
                    .add('drain', {}, { jobId: 'sms-drain', removeOnComplete: true, removeOnFail: true })
                    .catch((err: unknown) => this.logger.warn(`No se pudo despertar la cola de SMS: ${String(err)}`));
            });
            this.logger.log('Cola de SMS lista');
        } catch (err) {
            this.logger.warn(`Cola de SMS deshabilitada (sin Redis): los envíos masivos salen en el acto: ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        this.sms.setKicker(null);
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
