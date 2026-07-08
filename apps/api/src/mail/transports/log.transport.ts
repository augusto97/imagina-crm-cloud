import { Logger } from '@nestjs/common';
import type { MailMessage, MailTransport } from '../mail.types';

/**
 * Transporte por defecto: no envía nada, sólo registra el correo en el logger.
 * Sirve en desarrollo y en tests (sin depender de un SMTP), y es la degradación
 * segura cuando `smtp` no está configurado.
 */
export class LogMailTransport implements MailTransport {
    readonly name = 'log';
    private readonly logger = new Logger('MailTransport');

    send(message: MailMessage): Promise<void> {
        this.logger.log(
            `[mail:log] → ${message.to} · "${message.subject}"` +
                (message.text ? ` · ${message.text.slice(0, 120)}` : ''),
        );
        return Promise.resolve();
    }
}
