import { Controller, Delete, Get, HttpCode, Inject, UseGuards } from '@nestjs/common';
import type { PlatformDiagnostics } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { MailService } from '../mail/mail.service';
import { clearDiagnostics, readMailLog, readServerErrors } from '../observability/diagnostics';
import { REDIS } from '../redis/redis.module';

/**
 * v0.1.238 — Plataforma → Diagnóstico (superadmin): si los correos de cuenta
 * tienen por dónde salir, los últimos correos con su resultado y los últimos
 * errores inesperados del servidor. Sin esto había que entrar al servidor a
 * leer el journal para saber por qué no llegó un correo o qué fue un "Error
 * interno".
 */
@Controller('system/diagnostics')
@UseGuards(SessionGuard, SuperadminGuard)
export class DiagnosticsController {
    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        private readonly mail: MailService,
    ) {}

    @Get()
    async get(): Promise<PlatformDiagnostics> {
        const [account_mail, mail, errors] = await Promise.all([
            this.mail.accountMailStatus(),
            readMailLog(this.redis, 100),
            readServerErrors(this.redis, 100),
        ]);
        return { account_mail, mail, errors };
    }

    @Delete()
    @HttpCode(204)
    async clear(): Promise<void> {
        await clearDiagnostics(this.redis);
    }
}
