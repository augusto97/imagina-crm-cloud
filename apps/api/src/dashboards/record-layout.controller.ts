import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { layoutDataRequestSchema, type LayoutDataRequest } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RecordLayoutDataService } from './record-layout-data.service';

/**
 * v0.1.230 — datos de los bloques de la ficha (gráficos y vinculados) en un
 * solo request. Lectura: exige poder ver registros de la lista (el ACL fino
 * lo aplica el service).
 */
@Controller('lists/:list/records/:id/layout-data')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordLayoutController {
    constructor(private readonly service: RecordLayoutDataService) {}

    @Post()
    @HttpCode(200)
    @RequireCapability('view_records', 'view_own_records')
    data(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(layoutDataRequestSchema)) body: LayoutDataRequest,
    ): Promise<{ data: Record<string, unknown> }> {
        return this.service
            .data(req.tenant!.tenantId, { userId: req.authUserId!, role: req.tenant!.role }, list, id, body)
            .then((data) => ({ data }));
    }
}
