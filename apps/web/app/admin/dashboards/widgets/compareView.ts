import { compareDelta, formatDeltaPct } from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';
import { getTenantFormat } from '@/lib/tenantFormat';
import type { WidgetCompare } from '@/types/dashboard';

/**
 * v0.1.462 — «Comparar con…» (J2) en los widgets: piezas puras (testeables)
 * para leer lo que mandó el servidor y armar «+12 % vs. mes anterior» con
 * el formato de la empresa y el color que corresponde.
 */

/** Una comparación lista para dibujar (con su etiqueta). */
export type ReadyCompare = WidgetCompare & { label: string; short: string; detail: string };

/** La comparación que trae el dato de un widget (o `null` si no pidió). */
export function widgetCompareOf(data: unknown): WidgetCompare | null {
    if (data === null || typeof data !== 'object' || !('compare' in data)) return null;
    const c = (data as { compare?: unknown }).compare;
    if (c === null || typeof c !== 'object') return null;
    const cmp = c as WidgetCompare;
    if (typeof cmp.unavailable === 'string' || typeof cmp.label === 'string') return cmp;
    return null;
}

/** ¿Se pudo comparar? (con etiqueta y sin motivo de «no disponible»). */
export function isReadyCompare(c: WidgetCompare | null | undefined): c is ReadyCompare {
    return !!c && typeof c.unavailable !== 'string' && typeof c.label === 'string';
}

export type DeltaTone = 'good' | 'bad' | 'neutral';

export interface DeltaView {
    /** «+12 %», «−3,5 %», «Nuevo», «—». */
    text: string;
    pct: number | null;
    diff: number;
    tone: DeltaTone;
    direction: 'up' | 'down' | 'flat';
}

/** La variación de un valor contra el de antes (null si alguno no es número). */
export function deltaView(current: unknown, previous: unknown, invert = false): DeltaView | null {
    const cur = typeof current === 'number' && Number.isFinite(current) ? current : null;
    const prev = typeof previous === 'number' && Number.isFinite(previous) ? previous : null;
    const d = compareDelta(cur, prev, invert);
    if (d === null) return null;
    return { text: formatDeltaPct(d, getTenantFormat().number_format), pct: d.pct, diff: d.diff, tone: d.tone, direction: d.direction };
}

/** Clases de color de una variación (legibles en claro y en oscuro). */
export function toneClass(tone: DeltaTone): string {
    return tone === 'good'
        ? 'imcrm-text-emerald-600 dark:imcrm-text-emerald-400'
        : tone === 'bad'
            ? 'imcrm-text-rose-600 dark:imcrm-text-rose-400'
            : 'imcrm-text-muted-foreground';
}

/** «+$1.000» / «−$250» / «0» con el formato del valor. */
export function diffText(diff: number, format: (n: number) => string): string {
    if (diff === 0) return format(0);
    return `${diff > 0 ? '+' : '−'}${format(Math.abs(diff))}`;
}

/** El texto del tooltip: los dos valores y la diferencia. */
export function compareTooltip(args: {
    compare: ReadyCompare;
    name?: string;
    nowText: string;
    beforeText: string;
    diff?: string | null;
    delta?: string | null;
}): string {
    const head = args.name ? `${args.name} · ${args.compare.label}` : args.compare.label;
    const lines = [head];
    if (args.compare.detail) lines.push(args.compare.detail);
    lines.push(sprintf(__('Ahora: %s'), args.nowText));
    lines.push(sprintf(__('Antes: %s'), args.beforeText));
    if (args.diff) lines.push(args.delta ? sprintf(__('Diferencia: %1$s (%2$s)'), args.diff, args.delta) : sprintf(__('Diferencia: %s'), args.diff));
    return lines.join('\n');
}

/** Métricas que se suman: el total de un gráfico es comparable. */
export function isAdditiveMetric(metric: string): boolean {
    return metric === 'count' || metric === 'sum' || metric === 'count_empty' || metric === 'count_true' || metric === 'count_false';
}

/** El valor de antes de cada grupo (`values` del servidor), por su clave. */
export function previousByKey(c: WidgetCompare | null | undefined): Map<string, number | null> {
    const out = new Map<string, number | null>();
    for (const v of c?.values ?? []) out.set(v.label, typeof v.value === 'number' ? v.value : null);
    return out;
}

/**
 * Totales de una serie comparada (sólo donde hay valor actual: «hasta hoy»
 * en los dos lados).
 */
export function trendTotals(points: WidgetCompare['points']): { current: number; previous: number } | null {
    if (!points || points.length === 0) return null;
    let current = 0;
    let previous = 0;
    let any = false;
    for (const p of points) {
        if (p.value === null) continue;
        any = true;
        current += p.value;
        previous += p.previous ?? 0;
    }
    return any ? { current, previous } : null;
}

/** Un punto de la serie comparada (el de ahora y el de antes en la misma posición). */
export interface ComparedPoint {
    label: string | null;
    prevLabel: string | null;
    value: number | null;
    previous: number | null;
}

/**
 * v0.1.462 — Los puntos a dibujar con «Comparar con…». Si el servidor
 * alineó la serie por posición (`points`: el día 1 con el día 1), van
 * esos; si el gráfico agrupa por otra cosa, cada punto con el valor de
 * antes de su mismo grupo (`values`).
 */
export function comparedPoints(compare: ReadyCompare, rows: Array<{ label: string; value: number }>): ComparedPoint[] {
    if (Array.isArray(compare.points) && compare.points.length > 0) {
        return compare.points.map((p) => ({ label: p.label, prevLabel: p.prev_label, value: p.value, previous: p.previous }));
    }
    const before = previousByKey(compare);
    return rows.map((r) => {
        const prev = before.get(r.label);
        return { label: r.label, prevLabel: r.label, value: r.value, previous: prev === undefined ? null : prev };
    });
}

/**
 * El total de antes de un gráfico por categorías: el que manda el servidor
 * (todos sus grupos, también los que hoy no aparecen) o, si no viene, la suma
 * de los grupos que se ven.
 */
export function previousTotal(c: WidgetCompare | null | undefined, fallback: number): number {
    return typeof c?.total === 'number' ? c.total : fallback;
}
