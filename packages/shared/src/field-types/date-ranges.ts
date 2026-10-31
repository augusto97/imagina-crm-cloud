import { dateRangePresetSchema, type DateRangePreset } from '../schemas/filter';
import { addDaysYmd, FALLBACK_TIME_ZONE, zonedInstant, zonedToday } from '../schemas/timezone';

/**
 * v0.1.287 — Rangos de fecha de los filtros, PUROS (antes vivían en el
 * QueryBuilder del API). Los usan el SQL de los filtros, el evaluador de
 * condiciones de las automatizaciones y, desde ahora, los colores
 * condicionales de la tabla, que evalúan en el navegador: así «hoy» y «este
 * mes» son el mismo día y el mismo mes en las tres puntas, en el reloj de la
 * EMPRESA (ADR-S33).
 */

/** "Ahora" + la zona de la empresa. */
export interface DateClock {
    now: Date;
    timeZone: string;
}

/** Rango inclusivo: YYYY-MM-DD (fecha) o instantes ISO (fecha y hora). */
export interface DateRange {
    from: string;
    to: string;
}

/**
 * El rango de un preset («este mes», «últimos 7 días»…). Para un campo fecha
 * devuelve días de calendario; para uno de fecha y hora, los instantes que
 * cubren esos días completos en el reloj de la empresa.
 */
export function presetDateRange(preset: DateRangePreset, type: string, clock: DateClock): DateRange {
    // v0.1.263 — "hoy" es el de la EMPRESA (antes, el del servidor: en
    // Colombia, de 7 pm a medianoche "hoy" ya era mañana). La aritmética se
    // hace sobre fechas de calendario puras (YYYY-MM-DD), sin zona.
    const today = zonedToday(clock.timeZone, clock.now);
    const [y, m] = today.split('-').map(Number) as [number, number];
    const ymd = (yy: number, mm: number, dd: number): string => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
    // Semana ISO: lunes como primer día.
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const startOfWeek = addDaysYmd(today, -dow);

    let from: string;
    let to: string;
    switch (preset) {
        case 'today':
            from = today;
            to = today;
            break;
        case 'yesterday':
            from = addDaysYmd(today, -1);
            to = from;
            break;
        case 'this_week':
            from = startOfWeek;
            to = addDaysYmd(startOfWeek, 6);
            break;
        case 'last_week':
            from = addDaysYmd(startOfWeek, -7);
            to = addDaysYmd(startOfWeek, -1);
            break;
        case 'this_month':
            from = ymd(y, m, 1);
            to = ymd(y, m + 1, 0);
            break;
        case 'last_month':
            from = ymd(y, m - 1, 1);
            to = ymd(y, m, 0);
            break;
        case 'last_7_days':
            from = addDaysYmd(today, -6);
            to = today;
            break;
        case 'last_15_days':
            from = addDaysYmd(today, -14);
            to = today;
            break;
        case 'last_30_days':
            from = addDaysYmd(today, -29);
            to = today;
            break;
        case 'this_year':
            from = ymd(y, 1, 1);
            to = ymd(y, 12, 31);
            break;
        case 'last_year':
            from = ymd(y - 1, 1, 1);
            to = ymd(y - 1, 12, 31);
            break;
        // v0.1.286 — hacia adelante, 90 días y trimestres.
        case 'next_7_days':
            from = today;
            to = addDaysYmd(today, 6);
            break;
        case 'next_30_days':
            from = today;
            to = addDaysYmd(today, 29);
            break;
        case 'last_90_days':
            from = addDaysYmd(today, -89);
            to = today;
            break;
        case 'this_quarter': {
            const q = Math.floor((m - 1) / 3);
            from = ymd(y, q * 3 + 1, 1);
            to = ymd(y, q * 3 + 4, 0);
            break;
        }
        case 'last_quarter': {
            const q = Math.floor((m - 1) / 3) - 1;
            from = ymd(y, q * 3 + 1, 1);
            to = ymd(y, q * 3 + 4, 0);
            break;
        }
        case 'from_today':
            // "De hoy en adelante": un tope lejano pero representable (el
            // instante de un datetime tiene que existir).
            from = today;
            to = '2999-12-31';
            break;
        case 'before_today':
            // v0.1.341 — «Antes de hoy» (vencido): desde un piso lejano hasta ayer.
            from = '1900-01-01';
            to = addDaysYmd(today, -1);
            break;
    }

    // Un datetime cubre los días completos en el reloj de la empresa.
    if (type === 'datetime') return dayRangeInstants(from, to, clock.timeZone);
    return { from, to };
}

/** De las 00:00 de `from` a las 23:59:59.999 de `to`, en `tz`, como instantes ISO. */
export function dayRangeInstants(from: string, to: string, tz: string): DateRange {
    const start = zonedInstant(from, tz);
    const end = new Date(zonedInstant(addDaysYmd(to, 1), tz).getTime() - 1);
    return { from: start.toISOString(), to: end.toISOString() };
}

const CUSTOM_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El valor de un `between_relative` cuando es un rango FIJO `{from, to}`
 * (período personalizado). `null` si no es un objeto con esa forma;
 * `'invalid'` si lo es pero las fechas no son YYYY-MM-DD. Los extremos
 * invertidos se corrigen en vez de devolver 0 filas confusas.
 */
export function parseCustomDateRange(value: unknown): DateRange | null | 'invalid' {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const from = (value as { from?: unknown }).from;
    const to = (value as { to?: unknown }).to;
    if (typeof from !== 'string' || typeof to !== 'string') return null;
    if (!CUSTOM_DATE_RE.test(from) || !CUSTOM_DATE_RE.test(to)) return 'invalid';
    return from <= to ? { from, to } : { from: to, to: from };
}

/** El slug del preset de un `between_relative` (`'this_month'` o `{preset}`), o null si no es válido. */
export function parseDateRangePreset(value: unknown): DateRangePreset | null {
    const preset =
        typeof value === 'string'
            ? value
            : value && typeof value === 'object' && 'preset' in value
              ? (value as { preset?: unknown }).preset
              : undefined;
    const parsed = dateRangePresetSchema.safeParse(preset);
    return parsed.success ? parsed.data : null;
}

/**
 * El rango de un `between_relative` (preset «este mes» o rango fijo
 * `{from, to}`) en el reloj de la empresa: fechas YYYY-MM-DD para un campo
 * fecha, instantes ISO para un fecha-hora. `null` si el valor no es válido.
 */
export function relativeRangeFor(value: unknown, type: 'date' | 'datetime', clock: DateClock): DateRange | null {
    const custom = parseCustomDateRange(value);
    if (custom === 'invalid') return null;
    if (custom !== null) return type === 'datetime' ? dayRangeInstants(custom.from, custom.to, clock.timeZone) : custom;
    const preset = parseDateRangePreset(value);
    return preset === null ? null : presetDateRange(preset, type, clock);
}

const DATE_ONLY_RE = /^(\d{4}-\d{2}-\d{2})$/;
const NAIVE_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/**
 * v0.1.286 — Intervalo `[from, to)` (instantes ISO) del valor de un filtro de
 * FECHA Y HORA:
 *  - sólo fecha (`2026-10-21`): el día entero en el reloj de la empresa;
 *  - fecha y hora SIN zona (`2026-10-21T14:30`): ese minuto en el reloj de la
 *    empresa;
 *  - con zona (`…Z`, `…-05:00`): el minuto de ese instante.
 * `null` si el valor no se puede leer.
 */
export function datetimeFilterRange(value: unknown, timeZone: string = FALLBACK_TIME_ZONE): DateRange | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    const day = DATE_ONLY_RE.exec(v);
    if (day) {
        return {
            from: zonedInstant(day[1]!, timeZone).toISOString(),
            to: zonedInstant(addDaysYmd(day[1]!, 1), timeZone).toISOString(),
        };
    }
    let start: Date;
    const naive = NAIVE_DATETIME_RE.exec(v);
    if (naive) {
        start = zonedInstant(naive[1]!, timeZone, { h: Number(naive[2]), m: Number(naive[3]) });
    } else {
        const t = Date.parse(v);
        if (!Number.isFinite(t)) return null;
        start = new Date(Math.floor(t / 60_000) * 60_000);
    }
    if (!Number.isFinite(start.getTime())) return null;
    return { from: start.toISOString(), to: new Date(start.getTime() + 60_000).toISOString() };
}
