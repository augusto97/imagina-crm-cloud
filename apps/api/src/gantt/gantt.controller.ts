import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import {
    filterTreeSchema,
    ganttPdfRequestSchema,
    saveGanttBaselineSchema,
    type FilterGroup,
    type GanttBaseline,
    type GanttBundle,
    type GanttPdfRequest,
    type SaveGanttBaselineInput,
} from '@imagina-base/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { contentDispositionHeader } from '../files/safe-content-type';
import type { Actor } from '../records/records.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { GanttService } from './gantt.service';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * B1 — Vista Gantt. Leer pide ver registros (el ACL de cada fila lo aplica el
 * servicio de registros); la línea base es un ajuste de la VISTA
 * (`manage_views`, y una vista protegida sólo la cambia su autor o un admin).
 */
@Controller('lists/:list')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class GanttController {
    constructor(private readonly gantt: GanttService) {}

    @Get('records/gantt-bundle')
    @RequireCapability('view_records', 'view_own_records')
    bundle(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Query() q: Record<string, unknown>,
    ): Promise<{ data: GanttBundle }> {
        const from = ymdParam(q.from, 'from');
        const to = ymdParam(q.to, 'to');
        return this.gantt
            .bundle(req.tenant!.tenantId, actor(req), list, {
                startFieldId: intParam(q.start_field_id, 'start_field_id'),
                endFieldId: q.end_field_id === undefined || q.end_field_id === '' ? null : intParam(q.end_field_id, 'end_field_id'),
                from,
                to,
                viewId: q.view_id === undefined || q.view_id === '' ? undefined : intParam(q.view_id, 'view_id'),
                filterTree: parseFilter(q.filter_tree),
                search: typeof q.search === 'string' && q.search.length <= 200 ? q.search : undefined,
                sort: typeof q.sort === 'string' && q.sort.length <= 500 ? q.sort : undefined,
                subtasks: q.subtasks !== '0',
                unscheduled: q.unscheduled !== '0',
            })
            .then((data) => ({ data }));
    }

    @Post('records/gantt-pdf')
    @RequireCapability('view_records', 'view_own_records')
    async pdf(
        @Req() req: FastifyRequest,
        @Res() reply: FastifyReply,
        @Param('list') list: string,
        @Body(new ZodValidationPipe(ganttPdfRequestSchema)) input: GanttPdfRequest,
    ): Promise<void> {
        const doc = await this.gantt.pdf(req.tenant!.tenantId, actor(req), list, input);
        reply.raw.writeHead(200, {
            'content-type': 'application/pdf',
            'content-length': String(doc.buffer.length),
            'content-disposition': contentDispositionHeader('attachment', doc.filename),
            'x-content-type-options': 'nosniff',
            'cache-control': 'private, no-store',
        });
        reply.raw.end(doc.buffer);
    }

    @Get('views/:viewId/gantt-baseline')
    @RequireCapability('view_records', 'view_own_records')
    async baseline(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('viewId', ParseIntPipe) viewId: number,
    ): Promise<{ data: GanttBaseline | null }> {
        return { data: await this.gantt.getBaseline(req.tenant!.tenantId, actor(req), list, viewId) };
    }

    @Post('views/:viewId/gantt-baseline')
    @HttpCode(201)
    @RequireCapability('manage_views')
    async saveBaseline(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('viewId', ParseIntPipe) viewId: number,
        @Body(new ZodValidationPipe(saveGanttBaselineSchema)) input: SaveGanttBaselineInput,
    ): Promise<{ data: GanttBaseline }> {
        return { data: await this.gantt.saveBaseline(req.tenant!.tenantId, actor(req), list, viewId, input) };
    }

    @Delete('views/:viewId/gantt-baseline')
    @HttpCode(204)
    @RequireCapability('manage_views')
    async deleteBaseline(
        @Req() req: FastifyRequest,
        @Param('list') list: string,
        @Param('viewId', ParseIntPipe) viewId: number,
    ): Promise<void> {
        await this.gantt.deleteBaseline(req.tenant!.tenantId, actor(req), list, viewId);
    }
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

function ymdParam(v: unknown, name: string): string {
    if (typeof v !== 'string' || !YMD.test(v)) {
        throw new BadRequestException({ code: 'invalid_param', message: `${name} tiene que ser una fecha AAAA-MM-DD`, data: { status: 400 } });
    }
    return v;
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
