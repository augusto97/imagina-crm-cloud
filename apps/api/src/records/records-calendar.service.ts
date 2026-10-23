import { BadRequestException, Injectable } from '@nestjs/common';
import {
    addDaysYmd,
    CALENDAR_MAX_PER_DAY,
    CALENDAR_MAX_RANGE_DAYS,
    CALENDAR_MAX_SOURCES,
    type FilterGroup,
    type RecordDto,
} from '@imagina-base/shared';
import { RecordsService, type Actor } from './records.service';

/** Tope de filas (día, evento) por respuesta: 42 días × 200 sería demasiado. */
const MAX_ROWS = 4000;

/** B4 — Respuesta del bundle del calendario (ver `RecordsCalendarService.bundle`). */
export interface CalendarBundle {
    meta: {
        from: string;
        to: string;
        /** Zona con la que se calcularon los días (la de la empresa, o la del navegador si no eligió). */
        time_zone: string;
        /** Eventos (fuente, registro) que se solapan con el rango — todos, no sólo los que viajan. */
        total: number;
        /** Se llegó al tope de filas: hay días con eventos que no viajaron. */
        truncated: boolean;
        per_day: number;
        /**
         * Las fuentes pedidas, con `ok: false` y el motivo si no se pudieron
         * usar (campo inexistente, de otro tipo u oculto para quien mira) y
         * cuántos eventos tiene cada una en el rango.
         */
        sources: Array<{ key: string; start_field_id: number; end_field_id: number | null; duration_field_id: number | null; ok: boolean; reason?: string; count: number }>;
    };
    /**
     * Por día del rango con eventos: cuántos lo ocupan (`n`) y cuántos de esos
     * NO viajaron (`more`, el «+N más» que no está en `data`).
     */
    days: Record<string, { n: number; more: number }>;
    /**
     * Los registros de los eventos que viajan, con `fields` por slug. Se llama
     * `records` (no `data`) a propósito: el adaptador del front desenvuelve
     * cualquier `{data}` de nivel superior y se perdían `meta` y `days`.
     */
    records: Array<Record<string, unknown>>;
}

export interface CalendarBundleOpts {
    from: string;
    to: string;
    sources: Array<{ key: string; startFieldId: number; endFieldId: number | null; durationFieldId?: number | null }>;
    filterTree?: FilterGroup;
    search?: string;
    perDay: number;
    dayLimits: Record<string, number>;
    clientTimeZone?: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * B4 — Calendario completo. El rango visible (mes con su relleno, semana, día o
 * una página de la agenda) en UNA request: los eventos de todas las fuentes de
 * fecha que se solapan con el rango, con un tope por día y el conteo exacto de
 * cada día — un día con muchos eventos manda los primeros y dice cuántos más
 * hay, en vez de cortar el mes en 200 registros sin avisar.
 */
@Injectable()
export class RecordsCalendarService {
    constructor(private readonly records: RecordsService) {}

    async bundle(tenantId: number, actor: Actor, listKey: string, opts: CalendarBundleOpts): Promise<CalendarBundle> {
        assertRange(opts.from, opts.to);
        if (opts.sources.length === 0 || opts.sources.length > CALENDAR_MAX_SOURCES) {
            throw badRequest('invalid_calendar_sources', `El calendario necesita entre 1 y ${CALENDAR_MAX_SOURCES} fuentes de fecha`);
        }
        const perDay = Math.max(1, Math.min(CALENDAR_MAX_PER_DAY, Math.floor(opts.perDay)));
        const dayLimits: Record<string, number> = {};
        for (const [day, n] of Object.entries(opts.dayLimits)) {
            if (YMD.test(day) && Number.isInteger(n) && n > perDay) dayLimits[day] = Math.min(CALENDAR_MAX_PER_DAY * 2, n);
        }
        const res = await this.records.listCalendarRange(tenantId, actor, listKey, {
            sources: opts.sources,
            from: opts.from,
            to: opts.to,
            clientTimeZone: opts.clientTimeZone,
            perDay,
            dayLimits,
            maxRows: MAX_ROWS,
            filter_tree: opts.filterTree,
            search: opts.search,
        });
        const days: CalendarBundle['days'] = {};
        for (const p of res.picks) {
            const d = days[p.day] ?? { n: p.n, more: p.n };
            d.more -= 1;
            days[p.day] = d;
        }
        const toSlug = new Map(res.fields.map((f) => [`f${f.id}`, f.slug]));
        return {
            meta: {
                from: opts.from,
                to: opts.to,
                time_zone: res.timeZone,
                total: res.total,
                truncated: res.picks.length >= MAX_ROWS,
                per_day: perDay,
                sources: res.sources.map((x) => ({ ...x, count: res.perSource[x.key] ?? 0 })),
            },
            days,
            records: res.rows.map((r) => toCalendarRow(r, toSlug)),
        };
    }
}

function assertRange(from: string, to: string): void {
    if (!YMD.test(from) || !YMD.test(to) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
        throw badRequest('invalid_range', 'from y to tienen que ser fechas AAAA-MM-DD');
    }
    if (to < from) throw badRequest('invalid_range', 'to no puede ser anterior a from');
    if (addDaysYmd(from, CALENDAR_MAX_RANGE_DAYS - 1) < to) {
        throw badRequest('invalid_range', `El rango del calendario abarca como máximo ${CALENDAR_MAX_RANGE_DAYS} días`);
    }
}

function badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}

/** Lo mismo que sale en el listado plano, con `fields` por slug (como el kanban). */
function toCalendarRow(r: RecordDto, toSlug: Map<string, string>): Record<string, unknown> {
    const mapKeys = (data: Record<string, unknown>): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data)) out[toSlug.get(k) ?? k] = v;
        return out;
    };
    return {
        id: r.id,
        fields: mapKeys(r.data as Record<string, unknown>),
        relations: mapKeys((r.relations ?? {}) as Record<string, unknown>),
        parent_id: r.parent_id ?? null,
        subtask_count: r.subtask_count ?? 0,
        has_description: r.has_description ?? false,
        created_by: r.created_by,
        created_at: r.created_at.replace(/Z$/, ''),
        updated_at: r.updated_at.replace(/Z$/, ''),
    };
}
