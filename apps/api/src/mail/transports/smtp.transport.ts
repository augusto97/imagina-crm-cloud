import { Logger } from '@nestjs/common';
import type { SmtpConfig } from '@imagina-base/shared';
import { createTransport, type Transporter } from 'nodemailer';
import type { MailMessage, MailTransport } from '../mail.types';

/**
 * Transporte SMTP real vía nodemailer. Se construye desde una `SmtpConfig`
 * (host/port/secure/user/pass/from): el MailModule la arma del env, y el
 * MailService la arma de la config guardada por el superadmin.
 */
export class SmtpMailTransport implements MailTransport {
    readonly name = 'smtp';
    private readonly logger = new Logger('MailTransport');
    private readonly transporter: Transporter;
    private readonly from: string;

    constructor(config: SmtpConfig) {
        this.from = config.from;
        this.transporter = createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: config.user ? { user: config.user, pass: config.pass } : undefined,
            // v0.1.150 — sin timeouts, nodemailer espera 2 minutos por conexión:
            // el botón "Probar envío" quedaba colgado y el worker de correo se
            // bloqueaba con un host mal escrito. Falla rápido y con mensaje.
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 20_000,
        });
    }

    async send(message: MailMessage): Promise<void> {
        const from = message.from
            ? message.fromName
                ? `${message.fromName} <${message.from}>`
                : message.from
            : this.from;
        await this.transporter.sendMail({
            from,
            to: message.to,
            cc: message.cc || undefined,
            bcc: message.bcc || undefined,
            subject: message.subject,
            html: message.html,
            text: message.text ?? stripHtml(message.html),
        });
        this.logger.log(`[mail:smtp] enviado → ${message.to}`);
    }
}

/** Fallback de texto plano cuando sólo hay HTML (nodemailer lo prefiere). */
function stripHtml(html: string | undefined): string | undefined {
    return html?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
