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

// ── «N días» a elección (v0.1.469) ─────────────────────────────────────────

/**
 * v0.1.469 — Los rangos FIJOS («próximos 7 días», «últimos 30») no alcanzan:
 * «vence en los próximos 10 días», «sin contacto hace más de 45 días». El
 * valor de un `between_relative` también puede ser `{days: N, dir}`:
 *  - `next`:   en los próximos N días  → de hoy a hoy+N−1 (= `next_7_days` con N=7);
 *  - `last`:   en los últimos N días   → de hoy−N+1 a hoy (= `last_7_days`);
 *  - `before`: hace más de N días      → antes de hoy−N (hace exactamente N días NO entra);
 *  - `after`:  dentro de más de N días → después de hoy+N.
 * Siempre en el reloj de la EMPRESA y, para fecha y hora, como los instantes
 * de los días completos (igual que los presets). N entero de 1 a 3650.
 */
export const ROLLING_DATE_DIRS = ['next', 'last', 'before', 'after'] as const;
export type RollingDateDir = (typeof ROLLING_DATE_DIRS)[number];
export const ROLLING_DATE_MIN_DAYS = 1;
export const ROLLING_DATE_MAX_DAYS = 3650;

export interface RollingDateRange {
    days: number;
    dir: RollingDateDir;
}

/** Piso y techo de los rangos abiertos («antes de…», «de hoy en adelante»): los mismos de los presets. */
export const OPEN_RANGE_FROM = '1900-01-01';
export const OPEN_RANGE_TO = '2999-12-31';

/**
 * El valor `{days, dir}` de un `between_relative`. `null` si no tiene esa
 * forma (es un preset o un rango fijo); `'invalid'` si la tiene pero N no es
 * un entero de 1 a 3650 o `dir` no es uno de los cuatro. Tolera N como texto
 * de dígitos («10»: lo que puede mandar el asistente) y lo normaliza.
 */
export function parseRollingDateRange(value: unknown): RollingDateRange | null | 'invalid' {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!('days' in value) && !('dir' in value)) return null;
    const rawDir = (value as { dir?: unknown }).dir;
    const dir = typeof rawDir === 'string' ? rawDir.trim() : rawDir;
    if (!(ROLLING_DATE_DIRS as readonly unknown[]).includes(dir)) return 'invalid';
    const raw = (value as { days?: unknown }).days;
    const days = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d{1,5}\s*$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(days) || days < ROLLING_DATE_MIN_DAYS || days > ROLLING_DATE_MAX_DAYS) return 'invalid';
    return { days, dir: dir as RollingDateDir };
}

/** Los días de calendario (YYYY-MM-DD, inclusivos) de un `{days, dir}` contra el «hoy» de la empresa. */
export function rollingDateDays(rolling: RollingDateRange, today: string): DateRange {
    const n = rolling.days;
    switch (rolling.dir) {
        case 'next':
            return { from: today, to: addDaysYmd(today, n - 1) };
        case 'last':
            return { from: addDaysYmd(today, -(n - 1)), to: today };
        case 'before':
            return { from: OPEN_RANGE_FROM, to: addDaysYmd(today, -(n + 1)) };
        case 'after':
            return { from: addDaysYmd(today, n + 1), to: OPEN_RANGE_TO };
    }
}

/** El rango de un `{days, dir}`: días para un campo fecha, instantes de días completos para un fecha-hora. */
export function rollingDateRange(rolling: RollingDateRange, type: string, clock: DateClock): DateRange {
    const days = rollingDateDays(rolling, zonedToday(clock.timeZone, clock.now));
    return type === 'datetime' ? dayRangeInstants(days.from, days.to, clock.timeZone) : days;
}

/**
 * El rango de un `between_relative` (preset «este mes», `{days, dir}` o rango
 * fijo `{from, to}`) en el reloj de la empresa: fechas YYYY-MM-DD para un
 * campo fecha, instantes ISO para un fecha-hora. `null` si el valor no es
 * válido.
 */
export function relativeRangeFor(value: unknown, type: 'date' | 'datetime', clock: DateClock): DateRange | null {
    const custom = parseCustomDateRange(value);
    if (custom === 'invalid') return null;
    if (custom !== null) return type === 'datetime' ? dayRangeInstants(custom.from, custom.to, clock.timeZone) : custom;
    const rolling = parseRollingDateRange(value);
    if (rolling === 'invalid') return null;
    if (rolling !== null) return rollingDateRange(rolling, type, clock);
    const preset = parseDateRangePreset(value);
    return preset === null ? null : presetDateRange(preset, type, clock);
}

/**
 * El valor de un `between_relative` normalizado (el preset tal cual, el rango
 * fijo con los extremos en orden, `{days, dir}` con N como número) o `null`
 * si no sirve. La misma regla en el navegador, el filtro de ítems de los PDF
 * y el asistente.
 */
export function normalizeRelativeDateValue(value: unknown): DateRangePreset | DateRange | RollingDateRange | null {
    const custom = parseCustomDateRange(value);
    if (custom === 'invalid') return null;
    if (custom !== null) return custom;
    const rolling = parseRollingDateRange(value);
    if (rolling === 'invalid') return null;
    if (rolling !== null) return rolling;
    return parseDateRangePreset(value);
}

/**
 * Por qué no sirve el valor de un `between_relative` (texto para la persona o
 * para el modelo), o `null` si sirve.
 */
export function relativeDateValueIssue(value: unknown): string | null {
    if (normalizeRelativeDateValue(value) !== null) return null;
    if (parseRollingDateRange(value) === 'invalid') {
        return `La cantidad de días tiene que ser un número entero de ${ROLLING_DATE_MIN_DAYS} a ${ROLLING_DATE_MAX_DAYS} (y dir: next, last, before o after).`;
    }
    if (parseCustomDateRange(value) === 'invalid') return 'El rango fijo pide dos fechas AAAA-MM-DD ({from, to}).';
    return 'El rango de fechas no es válido: usa un preset (today, this_month, next_7_days…), {days: N, dir: "next" | "last" | "before" | "after"} o {from, to}.';
}

/** Nombre de cada preset, para resúmenes en palabras (espejo de `dateRangePresets.ts` del front). */
export const DATE_RANGE_PRESET_LABELS: Record<DateRangePreset, string> = {
    today: 'Hoy',
    yesterday: 'Ayer',
    this_week: 'Esta semana',
    last_week: 'Semana pasada',
    this_month: 'Este mes',
    last_month: 'Mes pasado',
    last_7_days: 'Últimos 7 días',
    last_15_days: 'Últimos 15 días',
    last_30_days: 'Últimos 30 días',
    this_year: 'Este año',
    last_year: 'Año pasado',
    next_7_days: 'Próximos 7 días',
    next_30_days: 'Próximos 30 días',
    last_90_days: 'Últimos 90 días',
    this_quarter: 'Este trimestre',
    last_quarter: 'Trimestre pasado',
    from_today: 'De hoy en adelante',
    before_today: 'Antes de hoy (vencido)',
};

function daysWord(n: number): string {
    return n === 1 ? '1 día' : `${n} días`;
}

/** «Próximos 10 días», «Hace más de 30 días»… (con mayúscula inicial). */
export function rollingDateLabel(rolling: RollingDateRange): string {
    switch (rolling.dir) {
        case 'next':
            return rolling.days === 1 ? 'Próximo 1 día' : `Próximos ${rolling.days} días`;
        case 'last':
            return rolling.days === 1 ? 'Último 1 día' : `Últimos ${rolling.days} días`;
        case 'before':
            return `Hace más de ${daysWord(rolling.days)}`;
        case 'after':
            return `Dentro de más de ${daysWord(rolling.days)}`;
    }
}

/**
 * El valor de un `between_relative` en palabras («Este mes», «Próximos 10
 * días», «Del 01/11/2026 al 30/11/2026»), o `null` si no es válido.
 * `formatDate` pone una fecha YYYY-MM-DD en el formato de la empresa.
 */
export function relativeDateLabel(value: unknown, formatDate: (ymd: string) => string = (d) => d): string | null {
    const v = normalizeRelativeDateValue(value);
    if (v === null) return null;
    if (typeof v === 'string') return DATE_RANGE_PRESET_LABELS[v];
    if ('dir' in v) return rollingDateLabel(v);
    return v.from === v.to ? `El ${formatDate(v.from)}` : `Del ${formatDate(v.from)} al ${formatDate(v.to)}`;
}

/**
 * Los días de un rango en palabras, para mostrar qué abarca HOY: «del
 * 26/11/2026 al 5/12/2026», «el 26/11/2026», «antes del 11/10/2026» (rango
 * abierto hacia atrás: el día siguiente al último que entra) o «desde el
 * 27/12/2026» (abierto hacia adelante). Recibe días YYYY-MM-DD.
 */
export function dateRangeBoundsText(range: DateRange, formatDate: (ymd: string) => string = (d) => d): string {
    if (range.from <= OPEN_RANGE_FROM) return `antes del ${formatDate(addDaysYmd(range.to, 1))}`;
    if (range.to >= OPEN_RANGE_TO) return `desde el ${formatDate(range.from)}`;
    if (range.from === range.to) return `el ${formatDate(range.from)}`;
    return `del ${formatDate(range.from)} al ${formatDate(range.to)}`;
}

/**
 * Una condición de fecha relativa en palabras, para los resúmenes: «Vence»
 * está en los próximos 10 días, «Último contacto» fue hace más de 45 días,
 * «Entrega» es dentro de más de 30 días, «Fecha» está en «Este mes».
 */
export function relativeDateConditionText(label: string, value: unknown, formatDate: (ymd: string) => string = (d) => d): string {
    const v = normalizeRelativeDateValue(value);
    if (v === null) return `«${label}» está en un rango de fechas que no es válido`;
    if (typeof v === 'string') return `«${label}» está en «${DATE_RANGE_PRESET_LABELS[v]}»`;
    if ('dir' in v) {
        switch (v.dir) {
            case 'next':
                return `«${label}» está en los próximos ${daysWord(v.days)}`;
            case 'last':
                return `«${label}» está en los últimos ${daysWord(v.days)}`;
            case 'before':
                return `«${label}» fue hace más de ${daysWord(v.days)}`;
            case 'after':
                return `«${label}» es dentro de más de ${daysWord(v.days)}`;
        }
    }
    return v.from === v.to ? `«${label}» es el ${formatDate(v.from)}` : `«${label}» está entre el ${formatDate(v.from)} y el ${formatDate(v.to)}`;
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
