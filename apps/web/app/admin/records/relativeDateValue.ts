import {
    addDaysYmd,
    dateRangeBoundsText,
    normalizeRelativeDateValue,
    OPEN_RANGE_FROM,
    OPEN_RANGE_TO,
    parseRollingDateRange,
    relativeRangeFor,
    ROLLING_DATE_MAX_DAYS,
    ROLLING_DATE_MIN_DAYS,
    zonedToday,
    type DateClock,
    type DateRange,
    type RollingDateDir,
    type RollingDateRange,
} from '@imagina-base/shared';

import { __ } from '@/lib/i18n';

import { DATE_RANGE_PRESETS, type DateRangePresetId } from './dateRangePresets';

/**
 * v0.1.469 — El valor de un filtro «es en…» de una fecha, puro (lo usa
 * `RelativeDateRangeInput` y lo prueban los tests): qué opción del selector
 * corresponde a un valor guardado y qué valor nace al elegir otra.
 *
 * Tres formas, las mismas que entiende el servidor (`relativeRangeFor`):
 *  - un preset fijo («Este mes», «Próximos 7 días»): el slug;
 *  - cualquier cantidad de días: `{days: N, dir}` (`next` próximos, `last`
 *    últimos, `before` hace más de, `after` dentro de más de);
 *  - «Personalizado…»: un rango fijo `{from, to}` (YYYY-MM-DD).
 */

export type RelativeDateKey = Exclude<DateRangePresetId, 'custom'> | `rolling:${RollingDateDir}` | 'custom';

/** Las cuatro opciones de «cualquier cantidad de días», en el orden del selector. */
export const ROLLING_DATE_OPTIONS: ReadonlyArray<{ dir: RollingDateDir; label: string; prefix: string }> = [
    { dir: 'next', label: __('Próximos N días…'), prefix: __('Próximos') },
    { dir: 'last', label: __('Últimos N días…'), prefix: __('Últimos') },
    { dir: 'before', label: __('Hace más de N días…'), prefix: __('Hace más de') },
    { dir: 'after', label: __('Dentro de más de N días…'), prefix: __('Dentro de más de') },
];

/** Con cuántos días arranca cada opción al elegirla por primera vez. */
export const ROLLING_DEFAULT_DAYS: Record<RollingDateDir, number> = { next: 10, last: 10, before: 30, after: 30 };

/** Los presets fijos del selector (sin el «Personalizado» de los tableros). */
export const FIXED_RELATIVE_PRESETS = DATE_RANGE_PRESETS.filter((p) => p.id !== 'custom');

const DEFAULT_KEY: RelativeDateKey = 'this_month';

/** El `{days, dir}` de un valor, aunque N no sirva (para no perder la opción mientras se corrige). */
function rollingDirOf(value: unknown): RollingDateDir | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const dir = (value as { dir?: unknown }).dir;
    return ROLLING_DATE_OPTIONS.some((o) => o.dir === dir) ? (dir as RollingDateDir) : null;
}

/** Qué opción del selector muestra un valor guardado (uno que no se entiende cae a «Este mes»). */
export function relativeDateKeyOf(value: unknown): RelativeDateKey {
    const v = normalizeRelativeDateValue(value);
    if (v === null) {
        const dir = rollingDirOf(value);
        return dir ? `rolling:${dir}` : DEFAULT_KEY;
    }
    if (typeof v === 'string') return v;
    if ('dir' in v) return `rolling:${v.dir}`;
    return 'custom';
}

/** El N de un valor `{days, dir}` válido, o null. */
export function rollingDaysOf(value: unknown): number | null {
    const r = parseRollingDateRange(value);
    return r === null || r === 'invalid' ? null : r.days;
}

/** El `{from, to}` de un valor «Personalizado», o null. */
export function customRangeOf(value: unknown): DateRange | null {
    const v = normalizeRelativeDateValue(value);
    return v !== null && typeof v === 'object' && 'from' in v ? v : null;
}

/**
 * El valor que nace al elegir otra opción del selector. Conserva lo que se
 * puede: la cantidad de días al pasar de «próximos» a «últimos», y el rango que
 * se estaba viendo al pasar a «Personalizado…» (si tiene principio y fin).
 */
export function valueForRelativeKey(key: RelativeDateKey, current: unknown, clock: DateClock): unknown {
    if (key.startsWith('rolling:')) {
        const dir = key.slice('rolling:'.length) as RollingDateDir;
        const days = rollingDaysOf(current) ?? ROLLING_DEFAULT_DAYS[dir];
        return { days, dir } satisfies RollingDateRange;
    }
    if (key === 'custom') {
        const keep = customRangeOf(current);
        if (keep) return keep;
        const seen = relativeRangeFor(current, 'date', clock);
        if (seen && seen.from > OPEN_RANGE_FROM && seen.to < OPEN_RANGE_TO) return seen;
        const today = zonedToday(clock.timeZone, clock.now);
        return { from: today, to: addDaysYmd(today, 6) };
    }
    return key;
}

/** La cantidad de días tipeada, o null si no es un entero de 1 a 3650. */
export function parseDaysInput(text: string): number | null {
    const t = text.trim();
    if (!/^\d{1,5}$/.test(t)) return null;
    const n = Number(t);
    return n >= ROLLING_DATE_MIN_DAYS && n <= ROLLING_DATE_MAX_DAYS ? n : null;
}

/**
 * Qué abarca HOY el valor, en días y en el formato de la empresa: «Del
 * 26/11/2026 al 05/12/2026», «Antes del 11/10/2026», «Desde el 27/12/2026».
 * Siempre en días (también para un campo fecha y hora: los días completos).
 */
export function relativeDatePreview(value: unknown, clock: DateClock, formatDate: (ymd: string) => string): string | null {
    const range = relativeRangeFor(value, 'date', clock);
    if (range === null) return null;
    const text = dateRangeBoundsText(range, formatDate);
    return text.charAt(0).toUpperCase() + text.slice(1);
}
