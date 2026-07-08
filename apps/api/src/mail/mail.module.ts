import { Global, Logger, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { MailService } from './mail.service';
import { MAIL_TRANSPORT, type MailTransport } from './mail.types';
import { LogMailTransport } from './transports/log.transport';
import { SmtpMailTransport } from './transports/smtp.transport';

/**
 * Módulo de correo (ADR-S11). El transporte se elige por env: `smtp` si está
 * configurado (MAIL_TRANSPORT=smtp + SMTP_HOST), si no `log`. @Global para que
 * cualquier módulo (automatizaciones, portal, billing) pueda inyectar
 * MailService sin re-importar.
 */
@Global()
@Module({
    providers: [
        {
            provide: MAIL_TRANSPORT,
            inject: [ENV],
            useFactory: (env: Env): MailTransport => {
                if (env.MAIL_TRANSPORT === 'smtp' && env.SMTP_HOST) {
                    return new SmtpMailTransport(env);
                }
                if (env.MAIL_TRANSPORT === 'smtp') {
                    new Logger('MailModule').warn(
                        'MAIL_TRANSPORT=smtp pero falta SMTP_HOST → usando transporte log',
                    );
                }
                return new LogMailTransport();
            },
        },
        MailService,
    ],
    exports: [MailService],
})
export class MailModule {}
