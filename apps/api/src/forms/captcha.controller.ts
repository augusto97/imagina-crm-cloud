import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Logger, Put, Req, UseGuards } from '@nestjs/common';
import { captchaKeysInputSchema, CAPTCHA_PROVIDER_INFO, type CaptchaKeysInput, type CaptchaKeysStatus } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CaptchaKeysError, CaptchaService } from './captcha.service';

function keysError(err: unknown): never {
    if (err instanceof CaptchaKeysError) {
        throw new BadRequestException({ code: 'captcha_keys_invalid', message: err.message, data: { status: 400 } });
    }
    throw err;
}

/**
 * v0.1.290 — Llaves de captcha de la PLATAFORMA (superadmin). Las usan los
 * formularios de toda empresa que no cargó las suyas. El secreto nunca vuelve.
 */
@Controller('system/captcha')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformCaptchaController {
    private readonly logger = new Logger(PlatformCaptchaController.name);

    constructor(private readonly captcha: CaptchaService) {}

    @Get()
    get(): Promise<CaptchaKeysStatus> {
        return this.captcha.platformStatus();
    }

    @Put()
    async set(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(captchaKeysInputSchema)) input: CaptchaKeysInput): Promise<CaptchaKeysStatus> {
        const out = await this.captcha.setPlatform(input).catch(keysError);
        // Sin empresa no hay bitácora de workspace: queda en el registro del servidor.
        this.logger.log(`Captcha de plataforma → ${CAPTCHA_PROVIDER_INFO[input.provider].label} (usuario ${req.authUserId ?? '?'})`);
        return out;
    }

    @Delete()
    @HttpCode(204)
    async clear(@Req() req: FastifyRequest): Promise<void> {
        await this.captcha.clearPlatform();
        this.logger.log(`Captcha de plataforma quitado (usuario ${req.authUserId ?? '?'})`);
    }
}

/**
 * v0.1.290 — Llaves de captcha de la EMPRESA (admin). Si las carga, sus
 * formularios las usan en vez de las de la plataforma. Cada cambio queda en la
 * bitácora (sin el secreto).
 */
@Controller('workspaces/current/captcha')
@UseGuards(SessionGuard, TenantGuard)
export class WorkspaceCaptchaController {
    constructor(
        private readonly captcha: CaptchaService,
        private readonly audit: AuditService,
    ) {}

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
    get(@Req() req: FastifyRequest): Promise<CaptchaKeysStatus> {
        this.assertAdmin(req);
        return this.captcha.tenantStatus(req.tenant!.tenantId);
    }

    @Put()
    async set(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(captchaKeysInputSchema)) input: CaptchaKeysInput): Promise<CaptchaKeysStatus> {
        this.assertAdmin(req);
        const out = await this.captcha.setTenant(req.tenant!.tenantId, input).catch(keysError);
        await this.audit.log({
            tenantId: req.tenant!.tenantId,
            userId: req.authUserId ?? null,
            action: 'workspace.captcha_change',
            targetType: 'workspace',
            targetLabel: CAPTCHA_PROVIDER_INFO[input.provider].label,
            // NUNCA el secreto: la bitácora la lee cualquier admin.
            meta: { provider: input.provider, site_key: input.site_key },
        });
        return out;
    }

    @Delete()
    @HttpCode(204)
    async clear(@Req() req: FastifyRequest): Promise<void> {
        this.assertAdmin(req);
        await this.captcha.clearTenant(req.tenant!.tenantId);
        await this.audit.log({
            tenantId: req.tenant!.tenantId,
            userId: req.authUserId ?? null,
            action: 'workspace.captcha_change',
            targetType: 'workspace',
            targetLabel: '(vuelve a las llaves de la plataforma)',
        });
    }
}
