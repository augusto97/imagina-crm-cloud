import { formatDuration, type DurationFormat } from '../field-types/duration';
import { formatEmailFieldValue, formatYmd, groupNumber } from '../schemas/email-design';
import { AGGREGATE_OTHERS_KEY } from '../schemas/aggregate';
import type { TenantFormat } from '../schemas/tenant';
import { valueBaseType, type FieldType } from '../schemas/field';
import { compareDelta, formatDeltaPct } from './compare';

/** v0.1.300 — columnas de sistema → fecha y hora / persona; ID automático → texto. */
function base(type: string | undefined): string | undefined {
    return type === undefined ? undefined : valueBaseType(type as FieldType);
}

/**
 * v0.1.292 — "Reporte" de un widget de tablero: sus datos ya listos para
 * mostrarse FUERA de la app — la imagen PNG que se descarga, el CSV, el
 * correo programado y el PDF adjunto. Es el MISMO modelo para las cuatro
 * salidas (y en el navegador y en el servidor): etiquetas de opciones,
 * nombres de personas, buckets de fecha legibles, montos con los separadores
 * de la empresa y el color real de cada opción.
 *
 * Funciones puras: el llamador aporta el contexto (campos, nombres, formato,
 * colores) y la salida no depende de ningún DOM ni base.
 */

/** Lo que el reporte necesita saber de un campo (subconjunto del DTO). */
export interface ReportField {
    id: number;
    type: string;
    label: string;
    config: Record<string, unknown>;
    through?: { target_field?: { type: string; config: Record<string, unknown> } | null } | null;
}

export type ReportFormat = Pick<TenantFormat, 'number_format' | 'date_format' | 'time_format'> & { timezone?: string | null };

export interface ReportContext {
    field: (id: unknown) => ReportField | undefined;
    /** Nombre visible de una persona (los grupos por un campo persona son ids). */
    userName: (id: number) => string | null;
    /** C1 — nombre de un equipo (los grupos por un campo «Equipo» son ids). */
    teamName?: (id: number) => string | null;
    format: ReportFormat;
    /** Color de una opción (`blue` o `#3366ff`) → color pintable. Sin él, el hex de la paleta clara. */
    optionColor?: (color: string) => string;
    /** Paleta para lo que no tiene color propio (por índice). */
    palette?: readonly string[];
    /** Nombre de la lista del widget (subtítulo «Suma · Ventas»). */
    listName?: (listId: number) => string | null;
}

/** Hex de los colores preset de las opciones (los `--imcrm-opt-*` del tema claro). */
export const OPTION_COLOR_HEX: Readonly<Record<string, string>> = {
    gray: '#6b7280',
    slate: '#65758b',
    rose: '#e84a6f',
    red: '#ed2c2c',
    orange: '#f97415',
    amber: '#f59f0a',
    yellow: '#facc14',
    lime: '#82cb15',
    green: '#21c45d',
    emerald: '#10b77f',
    teal: '#14b8a5',
    cyan: '#05bad6',
    sky: '#0da6f2',
    blue: '#3c83f6',
    indigo: '#6467f2',
    violet: '#7c3bed',
    fuchsia: '#d843ef',
    pink: '#ec4699',
};

/** Misma secuencia que la paleta de los gráficos de la app. */
export const REPORT_PALETTE: readonly string[] = ['blue', 'amber', 'green', 'violet', 'rose', 'cyan', 'orange', 'teal', 'pink', 'lime', 'indigo', 'slate'].map(
    (k) => OPTION_COLOR_HEX[k]!,
);

/** Gris neutro de «Otros» y «(sin valor)». */
export const REPORT_NEUTRAL = '#9aa1ad';

export const EMPTY_GROUP_LABEL = '(sin valor)';

export interface ReportRow {
    key: string;
    label: string;
    value: number;
    /** El valor tal como llegó (un mínimo/máximo de fecha es texto ISO). */
    raw: number | string | null;
    /** El valor como se lee (moneda, duración, fecha…). */
    text: string;
    color: string;
    /** v0.1.462 — con «Comparar con…»: el valor en el período anterior. */
    previous?: number | null;
    previousText?: string;
    deltaText?: string;
    pct?: number | null;
    tone?: ReportTone;
}

/** v0.1.462 — Bueno (verde), malo (rojo) o neutro, según «menos es mejor». */
export type ReportTone = 'good' | 'bad' | 'neutral';

/** v0.1.462 — Qué se compara con qué («Este mes vs. mes anterior»). */
export interface ReportCompare {
    label: string;
    short: string;
    detail: string;
}

/** v0.1.462 — Un valor comparado: antes, la variación y su tono. */
export interface ReportDelta {
    previousText: string;
    deltaText: string;
    pct: number | null;
    tone: ReportTone;
}

/** v0.1.462 — Un punto de una serie comparada (alineada por posición). */
export interface ReportTrendPoint {
    label: string;
    prevLabel: string;
    value: number | null;
    previous: number | null;
    text: string;
    previousText: string;
}

/** v0.1.462 — Un período del pronóstico. */
export interface ReportForecastBucket {
    key: string;
    label: string;
    won: number;
    weighted: number;
    open: number;
    forecast: number;
    wonText: string;
    weightedText: string;
    openText: string;
    forecastText: string;
}

export interface ReportSeries {
    key: string;
    label: string;
    color: string;
    total: number;
    totalText: string;
}

export interface ReportGroup {
    key: string;
    label: string;
    total: number;
    totalText: string;
    /** Alineados con `series`: el valor de cada serie en este grupo (0 si no hay). */
    values: number[];
    texts: string[];
}

export interface ReportPivotRow {
    key: string;
    label: string;
    total: number | null;
    totalText: string;
    cells: Array<{ value: number | null; text: string }>;
    /** v0.1.462 — «Antes» y «Variación» del total de la fila. */
    delta?: ReportDelta | null;
}

interface ReportBase {
    title: string;
    /** «Suma · Ventas». */
    subtitle: string | null;
    widgetType: string;
}

export type WidgetReport = ReportBase &
    (
        | {
              kind: 'kpi';
              value: number | string | null;
              valueText: string;
              /** Medidor / KPI con meta: avance hacia la meta. */
              goal: { value: number; text: string; pct: number } | null;
              /** Delta vs período anterior. */
              delta: { pct: number | null; previous: number | string | null; previousText: string; periodDays: number } | null;
              gauge: boolean;
              /** v0.1.462 — «Comparar con…». */
              compare: (ReportCompare & ReportDelta & { previous: number | string | null }) | null;
          }
        | {
              kind: 'categories';
              chart: 'bar' | 'pie' | 'funnel' | 'line' | 'area';
              rows: ReportRow[];
              total: number;
              totalText: string;
              /** Nombre de la dimensión (columna del CSV): el campo agrupado. */
              dimension: string;
              metricName: string;
              /** v0.1.462 — «Comparar con…»: qué con qué (los valores van en cada fila). */
              compare: ReportCompare | null;
              /** v0.1.462 — serie de tiempo comparada, alineada por posición. */
              trend: ReportTrendPoint[] | null;
          }
        | {
              kind: 'stacked';
              chart: 'bar' | 'area' | 'line';
              mode: 'stacked' | 'grouped';
              percent: boolean;
              vertical: boolean;
              series: ReportSeries[];
              groups: ReportGroup[];
              dimension: string;
              metricName: string;
          }
        | {
              kind: 'table';
              columns: string[];
              rows: string[][];
              rawRows: Array<Array<string | number | null>>;
              /** v0.1.462 — totales del período comparados (registros y sumas). */
              totals: Array<ReportDelta & { label: string; value: number; previous: number; valueText: string }> | null;
              compare: ReportCompare | null;
          }
        | {
              kind: 'pivot';
              rowHeader: string;
              colHeader: string;
              cols: Array<{ key: string; label: string; total: number | null; totalText: string }>;
              rows: ReportPivotRow[];
              total: number | null;
              totalText: string;
              heatmap: boolean;
              min: number;
              max: number;
              metricName: string;
              compare: (ReportCompare & ReportDelta) | null;
          }
        | {
              /** v0.1.462 — pronóstico de ventas (embudo ponderado). */
              kind: 'forecast';
              buckets: ReportForecastBucket[];
              totals: ReportForecastBucket;
              goal: { value: number; text: string; pct: number } | null;
              compare: (ReportCompare & ReportDelta) | null;
              stages: Array<{ label: string; probability: number; amountText: string }>;
              /** Monto de los negocios sin etapa (no cuentan). */
              unassignedText: string | null;
          }
    );

/** Widget tal como lo necesita el reporte (subconjunto de `WidgetSpec`). */
export interface ReportWidget {
    type: string;
    title: string;
    list_id: number;
    config: Record<string, unknown>;
}

const COUNT_METRICS = new Set(['count', 'count_unique', 'count_empty', 'count_true', 'count_false']);

/** Nombre de una métrica para personas. */
export function reportMetricName(metric: string): string {
    switch (metric) {
        case 'count':
            return 'Conteo';
        case 'count_unique':
            return 'Únicos';
        case 'count_empty':
            return 'Vacíos';
        case 'count_true':
            return 'Sí';
        case 'count_false':
            return 'No';
        case 'sum':
            return 'Suma';
        case 'avg':
            return 'Promedio';
        case 'min':
            return 'Mínimo';
        case 'max':
            return 'Máximo';
        default:
            return metric;
    }
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;

/** Un bucket temporal legible (`2026-07` → «jul 2026», `2026-W30` → «Sem 30 · 2026»). */
export function reportBucketLabel(key: string, format: ReportFormat): string {
    if (ISO_DATE_RE.test(key)) return formatYmd(key, format.date_format);
    let m = /^(\d{4})-W(\d{2})$/.exec(key);
    if (m) return `Sem ${Number(m[2])} · ${m[1]}`;
    m = /^(\d{4})-(\d{2})$/.exec(key);
    if (m) return `${MONTHS_SHORT[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
    m = /^(\d{4})-Q([1-4])$/.exec(key);
    if (m) return `T${m[2]} ${m[1]}`;
    return key;
}

/** El campo "de vista" de un rollup (se formatea como su destino). */
function displayField(f: ReportField | undefined): ReportField | undefined {
    if (f && base(f.type) !== f.type) return { ...f, type: base(f.type)!, config: {} };
    if (!f || f.type !== 'rollup') return f;
    const op = String(f.config.operation ?? 'count');
    const t = f.through?.target_field ?? null;
    if (op === 'count' || !t) return { ...f, type: 'number', config: { precision: 0 } };
    if (t.type === 'date' || t.type === 'datetime') return { ...f, type: t.type, config: {} };
    if (op === 'avg') return { ...f, type: 'number', config: { precision: 2 } };
    return { ...f, type: t.type, config: t.config };
}

/** Número con los separadores de la empresa y hasta `max` decimales (sin ceros de más). */
function looseNumber(n: number, max: number, format: ReportFormat): string {
    const rounded = Math.round(n * 10 ** max) / 10 ** max;
    const dec = Number.isInteger(rounded) ? 0 : Math.min(max, (String(rounded).split('.')[1] ?? '').length);
    return groupNumber(rounded, dec, format.number_format);
}

/**
 * Valor de una métrica como se lee — misma regla que los widgets de la app:
 * los conteos enteros, la duración como «1h 30m», el porcentaje con «%», la
 * moneda con sus decimales y las fechas en el formato de la empresa.
 */
export function reportMetricText(
    value: number | string | null | undefined,
    metric: string,
    field: ReportField | undefined,
    format: ReportFormat,
): string {
    if (value === null || value === undefined || value === '') return '—';
    const f = displayField(field);
    if (typeof value === 'string') {
        if (ISO_DATE_RE.test(value)) return formatYmd(value, format.date_format);
        if (ISO_INSTANT_RE.test(value)) return formatEmailFieldValue({ type: 'datetime' }, value, format);
        return value;
    }
    if (!Number.isFinite(value)) return '—';
    if (COUNT_METRICS.has(metric) || !f) return looseNumber(value, Number.isInteger(value) ? 0 : 2, format);
    const precision = typeof f.config.precision === 'number' ? f.config.precision : null;
    switch (f.type) {
        case 'duration':
            return formatDuration(Math.round(value), (f.config.format as DurationFormat | undefined) ?? 'hm');
        case 'percent':
            return `${looseNumber(value, metric === 'avg' ? Math.max(precision ?? 0, 1) : (precision ?? 0), format)}%`;
        case 'currency': {
            const text = groupNumber(value, precision ?? 2, format.number_format);
            const cur = typeof f.config.currency === 'string' ? f.config.currency : '';
            const symbol = currencySymbol(cur);
            return symbol ? `${symbol}${text}` : text;
        }
        case 'number':
            return metric === 'avg' && (precision ?? 0) === 0 ? looseNumber(value, 2, format) : groupNumber(value, precision ?? null, format.number_format);
        default:
            return looseNumber(value, 2, format);
    }
}

/** Símbolo corto de una moneda («$», «€»…), o el código si el runtime no lo sabe. */
function currencySymbol(code: string): string {
    if (!/^[A-Z]{3}$/.test(code)) return '';
    try {
        const part = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
            .formatToParts(0)
            .find((p) => p.type === 'currency');
        return part?.value ?? `${code} `;
    } catch {
        return `${code} `;
    }
}

interface OptionInfo {
    label: string;
    color: string | null;
    index: number;
}

function optionsOf(f: ReportField | undefined): Map<string, OptionInfo> {
    const out = new Map<string, OptionInfo>();
    if (!f || (f.type !== 'select' && f.type !== 'multi_select')) return out;
    const opts = Array.isArray(f.config.options) ? (f.config.options as Array<Record<string, unknown>>) : [];
    opts.forEach((o, index) => {
        const value = typeof o.value === 'string' ? o.value : '';
        const label = typeof o.label === 'string' && o.label !== '' ? o.label : value;
        const color = typeof o.color === 'string' && o.color !== '' ? o.color : null;
        if (value !== '' && !out.has(value)) out.set(value, { label, color, index });
        if (label !== '' && !out.has(label)) out.set(label, { label, color, index });
    });
    return out;
}

/** Clave de un grupo → texto para personas, según el campo agrupado. */
export function reportGroupLabel(key: string, field: ReportField | undefined, ctx: ReportContext, others?: number): string {
    if (key === AGGREGATE_OTHERS_KEY) return typeof others === 'number' ? `Otros (${others})` : 'Otros';
    if (key === '' || key === EMPTY_GROUP_LABEL) return field?.type === 'checkbox' ? 'No' : EMPTY_GROUP_LABEL;
    if (!field) return key;
    switch (base(field.type)) {
        case 'select':
        case 'multi_select': {
            const opts = optionsOf(field);
            const one = (v: string): string => opts.get(v)?.label ?? v;
            if (key.startsWith('[')) {
                try {
                    const arr: unknown = JSON.parse(key);
                    if (Array.isArray(arr)) return arr.length === 0 ? EMPTY_GROUP_LABEL : arr.map((v) => one(String(v))).join(', ');
                } catch {
                    // no era JSON
                }
            }
            return one(key);
        }
        case 'user': {
            const id = Number(key);
            return Number.isInteger(id) ? (ctx.userName(id) ?? `Usuario ${id}`) : key;
        }
        case 'team': {
            // C1 — la clave de grupo es el conjunto de ids (`[3, 7]`).
            try {
                const arr: unknown = JSON.parse(key);
                const ids = (Array.isArray(arr) ? arr : [arr]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
                if (ids.length === 0) return EMPTY_GROUP_LABEL;
                return ids.map((id) => ctx.teamName?.(id) ?? `Equipo ${id}`).join(', ');
            } catch {
                return key;
            }
        }
        case 'checkbox':
            return key === 'true' ? 'Sí' : key === 'false' ? 'No' : key;
        case 'date':
        case 'datetime': {
            const bucket = reportBucketLabel(key, ctx.format);
            if (bucket !== key) return bucket;
            return ISO_INSTANT_RE.test(key) ? formatEmailFieldValue({ type: 'datetime' }, key, ctx.format) : key;
        }
        default:
            return key;
    }
}

function paintColor(raw: string, ctx: ReportContext): string {
    if (ctx.optionColor) return ctx.optionColor(raw);
    return OPTION_COLOR_HEX[raw] ?? (/^#[0-9a-f]{3,8}$/i.test(raw) ? raw : REPORT_NEUTRAL);
}

/** Color de un grupo: el de su opción, gris para «Otros» y «sin valor», la paleta para el resto. */
export function reportGroupColor(key: string, field: ReportField | undefined, index: number, ctx: ReportContext): string {
    if (key === AGGREGATE_OTHERS_KEY || key === EMPTY_GROUP_LABEL) return REPORT_NEUTRAL;
    const opts = optionsOf(field);
    let opt = opts.get(key);
    if (!opt && key.startsWith('[')) {
        try {
            const arr: unknown = JSON.parse(key);
            if (Array.isArray(arr) && arr.length === 1) opt = opts.get(String(arr[0]));
        } catch {
            // no era JSON
        }
    }
    if (opt?.color) return paintColor(opt.color, ctx);
    const palette = ctx.palette ?? REPORT_PALETTE;
    return palette[index % palette.length] ?? REPORT_NEUTRAL;
}

function optionIndex(key: string, field: ReportField | undefined): number | undefined {
    const opts = optionsOf(field);
    const direct = opts.get(key)?.index;
    if (direct !== undefined) return direct;
    if (key.startsWith('[')) {
        try {
            const arr: unknown = JSON.parse(key);
            if (Array.isArray(arr) && arr.length > 0) return opts.get(String(arr[0]))?.index;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

/**
 * Orden de las categorías (`config.sort`, el mismo de la app): por valor, por
 * la etiqueta o por el orden de las opciones del campo. "Otros" al final; un
 * eje de fecha queda cronológico.
 */
export function sortReportKeys<T extends { key: string; value: number; label: string }>(
    rows: T[],
    sort: unknown,
    field: ReportField | undefined,
): T[] {
    if (base(field?.type) === 'date' || base(field?.type) === 'datetime') return rows;
    const others = rows.filter((r) => r.key === AGGREGATE_OTHERS_KEY);
    const rest = rows.filter((r) => r.key !== AGGREGATE_OTHERS_KEY);
    const hasOptions = optionsOf(field).size > 0;
    const mode = typeof sort === 'string' && sort !== '' ? sort : hasOptions ? 'options' : 'value_desc';
    const sorted = [...rest].sort((a, b) => {
        if (mode === 'value_asc') return a.value - b.value;
        if (mode === 'label') return a.label.localeCompare(b.label, 'es');
        if (mode === 'options') {
            const ia = optionIndex(a.key, field);
            const ib = optionIndex(b.key, field);
            if (ia !== undefined && ib !== undefined && ia !== ib) return ia - ib;
            if (ia !== undefined && ib === undefined) return -1;
            if (ia === undefined && ib !== undefined) return 1;
        }
        return b.value - a.value;
    });
    return [...sorted, ...others];
}

const num = (v: unknown): number => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n) && v.trim() !== '') return n;
        const t = Date.parse(v);
        return Number.isFinite(t) ? t : 0;
    }
    return 0;
};

interface RawCompare {
    unavailable?: string;
    label?: string;
    short?: string;
    detail?: string;
    invert?: boolean;
    value?: number | string | null;
    values?: Array<{ label: string; value: number | string | null }>;
    points?: Array<{ label: string | null; prev_label: string | null; value: number | null; previous: number | null }>;
    totals?: unknown;
    rows?: Array<{ key: string; value: number | string | null }>;
    total?: number | string | null;
}

/** v0.1.462 — La comparación que devolvió el bundle (null si no hay o no se pudo). */
function readRawCompare(raw: unknown): (RawCompare & ReportCompare) | null {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as RawCompare;
    if (typeof c.unavailable === 'string' || typeof c.label !== 'string') return null;
    return { ...c, label: c.label, short: typeof c.short === 'string' ? c.short : '', detail: typeof c.detail === 'string' ? c.detail : '' };
}

/** v0.1.462 — Antes, variación y tono de un valor comparado. */
export function reportDelta(
    current: number | string | null | undefined,
    previous: number | string | null | undefined,
    previousText: string,
    invert: boolean,
    format: ReportFormat,
): ReportDelta {
    const d = compareDelta(typeof current === 'number' ? current : null, typeof previous === 'number' ? previous : null, invert);
    return { previousText, deltaText: d === null ? '—' : formatDeltaPct(d, format.number_format), pct: d?.pct ?? null, tone: d?.tone ?? 'neutral' };
}

/**
 * El reporte de UN widget a partir de lo que devolvió el bundle del tablero.
 * `null` para los bloques de contenido o un widget sin datos legibles.
 */
export function buildWidgetReport(widget: ReportWidget, data: unknown, ctx: ReportContext): WidgetReport | null {
    if (data === null || typeof data !== 'object' || '__error' in (data as object)) return null;
    const cfg = widget.config ?? {};
    const metric = typeof cfg.metric === 'string' ? cfg.metric : 'count';
    const metricField = ctx.field(cfg.metric_field_id);
    const metricName = reportMetricName(metric);
    const listName = widget.list_id > 0 ? (ctx.listName?.(widget.list_id) ?? null) : null;
    const subtitle = [cfg.metric ? metricName : null, listName].filter(Boolean).join(' · ') || null;
    const title = widget.title || defaultTitle(widget.type);
    const base = { title, subtitle, widgetType: widget.type };
    const text = (v: number | string | null | undefined): string => reportMetricText(v, metric, metricField, ctx.format);
    const d = data as Record<string, unknown>;

    if (widget.type === 'kpi' || widget.type === 'gauge' || widget.type === 'stat_delta') {
        if (!('value' in d)) return null;
        const value = d.value as number | string | null;
        const prefix = typeof cfg.prefix === 'string' ? cfg.prefix : '';
        const suffix = typeof cfg.suffix === 'string' ? cfg.suffix : '';
        const goalRaw = typeof cfg.goal === 'number' && cfg.goal > 0 ? cfg.goal : null;
        const goal = goalRaw !== null && typeof value === 'number'
            ? { value: goalRaw, text: `${prefix}${text(goalRaw)}${suffix}`, pct: (value / goalRaw) * 100 }
            : null;
        const delta = widget.type === 'stat_delta'
            ? {
                  pct: typeof d.delta_pct === 'number' ? d.delta_pct : null,
                  previous: typeof d.previous === 'number' || typeof d.previous === 'string' ? d.previous : null,
                  previousText: `${prefix}${text(d.previous as number | string | null)}${suffix}`,
                  periodDays: typeof d.period_days === 'number' ? d.period_days : 0,
              }
            : null;
        const cmp = widget.type === 'stat_delta' ? null : readRawCompare(d.compare);
        const compare = cmp
            ? {
                  label: cmp.label,
                  short: cmp.short,
                  detail: cmp.detail,
                  previous: cmp.value ?? null,
                  ...reportDelta(value, cmp.value, `${prefix}${text(cmp.value ?? null)}${suffix}`, cmp.invert === true, ctx.format),
              }
            : null;
        return { ...base, kind: 'kpi', value, valueText: `${prefix}${text(value)}${suffix}`, goal, delta, gauge: widget.type === 'gauge', compare };
    }

    if (widget.type === 'forecast') {
        const f = d.forecast as {
            buckets: Array<{ key: string; won: number; weighted: number; open: number; forecast: number }>;
            totals: { won: number; weighted: number; open: number; forecast: number; unassigned?: number };
            stages?: Array<{ key: string; label: string; probability: number; amount: number }>;
        } | undefined;
        if (!f) return null;
        const money = (v: number): string => reportMetricText(v, 'sum', metricField, ctx.format);
        const bucketOf = (b: { key: string; won: number; weighted: number; open: number; forecast: number }, label: string): ReportForecastBucket => ({
            key: b.key,
            label,
            won: b.won,
            weighted: b.weighted,
            open: b.open,
            forecast: b.forecast,
            wonText: money(b.won),
            weightedText: money(b.weighted),
            openText: money(b.open),
            forecastText: money(b.forecast),
        });
        const totals = bucketOf({ key: 'total', ...f.totals }, 'Total');
        const goalRaw = typeof cfg.goal === 'number' && cfg.goal > 0 ? cfg.goal : null;
        const cmp = readRawCompare(d.compare);
        const before = cmp && cmp.totals && typeof cmp.totals === 'object' ? (cmp.totals as { forecast?: number }).forecast : undefined;
        return {
            ...base,
            subtitle: [metricField?.label ?? null, listName].filter(Boolean).join(' · ') || null,
            kind: 'forecast',
            buckets: f.buckets.map((b) => bucketOf(b, b.key === '' ? 'Sin fecha' : reportBucketLabel(b.key, ctx.format))),
            totals,
            goal: goalRaw !== null ? { value: goalRaw, text: money(goalRaw), pct: (totals.forecast / goalRaw) * 100 } : null,
            compare: cmp && typeof before === 'number'
                ? { label: cmp.label, short: cmp.short, detail: cmp.detail, ...reportDelta(totals.forecast, before, money(before), cmp.invert === true, ctx.format) }
                : null,
            stages: (f.stages ?? []).map((st) => ({ label: st.label, probability: st.probability, amountText: money(st.amount) })),
            unassignedText: typeof f.totals.unassigned === 'number' && f.totals.unassigned > 0 ? money(f.totals.unassigned) : null,
        };
    }

    if (widget.type === 'table') {
        const cols = Array.isArray(d.columns) ? (d.columns as Array<{ label: string; slug: string; type: string; id?: number }>) : [];
        const rows = Array.isArray(d.rows) ? (d.rows as Array<{ fields: Record<string, unknown> }>) : [];
        const cellText = (col: { slug: string; type: string; id?: number }, v: unknown): string => {
            if (col.type === 'relation') {
                const n = Array.isArray(v) ? v.length : 0;
                return n === 0 ? '' : n === 1 ? '1 vinculado' : `${n} vinculados`;
            }
            if (col.type === 'file') {
                const n = Array.isArray(v) ? v.length : v ? 1 : 0;
                return n === 0 ? '' : n === 1 ? '1 archivo' : `${n} archivos`;
            }
            const field = ctx.field(col.id);
            return formatEmailFieldValue(field ?? { type: col.type }, v, ctx.format, ctx.userName, ctx.teamName);
        };
        const tcmp = readRawCompare(d.compare);
        const totals = tcmp && Array.isArray(tcmp.totals)
            ? (tcmp.totals as Array<{ key: string; label: string; field_id: number | null; value: number; previous: number }>).map((t) => {
                  const f = t.field_id !== null ? ctx.field(t.field_id) : undefined;
                  const m = t.field_id === null ? 'count' : 'sum';
                  const fmt = (v: number): string => reportMetricText(v, m, f, ctx.format);
                  return { label: t.label, value: t.value, previous: t.previous, valueText: fmt(t.value), ...reportDelta(t.value, t.previous, fmt(t.previous), tcmp.invert === true, ctx.format) };
              })
            : null;
        return {
            ...base,
            kind: 'table',
            totals,
            compare: tcmp ? { label: tcmp.label, short: tcmp.short, detail: tcmp.detail } : null,
            columns: cols.map((c) => c.label),
            rows: rows.map((r) => cols.map((c) => cellText(c, r.fields?.[c.slug]))),
            rawRows: rows.map((r) =>
                cols.map((c) => {
                    const v = r.fields?.[c.slug];
                    if (typeof v === 'number' && ['number', 'currency', 'percent', 'rating', 'duration'].includes(c.type)) return v;
                    return cellText(c, v);
                }),
            ),
        };
    }

    if (widget.type === 'pivot') {
        const p = d.pivot as {
            rows: Array<{ key: string; value: number | string | null; others?: number }>;
            cols: Array<{ key: string; value: number | string | null; others?: number }>;
            cells: Array<{ row: string; col: string; value: number | string | null }>;
            total: number | string | null;
        } | undefined;
        if (!p) return null;
        const rowField = ctx.field(cfg.group_by_field_id);
        const colField = ctx.field(cfg.sub_group_by_field_id);
        const label = (f: ReportField | undefined) => (k: { key: string; value: number | string | null; others?: number }) => ({
            key: k.key,
            value: num(k.value),
            label: reportGroupLabel(k.key, f, ctx, k.others),
            raw: k.value,
        });
        const rows = sortReportKeys(p.rows.map(label(rowField)), cfg.sort, rowField);
        const cols = sortReportKeys(p.cols.map(label(colField)), cfg.col_sort, colField);
        const cells = new Map(p.cells.map((c) => [`${c.row}\u0000${c.col}`, c.value]));
        const pcmp = readRawCompare(d.compare);
        const beforeRows = new Map((pcmp?.rows ?? []).map((r) => [r.key, r.value]));
        const pInvert = pcmp?.invert === true;
        let min = Infinity;
        let max = -Infinity;
        for (const c of p.cells) {
            if (typeof c.value === 'number') {
                min = Math.min(min, c.value);
                max = Math.max(max, c.value);
            }
        }
        return {
            ...base,
            kind: 'pivot',
            metricName,
            rowHeader: rowField?.label ?? '',
            colHeader: colField?.label ?? '',
            heatmap: cfg.heatmap === true,
            cols: cols.map((c) => ({ key: c.key, label: c.label, total: typeof c.raw === 'number' ? c.raw : null, totalText: text(c.raw) })),
            compare: pcmp
                ? { label: pcmp.label, short: pcmp.short, detail: pcmp.detail, ...reportDelta(p.total, pcmp.total, text(pcmp.total ?? null), pInvert, ctx.format) }
                : null,
            rows: rows.map((r) => ({
                key: r.key,
                label: r.label,
                total: typeof r.raw === 'number' ? r.raw : null,
                totalText: text(r.raw),
                delta: pcmp ? reportDelta(r.raw, beforeRows.get(r.key) ?? null, text(beforeRows.get(r.key) ?? null), pInvert, ctx.format) : null,
                cells: cols.map((c) => {
                    const v = cells.get(`${r.key}\u0000${c.key}`) ?? null;
                    return { value: typeof v === 'number' ? v : null, text: v === null ? '' : text(v) };
                }),
            })),
            total: typeof p.total === 'number' ? p.total : null,
            totalText: text(p.total),
            min: Number.isFinite(min) ? min : 0,
            max: Number.isFinite(max) ? max : 0,
        };
    }

    if (!Array.isArray(d.data)) return null;
    const groupField = ctx.field(cfg.group_by_field_id) ?? ctx.field(cfg.date_field_id);
    const dimension = groupField?.label ?? 'Categoría';
    const chart = widget.type === 'chart_pie' ? 'pie' : widget.type === 'funnel' ? 'funnel' : widget.type === 'chart_line' ? 'line' : widget.type === 'chart_area' ? 'area' : 'bar';
    const timeline = chart === 'line' || chart === 'area';
    let raw = (d.data as Array<{ label: string; value: number | string; others?: number; segments?: Array<{ series: string; value: number | string }> }>)
        // Los registros sin fecha no son un punto de una tendencia.
        .filter((r) => !(timeline && (r.label === EMPTY_GROUP_LABEL || r.label === AGGREGATE_OTHERS_KEY)));
    if (cfg.hide_zero_groups === true) {
        const kept = raw.filter((r) => num(r.value) !== 0);
        if (kept.length > 0) raw = kept;
    }

    if (Array.isArray(d.series) && chart !== 'pie' && chart !== 'funnel') {
        const subField = ctx.field(cfg.sub_group_by_field_id);
        const seriesRaw = (d.series as Array<{ key: string; value: number | string; others?: number }>).map((s) => ({
            key: s.key,
            value: num(s.value),
            raw: s.value,
            label: reportGroupLabel(s.key, subField, ctx, s.others),
        }));
        // Con catálogo, el orden de las opciones (como la leyenda de la app);
        // si no, el del servidor (las mayores primero o cronológico). "Otros" al final.
        const seriesList = optionsOf(subField).size > 0
            ? sortReportKeys(seriesRaw, 'options', subField)
            : [...seriesRaw.filter((s) => s.key !== AGGREGATE_OTHERS_KEY), ...seriesRaw.filter((s) => s.key === AGGREGATE_OTHERS_KEY)];
        const series: ReportSeries[] = seriesList.map((s, i) => ({
            key: s.key,
            label: s.label,
            color: reportGroupColor(s.key, subField, i, ctx),
            total: s.value,
            totalText: text(s.raw),
        }));
        let groups = raw.map((r) => ({ key: r.label, value: num(r.value), raw: r.value, label: reportGroupLabel(r.label, groupField, ctx, r.others), segments: r.segments ?? [] }));
        if (!timeline) groups = sortReportKeys(groups, cfg.sort, groupField);
        const stacked = cfg.stack_mode !== 'grouped';
        return {
            ...base,
            kind: 'stacked',
            chart: chart as 'bar' | 'area' | 'line',
            mode: stacked ? 'stacked' : 'grouped',
            percent: stacked && cfg.stack_percent === true,
            vertical: cfg.bar_orientation === 'vertical',
            dimension,
            metricName,
            series,
            groups: groups.map((g) => {
                const bySeries = new Map(g.segments.map((s) => [s.series, s.value]));
                return {
                    key: g.key,
                    label: g.label,
                    total: g.value,
                    totalText: text(g.raw),
                    values: series.map((s) => num(bySeries.get(s.key) ?? 0)),
                    texts: series.map((s) => (bySeries.has(s.key) ? text(bySeries.get(s.key) ?? 0) : '')),
                };
            }),
        };
    }

    let rows = raw.map((r, i) => ({
        key: r.label,
        value: num(r.value),
        raw: r.value,
        label: timeline ? reportBucketLabel(r.label, ctx.format) : reportGroupLabel(r.label, groupField, ctx, r.others),
        index: i,
    }));
    if (!timeline) rows = sortReportKeys(rows, cfg.sort ?? (chart === 'pie' ? 'value_desc' : undefined), groupField);
    const total = rows.reduce((s, r) => s + r.value, 0);
    // v0.1.462 — «Comparar con…»: por categoría, el valor de antes de cada
    // grupo; en una serie de tiempo, la serie anterior alineada por posición.
    const ccmp = readRawCompare(d.compare);
    const beforeByKey = new Map((ccmp?.values ?? []).map((v) => [v.label, v.value]));
    const cInvert = ccmp?.invert === true;
    const trend: ReportTrendPoint[] | null = ccmp && Array.isArray(ccmp.points)
        ? ccmp.points.map((pt) => ({
              label: pt.label !== null ? reportBucketLabel(pt.label, ctx.format) : '',
              prevLabel: pt.prev_label !== null ? reportBucketLabel(pt.prev_label, ctx.format) : '',
              value: pt.value,
              previous: pt.previous,
              text: pt.value === null ? '' : text(pt.value),
              previousText: pt.previous === null ? '' : text(pt.previous),
          }))
        : null;
    return {
        ...base,
        kind: 'categories',
        chart,
        dimension,
        metricName,
        compare: ccmp ? { label: ccmp.label, short: ccmp.short, detail: ccmp.detail } : null,
        trend,
        rows: rows.map((r, i) => {
            const before = ccmp && !trend ? (beforeByKey.has(r.key) ? beforeByKey.get(r.key)! : null) : undefined;
            return {
                key: r.key,
                label: r.label,
                value: r.value,
                raw: typeof r.raw === 'number' || typeof r.raw === 'string' ? r.raw : null,
                text: text(r.raw),
                color: timeline ? (ctx.palette ?? REPORT_PALETTE)[0]! : reportGroupColor(r.key, groupField, i, ctx),
                ...(before !== undefined
                    ? { previous: typeof before === 'number' ? before : null, ...reportDelta(r.raw, before, before === null ? '—' : text(before), cInvert, ctx.format) }
                    : {}),
            };
        }),
        total,
        totalText: text(total),
    };
}

/**
 * Ids de las personas que aparecen en los datos de un widget (para resolver
 * sus nombres antes de mostrarlos fuera de la app): grupos y series por un
 * campo persona, y las celdas de las columnas persona de una tabla.
 */
export function reportUserIds(widget: Pick<ReportWidget, 'type' | 'config'>, data: unknown, field: (id: unknown) => Pick<ReportField, 'type'> | undefined): number[] {
    if (typeof data !== 'object' || data === null) return [];
    const ids = new Set<number>();
    const add = (v: unknown): void => {
        const n = Number(v);
        if (Number.isInteger(n) && n > 0) ids.add(n);
    };
    const isUser = (id: unknown): boolean => base(field(id)?.type) === 'user';
    const cfg = widget.config ?? {};
    const d = data as Record<string, unknown>;
    const groupIsUser = isUser(cfg.group_by_field_id);
    const subIsUser = isUser(cfg.sub_group_by_field_id);
    if (Array.isArray(d.data)) {
        for (const row of d.data as Array<{ label?: unknown; segments?: Array<{ series?: unknown }> }>) {
            if (groupIsUser) add(row.label);
            if (subIsUser) for (const s of row.segments ?? []) add(s.series);
        }
    }
    if (Array.isArray(d.series) && subIsUser) for (const s of d.series as Array<{ key?: unknown }>) add(s.key);
    const pivot = d.pivot as { rows?: Array<{ key?: unknown }>; cols?: Array<{ key?: unknown }> } | undefined;
    if (pivot) {
        if (groupIsUser) for (const r of pivot.rows ?? []) add(r.key);
        if (subIsUser) for (const c of pivot.cols ?? []) add(c.key);
    }
    if (widget.type === 'table' && Array.isArray(d.columns) && Array.isArray(d.rows)) {
        const cols = (d.columns as Array<{ slug: string; type: string }>).filter((c) => base(c.type) === 'user');
        for (const row of d.rows as Array<{ fields?: Record<string, unknown> }>) {
            for (const c of cols) {
                const v = row.fields?.[c.slug];
                if (Array.isArray(v)) v.forEach(add);
                else add(v);
            }
        }
    }
    return [...ids];
}

function defaultTitle(type: string): string {
    switch (type) {
        case 'kpi':
            return 'Indicador';
        case 'gauge':
            return 'Medidor';
        case 'stat_delta':
            return 'Variación';
        case 'table':
            return 'Top registros';
        case 'pivot':
            return 'Tabla dinámica';
        case 'forecast':
            return 'Pronóstico';
        case 'chart_line':
        case 'chart_area':
            return 'Tendencia';
        default:
            return 'Distribución';
    }
}

/** Nombre de archivo seguro: «estado-por-region-2026-10-21». */
export function reportFileName(title: string, dateYmd: string): string {
    const base = title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return `${base || 'widget'}-${dateYmd}`;
}
