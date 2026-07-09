import {
    BadGatewayException,
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    Post,
    Put,
    UseGuards,
} from '@nestjs/common';
import { smtpConfigSchema, type SmtpConfig, type SmtpConfigPublic } from '@imagina-base/shared';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MailService } from '../mail/mail.service';
import { PlatformSettingsService } from '../mail/platform-settings.service';

/**
 * Config SMTP de plataforma (superadmin). Operación global del servidor (sin
 * TenantGuard). El GET nunca devuelve el password; el PUT lo guarda en Redis y
 * el MailService lo toma en el próximo envío (sin reiniciar).
 */
@Controller('system/smtp')
@UseGuards(SessionGuard, SuperadminGuard)
export class SmtpController {
    constructor(
        private readonly platform: PlatformSettingsService,
        private readonly mail: MailService,
    ) {}

    @Get()
    async get(): Promise<SmtpConfigPublic> {
        const c = await this.platform.getSmtp();
        return {
            configured: c !== null,
            host: c?.host ?? '',
            port: c?.port ?? 587,
            secure: c?.secure ?? false,
            user: c?.user ?? '',
            from: c?.from ?? '',
        };
    }

    @Put()
    @HttpCode(204)
    async set(@Body(new ZodValidationPipe(smtpConfigSchema)) config: SmtpConfig): Promise<void> {
        await this.platform.setSmtp(config);
    }

    /** Envía un correo de prueba al destinatario indicado (usa la config recién guardada). */
    @Post('test')
    @HttpCode(202)
    async test(@Body() body: { to?: unknown }): Promise<void> {
        const to = typeof body?.to === 'string' && body.to.includes('@') ? body.to : null;
        if (!to) {
            throw new BadRequestException({ code: 'invalid_to', message: 'Email de destino inválido', data: { status: 400 } });
        }
        try {
            // sendNow envía en el acto (sin cola) con la config recién guardada,
            // así el fallo de conexión vuelve al superadmin como mensaje claro.
            await this.mail.sendNow({
                to,
                subject: 'Prueba de SMTP — Imagina Base',
                html: '<p>¡Tu configuración SMTP funciona! ✔</p>',
                text: 'Tu configuración SMTP funciona.',
            });
        } catch (err) {
            throw new BadGatewayException({
                code: 'smtp_send_failed',
                message: `No se pudo enviar: ${err instanceof Error ? err.message : String(err)}`,
                data: { status: 502 },
            });
        }
    }
}
