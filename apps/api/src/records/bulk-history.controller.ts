import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import {
    bulkRevertApplySchema,
    type BulkEditLog,
    type BulkRevertApplyInput,
    type BulkRevertPreview,
    type BulkRevertResult,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantGuard } from '../tenancy/tenant.guard';
import { BulkHistoryService } from './bulk-history.service';
import type { Actor } from './records.service';

/**
 * Historial de ediciones masivas de una lista y DESHACER (v0.1.218). Ver y
 * deshacer exige poder editar registros; deshacer la edición de OTRA persona
 * (o una de la tienda) exige además `bulk_actions` — lo decide el service.
 */
@Controller('lists/:list/bulk-edits')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class BulkHistoryController {
    constructor(private readonly history: BulkHistoryService) {}

    @Get()
    @RequireCapability('edit_records', 'edit_own_records')
    list(@Req() req: FastifyRequest, @Param('list') list: string): Promise<BulkEditLog[]> {
        return this.history.list(tenantId(req), actor(req), list);
    }

    @Post(':id/revert/preview')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    preview(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<BulkRevertPreview> {
        return this.history.revertPreview(tenantId(req), actor(req), list, id);
    }

    @Post(':id/revert')
    @HttpCode(200)
    @RequireCapability('edit_records', 'edit_own_records')
    revert(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(bulkRevertApplySchema)) input: BulkRevertApplyInput,
    ): Promise<BulkRevertResult> {
        return this.history.revertApply(tenantId(req), actor(req), list, id, input.item_ids, input.force);
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role };
}
