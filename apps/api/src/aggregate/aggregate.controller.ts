import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
    aggregateRequestSchema,
    type AggregateRequest,
    type AggregateResult,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AllowReadOnly } from '../tenancy/allow-read-only.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AggregateService, MAX_GROUPS } from './aggregate.service';

/**
 * Agregaciones sobre una lista (CONTRACT.md §5). POST porque el request lleva
 * filter_tree; es una lectura (no muta). Requiere poder ver records.
 */
@Controller('lists/:list/aggregate')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class AggregateController {
    constructor(private readonly aggregate: AggregateService) {}

    @Post()
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    // ADR-S09: lectura (POST por el filter_tree) — vale en solo-lectura.
    @AllowReadOnly()
    run(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(aggregateRequestSchema)) body: AggregateRequest,
    ): Promise<AggregateResult> {
        return this.aggregate.run(req.tenant!.tenantId, list, body, {
            viewer: { role: req.tenant!.role, userId: req.authUserId! },
            // v0.1.286 — un agrupado por un campo casi único devolvía 100k
            // grupos (7,5 MB): a partir de MAX_GROUPS el resto va a "Otros".
            top: body.group_by_field_id !== undefined ? { limit: MAX_GROUPS, byValue: false } : undefined,
        });
    }
}
