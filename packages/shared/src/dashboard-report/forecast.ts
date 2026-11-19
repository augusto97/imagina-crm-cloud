/**
 * v0.1.462 — Pronóstico de ventas con embudo ponderado (idea J3). PURO: la
 * probabilidad sugerida de cada etapa y la cuenta «monto × probabilidad»
 * por período. El servidor arma los montos por (período, etapa) en UNA
 * consulta y esta función los pondera; la app, el correo y el PDF dibujan
 * el resultado.
 *
 * Reglas (las mismas en todas las puntas):
 *  - 100 % = ganada: suma en «Ganado» y entra entera al pronóstico.
 *  - 0 % = perdida: no suma al embudo abierto.
 *  - Entre 1 % y 99 % = abierta: suma su monto al «Abierto» y
 *    «monto × probabilidad» al «Ponderado».
 *  - Pronóstico = Ganado + Ponderado.
 *  - Un negocio sin etapa no cuenta (se informa aparte).
 */

export interface StageOption {
    value: string;
    label: string;
}

const norm = (s: string): string =>
    s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();

const LOST_RE = /\b(perdid|perdio|lost|descartad|rechazad|cancelad|no interes|fallid|desist|abandon)/;
const WON_RE = /\b(ganad|gano|won|vendid|exit|logrado|firmad|pagad|cerrad|closed|convertid|facturad)/;

/** ¿La etapa suena a ganada (`won`), perdida (`lost`) o abierta (`open`)? */
export function stageKind(option: StageOption): 'won' | 'lost' | 'open' {
    const text = `${norm(option.label)} ${norm(option.value)}`;
    if (LOST_RE.test(text)) return 'lost';
    if (WON_RE.test(text)) return 'won';
    return 'open';
}

/**
 * Probabilidad sugerida por el NOMBRE de cada etapa: «Ganado» 100 %,
 * «Perdido» 0 % y las abiertas repartidas en su orden (4 abiertas → 20, 40,
 * 60 y 80 %).
 */
export function suggestStageProbabilities(options: readonly StageOption[]): Record<string, number> {
    const out: Record<string, number> = {};
    const open = options.filter((o) => stageKind(o) === 'open');
    let i = 0;
    for (const o of options) {
        const kind = stageKind(o);
        if (kind === 'won') out[o.value] = 100;
        else if (kind === 'lost') out[o.value] = 0;
        else {
            i += 1;
            out[o.value] = Math.round((i / (open.length + 1)) * 100);
        }
    }
    return out;
}

/** Las opciones de un campo selección (`config.options`), leídas con tolerancia. */
export function stageOptionsOf(config: Record<string, unknown> | undefined): StageOption[] {
    const raw = Array.isArray(config?.options) ? (config.options as Array<Record<string, unknown>>) : [];
    const out: StageOption[] = [];
    for (const o of raw) {
        const value = typeof o.value === 'string' ? o.value : '';
        if (value === '') continue;
        out.push({ value, label: typeof o.label === 'string' && o.label !== '' ? o.label : value });
    }
    return out;
}

/**
 * Las probabilidades que aplican: las guardadas en el widget (0-100) y, para
 * las etapas que no tienen, la sugerida.
 */
export function resolveStageProbabilities(options: readonly StageOption[], saved: unknown): Record<string, number> {
    const out = suggestStageProbabilities(options);
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
            const n = typeof v === 'number' ? v : Number(v);
            if (Number.isFinite(n)) out[k] = Math.max(0, Math.min(100, Math.round(n)));
        }
    }
    return out;
}

export interface ForecastTotals {
    won: number;
    weighted: number;
    open: number;
    lost: number;
    /** Ganado + ponderado. */
    forecast: number;
    /** Monto de los negocios sin etapa (no cuentan). */
    unassigned: number;
}

export interface ForecastBucket extends ForecastTotals {
    key: string;
}

export interface ForecastCell {
    /** Clave del período (bucket de la fecha de cierre) o null sin fecha. */
    bucket: string | null;
    /** Valor de la etapa o null sin etapa. */
    stage: string | null;
    amount: number;
}

function emptyTotals(): ForecastTotals {
    return { won: 0, weighted: 0, open: 0, lost: 0, forecast: 0, unassigned: 0 };
}

function addCell(t: ForecastTotals, stage: string | null, amount: number, probabilities: Record<string, number>): void {
    if (!Number.isFinite(amount)) return;
    if (stage === null) {
        t.unassigned += amount;
        return;
    }
    const p = probabilities[stage] ?? 0;
    if (p >= 100) t.won += amount;
    else if (p <= 0) t.lost += amount;
    else {
        t.open += amount;
        t.weighted += (amount * p) / 100;
    }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function finish(t: ForecastTotals): ForecastTotals {
    return {
        won: round2(t.won),
        weighted: round2(t.weighted),
        open: round2(t.open),
        lost: round2(t.lost),
        forecast: round2(t.won + t.weighted),
        unassigned: round2(t.unassigned),
    };
}

/**
 * Pondera los montos por (período, etapa). Devuelve un período por bucket
 * (en el orden en que llegan; los sin fecha al final, con clave `''`) y los
 * totales.
 */
export function weightForecast(cells: readonly ForecastCell[], probabilities: Record<string, number>): { buckets: ForecastBucket[]; totals: ForecastTotals } {
    const totals = emptyTotals();
    const byBucket = new Map<string, ForecastTotals>();
    for (const c of cells) {
        addCell(totals, c.stage, c.amount, probabilities);
        const key = c.bucket ?? '';
        let t = byBucket.get(key);
        if (!t) {
            t = emptyTotals();
            byBucket.set(key, t);
        }
        addCell(t, c.stage, c.amount, probabilities);
    }
    const keys = [...byBucket.keys()].filter((k) => k !== '');
    if (byBucket.has('')) keys.push('');
    return {
        buckets: keys.map((key) => ({ key, ...finish(byBucket.get(key)!) })),
        totals: finish(totals),
    };
}
