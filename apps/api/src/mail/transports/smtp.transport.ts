import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../config/env';
import type { MailMessage, MailTransport } from '../mail.types';

/**
 * Transporte SMTP real vía nodemailer. Se construye desde el env (SMTP_*), con
 * el `from` por defecto de MAIL_FROM. Sólo se instancia cuando MAIL_TRANSPORT
 * es `smtp` y hay SMTP_HOST (ver MailModule).
 */
export class SmtpMailTransport implements MailTransport {
    readonly name = 'smtp';
    private readonly logger = new Logger('MailTransport');
    private readonly transporter: Transporter;

    constructor(private readonly env: Env) {
        this.transporter = createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        });
    }

    async send(message: MailMessage): Promise<void> {
        await this.transporter.sendMail({
            from: this.env.MAIL_FROM,
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
