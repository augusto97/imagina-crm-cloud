/**
 * Calcula la "siguiente fecha" para una recurrencia dada. Port PURO de
 * `Recurrences/DateRoller.php` del plugin (no toca DB ni estado).
 *
 * Soporta:
 *   - daily / weekly / yearly / days_after con `interval_n`.
 *   - Patrones mensuales: same_day, first_day, last_day, weekday
 *     (= N-ésimo día de la semana del mes; ej. "2do jueves").
 *
 * Edge cases (mismos del plugin):
 *   - Mensual same_day: si el día actual es 31 y el mes target tiene 30,
 *     usa el último día del mes target (no overflow al siguiente).
 *   - last_day: respeta los días reales de cada mes (28/29/30/31).
 *   - weekday: si la N-ésima ocurrencia no existe (ej. 5to jueves), usa
 *     la anterior.
 *   - Anual: 29-feb + 1 año → 28-feb (target no bisiesto).
 *
 * TODO en UTC. Los strings de fecha se parsean a mano por componentes
 * (regex) — jamás `new Date(str)` con strings ambiguos (el parseo de
 * strings sin zona varía por runtime).
 */

export interface RollSpec {
    frequency: string;
    intervalN: number;
    monthlyPattern: string | null;
}

/** Componentes de la fecha parseada + metadata de formato para re-serializar. */
interface DateParts {
    y: number;
    m: number; // 1-12
    d: number;
    hh: number;
    mm: number;
    ss: number;
    hasTime: boolean;
    /** Separador fecha/hora original ('T' o ' ') — se preserva. */
    sep: 'T' | ' ';
    /** Sufijo de zona original ('Z', '+02:00', …) — se preserva verbatim. */
    suffix: string;
}

const DATE_RE =
    /^(\d{4})-(\d{2})-(\d{2})(?:([ T])(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function parseDate(value: string): DateParts {
    const m = DATE_RE.exec(value.trim());
    if (!m) throw new Error(`Fecha inválida para recurrencia: "${value}"`);
    const hasTime = m[4] !== undefined;
    return {
        y: Number(m[1]),
        m: Number(m[2]),
        d: Number(m[3]),
        hh: hasTime ? Number(m[5]) : 0,
        mm: hasTime ? Number(m[6]) : 0,
        ss: hasTime && m[7] !== undefined ? Number(m[7]) : 0,
        hasTime,
        sep: m[4] === 'T' ? 'T' : ' ',
        suffix: m[8] ?? '',
    };
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Serializa preservando el formato original (con/sin hora, separador, zona). */
function formatDate(p: DateParts): string {
    const date = `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
    if (!p.hasTime) return date;
    return `${date}${p.sep}${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}${p.suffix}`;
}

/** Días del mes (m: 1-12), vía Date.UTC con componentes explícitos. */
function daysInMonth(y: number, m: number): number {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Día de la semana (0=dom..6=sáb) de una fecha por componentes, en UTC. */
function weekdayOf(y: number, m: number, d: number): number {
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Suma días dejando que Date.UTC normalice el overflow (siempre UTC). */
function addDays(p: DateParts, days: number): DateParts {
    const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
    return { ...p, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/**
 * Suma años con manejo explícito de 29-feb → 28-feb cuando el año target
 * no es bisiesto (lógica de meses/días a mano — nada de setFullYear a ciegas).
 */
function addYears(p: DateParts, n: number): DateParts {
    const y = p.y + n;
    const d = Math.min(p.d, daysInMonth(y, p.m));
    return { ...p, y, d };
}

/** Avanza meses respetando el patrón configurado (port de addMonths del plugin). */
function addMonths(p: DateParts, n: number, pattern: string): DateParts {
    let targetMonth = p.m + n;
    let targetYear = p.y + Math.floor((targetMonth - 1) / 12);
    targetMonth = ((targetMonth - 1) % 12) + 1;
    if (targetMonth <= 0) {
        targetMonth += 12;
        targetYear--;
    }

    switch (pattern) {
        case 'first_day':
            return { ...p, y: targetYear, m: targetMonth, d: 1 };
        case 'last_day':
            return { ...p, y: targetYear, m: targetMonth, d: daysInMonth(targetYear, targetMonth) };
        case 'weekday':
            return nthWeekdayOfMonth(targetYear, targetMonth, p);
        case 'same_day':
        default:
            return {
                ...p,
                y: targetYear,
                m: targetMonth,
                d: Math.min(p.d, daysInMonth(targetYear, targetMonth)),
            };
    }
}

/**
 * N-ésima ocurrencia del día de la semana de la fecha actual dentro del mes
 * target. Ej: si la fecha actual es "2do jueves de mayo", devuelve el 2do
 * jueves del mes target. Si la N-ésima no existe (5to jueves), la anterior.
 */
function nthWeekdayOfMonth(targetYear: number, targetMonth: number, p: DateParts): DateParts {
    const weekday = weekdayOf(p.y, p.m, p.d);
    const nth = Math.ceil(p.d / 7); // 1ra, 2da, …

    const firstWeekday = weekdayOf(targetYear, targetMonth, 1);
    const offset = (weekday - firstWeekday + 7) % 7;
    const firstOccDay = 1 + offset;
    let targetDay = firstOccDay + (nth - 1) * 7;

    if (targetDay > daysInMonth(targetYear, targetMonth)) {
        targetDay -= 7;
    }
    return { ...p, y: targetYear, m: targetMonth, d: targetDay };
}

/**
 * Devuelve la nueva fecha en el mismo formato que la original
 * (`YYYY-MM-DD`, `YYYY-MM-DD HH:MM:SS` o ISO con `T`/zona — se preserva).
 */
export function nextOccurrence(currentDate: string, rec: RollSpec): string {
    const current = parseDate(currentDate);
    const n = Math.max(1, rec.intervalN);

    let next: DateParts;
    switch (rec.frequency) {
        case 'daily':
        case 'days_after':
            next = addDays(current, n);
            break;
        case 'weekly':
            next = addDays(current, n * 7);
            break;
        case 'yearly':
            next = addYears(current, n);
            break;
        case 'monthly':
            next = addMonths(current, n, rec.monthlyPattern ?? 'same_day');
            break;
        default:
            next = addDays(current, 1);
            break;
    }
    return formatDate(next);
}

/**
 * Normaliza un valor de fecha para comparación lexicográfica ("naive UTC"):
 * `T` → espacio, sin fracción de segundos ni sufijo de zona. El plugin
 * comparaba strings crudos porque su formato era uniforme (`Y-m-d H:i:s`);
 * acá los `datetime` llegan como ISO con `T`/`Z`, así que se normaliza a la
 * misma familia de formato antes de comparar (misma semántica).
 */
export function comparableDate(value: string): string {
    return value
        .trim()
        .replace('T', ' ')
        .replace(/(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/, '');
}

/** Now UTC en formato `YYYY-MM-DD HH:MM:SS` (equivalente a current_time('mysql', true)). */
export function nowUtc(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** ¿El valor tiene componente de hora? (port de hasTimeComponent del plugin). */
export function hasTimeComponent(value: string): boolean {
    return value.includes(' ') || value.includes('T');
}
