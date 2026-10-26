import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
    cancelApprovalSchema,
    createApprovalFlowSchema,
    decideApprovalSchema,
    requestApprovalSchema,
    updateApprovalFlowSchema,
    type ApprovalActionResult,
    type ApprovalFlow,
    type ApprovalRequestDto,
    type CancelApprovalInput,
    type CreateApprovalFlowInput,
    type DecideApprovalInput,
    type MyApprovalsDto,
    type RecordApprovalsDto,
    type RequestApprovalInput,
    type UpdateApprovalFlowInput,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ApprovalsService, type ApprovalActor } from './approvals.service';

function actor(req: FastifyRequest): ApprovalActor {
    return { userId: req.authUserId!, role: req.tenant!.role, teamIds: req.tenant!.teamIds };
}

/**
 * C5 — Aprobaciones. Configurar flujos: `manage_lists` (leerlos también lo
 * puede quien arma automatizaciones). Pedir: poder editar el registro (lo
 * re-chequea el service con el ACL de la fila). Decidir y cancelar: cualquier
 * miembro del equipo — el service exige ser aprobador del paso actual (o quien
 * pidió, para cancelar) y poder ver el registro.
 */
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ApprovalsController {
    constructor(private readonly approvals: ApprovalsService) {}

    // ── Flujos de una lista ─────────────────────────────────────────────

    @Get('lists/:list/approval-flows')
    @RequireCapability('manage_lists', 'manage_automations')
    async flows(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: ApprovalFlow[] }> {
        return { data: await this.approvals.listFlows(req.tenant!.tenantId, list) };
    }

    @Post('lists/:list/approval-flows')
    @HttpCode(201)
    @RequireCapability('manage_lists')
    async createFlow(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(createApprovalFlowSchema)) input: CreateApprovalFlowInput,
    ): Promise<{ data: ApprovalFlow }> {
        return { data: await this.approvals.createFlow(req.tenant!.tenantId, actor(req), list, input) };
    }

    @Patch('lists/:list/approval-flows/:flowId')
    @RequireCapability('manage_lists')
    async updateFlow(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('flowId', ParseIntPipe) flowId: number,
        @Body(new ZodValidationPipe(updateApprovalFlowSchema)) input: UpdateApprovalFlowInput,
    ): Promise<{ data: ApprovalFlow }> {
        return { data: await this.approvals.updateFlow(req.tenant!.tenantId, actor(req), list, flowId, input) };
    }

    @Delete('lists/:list/approval-flows/:flowId')
    @HttpCode(204)
    @RequireCapability('manage_lists')
    async deleteFlow(@Req() req: FastifyRequest, @Param('list') list: string, @Param('flowId', ParseIntPipe) flowId: number): Promise<void> {
        await this.approvals.deleteFlow(req.tenant!.tenantId, actor(req), list, flowId);
    }

    // ── Un registro ─────────────────────────────────────────────────────

    @Get('lists/:list/records/:id/approvals')
    @RequireCapability('view_records', 'view_own_records')
    async forRecord(@Req() req: FastifyRequest, @Param('list') list: string, @Param('id', ParseIntPipe) id: number): Promise<{ data: RecordApprovalsDto }> {
        return { data: await this.approvals.recordApprovals(req.tenant!.tenantId, actor(req), list, id) };
    }

    @Post('lists/:list/records/:id/approvals')
    @HttpCode(201)
    @RequireCapability('edit_records', 'edit_own_records')
    async request(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(requestApprovalSchema)) input: RequestApprovalInput,
    ): Promise<{ data: ApprovalRequestDto }> {
        return { data: await this.approvals.request(req.tenant!.tenantId, actor(req), list, id, input) };
    }

    // ── Una solicitud ───────────────────────────────────────────────────

    @Get('approvals/:id')
    @RequireCapability('access_admin')
    async get(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ data: { request: ApprovalRequestDto; list: { id: number; slug: string; name: string }; record_title: string } }> {
        return { data: await this.approvals.getRequest(req.tenant!.tenantId, actor(req), id) };
    }

    /** Aprobar / rechazar / devolver el paso actual. Siempre un POST con sesión. */
    @Post('approvals/:id/decide')
    @HttpCode(200)
    @RequireCapability('access_admin')
    async decide(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(decideApprovalSchema)) input: DecideApprovalInput,
    ): Promise<{ data: ApprovalActionResult }> {
        return { data: await this.approvals.decide(req.tenant!.tenantId, actor(req), id, input) };
    }

    @Post('approvals/:id/cancel')
    @HttpCode(200)
    @RequireCapability('access_admin')
    async cancel(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(cancelApprovalSchema)) input: CancelApprovalInput,
    ): Promise<{ data: ApprovalActionResult }> {
        return { data: await this.approvals.cancel(req.tenant!.tenantId, actor(req), id, input) };
    }

    // ── Mi trabajo ──────────────────────────────────────────────────────

    @Get('me/approvals')
    @RequireCapability('access_admin')
    async mine(@Req() req: FastifyRequest): Promise<{ data: MyApprovalsDto }> {
        return { data: await this.approvals.myApprovals(req.tenant!.tenantId, actor(req)) };
    }
}
