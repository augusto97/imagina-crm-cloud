import {
    Inject,
    Injectable,
    Logger,
    type OnApplicationShutdown,
    type OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { guardRedis } from '../redis/redis.util';
import { MAIL_TRANSPORT, type MailMessage, type MailTransport } from './mail.types';
import { PlatformSettingsService } from './platform-settings.service';
import { SmtpMailTransport } from './transports/smtp.transport';

export const MAIL_QUEUE = 'mail';

/**
 * Servicio de correo (ADR-S11). Encola los mails en BullMQ (STANDALONE §5 —
 * "colas: automatizaciones, emails, exports, webhooks") y un worker los envía
 * con el transporte inyectado, con reintentos. Si Redis no está disponible,
 * degrada a envío directo en proceso (sin cola) para no perder el correo.
 */
@Injectable()
export class MailService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(MailService.name);
    private queue: Queue<MailMessage> | null = null;
    private worker: Worker<MailMessage> | null = null;
    private connections: IORedis[] = [];

    private cachedSmtp: { hash: string; transport: SmtpMailTransport } | null = null;

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
        private readonly platform?: PlatformSettingsService,
    ) {}

    /**
     * Transporte a usar en cada envío: la config SMTP guardada por el superadmin
     * (Redis) si existe, con fallback al transporte por env (log/smtp). Se
     * cachea el SmtpMailTransport por hash de config (se reconstruye al cambiar).
     */
    private async activeTransport(): Promise<MailTransport> {
        try {
            const cfg = this.platform ? await this.platform.getSmtp() : null;
            if (cfg) {
                const hash = JSON.stringify(cfg);
                if (this.cachedSmtp?.hash !== hash) {
                    this.cachedSmtp = { hash, transport: new SmtpMailTransport(cfg) };
                }
                return this.cachedSmtp.transport;
            }
        } catch (err) {
            this.logger.warn(`No se pudo leer SMTP de plataforma, uso el transporte por env: ${String(err)}`);
        }
        this.cachedSmtp = null;
        return this.transport;
    }

    onModuleInit(): void {
        try {
            const conn = () => {
                const c = guardRedis(
                    new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }),
                    this.logger,
                    'mail',
                );
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue<MailMessage>(MAIL_QUEUE, { connection: conn() });
            this.queue.on('error', (err) => this.logger.warn(`Cola de correo con error: ${err.message}`));
            this.worker = new Worker<MailMessage>(
                MAIL_QUEUE,
                async (job) => (await this.activeTransport()).send(job.data),
                { connection: conn(), concurrency: 5 },
            );
            this.worker.on('failed', (job, err) =>
                this.logger.error(`Mail job ${job?.id} falló: ${err.message}`),
            );
            this.worker.on('error', (err) => this.logger.warn(`Worker de correo con error: ${err.message}`));
            this.logger.log(`Cola de correo lista (transporte: ${this.transport.name})`);
        } catch (err) {
            this.logger.warn(`Cola de correo deshabilitada (sin Redis): ${String(err)}`);
        }
    }

    /** Encola un correo (reintentos con backoff). Fallback: envío directo. */
    async enqueue(message: MailMessage): Promise<void> {
        if (!this.queue) {
            await this.sendNow(message);
            return;
        }
        await this.queue.add('send', message, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 500,
        });
    }

    /** Envía sin pasar por la cola (tests, o degradación sin Redis). */
    async sendNow(message: MailMessage): Promise<void> {
        return (await this.activeTransport()).send(message);
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
