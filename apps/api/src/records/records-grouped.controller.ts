import { BadRequestException, Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { filterTreeSchema, type FilterGroup } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RecordsGroupedService } from './records-grouped.service';
import type { Actor } from './records.service';

/**
 * Vista agrupada (CONTRACT.md §7): buckets + bundle de records/agregados por
 * grupo. Rutas más específicas que `/records/:id`, así que Fastify las resuelve
 * primero.
 */
@Controller('lists/:list/records')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordsGroupedController {
    constructor(private readonly grouped: RecordsGroupedService) {}

    @Get('groups')
    @RequireCapability('view_records', 'view_own_records')
    groups(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Query() q: Record<string, unknown>,
    ): Promise<unknown> {
        const groupBy = intParam(q.group_by, 'group_by');
        return this.grouped.groups(tenantId(req), list, groupBy, parseFilter(q.filter_tree), typeof q.search === 'string' ? q.search : undefined);
    }

    @Get('grouped-bundle')
    @RequireCapability('view_records', 'view_own_records')
    groupedBundle(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Query() q: Record<string, unknown>,
    ): Promise<unknown> {
        const groupBy = intParam(q.group_by, 'group_by');
        const perPage = Number(q.per_page) > 0 ? Math.min(200, Number(q.per_page)) : 50;
        const expanded = csv(q.expanded);
        const aggregateFieldIds = csv(q.aggregate_fields)
            .map((s) => Number(s))
            .filter((n) => Number.isInteger(n) && n > 0);
        return this.grouped.groupedBundle(tenantId(req), actor(req), list, {
            groupBy,
            expanded,
            filterTree: parseFilter(q.filter_tree),
            search: typeof q.search === 'string' ? q.search : undefined,
            perPage,
            aggregateFieldIds,
        });
    }
}

function tenantId(req: FastifyRequest): number {
    return req.tenant!.tenantId;
}
function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role };
}
function intParam(v: unknown, name: string): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) {
        throw new BadRequestException({ code: 'invalid_param', message: `${name} inválido`, data: { status: 400 } });
    }
    return n;
}
function csv(v: unknown): string[] {
    if (typeof v !== 'string' || v.trim() === '') return [];
    return v.split(',').map((s) => s.trim()).filter((s) => s !== '');
}
function parseFilter(v: unknown): FilterGroup | undefined {
    if (typeof v !== 'string' || v.trim() === '') return undefined;
    let raw: unknown;
    try {
        raw = JSON.parse(v);
    } catch {
        throw new BadRequestException({ code: 'invalid_filter', message: 'filter_tree debe ser JSON', data: { status: 400 } });
    }
    const parsed = filterTreeSchema.safeParse(raw);
    if (!parsed.success) {
        throw new BadRequestException({ code: 'invalid_filter', message: 'filter_tree inválido', data: { status: 400 } });
    }
    return parsed.data;
}
