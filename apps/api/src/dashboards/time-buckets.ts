import { addDaysYmd, type AggregateMetric, type TimeBucket } from '@imagina-base/shared';

/**
 * v0.1.286 — Relleno de buckets temporales vacíos. El motor de agregados sólo
 * devuelve los buckets que TIENEN registros: una línea de "altas por mes" con
 * un mes sin altas unía directamente el mes anterior con el siguiente (la
 * pendiente mentía) y la mini-tendencia de 30 días del KPI tenía 3 puntos en
 * vez de 30. Los labels son los del motor (`timeBucketExpr`):
 * `2026-07-21` · `2026-W30` · `2026-07` · `2026-Q3` · `2026`.
 */

/** Métricas donde un bucket SIN registros vale 0 (en las demás queda el hueco). */
const ZERO_FILLABLE: ReadonlySet<AggregateMetric> = new Set([
    'count',
    'count_unique',
    'count_empty',
    'sum',
    'count_true',
    'count_false',
]);

export function zeroFillable(metric: AggregateMetric): boolean {
    return ZERO_FILLABLE.has(metric);
}

/** Tope de puntos que se rellenan (10 años por día no es un gráfico). */
const MAX_POINTS = 1000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const YEAR_RE = /^\d{4}$/;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Lunes (YYYY-MM-DD) de la semana ISO `week` del año ISO `year`. */
function isoWeekMonday(year: number, week: number): string {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const mondayW1 = addDaysYmd(jan4.toISOString().slice(0, 10), -((jan4.getUTCDay() + 6) % 7));
    return addDaysYmd(mondayW1, (week - 1) * 7);
}

/** Label ISO `IYYY-"W"IW` de una fecha YYYY-MM-DD (mismo formato que Postgres). */
export function isoWeekLabel(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00Z`);
    const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * 86_400_000);
    const year = thursday.getUTCFullYear();
    const monday = isoWeekMonday(year, 1);
    const week = 1 + Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${monday}T00:00:00Z`)) / (7 * 86_400_000));
    return `${year}-W${pad(week)}`;
}

/** El label del bucket siguiente, o null si el label no tiene la forma esperada. */
export function nextBucketLabel(label: string, bucket: TimeBucket): string | null {
    switch (bucket) {
        case 'day':
            return DAY_RE.test(label) ? addDaysYmd(label, 1) : null;
        case 'week': {
            const m = WEEK_RE.exec(label);
            if (!m) return null;
            return isoWeekLabel(addDaysYmd(isoWeekMonday(Number(m[1]), Number(m[2])), 7));
        }
        case 'month': {
            const m = MONTH_RE.exec(label);
            if (!m) return null;
            const y = Number(m[1]);
            const mo = Number(m[2]);
            return mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
        }
        case 'quarter': {
            const m = QUARTER_RE.exec(label);
            if (!m) return null;
            const y = Number(m[1]);
            const q = Number(m[2]);
            return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`;
        }
        case 'year':
            return YEAR_RE.test(label) ? String(Number(label) + 1) : null;
    }
}

interface Point {
    label: string;
    value: number | string;
}

/**
 * Rellena con 0 los buckets que faltan entre `from` y `to` (inclusive; por
 * defecto el primero y el último de la serie). Los puntos que no son buckets
 * (el "(sin valor)" de los registros sin fecha, "Otros") se conservan al final.
 */
export function fillTimeBuckets<T extends Point>(
    rows: T[],
    bucket: TimeBucket,
    range: { from?: string; to?: string } = {},
): Array<T | Point> {
    const isBucket = (r: Point) => nextBucketLabel(r.label, bucket) !== null;
    const series = rows.filter(isBucket).sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    const rest = rows.filter((r) => !isBucket(r));
    const from = range.from ?? series[0]?.label;
    const to = range.to ?? series[series.length - 1]?.label;
    if (from === undefined || to === undefined || from > to) return rows;
    const byLabel = new Map(series.map((r) => [r.label, r]));
    const out: Array<T | Point> = [];
    let cur: string | null = from;
    while (cur !== null && cur <= to) {
        if (out.length >= MAX_POINTS) return rows; // demasiado largo: sin relleno
        out.push(byLabel.get(cur) ?? { label: cur, value: 0 });
        cur = nextBucketLabel(cur, bucket);
    }
    // Buckets fuera del rango pedido (no debería pasar con el filtro aplicado).
    for (const r of series) if (r.label < from || r.label > to) out.push(r);
    out.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return [...out, ...rest];
}
