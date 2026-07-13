import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
    smtpConfigSchema,
    updateBrandingSchema,
    type SmtpConfig,
    type SmtpConfigPublic,
    type BrandingResponse,
    type MembershipSummary,
    type UpdateBrandingInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { AuthService } from '../auth/auth.service';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard, type TenantContext } from '../tenancy/tenant.guard';
import { MailService } from '../mail/mail.service';
import { TenantSmtpService } from '../mail/tenant-smtp.service';
import { BrandingService } from './branding.service';

@Controller('workspaces')
@UseGuards(SessionGuard)
export class WorkspacesController {
    constructor(
        private readonly auth: AuthService,
        private readonly branding: BrandingService,
        private readonly smtp: TenantSmtpService,
        private readonly mail: MailService,
    ) {}

    /** Gate compartido: mutaciones de configuración = solo admin del workspace. */
    private assertAdmin(req: FastifyRequest): void {
        if (req.tenant!.role !== 'admin') {
            throw new ForbiddenException({
                code: 'admin_only',
                message: 'Sólo el admin del workspace puede editar esta configuración',
                data: { status: 403 },
            });
        }
    }

    /** Workspaces del usuario autenticado (plano auth, sin tenant activo). */
    @Get()
    async mine(@Req() req: FastifyRequest): Promise<{ data: MembershipSummary[] }> {
        return { data: await this.auth.membershipsOf(req.authUserId as number) };
    }

    /** Tenant activo resuelto vía X-Tenant-Id + membership (TenantGuard). */
    @Get('current')
    @UseGuards(TenantGuard)
    current(@Req() req: FastifyRequest): TenantContext {
        return req.tenant as TenantContext;
    }

    /** Branding del workspace — lo lee cualquier miembro (lo aplica el boot). */
    @Get('current/branding')
    @UseGuards(TenantGuard)
    getBranding(@Req() req: FastifyRequest): Promise<BrandingResponse> {
        return this.branding.get(req.tenant!.tenantId);
    }

    /** Editarlo es exclusivo del admin del workspace (mismo gate que Miembros). */
    @Patch('current/branding')
    @UseGuards(TenantGuard)
    updateBranding(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateBrandingSchema)) patch: UpdateBrandingInput,
    ): Promise<BrandingResponse> {
        this.assertAdmin(req);
        return this.branding.update(req.tenant!.tenantId, patch);
    }

    /**
     * SMTP propio del workspace (white-label de correo). Sin config → los
     * correos de la empresa salen por el SMTP de plataforma. Solo admin.
     */
    @Get('current/smtp')
    @UseGuards(TenantGuard)
    getSmtp(@Req() req: FastifyRequest): Promise<SmtpConfigPublic> {
        this.assertAdmin(req);
        return this.smtp.get(req.tenant!.tenantId);
    }

    @Patch('current/smtp')
    @UseGuards(TenantGuard)
    updateSmtp(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(smtpConfigSchema)) input: SmtpConfig,
    ): Promise<SmtpConfigPublic> {
        this.assertAdmin(req);
        return this.smtp.update(req.tenant!.tenantId, input);
    }

    /** Volver al correo de la plataforma (borra la config propia). */
    @Delete('current/smtp')
    @HttpCode(204)
    @UseGuards(TenantGuard)
    async clearSmtp(@Req() req: FastifyRequest): Promise<void> {
        this.assertAdmin(req);
        await this.smtp.clear(req.tenant!.tenantId);
    }

    /** Correo de prueba por el transporte del tenant (sin cola: error visible). */
    @Post('current/smtp/test')
    @HttpCode(200)
    @UseGuards(TenantGuard)
    async testSmtp(@Req() req: FastifyRequest): Promise<{ ok: boolean; error?: string }> {
        this.assertAdmin(req);
        const session = await this.auth.me(req.authUserId!);
        const to = session.user.email;
        try {
            await this.mail.sendNow({
                tenantId: req.tenant!.tenantId,
                to,
                subject: 'Correo de prueba — SMTP del workspace',
                text: 'Si recibiste este correo, el SMTP de tu empresa está funcionando.',
            });
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }
}
