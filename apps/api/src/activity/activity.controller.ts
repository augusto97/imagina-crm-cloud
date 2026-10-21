import { Controller, Get, Param, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import type { ActivityDto, FieldHistoryPage } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ActivityService } from './activity.service';

type Page = { data: ActivityDto[]; meta: { next_cursor: string | null } };

@Controller('lists/:list')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class ActivityController {
    constructor(private readonly activity: ActivityService) {}

    /** Actividad de toda la lista. */
    @Get('activity')
    @RequireCapability('view_records', 'view_own_records')
    listActivity(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Query('cursor') cursor?: string,
        @Query('limit') limit?: string,
    ): Promise<Page> {
        return this.activity.list(req.tenant!.tenantId, list, {
            cursor: cursor ? Number(cursor) : undefined,
            limit: limit ? Number(limit) : undefined,
            viewer: { role: req.tenant!.role, userId: req.authUserId! },
        });
    }

    /**
     * v0.1.288 — Historial de UN campo de un registro (quién, cuándo, de → a),
     * paginado por cursor. Lo usa «Ver historial» de cada campo de la ficha.
     */
    @Get('records/:id/fields/:fieldId/history')
    @RequireCapability('view_records', 'view_own_records')
    fieldHistory(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Param('fieldId', ParseIntPipe) fieldId: number,
        @Query('cursor') cursor?: string,
        @Query('limit') limit?: string,
    ): Promise<FieldHistoryPage> {
        const c = cursor ? Number(cursor) : undefined;
        return this.activity.fieldHistory(req.tenant!.tenantId, list, id, fieldId, {
            cursor: c !== undefined && Number.isSafeInteger(c) && c > 0 ? c : undefined,
            limit: limit ? Number(limit) : undefined,
            viewer: { role: req.tenant!.role, userId: req.authUserId! },
        });
    }

    /** Actividad de un record puntual. */
    @Get('records/:id/activity')
    @RequireCapability('view_records', 'view_own_records')
    recordActivity(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('id', ParseIntPipe) id: number,
        @Query('cursor') cursor?: string,
        @Query('limit') limit?: string,
    ): Promise<Page> {
        return this.activity.list(req.tenant!.tenantId, list, {
            recordId: id,
            cursor: cursor ? Number(cursor) : undefined,
            limit: limit ? Number(limit) : undefined,
            viewer: { role: req.tenant!.role, userId: req.authUserId! },
        });
    }
}
