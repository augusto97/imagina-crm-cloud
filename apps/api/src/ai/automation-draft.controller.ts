import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
    automationAiDraftRequestSchema,
    type AutomationAiDraftJob,
    type AutomationAiDraftRequest,
    type AutomationAiDraftStatus,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { AutomationsService } from '../automations/automations.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ListsService } from '../lists/lists.service';
import { aclOf } from '../tenancy/acl-of';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AutomationDraftService } from './automation-draft.service';
import type { AiToolContext } from './tools/registry';

/**
 * v0.1.463 — «Describir con IA» y «Pedir un cambio con IA» del editor de
 * automatizaciones (E7). Arma automatizaciones: exige `manage_automations`
 * (el guard) y `use_ai_assistant` (el service), el módulo de automatizaciones
 * del plan (aquí) y el de IA (la resolución de la clave), y ver la lista
 * ENTERA (las automatizaciones corren con todos sus registros y campos).
 */
@PlanModule('automations')
@Controller('lists/:list/automations/ai-draft')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class AutomationDraftController {
    constructor(
        private readonly drafts: AutomationDraftService,
        private readonly automations: AutomationsService,
        private readonly lists: ListsService,
    ) {}

    private ctx(req: FastifyRequest): AiToolContext {
        return { tenantId: req.tenant!.tenantId, userId: req.authUserId as number, role: req.tenant!.role, ...aclOf(req) };
    }

    private async whole(req: FastifyRequest, list: string): Promise<AiToolContext> {
        const ctx = this.ctx(req);
        await this.automations.assertWholeList(ctx.tenantId, list, ctx);
        return ctx;
    }

    /** Si el botón se puede usar y, si no, por qué (sin gastar nada). */
    @Get('status')
    @RequireCapability('manage_automations')
    async status(@Req() req: FastifyRequest, @Param('list') list: string): Promise<AutomationAiDraftStatus> {
        return this.drafts.status(await this.whole(req, list));
    }

    @Post()
    @HttpCode(202)
    @RequireCapability('manage_automations')
    async start(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(automationAiDraftRequestSchema)) body: AutomationAiDraftRequest,
    ): Promise<{ id: string }> {
        return this.drafts.start(await this.whole(req, list), list, body);
    }

    @Get(':id')
    @RequireCapability('manage_automations')
    async get(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id') id: string): Promise<AutomationAiDraftJob> {
        const ctx = await this.whole(req, list);
        const l = await this.lists.get(ctx.tenantId, list);
        const job = await this.drafts.get(ctx.tenantId, ctx.userId, l.id, id);
        if (!job) throw new NotFoundException({ code: 'ai_draft_not_found', message: 'El pedido venció. Vuelve a pedirlo.', data: { status: 404 } });
        return job;
    }
}
