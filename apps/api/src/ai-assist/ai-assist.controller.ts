import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import {
    agentBatchPreviewSchema,
    agentBatchStartSchema,
    askRecordAgentSchema,
    recordAiReplySchema,
    recordAiSummaryRequestSchema,
    recordAiWriteSchema,
    type AgentBatchDto,
    type AgentBatchPreview,
    type AgentBatchPreviewInput,
    type AgentBatchStartInput,
    type AskRecordAgentInput,
    type RecordAgentOption,
    type RecordAgentRunDto,
    type RecordAiReplyInput,
    type RecordAiSummary,
    type RecordAiSummaryRequest,
    type RecordAiTextResult,
    type RecordAiWriteInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { aclOf } from '../tenancy/acl-of';
import { PlanModule } from '../tenancy/plan-module.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RecordAgentsService } from './record-agents.service';
import { RecordAiService, type AiAssistActor } from './record-ai.service';

function actor(req: FastifyRequest): AiAssistActor {
    return { userId: req.authUserId!, role: req.tenant!.role, ...aclOf(req) };
}

/**
 * v0.1.456 (ADR-S109) — La IA en el día a día, desde la ficha del registro y
 * la barra de selección. Cerrado a invitados (sin `@AllowGuest()`) y al rol
 * cliente (TenantGuard); el plan tiene que incluir la IA. Los permisos finos
 * (usar la IA, editar el registro, acciones masivas) los revisa el service.
 */
@Controller()
@UseGuards(SessionGuard, TenantGuard)
@PlanModule('ai')
export class AiAssistController {
    constructor(
        private readonly ai: RecordAiService,
        private readonly agents: RecordAgentsService,
    ) {}

    // ── Resumen y texto ──────────────────────────────────────────────────

    @Post('lists/:list/records/:id/ai/summary')
    @HttpCode(200)
    summary(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(recordAiSummaryRequestSchema)) body: RecordAiSummaryRequest,
    ): Promise<RecordAiSummary> {
        return this.ai.summary(req.tenant!.tenantId, actor(req), list, id, { refresh: body.refresh });
    }

    @Post('lists/:list/records/:id/ai/write')
    @HttpCode(200)
    write(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(recordAiWriteSchema)) body: RecordAiWriteInput,
    ): Promise<RecordAiTextResult> {
        return this.ai.write(req.tenant!.tenantId, actor(req), list, id, body);
    }

    @Post('lists/:list/records/:id/ai/reply')
    @HttpCode(200)
    reply(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(recordAiReplySchema)) body: RecordAiReplyInput,
    ): Promise<RecordAiTextResult> {
        return this.ai.reply(req.tenant!.tenantId, actor(req), list, id, body);
    }

    // ── Pedir al agente ──────────────────────────────────────────────────

    @Get('lists/:list/records/:id/agents')
    async recordAgents(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ agents: RecordAgentOption[]; runs: RecordAgentRunDto[]; can_ask: boolean }> {
        return this.agents.forRecord(req.tenant!.tenantId, actor(req), list, id);
    }

    @Post('lists/:list/records/:id/agent-runs')
    @HttpCode(202)
    ask(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(askRecordAgentSchema)) body: AskRecordAgentInput,
    ): Promise<RecordAgentRunDto> {
        return this.agents.ask(req.tenant!.tenantId, actor(req), list, id, body);
    }

    @Get('lists/:list/records/:id/agent-runs/:runId')
    run(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('runId', ParseIntPipe) runId: number,
    ): Promise<RecordAgentRunDto> {
        return this.agents.run(req.tenant!.tenantId, actor(req), list, id, runId);
    }

    // ── Agente en lote ───────────────────────────────────────────────────

    @Get('lists/:list/agent-batches/agents')
    listAgents(@Req() req: FastifyRequest, @Param('list') list: string): Promise<RecordAgentOption[]> {
        return this.agents.listAgents(req.tenant!.tenantId, actor(req), list);
    }

    @Post('lists/:list/agent-batches/preview')
    @HttpCode(200)
    preview(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(agentBatchPreviewSchema)) body: AgentBatchPreviewInput,
    ): Promise<AgentBatchPreview> {
        return this.agents.preview(req.tenant!.tenantId, actor(req), list, body);
    }

    @Post('lists/:list/agent-batches')
    @HttpCode(202)
    start(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(agentBatchStartSchema)) body: AgentBatchStartInput,
    ): Promise<AgentBatchDto> {
        return this.agents.start(req.tenant!.tenantId, actor(req), list, body);
    }

    @Get('lists/:list/agent-batches/:batchId')
    batch(@Req() req: FastifyRequest, @Param('list') list: string, @Param('batchId', ParseIntPipe) batchId: number): Promise<AgentBatchDto> {
        return this.agents.batch(req.tenant!.tenantId, actor(req), list, batchId);
    }

    @Post('lists/:list/agent-batches/:batchId/cancel')
    @HttpCode(200)
    cancel(@Req() req: FastifyRequest, @Param('list') list: string, @Param('batchId', ParseIntPipe) batchId: number): Promise<AgentBatchDto> {
        return this.agents.cancel(req.tenant!.tenantId, actor(req), list, batchId);
    }
}
