import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Role } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AiFieldsService, type AiFieldStatus } from './ai-fields.service';

const fillSchema = z.object({ only_empty: z.boolean().default(true) });

/**
 * v0.1.277 (ADR-S41) — Campos con IA: recalcular uno desde la ficha, llenar
 * la columna entera y ver el último error del campo.
 */
@Controller('lists/:list')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class AiFieldsController {
    constructor(private readonly svc: AiFieldsService) {}

    @Post('records/:recordId/ai-fields/:fieldId/run')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    async run(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('recordId', ParseIntPipe) recordId: number,
        @Param('fieldId', ParseIntPipe) fieldId: number,
    ): Promise<{ data: { value: string | null } }> {
        const actor = { userId: req.authUserId!, role: req.tenant!.role as Role };
        return { data: await this.svc.runNow(req.tenant!.tenantId, actor, list, recordId, fieldId) };
    }

    @Post('fields/:fieldId/ai-fill')
    @HttpCode(200)
    @RequireCapability('manage_fields')
    async fill(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('fieldId', ParseIntPipe) fieldId: number,
        @Body(new ZodValidationPipe(fillSchema)) body: z.infer<typeof fillSchema>,
    ): Promise<{ data: { queued: number; capped: boolean; reason?: string } }> {
        return { data: await this.svc.fill(req.tenant!.tenantId, list, fieldId, body.only_empty) };
    }

    @Get('fields/:fieldId/ai-status')
    @RequireCapability('manage_fields')
    async status(@Req() req: FastifyRequest, @Param('fieldId', ParseIntPipe) fieldId: number): Promise<{ data: AiFieldStatus }> {
        return { data: await this.svc.status(req.tenant!.tenantId, fieldId) };
    }
}
