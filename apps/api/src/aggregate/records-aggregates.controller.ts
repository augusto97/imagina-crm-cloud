import { BadRequestException, Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { filterTreeSchema } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AggregateService, type FooterAggregates } from './aggregate.service';

/**
 * Footer de agregados de la tabla (shape del fork): `GET` batch por varios
 * campos → `{ totals: {slug: bag}, groups }`. El endpoint POST `/aggregate`
 * (métrica única) sigue existiendo para widgets puntuales. Ruta más específica
 * que `/records/:id`, así que Fastify la resuelve primero.
 */
@Controller('lists/:list/records/aggregates')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordsAggregatesController {
    constructor(private readonly aggregate: AggregateService) {}

    @Get()
    @RequireCapability('view_records', 'view_own_records')
    footer(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Query() q: Record<string, unknown>,
    ): Promise<FooterAggregates> {
        const fieldIds = String(q.fields ?? '')
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n > 0);

        let filter_tree: ReturnType<typeof filterTreeSchema.parse> | undefined;
        if (typeof q.filter_tree === 'string' && q.filter_tree.trim() !== '') {
            let raw: unknown;
            try {
                raw = JSON.parse(q.filter_tree);
            } catch {
                throw new BadRequestException({
                    code: 'invalid_filter',
                    message: 'filter_tree debe ser JSON válido',
                    data: { status: 400 },
                });
            }
            const parsed = filterTreeSchema.safeParse(raw);
            if (!parsed.success) {
                throw new BadRequestException({
                    code: 'invalid_filter',
                    message: 'filter_tree inválido',
                    data: { status: 400 },
                });
            }
            filter_tree = parsed.data;
        }

        const groupBy = q.group_by !== undefined ? Number(q.group_by) : undefined;
        return this.aggregate.footer(req.tenant!.tenantId, list, {
            fieldIds,
            filter_tree,
            group_by_field_id: Number.isInteger(groupBy) && (groupBy as number) > 0 ? groupBy : undefined,
        });
    }
}
