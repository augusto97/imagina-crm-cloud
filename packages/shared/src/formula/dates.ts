/**
 * Fórmulas — calendario: fechas puras (sin zona), días hábiles y festivos de
 * Colombia.
 *
 * Una FECHA es un día del calendario (`YYYY-MM-DD`) y se maneja como los
 * milisegundos de su medianoche UTC, sólo para hacer cuentas: nunca se le
 * aplica una zona. Una FECHA Y HORA es un instante; su día, mes y hora se
 * leen en la zona de la empresa (ADR-S33).
 */

const DAY_MS = 86_400_000;

export function ymdToMs(y: number, m: number, d: number): number {
    return Date.UTC(y, m - 1, d);
}

export function msToYmd(ms: number): string {
    const d = new Date(ms);
    return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function partsOfDateMs(ms: number): { y: number; m: number; d: number; dow: number } {
    const d = new Date(ms);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay() };
}

export function addDaysMs(ms: number, days: number): number {
    return ms + days * DAY_MS;
}

/** Suma meses al día del calendario: si el día no existe, el último del mes (31/01 + 1 = 28/02). */
export function addMonthsYmd(y: number, m: number, d: number, months: number): { y: number; m: number; d: number } {
    const total = y * 12 + (m - 1) + months;
    const ny = Math.floor(total / 12);
    const nm = total - ny * 12 + 1;
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return { y: ny, m: nm, d: Math.min(d, last) };
}

/** Diferencia en días entre dos fechas del calendario (b − a). */
export function daysBetweenMs(a: number, b: number): number {
    return Math.round((b - a) / DAY_MS);
}

/**
 * Meses COMPLETOS de `a` a `b` (como DATEDIF "M" y el `age()` de Postgres):
 * del 31 de enero al 28 de febrero hay 0; al 31 de marzo, 2.
 */
export function completeMonthsBetween(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }): number {
    const sign = cmp(a, b) <= 0 ? 1 : -1;
    const [lo, hi] = sign === 1 ? [a, b] : [b, a];
    let months = (hi.y - lo.y) * 12 + (hi.m - lo.m);
    if (hi.d < lo.d) months -= 1;
    return sign * Math.max(0, months);
}

function cmp(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }): number {
    return a.y - b.y || a.m - b.m || a.d - b.d;
}

// ─── Festivos de Colombia ───────────────────────────────────────────────

/**
 * Domingo de Pascua (algoritmo anónimo gregoriano — Meeus/Jones/Butcher).
 * Devuelve el día del calendario en ms.
 */
export function easterSundayMs(year: number): number {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return ymdToMs(year, month, day);
}

/** El lunes siguiente (o el mismo día, si ya es lunes): la Ley Emiliani. */
function nextMondayMs(ms: number): number {
    const dow = new Date(ms).getUTCDay(); // 0 = domingo
    const shift = (8 - dow) % 7; // lunes → 0
    return addDaysMs(ms, shift);
}

const holidayCache = new Map<number, ReadonlySet<number>>();

/**
 * Festivos de Colombia de un año, CALCULADOS (Ley 51 de 1983, «Ley
 * Emiliani», y Semana Santa por la fecha de Pascua) — sin una lista fija por
 * año que haya que actualizar:
 *  - fijos: 1 de enero, 1 de mayo, 20 de julio, 7 de agosto, 8 y 25 de
 *    diciembre;
 *  - trasladables al lunes siguiente: Reyes (6 ene), San José (19 mar),
 *    San Pedro y San Pablo (29 jun), Asunción (15 ago), Día de la Raza
 *    (12 oct), Todos los Santos (1 nov), Independencia de Cartagena (11 nov);
 *  - por la Pascua: Jueves y Viernes Santo, Ascensión (+43, lunes), Corpus
 *    Christi (+64, lunes) y Sagrado Corazón (+71, lunes).
 */
export function colombianHolidays(year: number): ReadonlySet<number> {
    const hit = holidayCache.get(year);
    if (hit) return hit;
    const out = new Set<number>();
    for (const [m, d] of [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]] as const) out.add(ymdToMs(year, m, d));
    for (const [m, d] of [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]] as const) {
        out.add(nextMondayMs(ymdToMs(year, m, d)));
    }
    const easter = easterSundayMs(year);
    for (const offset of [-3, -2, 43, 64, 71]) out.add(addDaysMs(easter, offset));
    if (holidayCache.size > 200) holidayCache.clear();
    holidayCache.set(year, out);
    return out;
}

export function isColombianHoliday(ms: number): boolean {
    return colombianHolidays(new Date(ms).getUTCFullYear()).has(ms);
}

/** ¿Es día hábil? (ni sábado, ni domingo, ni festivo de Colombia). */
export function isBusinessDay(ms: number): boolean {
    const dow = new Date(ms).getUTCDay();
    return dow !== 0 && dow !== 6 && !isColombianHoliday(ms);
}

/**
 * Suma días HÁBILES (como WORKDAY de Excel): el día de partida no cuenta; con
 * 0 devuelve la misma fecha; con un número negativo va hacia atrás.
 */
export function addBusinessDaysMs(ms: number, days: number): number {
    const n = Math.trunc(days);
    if (n === 0) return ms;
    const step = n > 0 ? 1 : -1;
    let left = Math.abs(n);
    let cur = ms;
    // Tope: 20 años de calendario (una fórmula no debería ir más lejos).
    for (let guard = 0; left > 0 && guard < 7300; guard++) {
        cur = addDaysMs(cur, step);
        if (isBusinessDay(cur)) left--;
    }
    return cur;
}

// ─── Nombres en español ─────────────────────────────────────────────────

export const MONTH_NAMES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;
export const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;
export const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;
export const DAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const;

const DATE_TOKENS = ['AAAA', 'YYYY', 'MMMM', 'DDDD', 'AMPM', 'AA', 'YY', 'MMM', 'DDD', 'MM', 'DD', 'HH', 'hh', 'mm', 'ss', 'M', 'D', 'H'] as const;

export interface CalendarParts {
    y: number;
    m: number;
    d: number;
    dow: number;
    hour: number;
    minute: number;
    second: number;
}

/**
 * Arma un texto con un patrón de fecha: `AAAA` año, `MMMM` mes con su
 * nombre, `DD` día con dos cifras, `HH`/`hh` hora (24 / 12), `mm` minutos…
 * Lo que va entre [corchetes] sale tal cual.
 */
export function formatDatePattern(p: CalendarParts, pattern: string): string {
    let out = '';
    let i = 0;
    while (i < pattern.length) {
        if (pattern[i] === '[') {
            const close = pattern.indexOf(']', i + 1);
            if (close > i) {
                out += pattern.slice(i + 1, close);
                i = close + 1;
                continue;
            }
        }
        const tok = DATE_TOKENS.find((t) => pattern.startsWith(t, i));
        if (!tok) {
            out += pattern[i];
            i++;
            continue;
        }
        i += tok.length;
        const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
        switch (tok) {
            case 'AAAA':
            case 'YYYY':
                out += String(p.y).padStart(4, '0');
                break;
            case 'AA':
            case 'YY':
                out += String(p.y % 100).padStart(2, '0');
                break;
            case 'MMMM':
                out += MONTH_NAMES[p.m - 1] ?? '';
                break;
            case 'MMM':
                out += MONTH_SHORT[p.m - 1] ?? '';
                break;
            case 'MM':
                out += String(p.m).padStart(2, '0');
                break;
            case 'M':
                out += String(p.m);
                break;
            case 'DDDD':
                out += DAY_NAMES[p.dow] ?? '';
                break;
            case 'DDD':
                out += DAY_SHORT[p.dow] ?? '';
                break;
            case 'DD':
                out += String(p.d).padStart(2, '0');
                break;
            case 'D':
                out += String(p.d);
                break;
            case 'HH':
                out += String(p.hour).padStart(2, '0');
                break;
            case 'H':
                out += String(p.hour);
                break;
            case 'hh':
                out += String(h12);
                break;
            case 'mm':
                out += String(p.minute).padStart(2, '0');
                break;
            case 'ss':
                out += String(p.second).padStart(2, '0');
                break;
            case 'AMPM':
                out += p.hour < 12 ? 'a. m.' : 'p. m.';
                break;
        }
    }
    return out;
}
