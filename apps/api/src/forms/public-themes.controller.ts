import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
    createPublicThemeSchema,
    updatePublicThemeSchema,
    type CreatePublicThemeInput,
    type PublicThemesDto,
    type SavedPublicTheme,
    type UpdatePublicThemeInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService, type AuditAction } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { PublicThemesService } from './public-themes.service';

const defaultSchema = z.object({ id: z.string().regex(/^[a-z0-9]{6,24}$/).nullable() });
const idPipe = new ZodValidationPipe(z.string().regex(/^[a-z0-9]{6,24}$/));

/** v0.1.351 (ADR-S94) — «Mis temas» de la empresa (diseños para reusar en los formularios). */
@PlanModule('forms')
@Controller('workspaces/current/public-themes')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class PublicThemesController {
    constructor(
        private readonly themes: PublicThemesService,
        private readonly audit: AuditService,
    ) {}

    @Get()
    @RequireCapability('manage_forms')
    list(@Req() req: FastifyRequest): Promise<PublicThemesDto> {
        return this.themes.list(req.tenant!.tenantId);
    }

    @Post()
    @RequireCapability('manage_forms')
    async create(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(createPublicThemeSchema)) input: CreatePublicThemeInput): Promise<SavedPublicTheme> {
        const out = await this.themes.create(req.tenant!.tenantId, input, { isAdmin: req.tenant!.role === 'admin' });
        await this.log(req, 'public_theme.create', out.name);
        return out;
    }

    @Put('default')
    @RequireCapability('manage_forms')
    async setDefault(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(defaultSchema)) input: { id: string | null }): Promise<PublicThemesDto> {
        const out = await this.themes.setDefault(req.tenant!.tenantId, input.id);
        await this.log(req, 'public_theme.default', out.themes.find((t) => t.id === out.default_id)?.name ?? 'Clásico');
        return out;
    }

    @Patch(':id')
    @RequireCapability('manage_forms')
    async update(
        @Req() req: FastifyRequest,
        @Param('id', idPipe) id: string,
        @Body(new ZodValidationPipe(updatePublicThemeSchema)) input: UpdatePublicThemeInput,
    ): Promise<SavedPublicTheme> {
        const out = await this.themes.update(req.tenant!.tenantId, id, input, { isAdmin: req.tenant!.role === 'admin' });
        await this.log(req, 'public_theme.update', out.name);
        return out;
    }

    @Delete(':id')
    @RequireCapability('manage_forms')
    async remove(@Req() req: FastifyRequest, @Param('id', idPipe) id: string): Promise<{ ok: true }> {
        const before = (await this.themes.list(req.tenant!.tenantId)).themes.find((t) => t.id === id);
        const out = await this.themes.remove(req.tenant!.tenantId, id);
        await this.log(req, 'public_theme.delete', before?.name ?? id);
        return out;
    }

    private async log(req: FastifyRequest, action: AuditAction, label: string): Promise<void> {
        await this.audit.log({
            tenantId: req.tenant!.tenantId,
            userId: req.authUserId ?? null,
            action,
            targetType: 'public_theme',
            targetLabel: label,
            meta: {},
        });
    }
}
