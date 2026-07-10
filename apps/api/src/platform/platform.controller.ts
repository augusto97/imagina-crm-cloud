import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Inject,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    createPlanSchema,
    createPlatformUserSchema,
    createTenantSchema,
    impersonateSchema,
    updatePlanSchema,
    updatePlatformUserSchema,
    updateTenantSchema,
    type CreatePlanInput,
    type CreatePlatformUserInput,
    type CreateTenantInput,
    type ImpersonateInput,
    type ImpersonateResult,
    type ImpersonationLogResponse,
    type PlatformPlan,
    type PlatformPlansResponse,
    type PlatformStats,
    type PlatformTenant,
    type PlatformTenantDetail,
    type PlatformTenantsResponse,
    type PlatformUser,
    type PlatformUsersResponse,
    type UpdatePlanInput,
    type UpdatePlatformUserInput,
    type UpdateTenantInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
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
    constructor(
        private readonly platform: PlatformService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /** Dashboard del operador: totales por estado/plan, usuarios, records, altas. */
    @Get('stats')
    stats(): Promise<PlatformStats> {
        return this.platform.getStats();
    }

    /** Todas las empresas (tenants) con plan/estado/uso/owner. `?include_archived=1` suma las archivadas. */
    @Get('tenants')
    tenants(@Query('include_archived') includeArchived?: string): Promise<PlatformTenantsResponse> {
        const withArchived = includeArchived === '1' || includeArchived === 'true';
        return this.platform.listTenants(withArchived).then((data) => ({ data }));
    }

    /** Alta de una empresa nueva + su admin en un paso. */
    @Post('tenants')
    @HttpCode(201)
    createTenant(
        @Body(new ZodValidationPipe(createTenantSchema)) input: CreateTenantInput,
    ): Promise<PlatformTenant> {
        return this.platform.createTenant(input);
    }

    /** Detalle de una empresa: datos + miembros + límites del plan. */
    @Get('tenants/:id')
    tenantDetail(@Param('id', ParseIntPipe) id: number): Promise<PlatformTenantDetail> {
        return this.platform.tenantDetail(id);
    }

    /** Edita una empresa: plan/estado, nombre, archivar/desarchivar, fecha 'paga hasta'. */
    @Patch('tenants/:id')
    updateTenant(
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateTenantSchema)) input: UpdateTenantInput,
    ): Promise<PlatformTenant> {
        return this.platform.updateTenant(id, input);
    }

    /** BORRA una empresa y todos sus datos (irreversible; el front confirma por texto). */
    @Delete('tenants/:id')
    @HttpCode(204)
    async deleteTenant(@Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.platform.deleteTenant(id);
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

    /** Edita nombre/email y/o desactiva-reactiva una cuenta (al desactivar revoca sesiones). */
    @Patch('users/:id')
    updateUser(
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updatePlatformUserSchema)) input: UpdatePlatformUserInput,
    ): Promise<PlatformUser> {
        return this.platform.updateUser(id, input);
    }

    /** BORRA una cuenta (irreversible; rechaza superadmin; el front confirma por texto). */
    @Delete('users/:id')
    @HttpCode(204)
    async deleteUser(@Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.platform.deleteUser(id);
    }

    /** Dispara el email de reset de contraseña de un usuario. */
    @Post('users/:id/reset-password')
    @HttpCode(202)
    async resetUserPassword(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
        await this.platform.resetUserPassword(id);
        return { ok: true };
    }

    // ─────────────────────────── Planes (F3) ───────────────────────────

    /** Todos los planes (para editar límites/nombre y para poblar los selects). */
    @Get('plans')
    plans(): Promise<PlatformPlansResponse> {
        return this.platform.listPlans().then((data) => ({ data }));
    }

    /** Crea un plan nuevo. */
    @Post('plans')
    @HttpCode(201)
    createPlan(
        @Body(new ZodValidationPipe(createPlanSchema)) input: CreatePlanInput,
    ): Promise<PlatformPlan> {
        return this.platform.createPlan(input);
    }

    /** Edita nombre/límites/activo de un plan (el slug no cambia). */
    @Patch('plans/:slug')
    updatePlan(
        @Param('slug') slug: string,
        @Body(new ZodValidationPipe(updatePlanSchema)) input: UpdatePlanInput,
    ): Promise<PlatformPlan> {
        return this.platform.updatePlan(slug, input);
    }

    /** Borra un plan (rechaza si alguna empresa lo usa). */
    @Delete('plans/:slug')
    @HttpCode(204)
    async removePlan(@Param('slug') slug: string): Promise<void> {
        await this.platform.removePlan(slug);
    }

    // ─────────────── Impersonación de soporte (F5) ───────────────

    /**
     * Abre una sesión de impersonación como el usuario indicado. Cambia la cookie
     * de sesión por la de impersonación (vida corta) — al salir se restaura la
     * original (`POST /auth/stop-impersonating`). Queda registrado en auditoría.
     */
    @Post('impersonate')
    @HttpCode(200)
    async impersonate(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(impersonateSchema)) input: ImpersonateInput,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<ImpersonateResult> {
        const { token, target } = await this.platform.impersonate(req.authUserId!, req.sessionToken!, input.user_id);
        reply.setCookie(SESSION_COOKIE, token, {
            httpOnly: true,
            secure: this.env.COOKIE_SECURE || this.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 60 * 60,
        });
        return { target };
    }

    /** Log de auditoría de impersonación (transparencia del operador). */
    @Get('impersonations')
    impersonations(): Promise<ImpersonationLogResponse> {
        return this.platform.listImpersonations().then((data) => ({ data }));
    }
}
