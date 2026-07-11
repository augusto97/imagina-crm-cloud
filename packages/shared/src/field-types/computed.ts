/**
 * Evaluador de campos `computed` (paridad con `ComputedFieldEvaluator.php`).
 * PURO: recibe los fields de la lista y un getter de valores por field id;
 * soporta encadenamiento computed→computed con guard de ciclos y profundidad.
 *
 * Devuelve `null` si falta un input, hay ciclo, la operación es inválida,
 * hay división por cero o la cadena supera MAX_DEPTH — nunca lanza.
 *
 * Vive en shared para que backend (inyección en el DTO al leer) y frontend
 * (previews del editor) usen EXACTAMENTE la misma semántica.
 */

export const COMPUTED_OPERATIONS = [
    'date_diff_months',
    'date_diff_days',
    'sum',
    'product',
    'subtract',
    'divide',
    'concat',
    'abs',
] as const;
export type ComputedOperation = (typeof COMPUTED_OPERATIONS)[number];

export const COMPUTED_MAX_DEPTH = 8;

export interface ComputedFieldLike {
    id: number;
    type: string;
    config: Record<string, unknown>;
}

/**
 * Evalúa el computed `field`. `getValue(fieldId)` devuelve el valor crudo de
 * un field NO-computed (el caller decide de dónde: `data[f{id}]` en el back,
 * `fields[slug]` en el front).
 */
export function evaluateComputed(
    field: ComputedFieldLike,
    listFields: ComputedFieldLike[],
    getValue: (fieldId: number) => unknown,
    visiting: ReadonlySet<number> = new Set(),
    depth = 0,
): unknown {
    if (field.type !== 'computed') return getValue(field.id);
    if (depth > COMPUTED_MAX_DEPTH) return null;
    if (visiting.has(field.id)) return null; // ciclo

    const operation = String(field.config.operation ?? '');
    const rawInputs = Array.isArray(field.config.inputs) ? field.config.inputs : [];
    const byId = new Map(listFields.map((f) => [f.id, f]));
    const nextVisiting = new Set(visiting);
    nextVisiting.add(field.id);

    const values = rawInputs.map((rawId) => {
        const id = typeof rawId === 'number' ? rawId : Number(rawId);
        if (!Number.isInteger(id) || id <= 0) return null;
        const input = byId.get(id);
        if (!input) return null;
        if (input.type === 'computed') {
            return evaluateComputed(input, listFields, getValue, nextVisiting, depth + 1);
        }
        return getValue(id);
    });

    return apply(operation, values, field.config);
}

function apply(operation: string, values: unknown[], config: Record<string, unknown>): unknown {
    switch (operation) {
        case 'date_diff_months':
            return dateDiffMonths(values[0], values[1]);
        case 'date_diff_days':
            return dateDiffDays(values[0], values[1]);
        case 'sum':
            return sum(values);
        case 'product':
            return product(values);
        case 'subtract':
            return isNum(values[0]) && isNum(values[1]) ? toNum(values[0]) - toNum(values[1]) : null;
        case 'divide': {
            if (!isNum(values[0]) || !isNum(values[1])) return null;
            const b = toNum(values[1]);
            return b === 0 ? null : toNum(values[0]) / b;
        }
        case 'concat':
            return concat(values, String(config.separator ?? ' '));
        case 'abs':
            return isNum(values[0]) ? Math.abs(toNum(values[0])) : null;
        default:
            return null;
    }
}

/** `(year_b*12 + month_b) − (year_a*12 + month_a)` — cruza años bien. */
function dateDiffMonths(a: unknown, b: unknown): number | null {
    const da = parseDateParts(a);
    const db = parseDateParts(b);
    if (!da || !db) return null;
    return db.year * 12 + db.month - (da.year * 12 + da.month);
}

/** `floor((b − a) / 86400s)`. Para `date` asume 00:00:00 UTC. */
function dateDiffDays(a: unknown, b: unknown): number | null {
    const ta = parseUtcTimestamp(a);
    const tb = parseUtcTimestamp(b);
    if (ta === null || tb === null) return null;
    return Math.floor((tb - ta) / 86_400_000);
}

function sum(values: unknown[]): number | null {
    let any = false;
    let total = 0;
    for (const v of values) {
        if (!isNum(v)) continue;
        total += toNum(v);
        any = true;
    }
    return any ? total : null;
}

function product(values: unknown[]): number | null {
    let any = false;
    let total = 1;
    for (const v of values) {
        if (!isNum(v)) continue;
        total *= toNum(v);
        any = true;
    }
    return any ? total : null;
}

function concat(values: unknown[], separator: string): string | null {
    const pieces: string[] = [];
    for (const v of values) {
        if (v === null || v === undefined || v === '') continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            pieces.push(String(v));
        }
    }
    return pieces.length === 0 ? null : pieces.join(separator);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

function parseDateParts(v: unknown): { year: number; month: number } | null {
    if (typeof v !== 'string') return null;
    const m = DATE_RE.exec(v);
    if (!m) return null;
    return { year: Number(m[1]), month: Number(m[2]) };
}

/** Timestamp UTC en ms — parse manual, jamás `new Date(str)` ambiguo. */
function parseUtcTimestamp(v: unknown): number | null {
    if (typeof v !== 'string') return null;
    const m = DATE_RE.exec(v);
    if (!m) return null;
    return Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4] ?? 0),
        Number(m[5] ?? 0),
        Number(m[6] ?? 0),
    );
}

function isNum(v: unknown): boolean {
    if (v === null || v === undefined || v === '') return false;
    if (typeof v === 'boolean') return true; // 1/0
    if (typeof v === 'number') return Number.isFinite(v);
    return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
}

function toNum(v: unknown): number {
    if (typeof v === 'boolean') return v ? 1 : 0;
    return Number(v);
}
