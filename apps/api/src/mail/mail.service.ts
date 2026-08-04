import {
    Inject,
    Injectable,
    Logger,
    type OnApplicationShutdown,
    type OnModuleInit,
} from '@nestjs/common';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { guardRedis } from '../redis/redis.util';
import { EmailQuotaExceededError, EmailQuotaService } from './email-quota.service';
import { MAIL_TRANSPORT, type MailMessage, type MailTransport } from './mail.types';
import { PlatformSettingsService } from './platform-settings.service';
import { TenantSmtpService } from './tenant-smtp.service';
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
    /** Cache de transportes por-tenant (hash de config → transporte). */
    private readonly tenantSmtpCache = new Map<number, { hash: string; transport: SmtpMailTransport }>();

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
        private readonly platform?: PlatformSettingsService,
        private readonly tenantSmtp?: TenantSmtpService,
        private readonly quota?: EmailQuotaService,
    ) {}

    /**
     * Transporte a usar en cada envío: la config SMTP guardada por el superadmin
     * (Redis) si existe, con fallback al transporte por env (log/smtp). Se
     * cachea el SmtpMailTransport por hash de config (se reconstruye al cambiar).
     */
    /**
     * Transporte a usar en cada envío + si es el SMTP PROPIO del tenant. Ese
     * dato manda: los correos que salen por el servidor del cliente no cuestan
     * nada al operador, así que no consumen cuota (ADR-S18).
     */
    private async resolve(message?: MailMessage): Promise<{ transport: MailTransport; own: boolean }> {
        // 1) SMTP PROPIO del tenant emisor (white-label de correo): si la
        //    empresa configuró el suyo, sus correos salen por él.
        //
        // v0.1.150 — si el tenant TIENE SMTP propio pero es inusable, el error
        // SUBE. Antes se capturaba y se seguía con plataforma/env: en una
        // instalación sin SMTP de plataforma eso significaba caer al transporte
        // `log`, o sea "enviado" en la UI y nada en la bandeja del cliente.
        if (message?.tenantId !== undefined && this.tenantSmtp) {
            const cfg = await this.tenantSmtp.getForSend(message.tenantId);
            if (cfg) {
                const hash = JSON.stringify(cfg);
                const cached = this.tenantSmtpCache.get(message.tenantId);
                if (cached?.hash === hash) return { transport: cached.transport, own: true };
                const transport = new SmtpMailTransport(cfg);
                if (this.tenantSmtpCache.size > 100) this.tenantSmtpCache.clear();
                this.tenantSmtpCache.set(message.tenantId, { hash, transport });
                return { transport, own: true };
            }
            this.tenantSmtpCache.delete(message.tenantId);
        }
        // 2) SMTP de PLATAFORMA (superadmin) → 3) transporte por env. Mismo
        //    criterio: una config rota lanza en vez de degradar en silencio.
        const cfg = this.platform ? await this.platform.getSmtp() : null;
        if (cfg) {
            const hash = JSON.stringify(cfg);
            if (this.cachedSmtp?.hash !== hash) {
                this.cachedSmtp = { hash, transport: new SmtpMailTransport(cfg) };
            }
            return { transport: this.cachedSmtp.transport, own: false };
        }
        this.cachedSmtp = null;
        return { transport: this.transport, own: false };
    }

    /**
     * Envía de verdad: resuelve el transporte, aplica la CUOTA de plataforma
     * (ADR-S18) y recién ahí entrega. La cuota se consume DESPUÉS del envío —
     * un correo que no salió no se cobra— y sólo cuando sale por el SMTP de la
     * plataforma: con SMTP propio no hay límite.
     */
    private async deliver(message: MailMessage): Promise<void> {
        const { transport, own } = await this.resolve(message);
        const metered = !own && message.tenantId !== undefined && this.quota !== undefined;
        if (metered) await this.quota!.assertWithinQuota(message.tenantId!);
        await transport.send(message);
        if (metered) {
            // Best-effort: si falla el contador, el correo YA salió — no tiene
            // sentido reintentarlo ni romperle la operación al cliente.
            await this.quota!.record(message.tenantId!).catch((err: unknown) =>
                this.logger.warn(`No se pudo contabilizar el correo del tenant ${message.tenantId}: ${String(err)}`),
            );
        }
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
                async (job) => {
                    try {
                        await this.deliver(job.data);
                    } catch (err) {
                        // Sin cuota no sirve reintentar: el mes no cambia en 2s.
                        if (err instanceof EmailQuotaExceededError) throw new UnrecoverableError(err.message);
                        throw err;
                    }
                },
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
        return this.deliver(message);
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
