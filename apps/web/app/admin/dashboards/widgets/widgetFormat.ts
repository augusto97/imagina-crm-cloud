import { formatDuration, type DurationFormat } from '@imagina-base/shared';

import { asDisplayField } from '@/lib/fieldTypeCatalog';
import { fieldPrecision, formatFieldNumber } from '@/lib/fieldNumberFormat';
import { __, sprintf } from '@/lib/i18n';
import { formatDateStr, formatDateTimeStr, formatNumber, numberFormatLocale } from '@/lib/tenantFormat';
import { rollupDisplayField } from '@/lib/throughFields';
import type { FieldEntity } from '@/types/field';

/**
 * v0.1.286 — Formato de los valores de los widgets SEGÚN EL CAMPO: un KPI que
 * suma una duración decía «90» en vez de «1h 30m», el promedio de un
 * porcentaje «70.00%», una moneda salía sin símbolo ni sus decimales, y un
 * máximo de fecha-hora el texto crudo de Postgres. Funciones puras (testeables)
 * que usan los KPI, el medidor, el delta y los charts.
 */

const COUNT_METRICS = new Set(['count', 'count_unique', 'count_empty', 'count_true', 'count_false']);

/** El campo "de vista" de una métrica: un rollup se formatea como su destino. */
function displayField(field: FieldEntity | undefined): FieldEntity | undefined {
    if (!field) return undefined;
    if (field.type === 'rollup') return rollupDisplayField(field);
    // Fórmulas (A1): como el tipo de su resultado (moneda, porcentaje…).
    if (field.type === 'formula') return asDisplayField(field);
    return field;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;

/**
 * Valor de una métrica para mostrar. `withSymbol`: con una moneda y sin
 * prefijo propio del widget, el símbolo de la moneda del campo.
 */
export function formatMetricValue(
    value: number | string,
    metric: string,
    field?: FieldEntity,
    opts: { withSymbol?: boolean } = {},
): string {
    const f = displayField(field);
    if (typeof value === 'string') {
        // min/max de fecha (el backend manda YYYY-MM-DD o un instante ISO).
        if (ISO_DATE_RE.test(value) && (f?.type === 'date' || f === undefined)) return formatDateStr(value);
        if (ISO_INSTANT_RE.test(value)) return formatDateTimeStr(value);
        return value;
    }
    if (COUNT_METRICS.has(metric) || !f) {
        return Number.isInteger(value) ? formatNumber(value, { maxFrac: 0 }) : formatNumber(value, { maxFrac: 2 });
    }
    switch (f.type) {
        // v0.1.291 — el tiempo registrado son minutos, como una duración.
        case 'time_tracked':
        case 'duration': {
            const fmt = (f.config as { format?: DurationFormat }).format;
            return formatDuration(Math.round(value), fmt);
        }
        case 'percent': {
            const precision = typeof f.config.precision === 'number' ? f.config.precision : 0;
            return `${formatNumber(value, { maxFrac: metric === 'avg' ? Math.max(precision, 1) : precision })}%`;
        }
        case 'currency': {
            if (opts.withSymbol) {
                const code = typeof f.config.currency === 'string' && f.config.currency.length === 3 ? f.config.currency : null;
                if (code) {
                    try {
                        const p = fieldPrecision(f);
                        return new Intl.NumberFormat(numberFormatLocale(), {
                            style: 'currency',
                            currency: code,
                            currencyDisplay: 'narrowSymbol',
                            minimumFractionDigits: p,
                            maximumFractionDigits: p,
                        }).format(value);
                    } catch {
                        // Código de moneda que el navegador no conoce: sin símbolo.
                    }
                }
            }
            return formatFieldNumber(f, value);
        }
        case 'number':
            // Un promedio puede tener decimales aunque el campo no los tenga.
            return metric === 'avg' && fieldPrecision(f) === 0
                ? formatNumber(value, { maxFrac: 2 })
                : formatFieldNumber(f, value);
        case 'rating':
            return formatNumber(value, { maxFrac: 2 });
        default:
            return Number.isInteger(value) ? formatNumber(value, { maxFrac: 0 }) : formatNumber(value, { maxFrac: 2 });
    }
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/**
 * Label de un bucket temporal para personas (el motor los ordena como texto:
 * `2026-07-21` · `2026-W43` · `2026-07` · `2026-Q3` · `2026`). Un label que no
 * es un bucket (un grupo cualquiera) se devuelve tal cual.
 */
export function formatBucketLabel(label: string): string {
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
    if (m) return formatDateStr(label);
    m = /^(\d{4})-W(\d{2})$/.exec(label);
    if (m) return sprintf(__('Sem %1$d · %2$s'), Number(m[2]), m[1]!);
    m = /^(\d{4})-(\d{2})$/.exec(label);
    if (m) {
        const month = MONTHS_SHORT[Number(m[2]) - 1];
        return month ? `${month} ${m[1]}` : label;
    }
    m = /^(\d{4})-Q([1-4])$/.exec(label);
    if (m) return `T${m[2]} ${m[1]}`;
    return label;
}

/**
 * Labels legibles para los grupos de un chart según el campo agrupado: los
 * buckets de fecha, un instante crudo, y la casilla («Sí» / «No»; el grupo
 * vacío de una casilla también es «No»). Devuelve un mapa clave → texto que
 * se suma al de las opciones (la clave cruda sigue siendo la del dato).
 */
export function groupDisplayLabels(keys: readonly string[], rawField: Pick<FieldEntity, 'type'> | undefined): Map<string, string> {
    const out = new Map<string, string>();
    if (!rawField) return out;
    // v0.1.300 — las fechas de sistema se leen como fecha y hora.
    const field = asDisplayField(rawField);
    if (field.type === 'checkbox') {
        out.set('true', __('Sí'));
        out.set('false', __('No'));
        out.set('(sin valor)', __('No'));
        return out;
    }
    if (field.type === 'date' || field.type === 'datetime') {
        for (const k of keys) {
            const bucket = formatBucketLabel(k);
            if (bucket !== k) out.set(k, bucket);
            else if (ISO_INSTANT_RE.test(k)) out.set(k, formatDateTimeStr(k));
        }
    }
    return out;
}
