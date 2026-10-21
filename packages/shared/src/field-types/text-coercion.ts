import { FALLBACK_TIME_ZONE, zonedInstant } from '../schemas/timezone';
import { foldSearchText } from './search';

/**
 * v0.1.287 — De TEXTO al valor de un campo: lo que alguien escribió en una
 * celda de Excel, en un CSV o lo que trae el portapapeles («Pendiente de
 * pago», «31/12/2026», «1.500.000», «Ana Pérez», «Sí»).
 *
 * Antes vivía en el importador del API; ahora la comparten el import CSV,
 * «actualizar desde un archivo», la sincronización SQL y el PEGAR de la tabla
 * (que convierte en el navegador). Una sola definición: un valor que se pega
 * se lee igual que uno que se importa.
 *
 * Best-effort a propósito: si no se puede leer, devuelve el texto crudo y es
 * `validateFieldValue` quien dice por qué no sirve (con su mensaje por campo).
 */

export type TextNumberFormat = 'comma_dot' | 'dot_comma' | 'space_comma';
export type TextDateFormat = 'ymd' | 'dmy' | 'mdy';

export interface TextCoercionOptions {
    /**
     * Personas por email y por nombre (en minúsculas) → id. Ver
     * `buildMemberLookup`: un nombre repetido no resuelve (sería adivinar).
     */
    members?: ReadonlyMap<string, number>;
    /** Separadores de la empresa: deciden «1.500» (mil quinientos o 1,5). */
    numberFormat?: TextNumberFormat;
    /** Orden de fecha de la empresa: decide «03/04/2026» (3 de abril o 4 de marzo). */
    dateFormat?: TextDateFormat;
    /** Zona de la empresa: una fecha y hora sin zona se lee en su reloj. */
    timeZone?: string;
    /**
     * Casillas estrictas: lo que no parece sí/no queda como texto (y el
     * validador lo rechaza) en vez de leerse como «no». El import histórico
     * leía cualquier otra cosa como no marcada; pegar en una celda, no.
     */
    strictBoolean?: boolean;
}

export interface CoercibleField {
    type: string;
    config: Record<string, unknown>;
}

const TRUE_WORDS = new Set(['1', 'true', 'yes', 'si', 'sí', 'x', 'on', 'verdadero', '✓', '✔']);
const FALSE_WORDS = new Set(['0', 'false', 'no', 'off', 'falso', '—', '-', '✗']);

/**
 * Convierte el texto al shape que espera `validateFieldValue` para cada tipo.
 */
export function coerceTextToFieldValue(raw: string, field: CoercibleField, opts: TextCoercionOptions = {}): unknown {
    const trimmed = raw.trim();
    if (trimmed === '') return field.type === 'multi_select' ? [] : null;

    switch (field.type) {
        case 'select':
            return resolveOptionValue(trimmed, field);
        case 'multi_select':
            return trimmed
                .split(/[,;\n]/)
                .map((v) => resolveOptionValue(v.trim(), field))
                .filter((v) => v !== '');
        case 'checkbox': {
            const key = trimmed.toLowerCase();
            if (TRUE_WORDS.has(key)) return true;
            if (!opts.strictBoolean || FALSE_WORDS.has(key)) return false;
            return trimmed;
        }
        case 'number':
        case 'currency': {
            const n = parseNumberText(trimmed, opts.numberFormat);
            return n ?? trimmed;
        }
        case 'percent': {
            const n = parseNumberText(trimmed.replace(/%/g, ''), opts.numberFormat);
            return n ?? trimmed;
        }
        case 'rating': {
            // «★★★☆☆» (lo que se ve) o «4», «4 de 5».
            const stars = (trimmed.match(/[★⭐]/g) ?? []).length;
            if (stars > 0) return stars;
            const lead = /^-?\d+(?:[.,]\d+)?/.exec(trimmed);
            const n = lead ? parseNumberText(lead[0], opts.numberFormat) : null;
            return n ?? trimmed;
        }
        case 'user': {
            // v0.1.252 — el CSV exporta el NOMBRE de la persona: se acepta el
            // nombre o el email de un miembro (además del id).
            if (/^\d+$/.test(trimmed)) return Number(trimmed);
            const members = opts.members;
            return members?.get(trimmed.toLowerCase()) ?? members?.get(foldSearchText(trimmed)) ?? trimmed;
        }
        case 'file':
            return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
        case 'date':
        case 'datetime':
            return normalizeDateString(trimmed, field.type, { dateFormat: opts.dateFormat, timeZone: opts.timeZone });
        default:
            return trimmed;
    }
}

/**
 * Personas del workspace por email y por nombre (minúsculas y también sin
 * acentos) → id. Un nombre repetido entre dos personas NO resuelve: elegir
 * una sería adivinar.
 */
export function buildMemberLookup(rows: ReadonlyArray<{ id: number; name?: string | null; email?: string | null }>): Map<string, number> {
    const out = new Map<string, number>();
    const dup = new Set<string>();
    const put = (key: string, id: number): void => {
        if (key === '') return;
        if (out.has(key) && out.get(key) !== id) dup.add(key);
        else out.set(key, id);
    };
    for (const u of rows) {
        const email = (u.email ?? '').trim().toLowerCase();
        if (email !== '') out.set(email, u.id);
        const name = (u.name ?? '').trim();
        put(name.toLowerCase(), u.id);
        put(foldSearchText(name), u.id);
    }
    for (const k of dup) out.delete(k);
    return out;
}

/**
 * La opción de un select a partir de lo que escribió alguien: la etiqueta
 * («Pendiente de pago») o el valor interno («pendiente_pago»), sin importar
 * mayúsculas ni acentos. Sin coincidencia devuelve el texto crudo (el
 * validador lo rechaza; el import agrega las opciones nuevas antes).
 */
export function resolveOptionValue(raw: string, field: CoercibleField): string {
    if (raw === '') return '';
    const options = readOptions(field.config);
    const lower = raw.toLocaleLowerCase('es');
    for (const opt of options) {
        if (opt.label.toLocaleLowerCase('es') === lower || opt.value.toLocaleLowerCase('es') === lower) return opt.value;
    }
    const folded = foldSearchText(raw);
    for (const opt of options) {
        if (foldSearchText(opt.label) === folded || foldSearchText(opt.value) === folded) return opt.value;
    }
    return raw;
}

function readOptions(config: Record<string, unknown>): Array<{ value: string; label: string }> {
    const raw = config.options;
    if (!Array.isArray(raw)) return [];
    const out: Array<{ value: string; label: string }> = [];
    for (const opt of raw) {
        if (opt && typeof opt === 'object') {
            const value = String((opt as { value?: unknown }).value ?? '');
            if (value === '') continue;
            out.push({ value, label: String((opt as { label?: unknown }).label ?? value) });
        } else if (typeof opt === 'string' && opt !== '') {
            out.push({ value: opt, label: opt });
        }
    }
    return out;
}

/**
 * Heurística histórica del import: limpia separadores ES (1.234,56 → 1234.56)
 * y coma decimal (12,5 → 12.5). La usa el detector de tipos del import.
 */
export function cleanNumberString(v: string): string {
    if (/^-?[0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?$/.test(v)) {
        return v.replace(/\./g, '').replace(',', '.');
    }
    if (v.includes(',') && !v.includes('.')) {
        return v.replace(',', '.');
    }
    return v;
}

/**
 * Un número escrito por una persona: «1.500.000», «1,032,000.50»,
 * «1 234,5», «$ 25.900», «(1.200)» (negativo contable), «-3,5 %».
 *
 * Con DOS separadores distintos, el último es el decimal. Con uno solo, si le
 * siguen exactamente 3 dígitos es ambiguo («1.500»): manda el formato de la
 * empresa (en `dot_comma` es mil quinientos; en `comma_dot`, «1,500» es mil
 * quinientos); sin formato, la regla histórica del import (punto = miles,
 * coma = decimal). Devuelve `null` si no es un número.
 */
export function parseNumberText(raw: string, format?: TextNumberFormat): number | null {
    let s = raw.trim();
    if (s === '') return null;
    let negative = false;
    if (/^\(.*\)$/.test(s)) {
        negative = true;
        s = s.slice(1, -1);
    }
    // Espacios (incluidos los de miles: normal, no separable, fino) y
    // apóstrofos suizos fuera; símbolos de moneda y letras («COP», «USD») fuera.
    s = s.replace(/[\s  ']/g, '').replace(/%$/, '');
    s = s.replace(/^[^\d+\-.,]+/, '').replace(/[^\d.,]+$/, '');
    if (s.startsWith('-')) {
        negative = !negative;
        s = s.slice(1);
    } else if (s.startsWith('+')) {
        s = s.slice(1);
    }
    s = s.replace(/^[^\d.,]+/, '');
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

    const dots = (s.match(/\./g) ?? []).length;
    const commas = (s.match(/,/g) ?? []).length;
    let decimal: '.' | ',' | null = null;
    if (dots > 0 && commas > 0) {
        decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    } else if (dots + commas > 0) {
        const sep: '.' | ',' = dots > 0 ? '.' : ',';
        const count = dots + commas;
        const after = s.length - s.lastIndexOf(sep) - 1;
        if (count > 1) {
            decimal = null; // «1.500.000»: todos son de miles.
        } else if (after !== 3) {
            decimal = sep; // «12,5», «1.25»
        } else {
            const preferred: '.' | ',' | null = format === 'comma_dot' ? '.' : format ? ',' : null;
            if (preferred !== null) decimal = preferred === sep ? sep : null;
            else decimal = sep === ',' ? ',' : null; // regla histórica del import
        }
    }
    const thousands = decimal === '.' ? ',' : decimal === ',' ? '.' : null;
    let clean = s;
    if (thousands !== null) clean = clean.split(thousands).join('');
    else clean = clean.replace(/[.,]/g, '');
    if (decimal !== null) clean = clean.replace(decimal, '.');
    if (!/^\d*\.?\d*$/.test(clean) || clean === '.' || clean === '') return null;
    const n = Number(clean);
    if (!Number.isFinite(n)) return null;
    return negative ? -n : n;
}

const TIME_TAIL_RE = /^(?:T|\s)*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?\s*m\.?)?\s*$/i;

/**
 * Normaliza una fecha escrita a mano a lo que guarda el campo:
 *  - `date` → `YYYY-MM-DD`;
 *  - `datetime` → instante ISO con zona (una hora sin zona se lee en el reloj
 *    de la empresa; sin hora, la medianoche).
 *
 * Formatos: ISO (`2026-12-31`, `2026-12-31T14:30`, con o sin zona),
 * `DD/MM/AAAA` o `MM/DD/AAAA` (también con `-` o `.` y año de 2 dígitos). Si
 * el primer número es > 12 es el día; si lo es el segundo, el mes va primero;
 * ambiguo → manda el formato de la empresa (`mdy` = mes primero; el resto,
 * día primero). Con hora detrás («31/12/2026 14:30», «2:30 p. m.»).
 * Fallback: `Date.parse` («May 21st 2026»). Sin parse posible → el crudo (el
 * validador reporta «Fecha inválida»).
 */
export function normalizeDateString(
    v: string,
    type: 'date' | 'datetime',
    opts: { dateFormat?: TextDateFormat; timeZone?: string } = {},
): string {
    const tz = opts.timeZone ?? FALLBACK_TIME_ZONE;
    const value = v.trim();

    const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(.*)$/.exec(value);
    if (iso) {
        const date = ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
        if (date === null) return value;
        if (type === 'date') return date;
        const tail = (iso[4] ?? '').trim();
        if (tail === '') return zonedInstant(date, tz).toISOString();
        // Con zona explícita: el instante tal cual (ISO válido para el validador).
        if (/^T?\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(tail)) {
            const t = Date.parse(`${date}T${tail.replace(/^T/i, '')}`);
            return Number.isNaN(t) ? value : new Date(t).toISOString();
        }
        const time = parseTimeTail(tail);
        return time === null ? value : zonedInstant(date, tz, time).toISOString();
    }

    const slashed = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(.*)$/.exec(value);
    if (slashed) {
        const a = Number(slashed[1]);
        const b = Number(slashed[2]);
        let year = Number(slashed[3]);
        if (year < 100) year += 2000;
        let day: number;
        let month: number;
        if (opts.dateFormat === 'mdy') {
            month = a;
            day = b;
            if (a > 12 && b <= 12) {
                day = a;
                month = b;
            }
        } else {
            day = a;
            month = b;
            if (b > 12 && a <= 12) {
                day = b;
                month = a;
            }
        }
        const date = ymd(year, month, day);
        if (date === null) return value;
        if (type === 'date') return date;
        const tail = (slashed[4] ?? '').trim();
        if (tail === '') return zonedInstant(date, tz).toISOString();
        const time = parseTimeTail(tail);
        return time === null ? value : zonedInstant(date, tz, time).toISOString();
    }

    const cleaned = value.replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
    const ts = Date.parse(cleaned);
    if (!Number.isNaN(ts)) {
        const d = new Date(ts);
        const date = ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
        if (date === null) return value;
        return type === 'datetime' ? d.toISOString() : date;
    }
    return value;
}

function ymd(y: number, m: number, d: number): string | null {
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null; // 31/02 no existe
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseTimeTail(tail: string): { h: number; m: number; s: number } | null {
    const t = TIME_TAIL_RE.exec(tail);
    if (!t) return null;
    let h = Number(t[1]);
    const m = Number(t[2]);
    const s = t[3] ? Number(t[3]) : 0;
    const ampm = t[4]?.toLowerCase();
    if (ampm === 'p' && h < 12) h += 12;
    if (ampm === 'a' && h === 12) h = 0;
    if (h > 23 || m > 59 || s > 59) return null;
    return { h, m, s };
}
