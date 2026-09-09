import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
    applyDashboardTemplateSchema,
    applyListTemplateSchema,
    createAutomationTemplateSchema,
    createDashboardTemplateSchema,
    createListTemplateSchema,
    duplicateListSchema,
    type ApplyDashboardTemplateInput,
    type ApplyListTemplateInput,
    type AutomationTemplateSummary,
    type CreateAutomationTemplateInput,
    type CreateDashboardTemplateInput,
    type CreateListTemplateInput,
    type DashboardTemplateSummary,
    type DuplicateListInput,
    type ListTemplateSummary,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { DashboardViewer } from '../dashboards/dashboards.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AutomationTemplatesService } from './automation-templates.service';
import type { MaterializeResult } from './blueprint.service';
import { DashboardTemplatesService, type ApplyDashboardResult } from './dashboard-templates.service';
import { TemplatesService } from './templates.service';

/**
 * Duplicar listas y plantillas (v0.1.166) + plantillas de dashboards y de
 * automatizaciones (v0.1.167). Cada familia pide la capability de lo que
 * crea: listas → `manage_lists`, dashboards → `manage_dashboards`,
 * automatizaciones → `manage_automations`.
 */
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class TemplatesController {
    constructor(
        private readonly templates: TemplatesService,
        private readonly dashboardTemplates: DashboardTemplatesService,
        private readonly automationTemplates: AutomationTemplatesService,
    ) {}

    // ── Listas ───────────────────────────────────────────────────────────

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

    // ── Dashboards ───────────────────────────────────────────────────────

    @Get('dashboard-templates')
    @RequireCapability('manage_dashboards')
    allDashboards(@Req() req: FastifyRequest): Promise<{ data: DashboardTemplateSummary[] }> {
        return this.dashboardTemplates.listAll(tenantId(req)).then((data) => ({ data }));
    }

    @Post('dashboard-templates')
    @HttpCode(201)
    @RequireCapability('manage_dashboards')
    createDashboard(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createDashboardTemplateSchema)) input: CreateDashboardTemplateInput,
    ): Promise<DashboardTemplateSummary> {
        return this.dashboardTemplates.create(tenantId(req), viewer(req), input);
    }

    @Delete('dashboard-templates/:id')
    @HttpCode(204)
    @RequireCapability('manage_dashboards')
    async removeDashboard(@Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
        await this.dashboardTemplates.remove(tenantId(req), actorId(req), id);
    }

    @Post('dashboard-templates/:id/apply')
    @HttpCode(201)
    @RequireCapability('manage_dashboards')
    applyDashboard(
        @Req() req: FastifyRequest,
        @Param('id') id: string,
        @Body(new ZodValidationPipe(applyDashboardTemplateSchema)) input: ApplyDashboardTemplateInput,
    ): Promise<ApplyDashboardResult> {
        return this.dashboardTemplates.apply(tenantId(req), actorId(req), id, input);
    }

    // ── Automatizaciones ─────────────────────────────────────────────────

    @Get('automation-templates')
    @RequireCapability('manage_automations')
    allAutomations(@Req() req: FastifyRequest): Promise<{ data: AutomationTemplateSummary[] }> {
        return this.automationTemplates.listAll(tenantId(req)).then((data) => ({ data }));
    }

    @Post('automation-templates')
    @HttpCode(201)
    @RequireCapability('manage_automations')
    createAutomation(
        @Req() req: FastifyRequest,
        @Body(new ZodValidationPipe(createAutomationTemplateSchema)) input: CreateAutomationTemplateInput,
    ): Promise<AutomationTemplateSummary> {
        return this.automationTemplates.create(tenantId(req), actorId(req), input);
    }

    @Delete('automation-templates/:id')
    @HttpCode(204)
    @RequireCapability('manage_automations')
    async removeAutomation(@Req() req: FastifyRequest, @Param('id') id: string): Promise<void> {
        await this.automationTemplates.remove(tenantId(req), actorId(req), id);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function actorId(req: FastifyRequest): number {
    return req.authUserId!;
}

function viewer(req: FastifyRequest): DashboardViewer {
    return { userId: req.authUserId!, role: req.tenant!.role };
}
