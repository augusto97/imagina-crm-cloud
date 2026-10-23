import type { FieldType } from './field';
import { zonedDayAndMinute } from './timezone';
import {
    CALENDAR_COLOR_BY,
    CALENDAR_MAX_SOURCES,
    CALENDAR_MODES,
    VIEW_ROW_COLORS,
    type CalendarColorBy,
    type CalendarMode,
    type ViewRowColor,
} from './view';

/**
 * B4 — Calendario completo: lógica PURA que comparten la vista (front), el
 * bundle del servidor y el asistente. Leer la config de la vista sin
 * romperse y volver a escribirla tocando sólo las claves `calendar_*`.
 */

/** Id de la fuente principal (`date_field_id` + `calendar_end_field_id`). */
export const CALENDAR_MAIN_SOURCE = 'main';
/** Tipos de campo que pueden ser inicio o fin de un evento. */
export const CALENDAR_DATE_TYPES: readonly FieldType[] = ['date', 'datetime'];
/** Días que puede abarcar un pedido de rango (el mes con relleno son 42). */
export const CALENDAR_MAX_RANGE_DAYS = 100;
/** Eventos por día que viajan como máximo (el resto se cuenta: «+N más»). */
export const CALENDAR_MAX_PER_DAY = 200;
/** Colores de las fuentes cuando no eligieron uno (en orden). */
export const CALENDAR_SOURCE_PALETTE: readonly ViewRowColor[] = ['blue', 'violet', 'green', 'orange', 'pink', 'teal'];
/** Duración de un evento con hora y sin fin, si la vista no dice otra cosa. */
export const CALENDAR_DEFAULT_DURATION = 60;

/** Una fuente de fecha ya normalizada (la principal incluida). */
export interface CalendarSource {
    id: string;
    startFieldId: number;
    /** Fin (mismo tipo que el inicio). Con fin, el evento ocupa varios días o tiene duración. */
    endFieldId: number | null;
    /**
     * Sin fin y con inicio de fecha y hora: un campo Duración (minutos). La
     * duración se dibuja y, al estirar el evento, se reescribe.
     */
    durationFieldId: number | null;
    label: string | null;
    color: ViewRowColor;
    /** `false` = apagada desde la barra del calendario (no se pide ni se dibuja). */
    enabled: boolean;
}

/** La config del calendario normalizada (lo que lee la vista). */
export interface CalendarSettings {
    /** La principal primero. Vacío si la vista no tiene `date_field_id`. */
    sources: CalendarSource[];
    colorBy: CalendarColorBy;
    colorFieldId: number | null;
    defaultMode: CalendarMode;
    weekStart: 0 | 1 | 6;
    /** Horario visible de semana y día: [dayStartHour, dayEndHour). */
    dayStartHour: number;
    dayEndHour: number;
    showWeekends: boolean;
    /** Minutos de un evento con hora y sin fin (0 = todo el día). */
    defaultDuration: number;
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
    sources: [],
    colorBy: 'auto',
    colorFieldId: null,
    defaultMode: 'month',
    weekStart: 1,
    dayStartHour: 7,
    dayEndHour: 21,
    showWeekends: true,
    defaultDuration: CALENDAR_DEFAULT_DURATION,
};

const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
const color = (v: unknown): ViewRowColor | null => ((VIEW_ROW_COLORS as readonly unknown[]).includes(v) ? (v as ViewRowColor) : null);
const label = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 80) : null);

/**
 * Lee la config de una vista calendario SIN romperse: lo que no tiene la
 * forma esperada se descarta (una fuente sin inicio, un horario invertido) y
 * lo ausente toma el default. Las fuentes repetidas (mismo inicio y fin) se
 * quedan una vez.
 */
export function readCalendarSettings(config: unknown): CalendarSettings {
    const c = config !== null && typeof config === 'object' ? (config as Record<string, unknown>) : {};
    const hidden = new Set(Array.isArray(c.calendar_hidden_sources) ? c.calendar_hidden_sources.filter((x): x is string => typeof x === 'string') : []);
    const sources: CalendarSource[] = [];
    const seen = new Set<string>();
    const push = (id: string, start: number | null, end: number | null, dur: number | null, lbl: string | null, col: ViewRowColor | null): void => {
        if (start === null || sources.length >= CALENDAR_MAX_SOURCES) return;
        const endId = end !== null && end !== start ? end : null;
        const sig = `${start}:${endId ?? ''}`;
        if (seen.has(sig) || sources.some((s) => s.id === id)) return;
        seen.add(sig);
        sources.push({
            id,
            startFieldId: start,
            endFieldId: endId,
            // Un fin explícito gana sobre la duración.
            durationFieldId: endId === null && dur !== null && dur !== start ? dur : null,
            label: lbl,
            color: col ?? CALENDAR_SOURCE_PALETTE[sources.length % CALENDAR_SOURCE_PALETTE.length]!,
            enabled: !hidden.has(id),
        });
    };
    push(
        CALENDAR_MAIN_SOURCE,
        posInt(c.date_field_id),
        posInt(c.calendar_end_field_id),
        posInt(c.calendar_duration_field_id),
        label(c.calendar_main_label),
        color(c.calendar_main_color),
    );
    if (sources.length > 0 && Array.isArray(c.calendar_sources)) {
        for (const raw of c.calendar_sources) {
            if (!raw || typeof raw !== 'object') continue;
            const s = raw as Record<string, unknown>;
            const id = typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) && s.id !== CALENDAR_MAIN_SOURCE ? s.id : null;
            if (id === null) continue;
            push(id, posInt(s.start_field_id), posInt(s.end_field_id), posInt(s.duration_field_id), label(s.label), color(s.color));
        }
    }
    let dayStart = typeof c.calendar_day_start === 'number' && Number.isInteger(c.calendar_day_start) ? c.calendar_day_start : DEFAULT_CALENDAR_SETTINGS.dayStartHour;
    let dayEnd = typeof c.calendar_day_end === 'number' && Number.isInteger(c.calendar_day_end) ? c.calendar_day_end : DEFAULT_CALENDAR_SETTINGS.dayEndHour;
    if (dayStart < 0 || dayStart > 23 || dayEnd < 1 || dayEnd > 24 || dayEnd <= dayStart) {
        dayStart = DEFAULT_CALENDAR_SETTINGS.dayStartHour;
        dayEnd = DEFAULT_CALENDAR_SETTINGS.dayEndHour;
    }
    const duration = c.calendar_default_duration;
    return {
        sources,
        colorBy: (CALENDAR_COLOR_BY as readonly unknown[]).includes(c.calendar_color_by) ? (c.calendar_color_by as CalendarColorBy) : 'auto',
        colorFieldId: posInt(c.calendar_color_field_id),
        defaultMode: (CALENDAR_MODES as readonly unknown[]).includes(c.calendar_default_mode) ? (c.calendar_default_mode as CalendarMode) : 'month',
        weekStart: c.calendar_week_start === 0 || c.calendar_week_start === 6 ? c.calendar_week_start : 1,
        dayStartHour: dayStart,
        dayEndHour: dayEnd,
        showWeekends: c.calendar_show_weekends !== false,
        defaultDuration:
            typeof duration === 'number' && Number.isInteger(duration) && duration >= 0 && duration <= 1440 ? duration : CALENDAR_DEFAULT_DURATION,
    };
}

/**
 * Inverso de `readCalendarSettings`: las claves del calendario, sólo con lo
 * que NO es el default (una vista vieja no gana claves vacías). El llamador
 * las mezcla con el resto de la config (filtros, búsqueda…).
 */
export function calendarSettingsToConfig(s: CalendarSettings): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const [main, ...extra] = s.sources;
    if (main) {
        out.date_field_id = main.startFieldId;
        if (main.endFieldId !== null) out.calendar_end_field_id = main.endFieldId;
        if (main.durationFieldId !== null) out.calendar_duration_field_id = main.durationFieldId;
        if (main.label !== null) out.calendar_main_label = main.label;
        if (main.color !== CALENDAR_SOURCE_PALETTE[0]) out.calendar_main_color = main.color;
    }
    if (extra.length > 0) {
        out.calendar_sources = extra.map((x) => ({
            id: x.id,
            start_field_id: x.startFieldId,
            ...(x.endFieldId !== null ? { end_field_id: x.endFieldId } : {}),
            ...(x.durationFieldId !== null ? { duration_field_id: x.durationFieldId } : {}),
            ...(x.label !== null ? { label: x.label } : {}),
            color: x.color,
        }));
    }
    const hidden = s.sources.filter((x) => !x.enabled).map((x) => x.id);
    if (hidden.length > 0) out.calendar_hidden_sources = hidden;
    if (s.colorBy !== 'auto') out.calendar_color_by = s.colorBy;
    if (s.colorFieldId !== null) out.calendar_color_field_id = s.colorFieldId;
    if (s.defaultMode !== 'month') out.calendar_default_mode = s.defaultMode;
    if (s.weekStart !== 1) out.calendar_week_start = s.weekStart;
    if (s.dayStartHour !== DEFAULT_CALENDAR_SETTINGS.dayStartHour || s.dayEndHour !== DEFAULT_CALENDAR_SETTINGS.dayEndHour) {
        out.calendar_day_start = s.dayStartHour;
        out.calendar_day_end = s.dayEndHour;
    }
    if (!s.showWeekends) out.calendar_show_weekends = false;
    if (s.defaultDuration !== CALENDAR_DEFAULT_DURATION) out.calendar_default_duration = s.defaultDuration;
    return out;
}

/** Todas las claves que escribe `calendarSettingsToConfig` (para limpiar antes de mezclar). */
export const CALENDAR_CONFIG_KEYS = [
    'date_field_id',
    'calendar_end_field_id',
    'calendar_duration_field_id',
    'calendar_main_label',
    'calendar_main_color',
    'calendar_sources',
    'calendar_hidden_sources',
    'calendar_color_by',
    'calendar_color_field_id',
    'calendar_default_mode',
    'calendar_week_start',
    'calendar_day_start',
    'calendar_day_end',
    'calendar_show_weekends',
    'calendar_default_duration',
] as const;

/** La config de la vista con los ajustes del calendario reemplazados (el resto intacto). */
export function withCalendarSettings(config: Record<string, unknown>, s: CalendarSettings): Record<string, unknown> {
    const out: Record<string, unknown> = { ...config };
    for (const k of CALENDAR_CONFIG_KEYS) delete out[k];
    return { ...out, ...calendarSettingsToConfig(s) };
}

/** Un id nuevo para una fuente adicional (no choca con `main` ni con las existentes). */
export function newCalendarSourceId(existing: readonly CalendarSource[]): string {
    for (let i = 2; i < 100; i++) {
        const id = `s${i}`;
        if (!existing.some((s) => s.id === id)) return id;
    }
    return `s${Date.now().toString(36)}`;
}

/**
 * ¿Puede este par (inicio, fin) formar una fuente? El fin, si está, es del
 * MISMO tipo que el inicio: así arrastrar y estirar tienen una sola
 * semántica (días enteros o minutos). Una duración sólo va con un inicio de
 * fecha y hora (un día entero no tiene minutos que sumar).
 */
export function calendarSourceTypesOk(startType: FieldType | undefined, endType: FieldType | null | undefined): boolean {
    if (startType === undefined || !CALENDAR_DATE_TYPES.includes(startType)) return false;
    if (endType === null || endType === undefined) return true;
    if (endType === 'duration') return startType === 'datetime';
    return endType === startType;
}

/**
 * B4 — Dónde cae un evento en el calendario, en el reloj de la EMPRESA. Es
 * la MISMA regla con la que el servidor reparte los eventos por día
 * (`calendar-sql.ts`), así el «+N más» de cada día cuadra con lo que se
 * dibuja:
 *  - fecha sin hora → ese día (nunca se corre: no pasa por ninguna zona);
 *  - fecha y hora → el día del instante en la zona de la empresa;
 *  - el fin (un campo de fin o una duración en minutos) sólo cuenta si es
 *    POSTERIOR al inicio; un fin exacto a las 00:00 no ocupa ese día;
 *  - sin fin, un evento con hora dura `defaultDuration` minutos sin cruzar
 *    al día siguiente (el servidor lo cuenta sólo en su día) o, con 0, es de
 *    «todo el día».
 */
export interface CalendarEventSpan {
    /** El inicio tiene hora (fuente de fecha y hora). */
    hasTime: boolean;
    /**
     * Va en la franja «Todo el día» de semana y día (y como barra en el mes):
     * fechas sin hora, eventos con hora sin fin cuando la duración por
     * defecto es 0, y eventos con hora de 24 h o más.
     */
    inStrip: boolean;
    /** Días (YYYY-MM-DD, inclusivos) en el reloj de la empresa. */
    startDay: string;
    endDay: string;
    /** Minuto del día `startDay` en que empieza (0 sin hora). */
    startMinute: number;
    /** Minuto del día `endDay` en que termina (exclusivo; 1440 = al final del día). */
    endMinute: number;
    /** Instantes (sólo con hora; el fin incluye la duración por defecto). */
    start: Date | null;
    end: Date | null;
    /** El fin salió de un campo (fin o duración), no de la duración por defecto. */
    endFromField: boolean;
}

const YMD_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** El valor de un campo fecha (YYYY-MM-DD válido) o null. */
export function calendarDateValue(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const s = v.trim().slice(0, 10);
    const m = YMD_ONLY.exec(s);
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.toISOString().slice(0, 10) === s ? s : null;
}

/**
 * El valor de un campo fecha y hora como instante. Llega como ISO con zona
 * (`…T03:30:00.000Z`); uno sin zona (`YYYY-MM-DD HH:MM:SS`) se toma como UTC,
 * igual que en el resto de la interfaz.
 */
export function calendarInstantValue(v: unknown): Date | null {
    if (typeof v !== 'string' || v.trim() === '') return null;
    const raw = v.trim().replace(' ', 'T');
    const iso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Minutos de un campo Duración (número > 0) o null. */
function durationMinutes(v: unknown): number | null {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const DAY_MS = 86_400_000;

export function calendarEventSpan(input: {
    startType: 'date' | 'datetime';
    start: unknown;
    /** Valor del campo de fin (mismo tipo que el inicio), si la fuente tiene. */
    end?: unknown;
    /** Valor del campo Duración (minutos), si la fuente tiene. */
    duration?: unknown;
    timeZone: string;
    /** Minutos de un evento con hora y sin fin (0 = todo el día). */
    defaultDuration: number;
}): CalendarEventSpan | null {
    if (input.startType === 'date') {
        const startDay = calendarDateValue(input.start);
        if (startDay === null) return null;
        const endRaw = calendarDateValue(input.end);
        const hasEnd = endRaw !== null && endRaw >= startDay;
        return {
            hasTime: false,
            inStrip: true,
            startDay,
            endDay: hasEnd ? endRaw : startDay,
            startMinute: 0,
            endMinute: 1440,
            start: null,
            end: null,
            endFromField: hasEnd,
        };
    }
    const start = calendarInstantValue(input.start);
    if (start === null) return null;
    const s = zonedDayAndMinute(start, input.timeZone);
    let end: Date | null = null;
    const endInstant = calendarInstantValue(input.end);
    if (endInstant !== null && endInstant.getTime() > start.getTime()) {
        end = endInstant;
    } else {
        const minutes = durationMinutes(input.duration);
        if (minutes !== null) end = new Date(start.getTime() + minutes * 60_000);
    }
    if (end === null) {
        if (input.defaultDuration <= 0) {
            return {
                hasTime: true,
                inStrip: true,
                startDay: s.ymd,
                endDay: s.ymd,
                startMinute: s.minute,
                endMinute: 1440,
                start,
                end: null,
                endFromField: false,
            };
        }
        const endMinute = Math.max(s.minute + 1, Math.min(1440, s.minute + Math.round(input.defaultDuration)));
        return {
            hasTime: true,
            inStrip: false,
            startDay: s.ymd,
            endDay: s.ymd,
            startMinute: s.minute,
            endMinute,
            start,
            end: new Date(start.getTime() + (endMinute - s.minute) * 60_000),
            endFromField: false,
        };
    }
    // El último instante ocupado: un fin a las 00:00 no ocupa ese día.
    const last = zonedDayAndMinute(new Date(end.getTime() - 1), input.timeZone);
    const e = zonedDayAndMinute(end, input.timeZone);
    const endDay = last.ymd < s.ymd ? s.ymd : last.ymd;
    return {
        hasTime: true,
        inStrip: end.getTime() - start.getTime() >= DAY_MS,
        startDay: s.ymd,
        endDay,
        startMinute: s.minute,
        endMinute: e.ymd === endDay && e.minute > 0 ? e.minute : 1440,
        start,
        end,
        endFromField: true,
    };
}
