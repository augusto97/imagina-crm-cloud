import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { guardRedis } from '../redis/redis.util';
import { BackupsService } from './backups.service';
import { CheckUpdatesService } from './check-updates.service';
import { UpdateManager } from './update-manager.service';
import { UPDATE_QUEUE } from './update.types';

/**
 * Cola BullMQ de la auto-actualización (ADR-S13). Un solo worker (concurrency
 * 1) procesa el `run` (que corre in-process → el finalize reinicia el API) y el
 * `check` horario. `lockDuration` alto para que un deploy largo no se marque
 * stalled ni se re-encole (gotcha #3). Degrada sin romper si no hay Redis.
 */
@Injectable()
export class UpdateQueue implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(UpdateQueue.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly manager: UpdateManager,
        private readonly checkUpdates: CheckUpdatesService,
        private readonly backups: BackupsService,
    ) {}

    async onModuleInit(): Promise<void> {
        try {
            const conn = () => {
                const c = guardRedis(
                    new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }),
                    this.logger,
                    'update',
                );
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(UPDATE_QUEUE, { connection: conn() });
            this.queue.on('error', (err) => this.logger.warn(`Cola de actualización con error: ${err.message}`));
            this.worker = new Worker(
                UPDATE_QUEUE,
                async (job) => {
                    if (job.name === 'check') return void (await this.checkUpdates.check());
                    // v0.1.179 — copias de seguridad en la MISMA cola (1 a la vez:
                    // nunca un snapshot y un deploy pisándose).
                    if (job.name === 'snapshot') return void (await this.backups.createSnapshot('manual'));
                    if (job.name === 'backups-tick') return void (await this.backups.tick());
                    return void (await this.manager.update());
                },
                // 1 a la vez; lock largo (>30min) para no re-encolar el deploy en curso.
                { connection: conn(), concurrency: 1, lockDuration: 1_900_000, maxStalledCount: 0 },
            );
            this.worker.on('failed', (job, err) => {
                this.logger.error(`Update job ${job?.name} falló: ${err.message}`);
                if (job?.name === 'snapshot') void this.backups.markFailed(err.message);
                else if (job?.name !== 'check' && job?.name !== 'backups-tick') void this.manager.markFailed(err.message);
            });
            this.worker.on('error', (err) => this.logger.warn(`Worker de actualización con error: ${err.message}`));

            // Chequeo horario de releases (persiste en Redis → sobrevive reinicios).
            // SIN await: la conexión de BullMQ usa maxRetriesPerRequest:null, así
            // que si Redis no está disponible ahora este comando se encola y NO
            // debe bloquear el arranque del API. Se registra cuando Redis vuelve.
            void this.queue
                .upsertJobScheduler('update-check-hourly', { pattern: '0 * * * *' }, { name: 'check' })
                .then(() => this.logger.log('Scheduler de chequeo horario registrado'))
                .catch((err) => this.logger.warn(`No se pudo registrar el scheduler horario: ${String(err)}`));
            // v0.1.179 — tick horario de copias automáticas (a los :05, así no
            // compite con el chequeo de releases de las :00).
            void this.queue
                .upsertJobScheduler('backups-hourly', { pattern: '5 * * * *' }, { name: 'backups-tick' })
                .catch((err) => this.logger.warn(`No se pudo registrar el scheduler de copias: ${String(err)}`));
            this.logger.log('Cola de actualización lista');
        } catch (err) {
            this.logger.warn(`Auto-actualización deshabilitada (sin Redis): ${String(err)}`);
        }
    }

    /** Encola una instalación (la dispara el panel admin). */
    async enqueueRun(): Promise<boolean> {
        if (!this.queue) return false;
        await this.queue.add('run', {}, { attempts: 1, removeOnComplete: true, removeOnFail: 20 });
        return true;
    }

    /** v0.1.179 — encola una copia de seguridad completa. */
    async enqueueSnapshot(): Promise<boolean> {
        if (!this.queue) return false;
        await this.queue.add('snapshot', {}, { attempts: 1, removeOnComplete: true, removeOnFail: 20 });
        return true;
    }

    /** Fuerza un chequeo de releases ahora. */
    async enqueueCheck(): Promise<boolean> {
        if (!this.queue) return false;
        await this.queue.add('check', {}, { attempts: 1, removeOnComplete: true, removeOnFail: 5 });
        return true;
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
