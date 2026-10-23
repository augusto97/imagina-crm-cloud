import { BadRequestException, Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { filterTreeSchema, type FilterGroup } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RecordsCalendarService, type CalendarBundle } from './records-calendar.service';

/**
 * B4 — Calendario completo: el rango visible en UNA request. Ruta estática:
 * Fastify la resuelve antes que `/records/:id`.
 */
@Controller('lists/:list/records')
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class RecordsCalendarController {
    constructor(private readonly calendar: RecordsCalendarService) {}

    @Get('calendar-bundle')
    @RequireCapability('view_records', 'view_own_records')
    bundle(@Req() req: FastifyRequest, @Param('list') list: string, @Query() q: Record<string, unknown>): Promise<CalendarBundle> {
        const perDay = Number(q.per_day);
        return this.calendar.bundle(req.tenant!.tenantId, { userId: req.authUserId!, role: req.tenant!.role }, list, {
            from: typeof q.from === 'string' ? q.from : '',
            to: typeof q.to === 'string' ? q.to : '',
            sources: parseSources(q.sources),
            filterTree: parseFilter(q.filter_tree),
            search: typeof q.search === 'string' && q.search.trim() !== '' ? q.search : undefined,
            perDay: Number.isInteger(perDay) && perDay > 0 ? perDay : 4,
            dayLimits: parseDayLimits(q.limits),
            clientTimeZone: typeof q.tz === 'string' && q.tz.length <= 64 && /^[A-Za-z][\w+/-]*$/.test(q.tz) ? q.tz : undefined,
        });
    }
}

/**
 * `[{"key":"main","start":9,"end":10}, {"key":"s2","start":4,"dur":5}, …]`
 * (JSON). Las claves son el id de la fuente en la vista; los campos se
 * validan contra la lista en el servicio.
 */
export function parseSources(v: unknown): Array<{ key: string; startFieldId: number; endFieldId: number | null; durationFieldId: number | null }> {
    if (typeof v !== 'string' || v.trim() === '') return [];
    let raw: unknown;
    try {
        raw = JSON.parse(v);
    } catch {
        throw new BadRequestException({ code: 'invalid_calendar_sources', message: 'sources debe ser JSON', data: { status: 400 } });
    }
    if (!Array.isArray(raw)) return [];
    const out: Array<{ key: string; startFieldId: number; endFieldId: number | null; durationFieldId: number | null }> = [];
    for (const s of raw.slice(0, 10)) {
        if (!s || typeof s !== 'object') continue;
        const { key, start, end, dur } = s as { key?: unknown; start?: unknown; end?: unknown; dur?: unknown };
        if (typeof key !== 'string' || !/^[\w-]{1,40}$/.test(key) || out.some((o) => o.key === key)) continue;
        if (typeof start !== 'number' || !Number.isInteger(start) || start <= 0) continue;
        const endId = typeof end === 'number' && Number.isInteger(end) && end > 0 && end !== start ? end : null;
        const durId = endId === null && typeof dur === 'number' && Number.isInteger(dur) && dur > 0 && dur !== start ? dur : null;
        out.push({ key, startFieldId: start, endFieldId: endId, durationFieldId: durId });
    }
    return out;
}

/** `{"2026-10-05": 60}` (JSON): los días con «+N más» desplegado. */
export function parseDayLimits(v: unknown): Record<string, number> {
    if (typeof v !== 'string' || v.trim() === '') return {};
    try {
        const parsed: unknown = JSON.parse(v);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: Record<string, number> = {};
        for (const [k, n] of Object.entries(parsed as Record<string, unknown>).slice(0, 100)) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof n === 'number' && Number.isInteger(n) && n > 0) out[k] = n;
        }
        return out;
    } catch {
        return {};
    }
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
