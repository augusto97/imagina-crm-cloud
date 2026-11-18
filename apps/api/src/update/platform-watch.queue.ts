import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { createWorker, processRole, registerScheduler } from '../redis/queue-runtime';
import { PlatformAlertsService } from './platform-alerts.service';
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

    private presenceTimer: NodeJS.Timeout | null = null;
    private missing = 0;

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly watch: PlatformWatchService,
        @Optional() private readonly alerts?: PlatformAlertsService,
    ) {}

    /**
     * v0.1.435 — Cuántos procesos están tomando trabajos de esta cola ahora
     * (BullMQ los cuenta en Redis). null = no se pudo saber (Redis sin el
     * comando CLIENT, o caído).
     */
    async workersConnected(): Promise<number | null> {
        if (processRole() !== 'api') return this.worker ? 1 : 0;
        try {
            return this.queue ? await this.queue.getWorkersCount() : null;
        } catch {
            return null;
        }
    }

    /**
     * v0.1.435 — Con la app separada en dos procesos, el que atiende vigila
     * que el de los trabajos esté vivo: si 3 minutos seguidos no hay ninguno,
     * avisa por correo EN EL ACTO (por la cola no saldría: nadie la atiende).
     */
    async checkPresence(now = new Date()): Promise<void> {
        if (!this.alerts) return;
        const n = await this.workersConnected();
        if (n === null) return;
        if (n > 0) {
            this.missing = 0;
            await this.alerts.resolve('workers:down', { message: 'Los trabajos en segundo plano volvieron a correr.' }, now).catch(() => undefined);
            return;
        }
        this.missing += 1;
        if (this.missing < 3) return;
        await this.alerts
            .raise(
                {
                    key: 'workers:down',
                    source: 'workers',
                    severity: 'critical',
                    title: 'Los trabajos en segundo plano están detenidos',
                    detail: 'La app atiende, pero nadie está haciendo los trabajos en segundo plano (automatizaciones, correos, sincronizaciones, copias).',
                    paragraphs: [
                        'La app atiende a las personas, pero el proceso de los trabajos en segundo plano (imagina-worker) no está corriendo hace más de 3 minutos.',
                        'Mientras siga así no corren las automatizaciones, no salen los correos ni los avisos, y no se hacen las sincronizaciones ni las copias. Nada se pierde: queda en espera y se hace cuando vuelva.',
                        'La reparación automática lo vuelve a arrancar sola. Si no vuelve, por SSH, como root: imagina-reparar (o systemctl restart imagina-worker; los detalles: journalctl -u imagina-worker -n 50).',
                    ],
                    remind_hours: 6,
                    direct: true,
                },
                now,
            )
            .catch(() => undefined);
    }

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
            if (processRole() === 'api' && this.env.NODE_ENV !== 'test') {
                this.presenceTimer = setInterval(() => void this.checkPresence().catch(() => undefined), 60_000);
                this.presenceTimer.unref();
            }
        } catch (err) {
            this.logger.warn(`Vigilancia del servidor deshabilitada (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        if (this.presenceTimer) clearInterval(this.presenceTimer);
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
