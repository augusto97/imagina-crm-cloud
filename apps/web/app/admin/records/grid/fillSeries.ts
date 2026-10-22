/**
 * v0.1.294 — Qué valores pone el RELLENO (asa de la esquina, Ctrl+D) en las
 * filas de destino, a partir de los de origen de UNA columna. Lo que hace
 * Excel/Sheets:
 *  - un solo valor de origen → se copia tal cual;
 *  - dos o más que forman una serie → la serie continúa: números con paso
 *    constante (1, 2 → 3, 4), fechas con paso constante en días o en meses
 *    (15/01, 15/02 → 15/03), fecha y hora con paso constante, y textos que
 *    terminan en número («Cuota 1», «Cuota 2» → «Cuota 3», con sus ceros);
 *  - cualquier otra cosa → se repite el patrón.
 * Puro.
 */
const NUMERIC = new Set(['number', 'currency', 'percent', 'duration', 'rating']);
const EPS = 1e-9;

export function fillValues(type: string, source: unknown[], count: number): unknown[] {
    if (count <= 0) return [];
    if (source.length === 0) return Array.from({ length: count }, () => null);
    if (source.length >= 2) {
        const series = numericSeries(type, source, count) ?? dateSeries(type, source, count) ?? datetimeSeries(type, source, count) ?? textSeries(type, source, count);
        if (series) return series;
    }
    return Array.from({ length: count }, (_, i) => source[i % source.length] ?? null);
}

function constantStep(nums: number[]): number | null {
    const step = nums[1]! - nums[0]!;
    for (let i = 2; i < nums.length; i++) {
        if (Math.abs(nums[i]! - nums[i - 1]! - step) > EPS) return null;
    }
    return step;
}

/** Redondea el ruido de coma flotante (0.1 + 0.2) a los decimales del origen. */
function roundLike(n: number, source: number[]): number {
    const decimals = Math.max(...source.map((v) => (String(v).split('.')[1] ?? '').length));
    const f = 10 ** Math.min(decimals, 10);
    return Math.round(n * f) / f;
}

function numericSeries(type: string, source: unknown[], count: number): unknown[] | null {
    if (!NUMERIC.has(type)) return null;
    if (!source.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    const nums = source as number[];
    const step = constantStep(nums);
    if (step === null) return null;
    const last = nums[nums.length - 1]!;
    return Array.from({ length: count }, (_, i) => roundLike(last + step * (i + 1), nums));
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateSeries(type: string, source: unknown[], count: number): unknown[] | null {
    if (type !== 'date') return null;
    const parts = source.map((v) => (typeof v === 'string' ? DATE_RE.exec(v) : null));
    if (parts.some((p) => p === null)) return null;
    const ymd = parts.map((p) => ({ y: Number(p![1]), m: Number(p![2]), d: Number(p![3]) }));
    // Paso en meses: mismo día del mes (o fin de mes) y meses consecutivos con paso constante.
    const monthIdx = ymd.map((x) => x.y * 12 + (x.m - 1));
    const lastDayOf = (y: number, m0: number): number => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
    const sameDay = ymd.every((x) => x.d === ymd[0]!.d);
    // «Fin de mes» (31/01, 28/02 → 31/03): cada fecha es el último día de su mes.
    const monthEnd = ymd.every((x) => x.d === lastDayOf(x.y, x.m - 1));
    const mStep = constantStep(monthIdx);
    if ((sameDay || monthEnd) && mStep !== null && mStep !== 0) {
        const last = monthIdx[monthIdx.length - 1]!;
        return Array.from({ length: count }, (_, i) => {
            const idx = last + mStep * (i + 1);
            const y = Math.floor(idx / 12);
            const m = idx - y * 12;
            const maxDay = lastDayOf(y, m);
            return isoDate(y, m + 1, monthEnd ? maxDay : Math.min(ymd[0]!.d, maxDay));
        });
    }
    const days = ymd.map((x) => Date.UTC(x.y, x.m - 1, x.d) / 86_400_000);
    const step = constantStep(days);
    if (step === null || step === 0) return null;
    const last = days[days.length - 1]!;
    return Array.from({ length: count }, (_, i) => {
        const d = new Date((last + step * (i + 1)) * 86_400_000);
        return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    });
}

function isoDate(y: number, m: number, d: number): string {
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function datetimeSeries(type: string, source: unknown[], count: number): unknown[] | null {
    if (type !== 'datetime') return null;
    const ts = source.map((v) => (typeof v === 'string' ? Date.parse(v) : NaN));
    if (ts.some((t) => !Number.isFinite(t))) return null;
    const step = constantStep(ts);
    if (step === null || step === 0) return null;
    const last = ts[ts.length - 1]!;
    return Array.from({ length: count }, (_, i) => new Date(last + step * (i + 1)).toISOString());
}

const TAIL_NUM_RE = /^(.*?)(\d+)$/;

function textSeries(type: string, source: unknown[], count: number): unknown[] | null {
    if (type !== 'text') return null;
    const m = source.map((v) => (typeof v === 'string' ? TAIL_NUM_RE.exec(v) : null));
    if (m.some((x) => x === null)) return null;
    const prefix = m[0]![1]!;
    if (!m.every((x) => x![1] === prefix)) return null;
    const nums = m.map((x) => Number(x![2]));
    const step = constantStep(nums);
    if (step === null || step === 0) return null;
    const width = m[m.length - 1]![2]!.length;
    const padded = m.some((x) => x![2]!.startsWith('0') && x![2]!.length > 1);
    const last = nums[nums.length - 1]!;
    return Array.from({ length: count }, (_, i) => {
        const n = last + step * (i + 1);
        if (n < 0) return `${prefix}${n}`;
        return `${prefix}${padded ? String(n).padStart(width, '0') : String(n)}`;
    });
}
