import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { updatePlatformRetentionSchema, type PlatformRetentionStatus, type UpdatePlatformRetentionInput } from '@imagina-base/shared';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RetentionService } from './retention.service';

/**
 * v0.1.439 — Plataforma → Diagnóstico → «Tamaño de la base»: cuánto pesa cada
 * tabla, cuánto se guarda el historial de corridas y la actividad, y limpiar
 * ahora (superadmin con contraseña).
 */
@Controller('system/diagnostics/retention')
@UseGuards(SessionGuard, SuperadminGuard)
export class RetentionController {
    constructor(private readonly retention: RetentionService) {}

    @Get()
    get(): Promise<PlatformRetentionStatus> {
        return this.retention.status();
    }

    @Put()
    update(@Body(new ZodValidationPipe(updatePlatformRetentionSchema)) input: UpdatePlatformRetentionInput): Promise<PlatformRetentionStatus> {
        return this.retention.setSettings(input);
    }

    /** Limpia ahora en segundo plano; la pantalla vuelve a preguntar el estado. */
    @Post('run')
    @HttpCode(200)
    async run(): Promise<PlatformRetentionStatus> {
        this.retention.runNow();
        return this.retention.status();
    }
}
