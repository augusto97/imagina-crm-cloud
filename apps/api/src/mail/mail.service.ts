import {
    Inject,
    Injectable,
    Logger,
    type OnApplicationShutdown,
    type OnModuleInit,
    ServiceUnavailableException,
} from '@nestjs/common';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import type { AccountMailStatus, MailVia } from '@imagina-base/shared';
import IORedis from 'ioredis';
import { resolvePublicHost } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { recordMail } from '../observability/diagnostics';
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
    private readonly tenantSmtpCache = new Map<number, { hash: string; transport: SmtpMailTransport; at: number }>();

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
    private async resolve(message?: MailMessage): Promise<{ transport: MailTransport; own: boolean; via: MailVia }> {
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
                // El transporte va FIJADO a la IP validada: se re-resuelve cada
                // 10 min para seguir al proveedor si cambia de IP.
                if (cached?.hash === hash && Date.now() - cached.at < 10 * 60_000) {
                    return { transport: cached.transport, own: true, via: 'tenant_smtp' };
                }
                // SEC-27 (v0.1.226): el SMTP de una EMPRESA sólo puede ser un
                // servidor público. Antes `127.0.0.1:25` relayaba por el MTA
                // local sin autenticar (spam desde la IP de la plataforma).
                const target = await resolvePublicHost(cfg.host, { allowPrivate: this.env.SMTP_ALLOW_PRIVATE_HOSTS });
                if (!target.ok) {
                    throw new UnrecoverableError(
                        target.reason === 'blocked'
                            ? `El servidor SMTP de la empresa (${cfg.host}) apunta a una dirección interna: tiene que ser un servidor accesible desde internet.`
                            : `El servidor SMTP de la empresa (${cfg.host}) no resuelve (${target.error}).`,
                    );
                }
                const transport = new SmtpMailTransport({ ...cfg, host: target.address }, { servername: cfg.host });
                if (this.tenantSmtpCache.size > 100) this.tenantSmtpCache.clear();
                this.tenantSmtpCache.set(message.tenantId, { hash, transport, at: Date.now() });
                return { transport, own: true, via: 'tenant_smtp' };
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
            return { transport: this.cachedSmtp.transport, own: false, via: 'platform_smtp' };
        }
        this.cachedSmtp = null;
        return { transport: this.transport, own: false, via: this.transport.name === 'log' ? 'none' : 'server_smtp' };
    }

    /**
     * v0.1.238 — ¿Los correos de CUENTA (verificación, recuperación de
     * contraseña, invitaciones) tienen por dónde salir? No tienen empresa, así
     * que el SMTP de una empresa no cuenta: sólo el de Plataforma o el del
     * `.env`. Antes, sin ninguno de los dos, se "enviaban" al registro del
     * servidor y la persona esperaba un correo que nunca iba a llegar.
     */
    async accountMailStatus(): Promise<AccountMailStatus> {
        const read = this.platform ? await this.platform.readSmtp() : { state: 'none' as const };
        if (read.state === 'ok') return { available: true, via: 'platform_smtp', host: read.config.host, reason: null };
        if (read.state === 'unreadable') {
            return {
                available: false,
                via: 'platform_smtp',
                host: read.config.host || null,
                reason: `El SMTP de Plataforma está configurado pero no se puede usar: ${read.reason}. Volvé a escribir la contraseña en Plataforma → Correo.`,
            };
        }
        if (this.transport.name !== 'log') return { available: true, via: 'server_smtp', host: null, reason: null };
        // En desarrollo el transporte de registro ES el envío (se lee en la consola).
        if (this.env.NODE_ENV !== 'production') return { available: true, via: 'none', host: null, reason: null };
        return {
            available: false,
            via: 'none',
            host: null,
            reason: 'No hay un SMTP de plataforma configurado: los correos de verificación, recuperación de contraseña e invitaciones no se envían. Configuralo en Plataforma → Correo (SMTP).',
        };
    }

    /** Corta con un 503 legible cuando un correo de cuenta no tendría por dónde salir. */
    async assertAccountMailAvailable(): Promise<void> {
        const status = await this.accountMailStatus();
        if (status.available) return;
        throw new ServiceUnavailableException({
            code: 'mail_unavailable',
            message:
                status.via === 'platform_smtp'
                    ? 'Este servidor no puede enviar correos ahora: el correo de la plataforma está mal configurado. Avisale al administrador.'
                    : 'Este servidor todavía no tiene un correo configurado para enviar este mensaje. Avisale al administrador de la plataforma.',
            data: { status: 503 },
        });
    }

    /**
     * Envía de verdad: resuelve el transporte, aplica la CUOTA de plataforma
     * (ADR-S18) y recién ahí entrega. La cuota se consume DESPUÉS del envío —
     * un correo que no salió no se cobra— y sólo cuando sale por el SMTP de la
     * plataforma: con SMTP propio no hay límite.
     */
    private async deliver(message: MailMessage): Promise<void> {
        const scope = message.tenantId === undefined ? 'account' : 'tenant';
        const base = { to: message.to, subject: message.subject, scope, tenant_id: message.tenantId ?? null } as const;
        let via: MailVia = 'none';
        let transport: MailTransport;
        let own: boolean;
        try {
            ({ transport, own, via } = await this.resolve(message));
        } catch (err) {
            // Un SMTP configurado pero roto: queda registrado con el motivo.
            recordMail({ ...base, via: message.tenantId === undefined ? 'platform_smtp' : 'tenant_smtp', status: 'failed', error: errorText(err) });
            throw err;
        }
        const metered = !own && message.tenantId !== undefined && this.quota !== undefined;
        const recipients = countRecipients(message);
        // SEC-33 (v0.1.239): por el SMTP COMPARTIDO (plataforma o `.env`) una
        // empresa no elige el remitente. Antes `from` pasaba tal cual: cualquier
        // automatización mandaba "de" `soporte@banco.com` por el servidor y la
        // reputación del operador — phishing con nuestra IP. El nombre visible
        // se conserva y la dirección elegida pasa a Reply-To (las respuestas le
        // siguen llegando a la empresa). Con SMTP propio, manda la empresa.
        const outgoing: MailMessage =
            !own && message.tenantId !== undefined && message.from
                ? { ...message, from: undefined, replyTo: message.replyTo ?? message.from }
                : message;
        try {
            if (metered) await this.quota!.assertWithinQuota(message.tenantId!, recipients);
            await transport.send(outgoing);
        } catch (err) {
            recordMail({ ...base, via, status: 'failed', error: errorText(err) });
            throw err;
        }
        // v0.1.238 — el transporte de registro NO envía: se anota como "no
        // enviado" para que el operador lo vea en Plataforma → Diagnóstico.
        recordMail({
            ...base,
            via,
            status: via === 'none' ? 'not_sent' : 'sent',
            error: via === 'none' ? 'No hay SMTP configurado: el correo quedó sólo en el registro del servidor.' : null,
        });
        if (metered) {
            // Best-effort: si falla el contador, el correo YA salió — no tiene
            // sentido reintentarlo ni romperle la operación al cliente.
            await this.quota!.record(message.tenantId!, recipients).catch((err: unknown) =>
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

/**
 * Destinatarios distintos del mensaje (to + cc + bcc, sin repetir). La cuota
 * se mide por persona que recibe, como cualquier proveedor de correo.
 */
export function countRecipients(message: Pick<MailMessage, 'to' | 'cc' | 'bcc'>): number {
    const all = [message.to, message.cc, message.bcc]
        .filter((v): v is string => typeof v === 'string' && v !== '')
        .flatMap((v) => v.split(/[,;]/))
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v !== '');
    return Math.max(1, new Set(all).size);
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
