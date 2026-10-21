import { OTHERS_GROUP_KEY, type WidgetSegment, type WidgetSeries } from '@/types/dashboard';

/**
 * v0.1.291 — Modelo de un gráfico DESGLOSADO (barras apiladas o lado a lado,
 * áreas/líneas por serie): grupos × series con sus valores, ya ordenados, con
 * etiqueta y color. Funciones puras (testeables); los componentes le pasan
 * los mapas de etiquetas/colores que resuelven los hooks.
 */

export interface ChartSeries {
    key: string;
    label: string;
    color: string;
    /** Total de la serie sobre todos los registros (la métrica, bien calculada). */
    total: number;
    /** "Otros" junta varias series: no se abre como lista. */
    navigable: boolean;
}

export interface ChartGroup {
    key: string;
    label: string;
    /** Valor del GRUPO entero (bien calculado también para promedio, mín/máx). */
    total: number;
    navigable: boolean;
    /** Serie → valor (las que no tienen registros no están). */
    values: Map<string, number>;
}

export interface BreakdownModel {
    groups: ChartGroup[];
    series: ChartSeries[];
    /** El mayor valor de un cruce (escala de lado a lado). */
    maxValue: number;
    /** La mayor SUMA de un grupo (escala de apiladas). */
    maxStack: number;
}

export interface BreakdownPayload {
    data: Array<{ label: string; value: number | string; others?: number; segments?: WidgetSegment[] }>;
    series?: WidgetSeries[];
}

export function toChartNumber(v: number | string | null | undefined): number {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
        const ts = Date.parse(v);
        return Number.isFinite(ts) ? ts : 0;
    }
    return 0;
}

export function buildBreakdown(
    payload: BreakdownPayload,
    opts: {
        groupLabel: (key: string, others?: number) => string;
        seriesLabel: (key: string, others?: number) => string;
        seriesColor: (key: string, index: number) => string;
        /** Orden de las opciones del campo de las series (vacío = el del servidor). */
        seriesOptionOrder?: Map<string, number>;
        /** Ordena los grupos (null = el orden del servidor: cronológico o por valor). */
        sortGroups?: (rows: Array<{ label: string; value: number }>) => Array<{ label: string; value: number }>;
        hideZero?: boolean;
    },
): BreakdownModel {
    const order = opts.seriesOptionOrder ?? new Map<string, number>();
    const rawSeries = [...(payload.series ?? [])];
    // Sin el listado de series (datos viejos): las que aparezcan en los grupos.
    if (rawSeries.length === 0) {
        const seen = new Set<string>();
        for (const g of payload.data) {
            for (const s of g.segments ?? []) {
                if (seen.has(s.series)) continue;
                seen.add(s.series);
                rawSeries.push({ key: s.series, value: 0 });
            }
        }
    }
    const serverRank = new Map(rawSeries.map((s, i) => [s.key, i]));
    const rank = (k: string): number => {
        if (k === OTHERS_GROUP_KEY) return Number.MAX_SAFE_INTEGER;
        const o = order.get(k) ?? optionIndexOfCombo(k, order);
        // Con catálogo: el orden de las opciones; lo que no está en él, después.
        if (order.size > 0) return o !== undefined ? o : 10_000 + (serverRank.get(k) ?? 0);
        return serverRank.get(k) ?? 0;
    };
    const ordered = rawSeries.slice().sort((a, b) => rank(a.key) - rank(b.key));
    const series: ChartSeries[] = ordered.map((s, i) => ({
        key: s.key,
        label: opts.seriesLabel(s.key, s.others),
        color: opts.seriesColor(s.key, i),
        total: toChartNumber(s.value),
        navigable: s.key !== OTHERS_GROUP_KEY,
    }));

    let rows = payload.data.map((r) => ({ label: r.label, value: toChartNumber(r.value), others: r.others, segments: r.segments ?? [] }));
    if (opts.hideZero) {
        const kept = rows.filter((r) => r.value !== 0);
        if (kept.length > 0) rows = kept;
    }
    if (opts.sortGroups) {
        const sorted = opts.sortGroups(rows.map((r) => ({ label: r.label, value: r.value })));
        const byLabel = new Map(rows.map((r) => [r.label, r]));
        rows = sorted.map((s) => byLabel.get(s.label)!).filter(Boolean);
    }
    let maxValue = 0;
    let maxStack = 0;
    const groups: ChartGroup[] = rows.map((r) => {
        const values = new Map<string, number>();
        let stack = 0;
        for (const seg of r.segments) {
            const v = toChartNumber(seg.value);
            values.set(seg.series, v);
            maxValue = Math.max(maxValue, v);
            stack += Math.max(0, v);
        }
        maxStack = Math.max(maxStack, stack);
        return {
            key: r.label,
            label: opts.groupLabel(r.label, r.others),
            total: r.value,
            navigable: r.label !== OTHERS_GROUP_KEY,
            values,
        };
    });
    return { groups, series, maxValue, maxStack };
}

/** multi_select: un combo `["a","b"]` se ordena por su primera opción. */
function optionIndexOfCombo(key: string, order: Map<string, number>): number | undefined {
    if (!key.startsWith('[')) return undefined;
    try {
        const arr: unknown = JSON.parse(key);
        if (Array.isArray(arr) && arr.length > 0) return order.get(String(arr[0]));
    } catch {
        // no era JSON
    }
    return undefined;
}

/** La suma de los segmentos de un grupo (base del 100 %). */
export function groupStackSum(g: ChartGroup): number {
    let sum = 0;
    for (const v of g.values.values()) sum += Math.max(0, v);
    return sum;
}

/**
 * Fracción (0..1) del ancho/alto que ocupa un segmento: sobre la mayor pila
 * (apiladas), sobre el total de su grupo (100 %) o sobre el mayor cruce
 * (lado a lado).
 */
export function segmentFraction(
    g: ChartGroup,
    value: number,
    model: Pick<BreakdownModel, 'maxStack' | 'maxValue'>,
    mode: 'stacked' | 'grouped',
    percent: boolean,
): number {
    const v = Math.max(0, value);
    if (mode === 'grouped') return model.maxValue > 0 ? v / model.maxValue : 0;
    if (percent) {
        const sum = groupStackSum(g);
        return sum > 0 ? v / sum : 0;
    }
    return model.maxStack > 0 ? v / model.maxStack : 0;
}
