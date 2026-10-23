import {
    addDaysYmd,
    calendarDateValue,
    calendarEventSpan,
    calendarInstantValue,
    zonedDayAndMinute,
    zonedInstant,
    type CalendarEventSpan,
    type CalendarMode,
    type CalendarSettings,
    type CalendarSource,
} from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * B4 — Calendario completo: lógica PURA de la vista (fechas del calendario,
 * eventos, acomodo en el mes y en la grilla de horas, y los valores que se
 * escriben al arrastrar, estirar o crear). Todo en el reloj de la EMPRESA:
 * los días son `YYYY-MM-DD` de calendario (nunca un `Date` local del
 * navegador) y las horas se pasan a instantes con `zonedInstant`.
 */

// ── Fechas de calendario (YYYY-MM-DD, sin zona) ─────────────────────────

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Día de la semana de un YYYY-MM-DD (0 = domingo … 6 = sábado). */
export function weekdayOf(ymd: string): number {
    const m = YMD.exec(ymd);
    if (!m) return 0;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/** Días entre dos fechas (b − a). */
export function daysBetween(a: string, b: string): number {
    const pa = YMD.exec(a);
    const pb = YMD.exec(b);
    if (!pa || !pb) return 0;
    const ta = Date.UTC(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
    const tb = Date.UTC(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
    return Math.round((tb - ta) / 86_400_000);
}

/** El primer día de la semana que contiene `ymd`. */
export function startOfWeek(ymd: string, weekStart: 0 | 1 | 6): string {
    const back = (weekdayOf(ymd) - weekStart + 7) % 7;
    return addDaysYmd(ymd, -back);
}

/** El día 1 del mes de `ymd`. */
export function startOfMonth(ymd: string): string {
    return `${ymd.slice(0, 7)}-01`;
}

/** El día 1 del mes `n` meses después (o antes) del de `ymd`. */
export function addMonths(ymd: string, n: number): string {
    const y = Number(ymd.slice(0, 4));
    const m = Number(ymd.slice(5, 7)) - 1 + n;
    const d = new Date(Date.UTC(y, m, 1));
    return d.toISOString().slice(0, 10);
}

function daysInMonth(ymd: string): number {
    const y = Number(ymd.slice(0, 4));
    const m = Number(ymd.slice(5, 7));
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isWeekend(ymd: string): boolean {
    const d = weekdayOf(ymd);
    return d === 0 || d === 6;
}

/**
 * Las semanas de la grilla del mes de `cursor` (5 o 6 filas de 7 días, con
 * los días de los meses vecinos que completan la primera y la última).
 */
export function monthWeeks(cursor: string, weekStart: 0 | 1 | 6): string[][] {
    const first = startOfMonth(cursor);
    const gridStart = startOfWeek(first, weekStart);
    const lead = daysBetween(gridStart, first);
    const total = Math.ceil((lead + daysInMonth(first)) / 7) * 7;
    const weeks: string[][] = [];
    for (let i = 0; i < total; i += 7) {
        weeks.push(Array.from({ length: 7 }, (_, k) => addDaysYmd(gridStart, i + k)));
    }
    return weeks;
}

/** Los días de la semana de `cursor`. */
export function weekDays(cursor: string, weekStart: 0 | 1 | 6): string[] {
    const start = startOfWeek(cursor, weekStart);
    return Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i));
}

/** Días que abarca una página de la agenda. */
export const AGENDA_PAGE_DAYS = 30;

/**
 * El rango que se le pide al servidor: el mes con los días de los meses
 * vecinos que muestra la grilla, la semana entera (aunque se oculten los
 * fines de semana), el día, o la primera página de la agenda.
 */
export function rangeFor(mode: CalendarMode, cursor: string, weekStart: 0 | 1 | 6): { from: string; to: string } {
    if (mode === 'month') {
        const weeks = monthWeeks(cursor, weekStart);
        return { from: weeks[0]![0]!, to: weeks[weeks.length - 1]![6]! };
    }
    if (mode === 'week') {
        const days = weekDays(cursor, weekStart);
        return { from: days[0]!, to: days[6]! };
    }
    if (mode === 'day') return { from: cursor, to: cursor };
    return { from: cursor, to: addDaysYmd(cursor, AGENDA_PAGE_DAYS - 1) };
}

/** El cursor del período anterior (−1) o siguiente (+1). */
export function shiftCursor(mode: CalendarMode, cursor: string, dir: -1 | 1): string {
    if (mode === 'month') return addMonths(cursor, dir);
    if (mode === 'week') return addDaysYmd(cursor, 7 * dir);
    if (mode === 'day') return addDaysYmd(cursor, dir);
    return addDaysYmd(cursor, AGENDA_PAGE_DAYS * dir);
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const dayNum = (ymd: string): number => Number(ymd.slice(8, 10));
const monthIdx = (ymd: string): number => Number(ymd.slice(5, 7)) - 1;
const yearOf = (ymd: string): number => Number(ymd.slice(0, 4));

export function weekdayName(ymd: string): string {
    return WEEKDAYS[weekdayOf(ymd)]!;
}
export function weekdayShort(ymd: string): string {
    return WEEKDAYS_SHORT[weekdayOf(ymd)]!;
}
export function weekdayShortByIndex(i: number): string {
    return WEEKDAYS_SHORT[((i % 7) + 7) % 7]!;
}

/** «12 oct» (o «12 oct 2027» si no es el año de `refYear`). */
export function shortDate(ymd: string, refYear?: number): string {
    const base = `${dayNum(ymd)} ${MONTHS_SHORT[monthIdx(ymd)]}`;
    return refYear !== undefined && refYear !== yearOf(ymd) ? `${base} ${yearOf(ymd)}` : base;
}

/** «Lunes 12 de octubre» (+ año si no es el de `refYear`). */
export function longDate(ymd: string, refYear?: number): string {
    const base = `${cap(weekdayName(ymd))} ${dayNum(ymd)} de ${MONTHS[monthIdx(ymd)]}`;
    return refYear !== undefined && refYear !== yearOf(ymd) ? `${base} de ${yearOf(ymd)}` : base;
}

/** El título de la barra según la vista. */
export function titleFor(mode: CalendarMode, cursor: string, weekStart: 0 | 1 | 6, today: string): string {
    const refYear = yearOf(today);
    if (mode === 'month') return `${cap(MONTHS[monthIdx(cursor)]!)} de ${yearOf(cursor)}`;
    if (mode === 'day') return longDate(cursor, refYear);
    const { from, to } = rangeFor(mode, cursor, weekStart);
    if (mode === 'agenda') return cursor === today ? __('Desde hoy') : sprintf(__('Desde el %s'), shortDate(cursor, refYear));
    if (monthIdx(from) === monthIdx(to) && yearOf(from) === yearOf(to)) {
        return `${dayNum(from)} – ${dayNum(to)} de ${MONTHS[monthIdx(to)]} de ${yearOf(to)}`;
    }
    if (yearOf(from) === yearOf(to)) return `${shortDate(from)} – ${shortDate(to)} de ${yearOf(to)}`;
    return `${shortDate(from, 0)} – ${shortDate(to, 0)}`;
}

/** «14:30» o «2:30 p. m.» según el reloj de la empresa. */
export function clockLabel(minute: number, h12: boolean): string {
    const m = ((Math.round(minute) % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, '0');
    if (!h12) return `${String(h).padStart(2, '0')}:${mm}`;
    const suffix = h < 12 ? 'a. m.' : 'p. m.';
    return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${suffix}`;
}

/** Redondea a la grilla de `step` minutos (15 por defecto). */
export function snapMinutes(minute: number, step = 15): number {
    return Math.round(minute / step) * step;
}

// ── Eventos ─────────────────────────────────────────────────────────────

export interface CalendarEvent {
    /** `<fuente>:<registro>`: un registro con dos fuentes es dos eventos. */
    key: string;
    record: RecordEntity;
    source: CalendarSource;
    span: CalendarEventSpan;
    title: string;
    /** Color CSS (hex o `hsl(var(--…))`). */
    color: string;
}

export interface BuildEventsOpts {
    sources: readonly CalendarSource[];
    fieldsById: ReadonlyMap<number, FieldEntity>;
    timeZone: string;
    defaultDuration: number;
    titleOf: (record: RecordEntity) => string;
    colorOf: (record: RecordEntity, source: CalendarSource) => string;
}

/**
 * Los eventos de los registros cargados, uno por (fuente prendida, registro)
 * con fecha. Una fuente cuyo campo de inicio no está (borrado u oculto) no
 * da eventos.
 */
export function buildEvents(records: readonly RecordEntity[], opts: BuildEventsOpts): CalendarEvent[] {
    const out: CalendarEvent[] = [];
    for (const source of opts.sources) {
        if (!source.enabled) continue;
        const startField = opts.fieldsById.get(source.startFieldId);
        if (!startField || (startField.type !== 'date' && startField.type !== 'datetime')) continue;
        const endField = source.endFieldId !== null ? opts.fieldsById.get(source.endFieldId) : undefined;
        const durField = source.durationFieldId !== null ? opts.fieldsById.get(source.durationFieldId) : undefined;
        for (const record of records) {
            const span = calendarEventSpan({
                startType: startField.type,
                start: record.fields[startField.slug],
                end: endField && endField.type === startField.type ? record.fields[endField.slug] : undefined,
                duration: !endField && durField?.type === 'duration' ? record.fields[durField.slug] : undefined,
                timeZone: opts.timeZone,
                defaultDuration: opts.defaultDuration,
            });
            if (!span) continue;
            out.push({
                key: `${source.id}:${record.id}`,
                record,
                source,
                span,
                title: opts.titleOf(record),
                color: opts.colorOf(record, source),
            });
        }
    }
    return out;
}

export function overlapsDay(e: CalendarEvent, day: string): boolean {
    return e.span.startDay <= day && e.span.endDay >= day;
}

/** Orden dentro de un día: lo de varios días y «todo el día» primero, después por hora. */
export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
    const multiA = a.span.endDay > a.span.startDay ? 1 : 0;
    const multiB = b.span.endDay > b.span.startDay ? 1 : 0;
    if (multiA !== multiB) return multiB - multiA;
    if (a.span.startDay !== b.span.startDay) return a.span.startDay < b.span.startDay ? -1 : 1;
    const stripA = a.span.inStrip ? 1 : 0;
    const stripB = b.span.inStrip ? 1 : 0;
    if (stripA !== stripB) return stripB - stripA;
    if (a.span.startMinute !== b.span.startMinute) return a.span.startMinute - b.span.startMinute;
    if (a.title !== b.title) return a.title.localeCompare(b.title, 'es');
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Los eventos de un día, en orden. */
export function eventsOfDay(events: readonly CalendarEvent[], day: string): CalendarEvent[] {
    return events.filter((e) => overlapsDay(e, day)).sort(compareEvents);
}

/**
 * Cuántos eventos de cada día NO llegaron del servidor (el «+N más» que no
 * está cargado): lo que el servidor contó para ese día menos los eventos
 * cargados que lo ocupan. Como los dos reparten por día con la misma regla
 * (`calendarEventSpan`), nunca es negativo salvo un dato que cambió en el
 * medio (se acota a 0).
 */
export function unloadedByDay(events: readonly CalendarEvent[], days: Record<string, { n: number }> | undefined, list: readonly string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const d of list) {
        const n = days?.[d]?.n ?? 0;
        if (n === 0) continue;
        const loaded = events.reduce((acc, e) => acc + (overlapsDay(e, d) ? 1 : 0), 0);
        if (n > loaded) out.set(d, n - loaded);
    }
    return out;
}

// ── Mes: barras por semana ──────────────────────────────────────────────

export interface MonthBar {
    event: CalendarEvent;
    /** Columnas (índices de `days`) que ocupa en esta semana. */
    startCol: number;
    endCol: number;
    lane: number;
    /** Sigue antes / después de esta semana (sin esquina redonda de ese lado). */
    continuesBefore: boolean;
    continuesAfter: boolean;
}

/**
 * Acomoda los eventos de UNA semana en carriles: un evento de varios días es
 * una barra que cruza sus columnas, uno de un día ocupa su columna. Gana el
 * primer carril libre; lo que no entra en `maxLanes` se cuenta por día como
 * «+N más». `days` son las columnas visibles (sin fines de semana si están
 * ocultos).
 */
export function layoutWeek(
    events: readonly CalendarEvent[],
    days: readonly string[],
    maxLanes: number,
): { bars: MonthBar[]; hiddenByCol: number[] } {
    const hiddenByCol = days.map(() => 0);
    if (days.length === 0) return { bars: [], hiddenByCol };
    const items: Array<{ e: CalendarEvent; s: number; t: number }> = [];
    for (const e of events) {
        if (e.span.endDay < days[0]! || e.span.startDay > days[days.length - 1]!) continue;
        let s = -1;
        let t = -1;
        days.forEach((d, i) => {
            if (overlapsDay(e, d)) {
                if (s === -1) s = i;
                t = i;
            }
        });
        if (s === -1) continue; // cae sólo en días ocultos (fines de semana)
        items.push({ e, s, t });
    }
    items.sort((a, b) => a.s - b.s || b.t - b.s - (a.t - a.s) || compareEvents(a.e, b.e));
    const lanes: boolean[][] = [];
    const bars: MonthBar[] = [];
    for (const it of items) {
        let lane = 0;
        for (; lane < lanes.length; lane++) {
            let free = true;
            for (let c = it.s; c <= it.t; c++) if (lanes[lane]![c]) free = false;
            if (free) break;
        }
        if (lane >= maxLanes) {
            for (let c = it.s; c <= it.t; c++) hiddenByCol[c] = hiddenByCol[c]! + 1;
            continue;
        }
        if (!lanes[lane]) lanes[lane] = days.map(() => false);
        for (let c = it.s; c <= it.t; c++) lanes[lane]![c] = true;
        bars.push({
            event: it.e,
            startCol: it.s,
            endCol: it.t,
            lane,
            continuesBefore: it.e.span.startDay < days[it.s]!,
            continuesAfter: it.e.span.endDay > days[it.t]!,
        });
    }
    return { bars, hiddenByCol };
}

// ── Semana y día: grilla de horas ───────────────────────────────────────

export interface TimeBlock {
    event: CalendarEvent;
    /** Minutos desde el inicio de la ventana visible. */
    top: number;
    height: number;
    /** Columna dentro de su grupo de eventos que se pisan, y cuántas hay. */
    col: number;
    cols: number;
    /** El evento empieza antes de este día / de la ventana, o termina después. */
    cutTop: boolean;
    cutBottom: boolean;
}

/** Duración mínima dibujada (un evento de 5 minutos tiene que poder tocarse). */
export const MIN_BLOCK_MINUTES = 20;

/**
 * Los eventos CON HORA de un día (no los de la franja «Todo el día"),
 * recortados a la ventana visible y repartidos en columnas cuando se pisan.
 * Lo que queda entero antes o después de la ventana se devuelve aparte
 * («2 antes de las 7:00»).
 */
export function layoutDay(
    events: readonly CalendarEvent[],
    day: string,
    windowStart: number,
    windowEnd: number,
): { blocks: TimeBlock[]; before: CalendarEvent[]; after: CalendarEvent[] } {
    const segs: Array<{ e: CalendarEvent; s: number; t: number; cutTop: boolean; cutBottom: boolean }> = [];
    const before: CalendarEvent[] = [];
    const after: CalendarEvent[] = [];
    for (const e of events) {
        if (e.span.inStrip || !overlapsDay(e, day)) continue;
        const s = e.span.startDay === day ? e.span.startMinute : 0;
        const t = e.span.endDay === day ? e.span.endMinute : 1440;
        if (t <= windowStart) {
            before.push(e);
            continue;
        }
        if (s >= windowEnd) {
            after.push(e);
            continue;
        }
        segs.push({ e, s: Math.max(s, windowStart), t: Math.min(t, windowEnd), cutTop: s < windowStart || e.span.startDay < day, cutBottom: t > windowEnd || e.span.endDay > day });
    }
    segs.sort((a, b) => a.s - b.s || b.t - a.t || compareEvents(a.e, b.e));
    const blocks: TimeBlock[] = [];
    // Grupos de eventos que se pisan: cada uno con sus columnas.
    let group: Array<{ seg: (typeof segs)[number]; col: number }> = [];
    let groupEnd = -1;
    let colEnds: number[] = [];
    const flush = (): void => {
        const cols = colEnds.length;
        for (const g of group) {
            const visibleEnd = Math.max(g.seg.t, Math.min(windowEnd, g.seg.s + MIN_BLOCK_MINUTES));
            blocks.push({
                event: g.seg.e,
                top: g.seg.s - windowStart,
                height: visibleEnd - g.seg.s,
                col: g.col,
                cols,
                cutTop: g.seg.cutTop,
                cutBottom: g.seg.cutBottom,
            });
        }
        group = [];
        colEnds = [];
        groupEnd = -1;
    };
    for (const seg of segs) {
        const drawnEnd = Math.max(seg.t, seg.s + MIN_BLOCK_MINUTES);
        if (group.length > 0 && seg.s >= groupEnd) flush();
        let col = colEnds.findIndex((end) => end <= seg.s);
        if (col === -1) {
            col = colEnds.length;
            colEnds.push(drawnEnd);
        } else {
            colEnds[col] = drawnEnd;
        }
        group.push({ seg, col });
        groupEnd = Math.max(groupEnd, drawnEnd);
    }
    if (group.length > 0) flush();
    return { blocks, before, after };
}

// ── Escribir: arrastrar, estirar, crear ─────────────────────────────────

/** Un cambio de un campo de un registro (lo que manda el guardado en lote). */
export interface CalendarCell {
    field: FieldEntity;
    value: unknown;
}

/** El destino de un arrastre: un día y, en la grilla de horas, un minuto. */
export interface DropTarget {
    day: string;
    /** Minuto del día (grilla de horas). Sin él, se conserva la hora. */
    minute?: number;
}

interface SourceFields {
    start: FieldEntity;
    end: FieldEntity | null;
    duration: FieldEntity | null;
}

export function sourceFields(source: CalendarSource, fieldsById: ReadonlyMap<number, FieldEntity>): SourceFields | null {
    const start = fieldsById.get(source.startFieldId);
    if (!start || (start.type !== 'date' && start.type !== 'datetime')) return null;
    const end = source.endFieldId !== null ? fieldsById.get(source.endFieldId) ?? null : null;
    const duration = end === null && source.durationFieldId !== null ? fieldsById.get(source.durationFieldId) ?? null : null;
    return {
        start,
        end: end && end.type === start.type ? end : null,
        duration: duration && duration.type === 'duration' && start.type === 'datetime' ? duration : null,
    };
}

/** ¿Se puede estirar? Sólo si hay dónde guardar el fin: un campo de fin o una duración. */
export function isResizable(event: CalendarEvent, fieldsById: ReadonlyMap<number, FieldEntity>): boolean {
    const f = sourceFields(event.source, fieldsById);
    return f !== null && (f.end !== null || f.duration !== null);
}

/**
 * Los cambios para MOVER un evento a `target`, conservando su duración: en
 * el mes cambia el día y conserva la hora; en la grilla de horas cambia el
 * día y la hora. `null` si no cambia nada.
 */
export function moveCells(event: CalendarEvent, fieldsById: ReadonlyMap<number, FieldEntity>, target: DropTarget, timeZone: string): CalendarCell[] | null {
    const f = sourceFields(event.source, fieldsById);
    if (!f) return null;
    const { span, record } = event;
    if (f.start.type === 'date') {
        const delta = daysBetween(span.startDay, target.day);
        if (delta === 0) return null;
        const cells: CalendarCell[] = [{ field: f.start, value: target.day }];
        const endValue = f.end ? calendarDateValue(record.fields[f.end.slug]) : null;
        if (f.end && endValue !== null && endValue >= span.startDay) cells.push({ field: f.end, value: addDaysYmd(endValue, delta) });
        return cells;
    }
    if (!span.start) return null;
    const minute = target.minute ?? span.startMinute;
    const newStart = zonedInstant(target.day, timeZone, { h: Math.floor(minute / 60), m: minute % 60 });
    const shift = newStart.getTime() - span.start.getTime();
    if (shift === 0) return null;
    const cells: CalendarCell[] = [{ field: f.start, value: newStart.toISOString() }];
    const endValue = f.end ? calendarInstantValue(record.fields[f.end.slug]) : null;
    if (f.end && endValue !== null && endValue.getTime() > span.start.getTime()) {
        cells.push({ field: f.end, value: new Date(endValue.getTime() + shift).toISOString() });
    }
    return cells;
}

/**
 * Los cambios para ESTIRAR el borde final hasta `target`: el campo de fin
 * (fecha, o fecha y hora) o la duración en minutos. El fin nunca queda antes
 * del inicio (mínimo 15 minutos con hora; el mismo día sin hora). Sin hora
 * en el destino (el mes, la franja «Todo el día»), se conserva la hora del
 * fin.
 */
export function resizeCells(event: CalendarEvent, fieldsById: ReadonlyMap<number, FieldEntity>, target: DropTarget, timeZone: string): CalendarCell[] | null {
    const f = sourceFields(event.source, fieldsById);
    if (!f || (f.end === null && f.duration === null)) return null;
    const { span } = event;
    if (f.start.type === 'date') {
        if (!f.end) return null;
        const day = target.day < span.startDay ? span.startDay : target.day;
        if (span.endFromField && day === span.endDay) return null;
        return [{ field: f.end, value: day }];
    }
    if (!span.start) return null;
    // Sin hora en el destino (el mes, la franja «Todo el día»): el fin conserva su hora.
    const endMinute: number = target.minute ?? Math.min(1440, span.endMinute);
    const end =
        endMinute >= 1440
            ? zonedInstant(addDaysYmd(target.day, 1), timeZone)
            : zonedInstant(target.day, timeZone, { h: Math.floor(endMinute / 60), m: endMinute % 60 });
    const min = span.start.getTime() + 15 * 60_000;
    const endAt = Math.max(end.getTime(), min);
    if (span.end && span.endFromField && endAt === span.end.getTime()) return null;
    if (f.end) return [{ field: f.end, value: new Date(endAt).toISOString() }];
    return [{ field: f.duration!, value: Math.round((endAt - span.start.getTime()) / 60_000) }];
}

/**
 * Lo que se pre-carga en el alta al hacer clic (o arrastrar) en un hueco:
 * el inicio y, si la fuente tiene dónde, el fin o la duración. `endMinute`
 * sólo en la grilla de horas (arrastrar para crear). Por slug: así lo
 * espera el formulario de alta.
 */
export function createPrefill(
    source: CalendarSource,
    fieldsById: ReadonlyMap<number, FieldEntity>,
    slot: { day: string; endDay?: string; minute?: number; endMinute?: number },
    timeZone: string,
    defaultDuration: number,
): Record<string, unknown> {
    const f = sourceFields(source, fieldsById);
    if (!f) return {};
    if (f.start.type === 'date') {
        const out: Record<string, unknown> = { [f.start.slug]: slot.day };
        if (f.end && slot.endDay && slot.endDay > slot.day) out[f.end.slug] = slot.endDay;
        return out;
    }
    const startMinute = slot.minute ?? 9 * 60;
    const start = zonedInstant(slot.day, timeZone, { h: Math.floor(startMinute / 60), m: startMinute % 60 });
    const out: Record<string, unknown> = { [f.start.slug]: start.toISOString() };
    const fallback = defaultDuration > 0 ? defaultDuration : 60;
    const endMinute = slot.endMinute !== undefined && slot.endMinute > startMinute ? slot.endMinute : startMinute + fallback;
    const minutes = endMinute - startMinute;
    if (f.end) {
        out[f.end.slug] = new Date(start.getTime() + minutes * 60_000).toISOString();
    } else if (f.duration) {
        out[f.duration.slug] = minutes;
    }
    return out;
}

/**
 * Dónde empieza un evento si se suelta en la grilla de horas: el día bajo el
 * puntero y la hora corrida lo mismo que el puntero desde donde se lo agarró,
 * en la grilla de 15 minutos. Agarrar un bloque cortado (empezó el día
 * anterior) o correrlo más allá de la medianoche pasa de día.
 */
export function moveTargetInGrid(
    span: Pick<CalendarEventSpan, 'startDay' | 'startMinute'>,
    origin: { day: string; minute: number },
    target: { day: string; minute: number },
): { day: string; minute: number } {
    const startRel = span.startMinute - daysBetween(span.startDay, origin.day) * 1440;
    let minute = snapMinutes(startRel + (target.minute - origin.minute));
    let day = target.day;
    const extra = Math.floor(minute / 1440);
    if (extra !== 0) {
        day = addDaysYmd(day, extra);
        minute -= extra * 1440;
    }
    return { day, minute };
}

/** Lo que muestra y edita «Mover a…» (en el reloj de la empresa). */
export interface MoveForm {
    startDay: string;
    /** HH:MM (sólo con hora). */
    startTime: string;
    /** Con campo de fin: el día y la hora del fin. */
    endDay: string;
    endTime: string;
    /** Con campo Duración: minutos. */
    duration: string;
}

const hhmm = (minute: number): string => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** El formulario de «Mover a…» con los valores actuales del evento. */
export function moveFormFor(event: CalendarEvent, fieldsById: ReadonlyMap<number, FieldEntity>, timeZone: string): MoveForm {
    const f = sourceFields(event.source, fieldsById);
    const { span } = event;
    const form: MoveForm = { startDay: span.startDay, startTime: hhmm(span.startMinute), endDay: '', endTime: '', duration: '' };
    if (f?.end) {
        if (f.start.type === 'date') {
            form.endDay = span.endFromField ? span.endDay : '';
        } else if (span.endFromField && span.end) {
            const e = zonedDayAndMinute(span.end, timeZone);
            form.endDay = e.ymd;
            form.endTime = hhmm(e.minute);
        }
    }
    if (f?.duration) {
        const v = event.record.fields[f.duration.slug];
        form.duration = typeof v === 'number' && v > 0 ? String(v) : '';
    }
    return form;
}

const HHMM = /^(\d{1,2}):(\d{2})$/;

/**
 * Cambiar el INICIO en «Mover a…» corre el fin lo mismo (como al arrastrar):
 * la duración se conserva salvo que la persona cambie el fin a mano.
 */
export function shiftMoveForm(prev: MoveForm, next: Pick<MoveForm, 'startDay' | 'startTime'>, hasTime: boolean, timeZone: string): MoveForm {
    const out: MoveForm = { ...prev, ...next };
    if (prev.endDay === '' || calendarDateValue(next.startDay) === null || calendarDateValue(prev.startDay) === null) return out;
    if (!hasTime) {
        out.endDay = addDaysYmd(prev.endDay, daysBetween(prev.startDay, next.startDay));
        return out;
    }
    const a = HHMM.exec(prev.startTime);
    const b = HHMM.exec(next.startTime);
    const e = HHMM.exec(prev.endTime || '00:00');
    if (!a || !b || !e) return out;
    const before = zonedInstant(prev.startDay, timeZone, { h: Number(a[1]), m: Number(a[2]) }).getTime();
    const after = zonedInstant(next.startDay, timeZone, { h: Number(b[1]), m: Number(b[2]) }).getTime();
    const end = zonedInstant(prev.endDay, timeZone, { h: Number(e[1]), m: Number(e[2]) }).getTime() + (after - before);
    const z = zonedDayAndMinute(new Date(end), timeZone);
    out.endDay = z.ymd;
    out.endTime = hhmm(z.minute);
    return out;
}


/**
 * Los cambios que escribe «Mover a…», o un error legible. Sin hora, la fecha
 * va tal cual; con hora, el instante sale del reloj de la empresa.
 */
export function cellsFromMoveForm(
    event: CalendarEvent,
    fieldsById: ReadonlyMap<number, FieldEntity>,
    form: MoveForm,
    timeZone: string,
): { cells: CalendarCell[] } | { error: string } {
    const f = sourceFields(event.source, fieldsById);
    if (!f) return { error: __('El campo de fecha ya no existe.') };
    if (calendarDateValue(form.startDay) === null) return { error: __('Elige una fecha de inicio válida.') };
    const cells: CalendarCell[] = [];
    if (f.start.type === 'date') {
        cells.push({ field: f.start, value: form.startDay });
        if (f.end) {
            if (form.endDay === '') cells.push({ field: f.end, value: null });
            else if (calendarDateValue(form.endDay) === null || form.endDay < form.startDay) return { error: __('El fin no puede ser anterior al inicio.') };
            else cells.push({ field: f.end, value: form.endDay });
        }
    } else {
        const m = HHMM.exec(form.startTime.trim());
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { error: __('Escribe la hora de inicio como HH:MM.') };
        const start = zonedInstant(form.startDay, timeZone, { h: Number(m[1]), m: Number(m[2]) });
        cells.push({ field: f.start, value: start.toISOString() });
        if (f.end) {
            if (form.endDay === '') {
                cells.push({ field: f.end, value: null });
            } else {
                const e = HHMM.exec(form.endTime.trim() || '00:00');
                if (calendarDateValue(form.endDay) === null || !e) return { error: __('Escribe el fin como fecha y HH:MM.') };
                const end = zonedInstant(form.endDay, timeZone, { h: Number(e[1]), m: Number(e[2]) });
                if (end.getTime() <= start.getTime()) return { error: __('El fin tiene que ser posterior al inicio.') };
                cells.push({ field: f.end, value: end.toISOString() });
            }
        } else if (f.duration) {
            const t = form.duration.trim();
            if (t === '') cells.push({ field: f.duration, value: null });
            else {
                const n = Number(t);
                if (!Number.isInteger(n) || n <= 0) return { error: __('La duración son minutos (un número entero mayor que 0).') };
                cells.push({ field: f.duration, value: n });
            }
        }
    }
    // Sólo lo que cambia.
    const changed = cells.filter((c) => !sameValue(event.record.fields[c.field.slug], c.value, c.field.type));
    return { cells: changed };
}

function sameValue(a: unknown, b: unknown, type: string): boolean {
    if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) return true;
    if (type === 'datetime') {
        const x = calendarInstantValue(a);
        const y = calendarInstantValue(b);
        return x !== null && y !== null && x.getTime() === y.getTime();
    }
    return String(a) === String(b);
}

/** El minuto del día de AHORA en la zona de la empresa (la línea roja). */
export function nowInZone(timeZone: string, now: Date = new Date()): { day: string; minute: number } {
    const p = zonedDayAndMinute(now, timeZone);
    return { day: p.ymd, minute: p.minute };
}

/** Las fuentes que se dibujan (prendidas y con su campo de inicio). */
export function activeSources(settings: CalendarSettings, fieldsById: ReadonlyMap<number, FieldEntity>): CalendarSource[] {
    return settings.sources.filter((s) => s.enabled && sourceFields(s, fieldsById) !== null);
}
