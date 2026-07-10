import { Body, Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import {
    updateTenantSchema,
    type PlatformStats,
    type PlatformTenant,
    type PlatformTenantsResponse,
    type UpdateTenantInput,
} from '@imagina-base/shared';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PlatformService } from './platform.service';

/**
 * Consola de PLATAFORMA (operador SaaS). Todo detrás de `SuperadminGuard`
 * (allowlist `PLATFORM_SUPERADMINS`), NO de la matriz de capabilities por
 * workspace. El frontend muestra la sección sólo si estos endpoints no dan 403
 * (mismo patrón que el panel de auto-actualización).
 */
@Controller('platform')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformController {
    constructor(private readonly platform: PlatformService) {}

    /** Dashboard del operador: totales por estado/plan, usuarios, records, altas. */
    @Get('stats')
    stats(): Promise<PlatformStats> {
        return this.platform.getStats();
    }

    /** Todas las empresas (tenants) con plan/estado/uso/owner. */
    @Get('tenants')
    tenants(): Promise<PlatformTenantsResponse> {
        return this.platform.listTenants().then((data) => ({ data }));
    }

    /** Cambia plan y/o estado (suspender/reactivar) de una empresa. */
    @Patch('tenants/:id')
    updateTenant(
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateTenantSchema)) input: UpdateTenantInput,
    ): Promise<PlatformTenant> {
        return this.platform.updateTenant(id, input);
    }
}
