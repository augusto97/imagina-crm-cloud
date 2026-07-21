import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
    customDomainInputSchema,
    smtpConfigSchema,
    updateBrandingSchema,
    updateStylePresetsSchema,
    type BlockStylePreset,
    type UpdateStylePresetsInput,
    type CustomDomainInput,
    type DomainDnsReport,
    type SmtpConfig,
    type SmtpConfigPublic,
    type BrandingResponse,
    type MembershipSummary,
    type TenantDomain,
    type UpdateBrandingInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { AuthService } from '../auth/auth.service';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DomainsService } from '../domains/domains.service';
import { TenantGuard, type TenantContext } from '../tenancy/tenant.guard';
import { MailService } from '../mail/mail.service';
import { SmtpDnsService, type SmtpDnsReport } from '../mail/smtp-dns.service';
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
        private readonly smtpDns: SmtpDnsService,
        private readonly domains: DomainsService,
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
     * v0.1.94 — Presets de estilo de marca (panel "Diseño" de los editores
     * de plantilla). Los lee cualquier miembro; guardarlos exige poder
     * editar plantillas (manage_lists — admin y manager).
     */
    @Get('current/style-presets')
    @UseGuards(TenantGuard)
    async getStylePresets(@Req() req: FastifyRequest): Promise<{ presets: BlockStylePreset[] }> {
        return { presets: await this.branding.getStylePresets(req.tenant!.tenantId) };
    }

    @Patch('current/style-presets')
    @UseGuards(TenantGuard)
    async updateStylePresets(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(updateStylePresetsSchema)) input: UpdateStylePresetsInput,
    ): Promise<{ presets: BlockStylePreset[] }> {
        const role = req.tenant!.role;
        if (role !== 'admin' && role !== 'manager') {
            throw new ForbiddenException({
                code: 'forbidden',
                message: 'Necesitas permisos de administración para editar los presets de estilo',
                data: { status: 403 },
            });
        }
        return { presets: await this.branding.setStylePresets(req.tenant!.tenantId, input.presets) };
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

    /**
     * Registros DNS exactos (SPF/DKIM/DMARC) que el cliente debe crear para
     * su dominio remitente, VERIFICADOS en vivo contra el DNS real.
     * 404 si el workspace no tiene SMTP propio configurado.
     */
    @Get('current/smtp/dns')
    @UseGuards(TenantGuard)
    async smtpDnsReport(@Req() req: FastifyRequest): Promise<SmtpDnsReport> {
        this.assertAdmin(req);
        const cfg = await this.smtp.getForSend(req.tenant!.tenantId);
        const report = cfg ? await this.smtpDns.report(cfg) : null;
        if (!report) {
            throw new NotFoundException({
                code: 'smtp_not_configured',
                message: 'Configurá primero el SMTP del workspace (con un remitente válido)',
                data: { status: 404 },
            });
        }
        return report;
    }

    /**
     * Dominio personalizado del workspace (ADR-S17). GET lo lee cualquier
     * miembro (muestra el subdominio); mutar y verificar es solo admin.
     */
    @Get('current/domain')
    @UseGuards(TenantGuard)
    getDomain(@Req() req: FastifyRequest): Promise<TenantDomain> {
        return this.domains.getForTenant(req.tenant!.tenantId);
    }

    @Patch('current/domain')
    @UseGuards(TenantGuard)
    setDomain(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(customDomainInputSchema)) input: CustomDomainInput,
    ): Promise<TenantDomain> {
        this.assertAdmin(req);
        return this.domains.set(req.tenant!.tenantId, input.domain);
    }

    @Delete('current/domain')
    @UseGuards(TenantGuard)
    clearDomain(@Req() req: FastifyRequest): Promise<TenantDomain> {
        this.assertAdmin(req);
        return this.domains.clear(req.tenant!.tenantId);
    }

    /** Verificación en vivo del CNAME/A del dominio propio. 404 sin dominio. */
    @Get('current/domain/dns')
    @UseGuards(TenantGuard)
    async domainDnsReport(@Req() req: FastifyRequest): Promise<DomainDnsReport> {
        this.assertAdmin(req);
        const report = await this.domains.dnsReport(req.tenant!.tenantId);
        if (!report) {
            throw new NotFoundException({
                code: 'domain_not_configured',
                message: 'Configurá primero el dominio personalizado',
                data: { status: 404 },
            });
        }
        return report;
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
