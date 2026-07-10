import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import {
    createPlatformUserSchema,
    updatePlatformUserSchema,
    updateTenantSchema,
    type CreatePlatformUserInput,
    type PlatformStats,
    type PlatformTenant,
    type PlatformTenantsResponse,
    type PlatformUser,
    type PlatformUsersResponse,
    type UpdatePlatformUserInput,
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

    // ─────────────────────────── Usuarios (F2) ───────────────────────────

    /** Todos los usuarios de la plataforma con nº de workspaces + flags. */
    @Get('users')
    users(): Promise<PlatformUsersResponse> {
        return this.platform.listUsers().then((data) => ({ data }));
    }

    /** Crea una cuenta y envía email de invitación (definir contraseña). */
    @Post('users')
    @HttpCode(201)
    createUser(
        @Body(new ZodValidationPipe(createPlatformUserSchema)) input: CreatePlatformUserInput,
    ): Promise<PlatformUser> {
        return this.platform.createUser(input.email, input.name);
    }

    /** Desactiva/reactiva una cuenta (al desactivar revoca sus sesiones). */
    @Patch('users/:id')
    updateUser(
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updatePlatformUserSchema)) input: UpdatePlatformUserInput,
    ): Promise<PlatformUser> {
        return this.platform.setUserDisabled(id, input.disabled);
    }

    /** Dispara el email de reset de contraseña de un usuario. */
    @Post('users/:id/reset-password')
    @HttpCode(202)
    async resetUserPassword(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
        await this.platform.resetUserPassword(id);
        return { ok: true };
    }
}
