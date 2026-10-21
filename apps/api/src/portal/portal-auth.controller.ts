import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    HttpCode,
    Inject,
    Patch,
    Post,
    Put,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    portalPasswordLoginSchema,
    portalSetPasswordSchema,
    updatePortalAuthSchema,
    type PortalAuthSettings,
    type PortalLoginOptions,
    type PortalPasswordLoginInput,
    type PortalSetPasswordInput,
    type UpdatePortalAuthInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { SessionService } from '../auth/session.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import { TenantGuard } from '../tenancy/tenant.guard';
import { PortalAuthService } from './portal-auth.service';
import { portalActor } from './portal.controller';
import { openPortalSession } from './portal-cookie';

/**
 * v0.1.290 — Entrar al portal con contraseña (además del enlace por correo).
 * Las rutas de la pantalla de entrar son públicas; crear/cambiar la
 * contraseña exige la sesión del portal.
 */
@Controller()
export class PortalAuthController {
    constructor(
        private readonly auth: PortalAuthService,
        private readonly sessions: SessionService,
        @Inject(ENV) private readonly env: Env,
    ) {}

    /** Ruta PÚBLICA: la marca de la empresa y si deja entrar con contraseña. */
    @Get('portal/login-options')
    loginOptions(@Req() req: FastifyRequest, @Query('empresa') empresa?: string): Promise<PortalLoginOptions> {
        return this.auth.loginOptions(req.host, empresa ?? null);
    }

    /** Ruta PÚBLICA: entrar con correo + contraseña del portal de la empresa. */
    @Post('portal/login')
    @HttpCode(200)
    async login(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(portalPasswordLoginSchema)) input: PortalPasswordLoginInput,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<{ ok: true }> {
        const { sessionToken } = await this.auth.login(input, {
            host: req.host,
            ip: req.ip,
            userAgent: String(req.headers['user-agent'] ?? ''),
        });
        await openPortalSession(req, reply, sessionToken, { sessions: this.sessions, env: this.env });
        return { ok: true };
    }

    /** El cliente crea o cambia SU contraseña del portal de esta empresa. */
    @Put('portal/me/password')
    @UseGuards(SessionGuard)
    setPassword(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(portalSetPasswordSchema)) input: PortalSetPasswordInput,
    ): Promise<{ ok: true }> {
        return this.auth.setPassword(portalActor(req), req.sessionToken!, input.password);
    }
}

/** Ajustes → Portal y formularios: si los clientes pueden entrar con contraseña (admin). */
@Controller('workspaces/current/portal-auth')
@UseGuards(SessionGuard, TenantGuard)
export class WorkspacePortalAuthController {
    constructor(private readonly auth: PortalAuthService) {}

    private assertAdmin(req: FastifyRequest): void {
        if (req.tenant!.role !== 'admin') {
            throw new ForbiddenException({
                code: 'admin_only',
                message: 'Sólo el admin del workspace puede editar esta configuración',
                data: { status: 403 },
            });
        }
    }

    @Get()
    get(@Req() req: FastifyRequest): Promise<PortalAuthSettings> {
        this.assertAdmin(req);
        return this.auth.settings(req.tenant!.tenantId);
    }

    @Patch()
    update(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updatePortalAuthSchema)) input: UpdatePortalAuthInput,
    ): Promise<PortalAuthSettings> {
        this.assertAdmin(req);
        return this.auth.update(req.tenant!.tenantId, req.authUserId ?? null, input);
    }
}
