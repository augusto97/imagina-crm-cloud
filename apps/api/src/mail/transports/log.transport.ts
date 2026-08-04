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
        // v0.1.150 — en producción esto NO es normal: significa que no hay
        // ningún SMTP configurado y el correo no salió a ninguna parte. Se
        // avisa fuerte; antes se registraba como un envío más y el operador
        // no tenía forma de notar que sus correos morían en el logger.
        const line = `→ ${message.to} · "${message.subject}"`;
        if (process.env.NODE_ENV === 'production') {
            this.logger.warn(
                `[mail:log] CORREO NO ENVIADO (no hay SMTP configurado) ${line}. ` +
                    'Configuralo en Ajustes → Correo (SMTP) de la empresa o en Plataforma → Correo.',
            );
        } else {
            this.logger.log(`[mail:log] ${line}${message.text ? ` · ${message.text.slice(0, 120)}` : ''}`);
        }
        return Promise.resolve();
    }
}
