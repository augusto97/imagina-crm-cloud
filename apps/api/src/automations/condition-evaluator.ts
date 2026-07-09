import type { ConditionData } from '@imagina-base/shared';

/**
 * Evalúa una condición de automatización (trigger filter / condición por acción /
 * rama de if_else) contra los valores de un registro, resuelto por SLUG.
 *
 * Port fiel del `ConditionEvaluator` del plugin. Acepta dos shapes:
 *  1. Rico (el que escribe el ConditionEditor): `[{field, op, value}]` unidas AND.
 *  2. Legacy plano: `{slug: value}` (igualdad laxa).
 *
 * `fieldValue(slug)` devuelve el valor actual del registro para ese slug.
 */
export function evaluateCondition(
    condition: ConditionData | null | undefined,
    fieldValue: (slug: string) => unknown,
): boolean {
    if (condition === null || condition === undefined) return true;

    if (Array.isArray(condition)) {
        if (condition.length === 0) return true;
        for (const rule of condition) {
            if (!rule || typeof rule !== 'object') continue;
            const field = String((rule as { field?: unknown; slug?: unknown }).field ?? (rule as { slug?: unknown }).slug ?? '');
            if (field === '') return false;
            const op = String((rule as { op?: unknown }).op ?? 'eq');
            const expected = (rule as { value?: unknown }).value ?? null;
            if (!evalOp(fieldValue(field), op, expected)) return false;
        }
        return true;
    }

    // Legacy plano `{slug: value}`.
    for (const [slug, expected] of Object.entries(condition)) {
        if (slug === '') continue;
        if (!valuesEqual(fieldValue(slug), expected)) return false;
    }
    return true;
}

function evalOp(actual: unknown, op: string, expected: unknown): boolean {
    switch (op) {
        case 'eq':
            return valuesEqual(actual, expected);
        case 'neq':
            return !valuesEqual(actual, expected);
        case 'is_null':
            return isEmpty(actual);
        case 'is_not_null':
            return !isEmpty(actual);
        case 'contains':
            return stringContains(actual, expected);
        case 'not_contains':
            return !stringContains(actual, expected);
        case 'starts_with':
            return typeof actual === 'string' && typeof expected === 'string' && expected !== '' && actual.startsWith(expected);
        case 'ends_with':
            return typeof actual === 'string' && typeof expected === 'string' && expected !== '' && actual.endsWith(expected);
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
            return numericCompare(actual, op, expected);
        case 'in':
            return Array.isArray(expected) && expected.map(String).includes(stringifyForIn(actual));
        case 'nin':
            return Array.isArray(expected) && !expected.map(String).includes(stringifyForIn(actual));
        default:
            return false;
    }
}

function isEmpty(v: unknown): boolean {
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/** `contains`: substring (string+string) o pertenencia (array+scalar, p.ej. multi_select). */
function stringContains(haystack: unknown, needle: unknown): boolean {
    if (Array.isArray(haystack) && (typeof needle === 'string' || typeof needle === 'number' || typeof needle === 'boolean')) {
        return haystack.some((v) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && String(v) === String(needle));
    }
    return typeof haystack === 'string' && typeof needle === 'string' && needle !== '' && haystack.includes(needle);
}

function numericCompare(actual: unknown, op: string, expected: unknown): boolean {
    const aNum = isNumeric(actual);
    const eNum = isNumeric(expected);
    if (aNum && eNum) {
        const a = Number(actual);
        const e = Number(expected);
        return op === 'gt' ? a > e : op === 'gte' ? a >= e : op === 'lt' ? a < e : a <= e;
    }
    // Fechas ISO / strings: comparación lexicográfica (orden cronológico para ISO).
    if (typeof actual === 'string' && typeof expected === 'string') {
        const c = actual < expected ? -1 : actual > expected ? 1 : 0;
        return op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
    }
    return false;
}

function isNumeric(v: unknown): boolean {
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(Number(v));
    return false;
}

function stringifyForIn(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    return '';
}

/** Igualdad laxa: arrays por JSON canónico; escalares con coerción tipo `==`. */
function valuesEqual(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
    if (Array.isArray(a) || Array.isArray(b)) return false;
    if (a === null || a === undefined) return b === null || b === undefined || b === '';
    if (b === null || b === undefined) return a === null || a === undefined || a === '';
    // Coerción laxa: "1" == 1, true == "1".
    return String(a) === String(b) || a === b;
}
