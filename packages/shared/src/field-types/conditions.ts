import type { ConditionData } from '../schemas/automation';
import type { FilterNode } from '../schemas/filter';
import { valueBaseType, type FieldType } from '../schemas/field';
import { FALLBACK_TIME_ZONE } from '../schemas/timezone';
import { datetimeFilterRange, relativeRangeFor } from './date-ranges';

/**
 * v0.1.287 — Evaluación de condiciones EN MEMORIA, compartida.
 *
 * Antes vivía en el motor de automatizaciones del API. Ahora la usan también
 * los colores condicionales de la tabla (que se evalúan en el navegador, fila
 * por fila): una sola definición de qué significa «es», «contiene» o «este
 * mes», así una condición dice lo mismo en la vista, en el filtro y en la
 * automatización.
 *
 * Dos entradas:
 *  - `evaluateCondition`: la de las automatizaciones (reglas por SLUG,
 *    `[{field, op, value}]` unidas por AND, o el shape legacy `{slug: value}`).
 *  - `evaluateFilterNode` / `evaluateFilterCondition`: árboles de filtro por
 *    `field_id` (los de las vistas) con el TIPO del campo, que decide la
 *    semántica igual que el QueryBuilder del SQL: subcadenas sin distinguir
 *    mayúsculas (ILIKE), números como números, fechas por día en el reloj de
 *    la empresa, multi_select como conjunto, relación por vínculos.
 */
export interface ConditionOptions {
    /** Zona de la empresa ("hoy", "este mes"). */
    timeZone?: string;
    now?: Date;
}

// ── Automatizaciones (por slug) ─────────────────────────────────────────────

/**
 * Evalúa una condición de automatización (trigger filter / condición por
 * acción / rama de if_else) contra los valores de un registro, resuelto por
 * SLUG. Port fiel del `ConditionEvaluator` del plugin. Acepta dos shapes:
 *  1. Rico (el que escribe el ConditionEditor): `[{field, op, value}]` unidas AND.
 *  2. Legacy plano: `{slug: value}` (igualdad laxa).
 *
 * La semántica imita la del filtro SQL de la tabla:
 *  - multi_select (el valor es una lista): `eq` con un valor = «incluye», con
 *    una lista = el MISMO conjunto (sin importar el orden); `in` = incluye
 *    alguno; `nin` = no incluye ninguno.
 *  - `between_relative` («este mes», «últimos 7 días» o un rango fijo) en el
 *    reloj de la EMPRESA (`timeZone`).
 *  - casilla: «1»/«true»/«sí» es marcada.
 */
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
            if (!evaluateConditionOp(fieldValue(field), op, expected, opts)) return false;
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

/** Un operador sobre un valor, sin conocer el tipo del campo (automatizaciones). */
export function evaluateConditionOp(actual: unknown, op: string, expected: unknown, opts: ConditionOptions = {}): boolean {
    switch (op) {
        case 'eq':
            return valuesEqual(actual, expected);
        case 'neq':
            return !valuesEqual(actual, expected);
        case 'is_null':
            return isEmptyValue(actual);
        case 'is_not_null':
            return !isEmptyValue(actual);
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

/** Vacío: nulo, cadena vacía o lista sin elementos. */
export function isEmptyValue(v: unknown): boolean {
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
        return compareBy(a < e ? -1 : a > e ? 1 : 0, op);
    }
    // Fechas ISO / strings: comparación lexicográfica (orden cronológico para ISO).
    if (typeof actual === 'string' && typeof expected === 'string') {
        return compareBy(actual < expected ? -1 : actual > expected ? 1 : 0, op);
    }
    return false;
}

function compareBy(c: number, op: string): boolean {
    return op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
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
    const at = parseInstant(value);
    if (at === null) return false;
    const range = relativeRangeFor(expected, 'datetime', clock);
    return range !== null && at >= Date.parse(range.from) && at <= Date.parse(range.to);
}

/** Instante de un valor de fecha-hora (sin zona = UTC, como lo guarda el API). */
function parseInstant(value: string): number | null {
    const at = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
    return Number.isNaN(at) ? null : at;
}

// ── Filtros de vista (por field_id, con el tipo del campo) ──────────────────

/** Lo que el evaluador necesita saber de un campo: su tipo y su valor en la fila. */
export interface FilterFieldValue {
    type: string;
    value: unknown;
}

const NUMERIC_FILTER_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'rating', 'percent', 'duration', 'rollup']);

/**
 * Una condición de filtro (`{field_id, op, value}`) contra el valor de UNA
 * fila, con la semántica del QueryBuilder del SQL según el tipo del campo.
 * Devuelve `null` cuando la condición NO APLICA (campo desconocido, operador
 * que el tipo no admite, valor ilegible): el SQL la descarta, y quien
 * evalúa decide qué hacer (un árbol la ignora; una regla de color no pinta).
 */
export function evaluateFilterCondition(
    cond: { op: string; value?: unknown },
    field: FilterFieldValue | undefined,
    opts: ConditionOptions = {},
): boolean | null {
    if (!field) return null;
    // v0.1.300 — una columna de sistema se compara como fecha y hora o persona; el
    // ID automático, como texto.
    const type: string = valueBaseType(field.type as FieldType);
    const actual = field.value;
    const op = cond.op;
    const expected = cond.value;
    const timeZone = opts.timeZone ?? FALLBACK_TIME_ZONE;

    if (op === 'is_null') return isEmptyValue(actual);
    if (op === 'is_not_null') return !isEmptyValue(actual);

    // Archivos: sólo "tiene / no tiene" (v0.1.191).
    if (type === 'file') return null;

    // Relación: «vinculado a» uno o varios registros (ids).
    if (type === 'relation') {
        const linked = toStringList(actual);
        const wanted = toStringList(expected);
        switch (op) {
            case 'eq':
            case 'in':
            case 'contains':
                return wanted.length === 0 ? null : wanted.some((w) => linked.includes(w));
            case 'neq':
            case 'nin':
            case 'not_contains':
                return wanted.length === 0 ? null : !wanted.some((w) => linked.includes(w));
            default:
                return null;
        }
    }

    // multi_select: el valor es un CONJUNTO de opciones.
    if (type === 'multi_select') {
        const set = toStringList(actual);
        switch (op) {
            case 'eq':
                if (Array.isArray(expected)) return sameSet(set, toStringList(expected));
                return expected === undefined || expected === null || expected === '' ? null : set.includes(String(expected));
            case 'contains':
                return expected === undefined || expected === null || expected === '' ? null : set.includes(String(expected));
            case 'neq':
                if (Array.isArray(expected)) return !sameSet(set, toStringList(expected));
                return expected === undefined || expected === null || expected === '' ? null : !set.includes(String(expected));
            case 'not_contains':
                return expected === undefined || expected === null || expected === '' ? null : !set.includes(String(expected));
            case 'in': {
                const wanted = toStringList(expected);
                return wanted.length === 0 ? false : wanted.some((w) => set.includes(w));
            }
            case 'nin': {
                const wanted = toStringList(expected);
                return wanted.length === 0 ? null : !wanted.some((w) => set.includes(w));
            }
            default:
                return null;
        }
    }

    if (op === 'between_relative') {
        if (type !== 'date' && type !== 'datetime') return null;
        return betweenRelative(actual, expected, { ...opts, timeZone });
    }

    // Fecha y hora: "es" abarca el minuto (o el día, si el valor es sólo una
    // fecha) en el reloj de la empresa — igual que `compileDatetimeComparison`.
    if (type === 'datetime' && ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(op)) {
        const range = datetimeFilterRange(expected, timeZone);
        if (range === null) return null;
        const at = typeof actual === 'string' && actual.trim() !== '' ? parseInstant(actual.trim()) : null;
        if (at === null) return op === 'neq';
        const from = Date.parse(range.from);
        const to = Date.parse(range.to);
        switch (op) {
            case 'eq':
                return at >= from && at < to;
            case 'neq':
                return at < from || at >= to;
            case 'gt':
                return at >= to;
            case 'gte':
                return at >= from;
            case 'lt':
                return at < from;
            default:
                return at < to;
        }
    }

    if (type === 'checkbox') {
        if (op !== 'eq' && op !== 'neq') return null;
        const want = asBoolean(expected);
        if (want === null) return null;
        // Una casilla sin valor se ve desmarcada: cuenta como "no".
        const got = asBoolean(actual) ?? false;
        return op === 'eq' ? got === want : got !== want;
    }

    if (NUMERIC_FILTER_TYPES.has(type) || (type === 'computed' && (typeof actual === 'number' || isNumeric(expected)))) {
        if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(op)) {
            if (!isNumeric(expected)) return null;
            const e = Number(expected);
            if (!isNumeric(actual)) return op === 'neq';
            const a = Number(actual);
            if (op === 'eq') return a === e;
            if (op === 'neq') return a !== e;
            return compareBy(a < e ? -1 : a > e ? 1 : 0, op);
        }
        if (op === 'in' || op === 'nin') {
            const wanted = toStringList(expected).filter(isNumeric).map(Number);
            if (wanted.length === 0) return op === 'in' ? false : null;
            const hit = isNumeric(actual) && wanted.includes(Number(actual));
            return op === 'in' ? hit : !hit;
        }
    }

    // Texto (y todo lo que se compara por su forma de texto: select, persona,
    // email, teléfono, fecha YYYY-MM-DD, lookup…).
    const text = textOf(actual);
    switch (op) {
        case 'contains':
        case 'not_contains':
        case 'starts_with':
        case 'ends_with': {
            if (expected === undefined || expected === null || expected === '') return null;
            const needle = String(expected).toLocaleLowerCase();
            const hay = (text ?? '').toLocaleLowerCase();
            if (op === 'not_contains') return text === null || !hay.includes(needle);
            if (text === null) return false;
            return op === 'contains' ? hay.includes(needle) : op === 'starts_with' ? hay.startsWith(needle) : hay.endsWith(needle);
        }
        case 'eq':
            if (expected === undefined || expected === null) return null;
            return text !== null && text === String(expected);
        case 'neq':
            if (expected === undefined || expected === null) return null;
            return text === null || text !== String(expected);
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
            if (expected === undefined || expected === null || expected === '' || text === null) return text === null ? false : null;
            const e = String(expected);
            return compareBy(text < e ? -1 : text > e ? 1 : 0, op);
        }
        case 'in':
        case 'nin': {
            const wanted = toStringList(expected);
            if (wanted.length === 0) return op === 'in' ? false : null;
            const hit = text !== null && wanted.includes(text);
            return op === 'in' ? hit : !hit;
        }
        default:
            return null;
    }
}

/**
 * Un árbol de filtro (grupos AND/OR) contra una fila. Las condiciones que no
 * aplican se ignoran (como el SQL, que las descarta); un grupo sin
 * condiciones aplicables es verdadero.
 */
export function evaluateFilterNode(
    node: FilterNode,
    fieldOf: (fieldId: number) => FilterFieldValue | undefined,
    opts: ConditionOptions = {},
): boolean {
    const r = evalNode(node, fieldOf, opts);
    return r ?? true;
}

function evalNode(
    node: FilterNode,
    fieldOf: (fieldId: number) => FilterFieldValue | undefined,
    opts: ConditionOptions,
): boolean | null {
    if (node.type === 'condition') return evaluateFilterCondition(node, fieldOf(node.field_id), opts);
    const parts = node.children.map((c) => evalNode(c, fieldOf, opts)).filter((r): r is boolean => r !== null);
    if (parts.length === 0) return null;
    return node.logic === 'or' ? parts.some(Boolean) : parts.every(Boolean);
}

function toStringList(v: unknown): string[] {
    if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined && x !== '').map((x) => String(x));
    if (v === null || v === undefined || v === '') return [];
    return [String(v)];
}

/** La forma de texto de un valor escalar (o de una lista, unida por ", "). */
function textOf(v: unknown): string | null {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
        const parts = v.filter((x) => x !== null && x !== undefined && x !== '').map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)));
        return parts.length === 0 ? null : parts.join(', ');
    }
    return JSON.stringify(v);
}
