import { __ } from '@/lib/i18n';

/**
 * Presets de rangos de fecha estilo ClickUp/Notion. Cada uno se
 * traduce a un par de filtros `gte`/`lte` sobre el campo seleccionado.
 *
 * El cálculo se hace en LOCAL del navegador (no UTC), porque el usuario
 * piensa "este mes" en su calendario. El backend acepta ambos formatos
 * para campos `date` (YYYY-MM-DD) y `datetime` (ISO 8601). Para
 * `datetime` el `from` siempre es 00:00:00 y el `to` 23:59:59 del día
 * límite — así "esta semana" abarca el lunes 00:00 al domingo 23:59.
 */
export type DateRangePresetId =
    | 'today'
    | 'yesterday'
    | 'this_week'
    | 'last_week'
    | 'this_month'
    | 'last_month'
    | 'last_7_days'
    | 'last_15_days'
    | 'last_30_days'
    | 'this_year'
    | 'last_year'
    | 'next_7_days'
    | 'next_30_days'
    | 'last_90_days'
    | 'this_quarter'
    | 'last_quarter'
    | 'from_today'
    | 'custom';

export interface DateRangePreset {
    id: DateRangePresetId;
    label: string;
}

export const DATE_RANGE_PRESETS: DateRangePreset[] = [
    { id: 'today', label: __('Hoy') },
    { id: 'yesterday', label: __('Ayer') },
    { id: 'this_week', label: __('Esta semana') },
    { id: 'last_week', label: __('Semana pasada') },
    { id: 'this_month', label: __('Este mes') },
    { id: 'last_month', label: __('Mes pasado') },
    { id: 'last_7_days', label: __('Últimos 7 días') },
    { id: 'last_15_days', label: __('Últimos 15 días') },
    { id: 'last_30_days', label: __('Últimos 30 días') },
    { id: 'last_90_days', label: __('Últimos 90 días') },
    { id: 'next_7_days', label: __('Próximos 7 días') },
    { id: 'next_30_days', label: __('Próximos 30 días') },
    { id: 'from_today', label: __('De hoy en adelante') },
    { id: 'this_quarter', label: __('Este trimestre') },
    { id: 'last_quarter', label: __('Trimestre pasado') },
    { id: 'this_year', label: __('Este año') },
    { id: 'last_year', label: __('Año pasado') },
    { id: 'custom', label: __('Personalizado') },
];

export interface DateRange {
    /** YYYY-MM-DD para `date`; ISO con tiempo 00:00 para `datetime`. */
    from: string;
    /** YYYY-MM-DD para `date`; ISO con tiempo 23:59:59 para `datetime`. */
    to: string;
}

/**
 * Calcula `from`/`to` para un preset relativo a `now` (default = ahora).
 * Devuelve `null` si el preset es `custom` (el usuario debe poner los
 * extremos manualmente).
 */
export function computePresetRange(
    preset: DateRangePresetId,
    fieldType: 'date' | 'datetime',
    now: Date = new Date(),
): DateRange | null {
    if (preset === 'custom') return null;

    const today = startOfDay(now);
    let from = today;
    let to = today;

    switch (preset) {
        case 'today':
            from = today;
            to = today;
            break;
        case 'yesterday':
            from = addDays(today, -1);
            to = addDays(today, -1);
            break;
        case 'this_week': {
            // ISO week: lunes como inicio. JS getDay() devuelve 0=domingo,
            // 1=lunes, …, 6=sábado. Convertimos a 0=lunes…6=domingo.
            const dow = (today.getDay() + 6) % 7;
            from = addDays(today, -dow);
            to = addDays(from, 6);
            break;
        }
        case 'last_week': {
            const dow = (today.getDay() + 6) % 7;
            const startThis = addDays(today, -dow);
            from = addDays(startThis, -7);
            to = addDays(startThis, -1);
            break;
        }
        case 'this_month':
            from = new Date(today.getFullYear(), today.getMonth(), 1);
            to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            break;
        case 'last_month':
            from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            to = new Date(today.getFullYear(), today.getMonth(), 0);
            break;
        case 'last_7_days':
            from = addDays(today, -6); // incluye hoy → 7 días en total
            to = today;
            break;
        case 'last_15_days':
            from = addDays(today, -14);
            to = today;
            break;
        case 'last_30_days':
            from = addDays(today, -29);
            to = today;
            break;
        case 'this_year':
            from = new Date(today.getFullYear(), 0, 1);
            to = new Date(today.getFullYear(), 11, 31);
            break;
        case 'last_year':
            from = new Date(today.getFullYear() - 1, 0, 1);
            to = new Date(today.getFullYear() - 1, 11, 31);
            break;
        case 'next_7_days':
            from = today;
            to = addDays(today, 6);
            break;
        case 'next_30_days':
            from = today;
            to = addDays(today, 29);
            break;
        case 'last_90_days':
            from = addDays(today, -89);
            to = today;
            break;
        case 'this_quarter': {
            const q = Math.floor(today.getMonth() / 3);
            from = new Date(today.getFullYear(), q * 3, 1);
            to = new Date(today.getFullYear(), q * 3 + 3, 0);
            break;
        }
        case 'last_quarter': {
            const q = Math.floor(today.getMonth() / 3) - 1;
            from = new Date(today.getFullYear(), q * 3, 1);
            to = new Date(today.getFullYear(), q * 3 + 3, 0);
            break;
        }
        case 'from_today':
            from = today;
            to = new Date(2999, 11, 31);
            break;
    }

    return {
        from: formatBoundary(from, 'start', fieldType),
        to: formatBoundary(to, 'end', fieldType),
    };
}

function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addDays(d: Date, n: number): Date {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
}

function pad(n: number): string {
    return n.toString().padStart(2, '0');
}

function formatBoundary(
    d: Date,
    edge: 'start' | 'end',
    fieldType: 'date' | 'datetime',
): string {
    const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (fieldType === 'date') return ymd;
    // `datetime-local` input acepta `YYYY-MM-DDTHH:mm` (sin segundos
    // ni zona). El backend lo guarda como UTC, así que para "todo el
    // día" cubrimos con 00:00 → 23:59.
    return edge === 'start' ? `${ymd}T00:00` : `${ymd}T23:59`;
}
