import type { DashboardFilterValue, ForecastData, ForecastTotalsData, WidgetSpec } from '@/types/dashboard';
import type { FieldEntity } from '@/types/field';
import type { FilterNode, FilterTree } from '@/types/record';

import { bucketRange, segmentScopeChildren } from './useSegmentNav';

/**
 * v0.1.462 — Pronóstico de ventas (J3) en la app: piezas puras para leer lo
 * que manda el servidor y abrir la lista filtrada por un tramo.
 */

/** Los datos del pronóstico (o null si el widget todavía no los trae). */
export function forecastOf(data: unknown): ForecastData | null {
    if (data === null || typeof data !== 'object' || !('forecast' in data)) return null;
    const f = (data as { forecast?: unknown }).forecast;
    if (f === null || typeof f !== 'object' || !Array.isArray((f as ForecastData).buckets)) return null;
    return f as ForecastData;
}

/** Los totales de antes de una comparación del pronóstico (o null). */
export function forecastPreviousTotals(totals: unknown): ForecastTotalsData | null {
    if (totals === null || typeof totals !== 'object' || Array.isArray(totals)) return null;
    const t = totals as Partial<ForecastTotalsData>;
    return typeof t.forecast === 'number' && typeof t.won === 'number' ? (t as ForecastTotalsData) : null;
}

/** Qué parte del pronóstico se abre: lo ganado, lo abierto o los dos. */
export type ForecastPart = 'won' | 'open' | 'all';

/** Las etapas (valores) de una parte, según su probabilidad. */
export function forecastStageKeys(stages: ForecastData['stages'], part: ForecastPart): string[] {
    return stages
        .filter((s) => (part === 'won' ? s.probability >= 100 : part === 'open' ? s.probability > 0 && s.probability < 100 : s.probability > 0))
        .map((s) => s.key);
}

/**
 * El filter_tree de un tramo del pronóstico: lo que contó el widget (su
 * filtro, el período y los filtros del tablero) + el período de la fecha de
 * cierre (si se eligió uno) + las etapas de la parte elegida.
 */
export function forecastFilterTree(args: {
    widget: WidgetSpec;
    listFields: ReadonlyArray<Pick<FieldEntity, 'id' | 'type'>>;
    period: string;
    filters: DashboardFilterValue[];
    userId: number;
    stageFieldId: number;
    stageKeys: string[];
    /** La clave del período (`2026-11`, `''` = sin fecha) o null = todo el pronóstico. */
    bucketKey: string | null;
}): FilterTree | null {
    if (args.stageKeys.length === 0) return null;
    const children: FilterNode[] = segmentScopeChildren(args);
    const cfg = args.widget.config as Record<string, unknown>;
    const closeId = typeof cfg.date_field_id === 'number' && cfg.date_field_id > 0 ? cfg.date_field_id : undefined;
    if (args.bucketKey !== null && closeId !== undefined) {
        if (args.bucketKey === '') {
            children.push({ type: 'condition', field_id: closeId, op: 'is_null', value: null });
        } else {
            const range = bucketRange(args.bucketKey);
            if (range === null) return null;
            children.push({ type: 'condition', field_id: closeId, op: 'between_relative', value: range });
        }
    }
    children.push({ type: 'condition', field_id: args.stageFieldId, op: 'in', value: args.stageKeys });
    return { type: 'group', logic: 'and', children };
}

/** % de la meta (0 si no hay meta). */
export function goalPct(value: number, goal: number | null): number {
    if (goal === null || !(goal > 0)) return 0;
    return (value / goal) * 100;
}
