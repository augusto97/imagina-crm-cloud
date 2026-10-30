import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
    createAiAgentSchema,
    createAiAgentTriggerSchema,
    testAiAgentSchema,
    updateAiAgentSchema,
    updateAiAgentTriggerSchema,
    type AiAgentApplyResult,
    type AiAgentDto,
    type AiAgentProposalDto,
    type AiAgentRunDto,
    type AiAgentVersionDto,
    type CreateAiAgentInput,
    type CreateAiAgentTriggerInput,
    type MyAgentProposalsDto,
    type TestAiAgentInput,
    type UpdateAiAgentInput,
    type UpdateAiAgentTriggerInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../records/records.service';
import { aclOf } from '../tenancy/acl-of';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AgentProposalsService } from './agent-proposals.service';
import { AgentRunnerService } from './agent-runner.service';
import { AiAgentsService, type AgentEditor } from './ai-agents.service';
import { PlanModule } from '../tenancy/plan-module.decorator';

function actor(req: FastifyRequest): Actor & AgentEditor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

/** Ids de query (`?cursor=`): un número positivo o nada. */
function optionalId(raw: string | undefined): number | undefined {
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/**
 * E6 — Agentes de IA (ADR-S67). Configurarlos, probarlos, ver su historial y
 * decidir sus propuestas.
 *
 * Administrar agentes exige `manage_ai_agents` (sólo admin por defecto; un
 * rol propio puede tenerla; un invitado nunca). Elegir un agente en una
 * automatización (la lista de opciones) también lo puede quien arma
 * automatizaciones. Decidir una propuesta: quien puede editar ese registro
 * (lo re-chequea el service con el ACL de la fila).
 */
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class AiAgentsController {
    constructor(
        private readonly agents: AiAgentsService,
        private readonly runner: AgentRunnerService,
        private readonly proposals: AgentProposalsService,
    ) {}

    // ── Agentes ──────────────────────────────────────────────────────────

    @PlanModule('ai')
    @Get('ai-agents')
    @RequireCapability('manage_ai_agents')
    async list(@Req() req: FastifyRequest): Promise<{ data: AiAgentDto[] }> {
        return { data: await this.agents.list(req.tenant!.tenantId) };
    }

    /** Para el selector de «Pedirle a un agente» del editor de automatizaciones. */
    @PlanModule('ai')
    @Get('ai-agents/options')
    @RequireCapability('manage_ai_agents', 'manage_automations')
    async options(@Req() req: FastifyRequest): Promise<{ data: Awaited<ReturnType<AiAgentsService['options']>> }> {
        return { data: await this.agents.options(req.tenant!.tenantId) };
    }

    @PlanModule('ai')
    @Post('ai-agents')
    @HttpCode(201)
    @RequireCapability('manage_ai_agents')
    async create(@Req() req: FastifyRequest, @Body(new ZodValidationPipe(createAiAgentSchema)) input: CreateAiAgentInput): Promise<{ data: AiAgentDto }> {
        return { data: await this.agents.create(req.tenant!.tenantId, actor(req), input) };
    }

    @PlanModule('ai')
    @Get('ai-agents/:id')
    @RequireCapability('manage_ai_agents')
    async get(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: AiAgentDto }> {
        return { data: await this.agents.get(req.tenant!.tenantId, id) };
    }

    @PlanModule('ai')
    @Patch('ai-agents/:id')
    @RequireCapability('manage_ai_agents')
    async update(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(updateAiAgentSchema)) input: UpdateAiAgentInput,
    ): Promise<{ data: AiAgentDto }> {
        return { data: await this.agents.update(req.tenant!.tenantId, actor(req), id, input) };
    }

    @PlanModule('ai')
    @Delete('ai-agents/:id')
    @RequireCapability('manage_ai_agents')
    async remove(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: { id: number; name: string; automations_removed: number } }> {
        return { data: await this.agents.remove(req.tenant!.tenantId, actor(req), id) };
    }

    // ── Cuándo trabaja ───────────────────────────────────────────────────

    @PlanModule('ai')
    @Post('ai-agents/:id/triggers')
    @HttpCode(201)
    @RequireCapability('manage_ai_agents')
    async addTrigger(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(createAiAgentTriggerSchema)) input: CreateAiAgentTriggerInput,
    ): Promise<{ data: AiAgentDto }> {
        return { data: await this.agents.addTrigger(req.tenant!.tenantId, actor(req), id, input) };
    }

    @PlanModule('ai')
    @Patch('ai-agents/:id/triggers/:automationId')
    @RequireCapability('manage_ai_agents')
    async updateTrigger(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('automationId', ParseIntPipe) automationId: number,
        @Body(new ZodValidationPipe(updateAiAgentTriggerSchema)) input: UpdateAiAgentTriggerInput,
    ): Promise<{ data: AiAgentDto }> {
        return { data: await this.agents.updateTrigger(req.tenant!.tenantId, actor(req), id, automationId, input) };
    }

    @PlanModule('ai')
    @Delete('ai-agents/:id/triggers/:automationId')
    @RequireCapability('manage_ai_agents')
    async removeTrigger(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('automationId', ParseIntPipe) automationId: number,
    ): Promise<{ data: AiAgentDto }> {
        return { data: await this.agents.removeTrigger(req.tenant!.tenantId, actor(req), id, automationId) };
    }

    // ── Probar, historial y versiones ────────────────────────────────────

    @PlanModule('ai')
    @Post('ai-agents/:id/test')
    @HttpCode(202)
    @RequireCapability('manage_ai_agents')
    async test(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(testAiAgentSchema)) input: TestAiAgentInput,
    ): Promise<{ data: { run_id: number } }> {
        return { data: await this.runner.test(req.tenant!.tenantId, actor(req), id, input) };
    }

    @PlanModule('ai')
    @Get('ai-agents/:id/runs')
    @RequireCapability('manage_ai_agents')
    async runs(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Query('cursor') cursor?: string,
    ): Promise<{ data: AiAgentRunDto[]; meta: { next_cursor: string | null } }> {
        return this.agents.runs(req.tenant!.tenantId, id, optionalId(cursor));
    }

    @PlanModule('ai')
    @Get('ai-agents/:id/runs/:runId')
    @RequireCapability('manage_ai_agents')
    async run(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number, @Param('runId', ParseIntPipe) runId: number): Promise<{ data: AiAgentRunDto }> {
        return { data: await this.agents.run(req.tenant!.tenantId, id, runId) };
    }

    @PlanModule('ai')
    @Get('ai-agents/:id/versions')
    @RequireCapability('manage_ai_agents')
    async versions(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: AiAgentVersionDto[] }> {
        return { data: await this.agents.versions(req.tenant!.tenantId, id) };
    }

    // ── Propuestas ───────────────────────────────────────────────────────

    @Get('lists/:list/records/:id/agent-proposals')
    @RequireCapability('view_records', 'view_own_records')
    async forRecord(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<{ data: AiAgentProposalDto[] }> {
        return { data: await this.proposals.forRecord(req.tenant!.tenantId, actor(req), list, id) };
    }

    /** «Mi trabajo» → Agentes: lo que espera MI revisión. */
    @Get('me/agent-proposals')
    @RequireCapability('access_admin')
    async mine(@Req() req: FastifyRequest): Promise<{ data: MyAgentProposalsDto }> {
        return { data: await this.proposals.mine(req.tenant!.tenantId, actor(req)) };
    }

    @Post('ai-agent-proposals/:id/apply')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    async apply(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: AiAgentApplyResult }> {
        return { data: await this.proposals.apply(req.tenant!.tenantId, actor(req), id) };
    }

    @Post('ai-agent-proposals/:id/discard')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    async discard(@Req() req: FastifyRequest, @Param('id', ParseIntPipe) id: number): Promise<{ data: AiAgentProposalDto }> {
        return { data: await this.proposals.discard(req.tenant!.tenantId, actor(req), id) };
    }
}
