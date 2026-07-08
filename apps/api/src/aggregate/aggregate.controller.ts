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
import { TenantGuard } from '../tenancy/tenant.guard';
import { AggregateService } from './aggregate.service';

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
    run(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(aggregateRequestSchema)) body: AggregateRequest,
    ): Promise<AggregateResult> {
        return this.aggregate.run(req.tenant!.tenantId, list, body);
    }
}
