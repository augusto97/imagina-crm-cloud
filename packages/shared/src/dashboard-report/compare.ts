import { addDaysYmd } from '../schemas/timezone';

/**
 * v0.1.462 — Comparar períodos en los widgets de un tablero (idea J2). Todo
 * PURO: la ventana anterior, cómo se alinean dos series de tiempo (el día 1
 * con el día 1), las etiquetas («Este mes vs. mes anterior») y la variación.
 * Lo usan el servidor (que calcula los dos períodos en el mismo bundle) y,
 * para mostrar, la app, el correo, el PDF y la página pública.
 */

export const COMPARE_MODES = ['previous', 'last_year', 'custom'] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

/** Lo que guarda un widget en `config.compare` (o llega del tablero). */
export interface CompareSpec {
    mode: CompareMode;
    /** Sólo `custom`: el rango con el que se compara (YYYY-MM-DD). */
    from?: string;
    to?: string;
    /**
     * «Hasta el mismo día» (por defecto sí): si el período actual todavía no
     * terminó, el anterior se corta en el mismo punto (hoy es 19 → el 1–19 del
     * mes anterior). No aplica a las series de tiempo, que dibujan el período
     * anterior completo.
     */
    to_date: boolean;
}

export interface YmdRange {
    from: string;
    to: string;
}

export interface CompareWindows {
    current: YmdRange;
    /** El período con el que se compara, completo. */
    previous: YmdRange;
    /** El anterior cortado en el mismo punto que el actual (si aplica). */
    previousToDate: YmdRange | null;
    /** El actual hasta hoy (sólo junto con `previousToDate`, para las etiquetas). */
    currentToDate: YmdRange | null;
    /** Cómo se corrió la ventana: por meses de calendario o por días. */
    shift: 'months' | 'days' | 'custom';
}

/** Ventanas de más de ~10 años no se comparan (un «de hoy en adelante» no es una ventana). */
export const MAX_COMPARE_DAYS = 3660;
/** Tope de puntos de una serie comparada. */
export const MAX_COMPARE_POINTS = 1000;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const CUSTOM_OVERRIDE_RE = /^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/;

/** `config.compare` de un widget, leído con tolerancia. `null` = no compara. */
export function readCompareConfig(raw: unknown): CompareSpec | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const mode = r.mode;
    if (mode !== 'previous' && mode !== 'last_year' && mode !== 'custom') return null;
    const toDate = r.to_date !== false;
    if (mode === 'custom') {
        const from = typeof r.from === 'string' && YMD_RE.test(r.from) ? r.from : null;
        const to = typeof r.to === 'string' && YMD_RE.test(r.to) ? r.to : null;
        if (from === null || to === null || !validYmd(from) || !validYmd(to)) return null;
        return from <= to ? { mode, from, to, to_date: false } : { mode, from: to, to: from, to_date: false };
    }
    return { mode, to_date: toDate };
}

/**
 * La comparación GLOBAL del tablero (viaja en el bundle): `''`/ausente = lo
 * de cada widget; `none` = ningún widget compara; `previous`, `last_year` o
 * `custom:YYYY-MM-DD:YYYY-MM-DD` = todos los widgets con período.
 * Devuelve `undefined` si lo que llegó no se entiende (se ignora).
 */
export function parseCompareOverride(raw: unknown): CompareSpec | 'none' | null | undefined {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string' || raw.length > 64) return undefined;
    if (raw === 'none') return 'none';
    if (raw === 'previous' || raw === 'last_year') return { mode: raw, to_date: true };
    const m = CUSTOM_OVERRIDE_RE.exec(raw);
    if (m && validYmd(m[1]!) && validYmd(m[2]!)) {
        return m[1]! <= m[2]! ? { mode: 'custom', from: m[1], to: m[2], to_date: false } : { mode: 'custom', from: m[2], to: m[1], to_date: false };
    }
    return undefined;
}

/** La comparación que aplica a un widget: la global del tablero pisa la suya. */
export function effectiveCompare(widgetConfig: Record<string, unknown> | undefined, override: CompareSpec | 'none' | null | undefined): CompareSpec | null {
    if (override === 'none') return null;
    if (override) {
        // La del tablero respeta el «hasta el mismo día» del widget.
        const own = readCompareConfig(widgetConfig?.compare);
        return override.mode === 'custom' ? override : { ...override, to_date: own ? own.to_date : override.to_date };
    }
    return readCompareConfig(widgetConfig?.compare);
}

function validYmd(ymd: string): boolean {
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parts(ymd: string): [number, number, number] {
    return ymd.split('-').map(Number) as [number, number, number];
}

function ymdOf(y: number, m: number, d: number): string {
    return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

function monthLength(y: number, m: number): number {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** `ymd` corrido N meses, con el día recortado al largo del mes (31 ene − 1 mes no existe → 31 dic; 31 mar − 1 mes → 28/29 feb). */
export function shiftMonthsClamp(ymd: string, months: number): string {
    const [y, m, d] = parts(ymd);
    const idx = y * 12 + (m - 1) + months;
    const ny = Math.floor(idx / 12);
    const nm = (idx % 12 + 12) % 12 + 1;
    return ymdOf(ny, nm, Math.min(d, monthLength(ny, nm)));
}

/** `ymd` corrido N años (el 29 de febrero cae en el 28 en un año no bisiesto). */
export function shiftYearsClamp(ymd: string, years: number): string {
    return shiftMonthsClamp(ymd, years * 12);
}

/** Días de una ventana inclusive. */
export function rangeDays(r: YmdRange): number {
    return Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** ¿La ventana son meses de calendario completos (del día 1 al último)? */
function monthAligned(r: YmdRange): boolean {
    const [fy, fm, fd] = parts(r.from);
    const [ty, tm, td] = parts(r.to);
    void fy;
    void fm;
    return fd === 1 && td === monthLength(ty, tm);
}

function monthsSpan(r: YmdRange): number {
    const [fy, fm] = parts(r.from);
    const [ty, tm] = parts(r.to);
    return (ty * 12 + tm) - (fy * 12 + fm) + 1;
}

/** Presets que miran hacia adelante: su «hasta hoy» no tiene sentido. */
const FORWARD_PRESETS = new Set(['next_7_days', 'next_30_days', 'from_today']);

/**
 * Las dos ventanas de una comparación. `null` si no se puede comparar (una
 * ventana de más de ~10 años, como «de hoy en adelante»).
 *
 *  - Período anterior: una ventana de meses completos («este mes», «este
 *    trimestre», «este año») se corre esa cantidad de MESES (noviembre →
 *    octubre aunque tengan distinto largo); cualquier otra, su largo en días
 *    («últimos 7 días» → los 7 anteriores).
 *  - Mismo período del año pasado: un año atrás (el 29 de febrero → 28).
 *  - Rango elegido: el que se eligió.
 */
export function comparisonWindows(current: YmdRange, spec: CompareSpec, opts: { today: string; preset?: string }): CompareWindows | null {
    if (!YMD_RE.test(current.from) || !YMD_RE.test(current.to)) return null;
    if (rangeDays(current) > MAX_COMPARE_DAYS || rangeDays(current) < 1) return null;
    if (spec.mode === 'custom') {
        if (!spec.from || !spec.to) return null;
        const previous = { from: spec.from, to: spec.to };
        if (rangeDays(previous) > MAX_COMPARE_DAYS) return null;
        return { current, previous, previousToDate: null, currentToDate: null, shift: 'custom' };
    }
    const aligned = monthAligned(current);
    const k = spec.mode === 'last_year' ? 12 : monthsSpan(current);
    let previous: YmdRange;
    let map: (ymd: string) => string;
    if (spec.mode === 'last_year') {
        if (aligned) {
            const [ty, tm] = parts(shiftMonthsClamp(current.to, -12));
            previous = { from: shiftMonthsClamp(current.from, -12), to: ymdOf(ty, tm, monthLength(ty, tm)) };
        } else {
            previous = { from: shiftYearsClamp(current.from, -1), to: shiftYearsClamp(current.to, -1) };
        }
        map = (ymd) => shiftYearsClamp(ymd, -1);
    } else if (aligned) {
        const [ty, tm] = parts(shiftMonthsClamp(current.to, -k));
        previous = { from: shiftMonthsClamp(current.from, -k), to: ymdOf(ty, tm, monthLength(ty, tm)) };
        map = (ymd) => shiftMonthsClamp(ymd, -k);
    } else {
        const len = rangeDays(current);
        previous = { from: addDaysYmd(current.from, -len), to: addDaysYmd(current.from, -1) };
        map = (ymd) => addDaysYmd(ymd, -len);
    }
    let previousToDate: YmdRange | null = null;
    let currentToDate: YmdRange | null = null;
    const forward = opts.preset !== undefined && FORWARD_PRESETS.has(opts.preset);
    if (spec.to_date && !forward && current.from <= opts.today && opts.today < current.to) {
        const cut = map(opts.today);
        previousToDate = { from: previous.from, to: cut < previous.from ? previous.from : cut > previous.to ? previous.to : cut };
        currentToDate = { from: current.from, to: opts.today };
    }
    return { current, previous, previousToDate, currentToDate, shift: aligned && spec.mode !== 'last_year' ? 'months' : 'days' };
}

// --- Variación ---------------------------------------------------------------

export interface CompareDelta {
    /** % de cambio (1 decimal). `null` si antes era 0 y ahora no (no hay %). */
    pct: number | null;
    diff: number;
    direction: 'up' | 'down' | 'flat';
    /** Bueno, malo o neutro según «menos es mejor». */
    tone: 'good' | 'bad' | 'neutral';
}

/** Variación entre el valor actual y el anterior. `invert`: menos es mejor (costos, tickets abiertos). */
export function compareDelta(current: number | null | undefined, previous: number | null | undefined, invert = false): CompareDelta | null {
    if (typeof current !== 'number' || typeof previous !== 'number' || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
    const diff = current - previous;
    const pct = previous === 0 ? (current === 0 ? 0 : null) : Math.round((diff / Math.abs(previous)) * 1000) / 10;
    const direction = Math.abs(diff) < 1e-9 ? 'flat' : diff > 0 ? 'up' : 'down';
    const tone = direction === 'flat' ? 'neutral' : (direction === 'up') !== invert ? 'good' : 'bad';
    return { pct, diff, direction, tone };
}

/** «+12 %», «−3,5 %», «0 %», «Nuevo» (antes era 0). */
export function formatDeltaPct(delta: CompareDelta | null, numberFormat: 'comma_dot' | 'dot_comma' | 'space_comma' = 'comma_dot'): string {
    if (delta === null) return '—';
    if (delta.pct === null) return 'Nuevo';
    const abs = Math.abs(delta.pct);
    const txt = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace('.', numberFormat === 'comma_dot' ? '.' : ',');
    const sign = delta.direction === 'up' ? '+' : delta.direction === 'down' ? '−' : '';
    return `${sign}${txt}\u00a0%`;
}

// --- Etiquetas -----------------------------------------------------------------

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Rango corto: «1–19 nov 2026», «1 oct – 15 nov 2026», «28 dic 2025 – 3 ene 2026», «nov 2026». */
export function formatYmdRange(r: YmdRange): string {
    const [fy, fm, fd] = parts(r.from);
    const [ty, tm, td] = parts(r.to);
    if (r.from === r.to) return `${fd} ${MONTHS[fm - 1]} ${fy}`;
    if (fd === 1 && td === monthLength(ty, tm)) {
        if (fy === ty && fm === tm) return `${MONTHS[fm - 1]} ${fy}`;
        if (fy === ty && fm === 1 && tm === 12) return String(fy);
        if (fy === ty) return `${MONTHS[fm - 1]} – ${MONTHS[tm - 1]} ${ty}`;
        return `${MONTHS[fm - 1]} ${fy} – ${MONTHS[tm - 1]} ${ty}`;
    }
    if (fy === ty && fm === tm) return `${fd}–${td} ${MONTHS[fm - 1]} ${fy}`;
    if (fy === ty) return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]} ${ty}`;
    return `${fd} ${MONTHS[fm - 1]} ${fy} – ${td} ${MONTHS[tm - 1]} ${ty}`;
}

const N_DAYS_RE = /^last_(\d+)_days$/;

export interface CompareLabels {
    /** «Este mes vs. mes anterior». */
    label: string;
    /** Lo que va al lado de la variación: «vs. mes anterior». */
    short: string;
    /** «1–19 nov 2026 vs. 1–19 oct 2026». */
    detail: string;
}

/**
 * Las etiquetas de una comparación, según el período (preset del widget o
 * del tablero) y el modo. `preset` es `undefined` para un rango propio.
 */
export function compareLabels(spec: CompareSpec, windows: CompareWindows, preset?: string): CompareLabels {
    const prev = windows.previousToDate ?? windows.previous;
    const detail = `${formatYmdRange(windows.currentToDate ?? windows.current)} vs. ${formatYmdRange(prev)}`;
    const [cy] = parts(windows.current.from);
    const [py] = parts(windows.previous.from);
    if (spec.mode === 'custom') {
        const r = formatYmdRange(windows.previous);
        return { label: `${presetName(preset) ?? formatYmdRange(windows.current)} vs. ${r}`, short: `vs. ${r}`, detail };
    }
    if (spec.mode === 'last_year') {
        switch (preset) {
            case 'this_year':
            case 'last_year':
                return { label: `${cy} vs. ${py}`, short: `vs. ${py}`, detail };
            case 'this_month':
            case 'last_month': {
                const [, m] = parts(windows.current.from);
                return {
                    label: `${cap(MONTHS_LONG[m - 1]!)} ${cy} vs. ${MONTHS_LONG[m - 1]} ${py}`,
                    short: `vs. ${MONTHS_LONG[m - 1]} ${py}`,
                    detail,
                };
            }
            case 'this_quarter':
            case 'last_quarter':
                return { label: `${presetName(preset)} vs. mismo trimestre de ${py}`, short: `vs. mismo trimestre de ${py}`, detail };
            case 'this_week':
            case 'last_week':
                return { label: `${presetName(preset)} vs. misma semana de ${py}`, short: `vs. misma semana de ${py}`, detail };
            case 'today':
            case 'yesterday':
                return { label: `${presetName(preset)} vs. mismo día de ${py}`, short: `vs. mismo día de ${py}`, detail };
            default: {
                const name = presetName(preset);
                if (name) return { label: `${name} vs. mismo período de ${py}`, short: `vs. mismo período de ${py}`, detail };
                // Un rango propio: los dos rangos, tal cual («feb 2028 vs. feb 2027»).
                const r = formatYmdRange(windows.previous);
                return { label: `${formatYmdRange(windows.current)} vs. ${r}`, short: `vs. ${r}`, detail };
            }
        }
    }
    const nDays = preset ? N_DAYS_RE.exec(preset) : null;
    if (nDays) return { label: `Últimos ${nDays[1]} días vs. los ${nDays[1]} anteriores`, short: `vs. los ${nDays[1]} días anteriores`, detail };
    switch (preset) {
        case 'today':
            return { label: 'Hoy vs. ayer', short: 'vs. ayer', detail };
        case 'yesterday':
            return { label: 'Ayer vs. el día anterior', short: 'vs. el día anterior', detail };
        case 'this_week':
            return { label: 'Esta semana vs. semana anterior', short: 'vs. semana anterior', detail };
        case 'last_week':
            return { label: 'Semana pasada vs. la anterior', short: 'vs. la semana anterior', detail };
        case 'this_month':
            return { label: 'Este mes vs. mes anterior', short: 'vs. mes anterior', detail };
        case 'last_month':
            return { label: 'Mes pasado vs. el anterior', short: 'vs. el mes anterior', detail };
        case 'this_quarter':
            return { label: 'Este trimestre vs. trimestre anterior', short: 'vs. trimestre anterior', detail };
        case 'last_quarter':
            return { label: 'Trimestre pasado vs. el anterior', short: 'vs. el trimestre anterior', detail };
        case 'this_year':
        case 'last_year':
            return { label: `${cy} vs. ${py}`, short: `vs. ${py}`, detail };
        default: {
            const name = presetName(preset);
            if (name) return { label: `${name} vs. período anterior`, short: 'vs. período anterior', detail };
            const r = formatYmdRange(windows.previous);
            return { label: `${formatYmdRange(windows.current)} vs. ${r}`, short: `vs. ${r}`, detail };
        }
    }
}

function cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function presetName(preset: string | undefined): string | null {
    switch (preset) {
        case 'today':
            return 'Hoy';
        case 'yesterday':
            return 'Ayer';
        case 'this_week':
            return 'Esta semana';
        case 'last_week':
            return 'Semana pasada';
        case 'this_month':
            return 'Este mes';
        case 'last_month':
            return 'Mes pasado';
        case 'this_quarter':
            return 'Este trimestre';
        case 'last_quarter':
            return 'Trimestre pasado';
        case 'this_year':
            return 'Este año';
        case 'last_year':
            return 'Año pasado';
        case 'next_7_days':
            return 'Próximos 7 días';
        case 'next_30_days':
            return 'Próximos 30 días';
        default: {
            const m = preset ? N_DAYS_RE.exec(preset) : null;
            return m ? `Últimos ${m[1]} días` : null;
        }
    }
}

// --- Series de tiempo ------------------------------------------------------------

export type CompareBucket = 'day' | 'week' | 'month' | 'quarter' | 'year';

function isoWeekKey(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7;
    const thursday = new Date(d.getTime() + (3 - dow) * 86_400_000);
    const year = thursday.getUTCFullYear();
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const week1 = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000);
    const week = Math.floor((thursday.getTime() - week1.getTime()) / (7 * 86_400_000)) + 1;
    return `${year}-W${String(week).padStart(2, '0')}`;
}

/** La clave del bucket de una fecha: la misma que arma el SQL (`2026-11-19`, `2026-W47`, `2026-11`, `2026-Q4`, `2026`). */
export function bucketKeyOf(ymd: string, bucket: CompareBucket): string {
    const [y, m] = parts(ymd);
    switch (bucket) {
        case 'day':
            return ymd;
        case 'week':
            return isoWeekKey(ymd);
        case 'month':
            return `${y}-${String(m).padStart(2, '0')}`;
        case 'quarter':
            return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
        case 'year':
            return String(y);
    }
}

/** Las claves de los buckets que toca una ventana, en orden (sin repetir). */
export function bucketKeysInRange(r: YmdRange, bucket: CompareBucket, max = MAX_COMPARE_POINTS + 1): string[] {
    const out: string[] = [];
    let cur = r.from;
    let last = '';
    while (cur <= r.to && out.length < max) {
        const k = bucketKeyOf(cur, bucket);
        if (k !== last) {
            out.push(k);
            last = k;
        }
        // Saltos grandes para no recorrer día por día un año entero de meses.
        if (bucket === 'day' || bucket === 'week') cur = addDaysYmd(cur, bucket === 'day' ? 1 : 7 - ((new Date(`${cur}T00:00:00Z`).getUTCDay() + 6) % 7));
        else if (bucket === 'month') cur = shiftMonthsClamp(`${cur.slice(0, 8)}01`, 1);
        else if (bucket === 'quarter') {
            const [y, m] = parts(cur);
            const q = Math.floor((m - 1) / 3);
            cur = ymdOf(y, q * 3 + 4, 1);
        } else cur = `${Number(cur.slice(0, 4)) + 1}-01-01`;
    }
    return out;
}

/** Un punto de una serie comparada, alineado por POSICIÓN (el día 1 con el día 1). */
export interface ComparePoint {
    /** Clave del bucket del período actual (null: el anterior es más largo). */
    label: string | null;
    /** Clave del bucket del período anterior (null: el actual es más largo). */
    prev_label: string | null;
    value: number | null;
    previous: number | null;
}

/**
 * Alinea dos series de tiempo por posición: el primer bucket del período
 * actual con el primero del anterior. El actual llega hasta hoy (o hasta su
 * último dato, si tiene fechas futuras); el anterior va completo.
 * `zeroFill`: un bucket sin registros vale 0 (conteos y sumas); si no, null.
 */
export function alignComparedSeries(args: {
    current: ReadonlyArray<{ label: string; value: number }>;
    previous: ReadonlyArray<{ label: string; value: number }>;
    currentKeys: readonly string[];
    previousKeys: readonly string[];
    todayKey: string | null;
    zeroFill: boolean;
}): ComparePoint[] {
    const cur = new Map(args.current.map((r) => [r.label, r.value]));
    const prev = new Map(args.previous.map((r) => [r.label, r.value]));
    const todayIdx = args.todayKey !== null ? args.currentKeys.indexOf(args.todayKey) : -1;
    let lastData = -1;
    args.currentKeys.forEach((k, i) => {
        if (cur.has(k)) lastData = i;
    });
    const n = todayIdx >= 0 ? Math.max(todayIdx, lastData) + 1 : args.currentKeys.length;
    const len = Math.min(MAX_COMPARE_POINTS, Math.max(n, args.previousKeys.length));
    const out: ComparePoint[] = [];
    const fill = (m: Map<string, number>, k: string): number | null => m.get(k) ?? (args.zeroFill ? 0 : null);
    for (let i = 0; i < len; i++) {
        const k = i < n ? args.currentKeys[i] ?? null : null;
        const pk = args.previousKeys[i] ?? null;
        out.push({
            label: k,
            prev_label: pk,
            value: k === null ? null : fill(cur, k),
            previous: pk === null ? null : fill(prev, pk),
        });
    }
    return out;
}

/** v0.1.464 (J1) — El nombre de un período (preset) legible, o `null` si no es uno conocido. */
export function periodPresetName(preset: string | undefined): string | null {
    return presetName(preset);
}
