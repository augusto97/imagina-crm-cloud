import { FALLBACK_TIME_ZONE, type ConditionData } from '@imagina-base/shared';
import { relativeRangeFor } from '../records/query-builder';

/**
 * Evalúa una condición de automatización (trigger filter / condición por acción /
 * rama de if_else) contra los valores de un registro, resuelto por SLUG.
 *
 * Port fiel del `ConditionEvaluator` del plugin. Acepta dos shapes:
 *  1. Rico (el que escribe el ConditionEditor): `[{field, op, value}]` unidas AND.
 *  2. Legacy plano: `{slug: value}` (igualdad laxa).
 *
 * `fieldValue(slug)` devuelve el valor actual del registro para ese slug.
 *
 * La semántica imita la del filtro SQL de la tabla (query-builder), así una
 * condición dice lo mismo en la vista y en la automatización:
 *  - multi_select (el valor es una lista): `eq` con un valor = «incluye», con
 *    una lista = el MISMO conjunto (sin importar el orden); `in` = incluye
 *    alguno; `nin` = no incluye ninguno.
 *  - `between_relative` («este mes», «últimos 7 días» o un rango fijo) en el
 *    reloj de la EMPRESA (`timeZone`).
 *  - casilla: «1»/«true»/«sí» es marcada.
 */
export interface ConditionOptions {
    /** Zona de la empresa ("hoy", "este mes"). */
    timeZone?: string;
    now?: Date;
}

export function evaluateCondition(
    condition: ConditionData | null | undefined,
    fieldValue: (slug: string) => unknown,
    opts: ConditionOptions = {},
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
            if (!evalOp(fieldValue(field), op, expected, opts)) return false;
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

/** v0.1.289 — una regla evaluada (lo que muestra «Probar»: POR QUÉ sí o no). */
export interface ConditionRuleCheck {
    field: string;
    op: string;
    expected: unknown;
    actual: unknown;
    ok: boolean;
}

/**
 * v0.1.289 — La misma evaluación que `evaluateCondition`, regla por regla
 * (comparte `evalOp`: lo que explica «Probar» es exactamente lo que decide
 * el motor). `matched` es el resultado AND.
 */
export function explainCondition(
    condition: ConditionData | null | undefined,
    fieldValue: (slug: string) => unknown,
    opts: ConditionOptions = {},
): { matched: boolean; checks: ConditionRuleCheck[] } {
    const checks: ConditionRuleCheck[] = [];
    if (condition === null || condition === undefined) return { matched: true, checks };
    if (Array.isArray(condition)) {
        for (const rule of condition) {
            if (!rule || typeof rule !== 'object') continue;
            const field = String((rule as { field?: unknown; slug?: unknown }).field ?? (rule as { slug?: unknown }).slug ?? '');
            const op = String((rule as { op?: unknown }).op ?? 'eq');
            const expected = (rule as { value?: unknown }).value ?? null;
            const actual = field === '' ? undefined : fieldValue(field);
            checks.push({ field, op, expected, actual, ok: field !== '' && evalOp(actual, op, expected, opts) });
        }
    } else {
        for (const [slug, expected] of Object.entries(condition)) {
            if (slug === '') continue;
            const actual = fieldValue(slug);
            checks.push({ field: slug, op: 'eq', expected, actual, ok: valuesEqual(actual, expected) });
        }
    }
    return { matched: checks.every((c) => c.ok), checks };
}

function evalOp(actual: unknown, op: string, expected: unknown, opts: ConditionOptions): boolean {
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
            return inList(actual, expected);
        case 'nin':
            return Array.isArray(expected) && !inList(actual, expected);
        case 'between_relative':
            return betweenRelative(actual, expected, opts);
        default:
            return false;
    }
}

function isEmpty(v: unknown): boolean {
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

const isScalar = (v: unknown): v is string | number | boolean =>
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** `contains`: substring (string+string) o pertenencia (array+scalar, p.ej. multi_select). */
function stringContains(haystack: unknown, needle: unknown): boolean {
    if (Array.isArray(haystack) && isScalar(needle)) {
        return haystack.some((v) => isScalar(v) && String(v) === String(needle));
    }
    return typeof haystack === 'string' && typeof needle === 'string' && needle !== '' && haystack.includes(needle);
}

/** `in`: el valor está en la lista; si el valor ES una lista (multi_select), alguno de sus elementos. */
function inList(actual: unknown, expected: unknown): boolean {
    if (!Array.isArray(expected)) return false;
    const wanted = expected.map((e) => stringifyForIn(e));
    if (Array.isArray(actual)) return actual.some((a) => wanted.includes(stringifyForIn(a)));
    return wanted.includes(stringifyForIn(actual));
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

const TRUE_WORDS = ['1', 'true', 'yes', 'si', 'sí', 'on'];
const FALSE_WORDS = ['0', 'false', 'no', 'off', ''];

/** Lectura laxa de sí/no; `null` si no parece un booleano. */
function asBoolean(v: unknown): boolean | null {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (TRUE_WORDS.includes(s)) return true;
        if (FALSE_WORDS.includes(s)) return false;
    }
    return null;
}

/**
 * Igualdad laxa. Una lista contra un valor = «incluye» (multi_select); dos
 * listas = mismo conjunto, sin importar el orden. Un booleano contra «1»/«sí».
 * Escalares con coerción tipo `==` ("1" == 1).
 */
function valuesEqual(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) return sameSet(a, b);
    if (Array.isArray(a)) {
        // Un multi_select vacío "es" vacío; contra un valor, lo incluye.
        if (b === null || b === undefined || b === '') return a.length === 0;
        return isScalar(b) && a.some((x) => isScalar(x) && String(x) === String(b));
    }
    if (Array.isArray(b)) return false;
    if (a === null || a === undefined) return b === null || b === undefined || b === '';
    if (b === null || b === undefined) return a === null || a === undefined || a === '';
    if (typeof a === 'boolean' || typeof b === 'boolean') {
        const ab = asBoolean(a);
        const bb = asBoolean(b);
        if (ab !== null && bb !== null) return ab === bb;
    }
    // Coerción laxa: "1" == 1.
    return String(a) === String(b) || a === b;
}

function sameSet(a: unknown[], b: unknown[]): boolean {
    const sa = new Set(a.map((x) => stringifyForIn(x)));
    const sb = new Set(b.map((x) => stringifyForIn(x)));
    if (sa.size !== sb.size) return false;
    for (const x of sa) if (!sb.has(x)) return false;
    return true;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `between_relative`: el valor es un preset («this_month») o `{from, to}`.
 * Una fecha sin hora se compara por día; una fecha-hora, por instante (los
 * días empiezan y terminan en el reloj de la empresa).
 */
function betweenRelative(actual: unknown, expected: unknown, opts: ConditionOptions): boolean {
    if (typeof actual !== 'string' || actual.trim() === '') return false;
    const clock = { now: opts.now ?? new Date(), timeZone: opts.timeZone ?? FALLBACK_TIME_ZONE };
    const value = actual.trim();
    if (YMD.test(value)) {
        const range = relativeRangeFor(expected, 'date', clock);
        return range !== null && value >= range.from && value <= range.to;
    }
    const at = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
    if (Number.isNaN(at)) return false;
    const range = relativeRangeFor(expected, 'datetime', clock);
    return range !== null && at >= Date.parse(range.from) && at <= Date.parse(range.to);
}
