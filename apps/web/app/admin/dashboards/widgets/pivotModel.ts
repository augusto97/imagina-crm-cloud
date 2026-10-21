import type { PivotData } from '@/types/dashboard';

/**
 * v0.1.291 — Modelo de la tabla dinámica (puro, testeable): filas y columnas
 * con etiqueta y total, los cruces indexados, y el rango de valores para el
 * mapa de calor.
 */
export interface PivotAxis {
    key: string;
    label: string;
    total: number | string | null;
}

export interface PivotModel {
    rows: PivotAxis[];
    cols: PivotAxis[];
    total: number | string | null;
    cell: (row: string, col: string) => number | string | null;
    /** Rango de los cruces numéricos (mapa de calor). */
    min: number;
    max: number;
}

type Sorter = (rows: Array<{ label: string; value: number }>) => Array<{ label: string; value: number }>;

const num = (v: number | string | null): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function buildPivot(
    data: PivotData,
    opts: {
        rowLabel: (key: string, others?: number) => string;
        colLabel: (key: string, others?: number) => string;
        sortRows?: Sorter;
        sortCols?: Sorter;
    },
): PivotModel {
    const reorder = <T extends { key: string; value: number | string | null }>(items: T[], sorter?: Sorter): T[] => {
        if (!sorter) return items;
        const byKey = new Map(items.map((i) => [i.key, i]));
        return sorter(items.map((i) => ({ label: i.key, value: num(i.value) })))
            .map((s) => byKey.get(s.label))
            .filter((i): i is T => i !== undefined);
    };
    const rows = reorder(data.rows, opts.sortRows).map((r) => ({ key: r.key, label: opts.rowLabel(r.key, r.others), total: r.value }));
    const cols = reorder(data.cols, opts.sortCols).map((c) => ({ key: c.key, label: opts.colLabel(c.key, c.others), total: c.value }));
    const cells = new Map<string, number | string | null>();
    let min = Infinity;
    let max = -Infinity;
    for (const c of data.cells) {
        cells.set(`${c.row}\u0000${c.col}`, c.value);
        if (typeof c.value === 'number' && Number.isFinite(c.value)) {
            min = Math.min(min, c.value);
            max = Math.max(max, c.value);
        }
    }
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = 0;
    return {
        rows,
        cols,
        total: data.total,
        cell: (row, col) => cells.get(`${row}\u0000${col}`) ?? null,
        min,
        max,
    };
}

/**
 * Intensidad del mapa de calor (0.06 – 0.5): un solo tono con transparencia,
 * así el texto (el color normal del tema) se lee en claro y en oscuro.
 */
export function heatAlpha(value: number, min: number, max: number): number {
    if (!(max > min)) return max > 0 ? 0.3 : 0;
    const t = (value - Math.min(min, 0)) / (max - Math.min(min, 0));
    return 0.06 + Math.max(0, Math.min(1, t)) * 0.44;
}
