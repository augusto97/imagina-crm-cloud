import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
    applyListTemplateSchema,
    createListTemplateSchema,
    duplicateListSchema,
    type ApplyListTemplateInput,
    type CreateListTemplateInput,
    type DuplicateListInput,
    type ListTemplateSummary,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import type { MaterializeResult } from './blueprint.service';
import { TemplatesService } from './templates.service';

/**
 * Duplicar listas y plantillas (v0.1.166). Todo bajo `manage_lists`: crear
 * listas —que es lo que hacen las tres operaciones— ya lo exige.
 */
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class TemplatesController {
    constructor(private readonly templates: TemplatesService) {}

    @Post('lists/:idOrSlug/duplicate')
    @HttpCode(201)
    @RequireCapability('manage_lists')
    duplicate(
        @Req() req: FastifyRequest,
        @Param('idOrSlug') idOrSlug: string,
        @Body(new ZodValidationPipe(duplicateListSchema)) input: DuplicateListInput,
    ): Promise<MaterializeResult> {
        return this.templates.duplicate(tenantId(req), actorId(req), idOrSlug, input);
    }

    @Get('list-templates')
    @RequireCapability('manage_lists')
    all(@Req() req: FastifyRequest): Promise<{ data: ListTemplateSummary[] }> {
        return this.templates.listAll(tenantId(req)).then((data) => ({ data }));
    }

    @Get('list-templates/:id')
    @RequireCapability('manage_lists')
    get(@Req() req: FastifyRequest, @Param('id') id: string) {
        return this.templates.get(tenantId(req), id);
    }

    @Post('list-templates')
    @HttpCode(201)
    @RequireCapability('manage_lists')
    create(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createListTemplateSchema)) input: CreateListTemplateInput,
    ): Promise<ListTemplateSummary> {
        return this.templates.create(tenantId(req), actorId(req), input);
    }

    @Delete('list-templates/:id')
    @HttpCode(204)
    @RequireCapability('manage_lists')
    async remove(@Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
        await this.templates.remove(tenantId(req), actorId(req), id);
    }

    @Post('list-templates/:id/apply')
    @HttpCode(201)
    @RequireCapability('manage_lists')
    apply(
        @Req() req: FastifyRequest,
        @Param('id') id: string,
        @Body(new ZodValidationPipe(applyListTemplateSchema)) input: ApplyListTemplateInput,
    ): Promise<MaterializeResult> {
        return this.templates.apply(tenantId(req), actorId(req), id, input);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function actorId(req: FastifyRequest): number {
    return req.authUserId!;
}
