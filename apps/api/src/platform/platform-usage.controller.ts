import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { usageModuleKeySchema, type PlatformTenantUsage, type PlatformUsage, type PlatformUsageModuleDetail, type UsageModuleKey } from '@imagina-base/shared';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PlatformUsageService } from './platform-usage.service';

/**
 * v0.1.437 — Plataforma → Uso: qué empresa usa qué y cuánto (sólo el
 * superadmin, con sesión abierta con contraseña).
 */
@Controller('platform/usage')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformUsageController {
    constructor(private readonly usage: PlatformUsageService) {}

    /** El resumen por módulo. `?refresh=1` lo recalcula (como mucho cada 30 s). */
    @Get()
    summary(@Query('refresh') refresh?: string): Promise<PlatformUsage> {
        return this.usage.summary({ refresh: refresh === '1' || refresh === 'true' });
    }

    /** Las empresas que usan un módulo. */
    @Get('modules/:key')
    module(@Param('key', new ZodValidationPipe(usageModuleKeySchema)) key: UsageModuleKey): Promise<PlatformUsageModuleDetail> {
        return this.usage.module(key);
    }

    /** Lo que usa una empresa. */
    @Get('tenants/:id')
    tenant(@Param('id', ParseIntPipe) id: number): Promise<PlatformTenantUsage> {
        return this.usage.tenant(id);
    }
}
