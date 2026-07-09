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
        });
    }

    async send(message: MailMessage): Promise<void> {
        await this.transporter.sendMail({
            from: this.from,
            to: message.to,
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
