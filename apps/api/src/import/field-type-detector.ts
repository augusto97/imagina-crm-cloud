/**
 * Heurística para inferir el tipo de campo apropiado a partir de una muestra
 * de valores del CSV (paridad con `Imports/FieldTypeDetector.php`). La UI lo
 * usa como default cuando el usuario elige "crear campo nuevo".
 *
 * Reglas (en orden):
 *  1. checkbox  — ≥80% de los valores no vacíos son sí/no/1/0/x.
 *  2. email     — ≥80% con forma de email.
 *  3. url       — ≥80% empiezan con http(s)://.
 *  4. number    — ≥80% numéricos (tras limpiar separadores de miles ES/US).
 *  5. datetime  — ≥80% parsean como fecha Y ≥50% incluyen hora (`:`).
 *  6. date      — ≥80% parsean como fecha.
 *  7. select    — cardinalidad baja: ≤20 únicos y al menos repetición 2×.
 *  8. text      — fallback.
 */

const THRESHOLD = 0.8;
const SELECT_MAX_CARDINALITY = 20;

const BOOLISH = new Set(['1', '0', 'true', 'false', 'yes', 'no', 'sí', 'si', 'x', 'on', 'off']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function detectFieldType(sample: string[]): string {
    const nonEmpty = sample.map((v) => v.trim()).filter((v) => v !== '');
    const count = nonEmpty.length;
    if (count === 0) return 'text';
    const needed = Math.ceil(count * THRESHOLD);

    if (matches(nonEmpty, isBoolish) >= needed) return 'checkbox';
    if (matches(nonEmpty, (v) => EMAIL_RE.test(v)) >= needed) return 'email';
    if (matches(nonEmpty, (v) => /^https?:\/\//i.test(v)) >= needed) return 'url';
    if (matches(nonEmpty, isNumberish) >= needed) return 'number';

    if (matches(nonEmpty, isDateish) >= needed) {
        const withTime = matches(nonEmpty, (v) => v.includes(':'));
        return withTime >= Math.ceil(count * 0.5) ? 'datetime' : 'date';
    }

    const unique = new Set(nonEmpty);
    if (unique.size <= SELECT_MAX_CARDINALITY && unique.size * 2 <= count) return 'select';

    return 'text';
}

function matches(values: string[], predicate: (v: string) => boolean): number {
    let hits = 0;
    for (const v of values) if (predicate(v)) hits++;
    return hits;
}

function isBoolish(v: string): boolean {
    return BOOLISH.has(v.toLowerCase());
}

export function isNumberish(v: string): boolean {
    const clean = cleanNumberString(v);
    return clean !== '' && !Number.isNaN(Number(clean));
}

/** Limpia separadores ES (1.234,56 → 1234.56) y coma decimal (12,5 → 12.5). */
export function cleanNumberString(v: string): string {
    if (/^-?[0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?$/.test(v)) {
        return v.replace(/\./g, '').replace(',', '.');
    }
    if (v.includes(',') && !v.includes('.')) {
        return v.replace(',', '.');
    }
    return v;
}

function isDateish(v: string): boolean {
    // ISO 8601: YYYY-MM-DD, posiblemente con hora.
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return !Number.isNaN(Date.parse(v));
    // DD/MM/YYYY o MM/DD/YYYY (con `/` o `-`).
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(v)) return true;
    // Fallback: parser nativo tras strip de sufijos ordinales ("May 21st").
    const cleaned = v.replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
    return !Number.isNaN(Date.parse(cleaned));
}
