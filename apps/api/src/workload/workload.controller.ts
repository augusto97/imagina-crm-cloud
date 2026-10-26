import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import {
    filterTreeSchema,
    readWorkloadSettings,
    setWorkloadCapacitySchema,
    WORKLOAD_ESTIMATE_UNITS,
    WORKLOAD_MAX_PEOPLE,
    WORKLOAD_METRICS,
    WORKLOAD_ZOOMS,
    type FilterGroup,
    type SetWorkloadCapacityInput,
    type WorkloadBundle,
    type WorkloadEstimateUnit,
    type WorkloadMetric,
    type WorkloadZoom,
} from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor } from '../records/records.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { WorkloadService, type WorkloadBundleQuery, type WorkloadMemberDto } from './workload.service';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * B2 — Vista «Carga de trabajo». Leer pide ver registros (el ACL de cada fila
 * lo aplica el servicio de registros). La capacidad de una persona la cambia
 * quien puede editar el trabajo de todos (admin y manager): ver el servicio.
 */
@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class WorkloadController {
    constructor(private readonly workload: WorkloadService) {}

    @Get('lists/:list/records/workload-bundle')
    @RequireCapability('view_records', 'view_own_records')
    bundle(@Req() req: FastifyRequest, @Param('list') list: string, @Query() q: Record<string, unknown>): Promise<{ data: WorkloadBundle }> {
        return this.workload.bundle(req.tenant!.tenantId, actor(req), list, parseBundleQuery(q)).then((data) => ({ data }));
    }

    @Get('lists/:list/workload-people')
    @RequireCapability('view_records', 'view_own_records')
    async people(@Req() req: FastifyRequest, @Param('list') list: string): Promise<{ data: WorkloadMemberDto[] }> {
        return { data: await this.workload.people(req.tenant!.tenantId, actor(req), list) };
    }

    @Patch('workload/capacity/:userId')
    @RequireCapability('edit_records')
    async setCapacity(
        @Req() req: FastifyRequest,
        @Param('userId', ParseIntPipe) userId: number,
        @Body(new ZodValidationPipe(setWorkloadCapacitySchema)) input: SetWorkloadCapacityInput,
    ): Promise<{ data: WorkloadMemberDto }> {
        return { data: await this.workload.setCapacity(req.tenant!.tenantId, actor(req), userId, input.capacity) };
    }
}

function actor(req: FastifyRequest): Actor {
    return { userId: req.authUserId!, role: req.tenant!.role };
}

/**
 * Los parámetros del bundle (todos por query, como el calendario y el Gantt:
 * lo que se ve —filtros y búsqueda sin guardar— manda sobre la vista guardada).
 * Exportada para los tests.
 */
export function parseBundleQuery(q: Record<string, unknown>): WorkloadBundleQuery {
    const from = ymdParam(q.from, 'from');
    const to = ymdParam(q.to, 'to');
    const zoom = enumParam<WorkloadZoom>(q.zoom, WORKLOAD_ZOOMS, 'week');
    const metric = enumParam<WorkloadMetric>(q.metric, WORKLOAD_METRICS, 'count');
    const users = typeof q.users === 'string' && q.users.trim() !== '' ? idList(q.users) : null;
    // `hide_done` sin valor: el default de la métrica (ver readWorkloadSettings).
    const hideDone = q.hide_done === undefined || q.hide_done === '' ? readWorkloadSettings({ workload_metric: metric }).hideDone : q.hide_done === '1' || q.hide_done === 'true';
    return {
        from,
        to,
        zoom,
        metric,
        personFieldId: intParam(q.person_field_id, 'person_field_id'),
        startFieldId: optionalInt(q.start_field_id, 'start_field_id'),
        endFieldId: optionalInt(q.end_field_id, 'end_field_id'),
        estimateFieldId: optionalInt(q.estimate_field_id, 'estimate_field_id'),
        estimateUnit: enumParam<WorkloadEstimateUnit>(q.unit, WORKLOAD_ESTIMATE_UNITS, 'hours'),
        hideDone,
        userIds: users,
        showUnassigned: q.unassigned !== '0' && q.unassigned !== 'false',
        filterTree: parseFilter(q.filter_tree),
        search: typeof q.search === 'string' && q.search.trim() !== '' && q.search.length <= 200 ? q.search : undefined,
        clientTimeZone: typeof q.tz === 'string' && q.tz.length <= 64 && /^[A-Za-z][\w+/-]*$/.test(q.tz) ? q.tz : undefined,
    };
}

function idList(v: string): number[] {
    const out: number[] = [];
    for (const part of v.split(',').slice(0, WORKLOAD_MAX_PEOPLE)) {
        const n = Number(part.trim());
        if (!Number.isInteger(n) || n <= 0) throw badRequest('invalid_param', 'users tiene que ser una lista de ids separados por coma');
        if (!out.includes(n)) out.push(n);
    }
    return out;
}

function enumParam<T extends string>(v: unknown, values: readonly string[], fallback: T): T {
    if (v === undefined || v === '') return fallback;
    if (typeof v !== 'string' || !values.includes(v)) throw badRequest('invalid_param', `Valor no válido: ${String(v).slice(0, 40)}`);
    return v as T;
}

function intParam(v: unknown, name: string): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw badRequest('invalid_param', `${name} inválido`);
    return n;
}

function optionalInt(v: unknown, name: string): number | null {
    return v === undefined || v === '' || v === null ? null : intParam(v, name);
}

function ymdParam(v: unknown, name: string): string {
    if (typeof v !== 'string' || !YMD.test(v)) throw badRequest('invalid_param', `${name} tiene que ser una fecha AAAA-MM-DD`);
    return v;
}

function parseFilter(v: unknown): FilterGroup | undefined {
    if (typeof v !== 'string' || v.trim() === '') return undefined;
    let raw: unknown;
    try {
        raw = JSON.parse(v);
    } catch {
        throw badRequest('invalid_filter', 'filter_tree debe ser JSON');
    }
    const parsed = filterTreeSchema.safeParse(raw);
    if (!parsed.success) throw badRequest('invalid_filter', 'filter_tree inválido');
    return parsed.data;
}

function badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}
