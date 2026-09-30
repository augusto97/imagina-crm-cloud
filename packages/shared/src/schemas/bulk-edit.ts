import { z } from 'zod';
import { validateFieldValue, type FieldValueSpec } from '../field-types/validate';
import { idSchema } from './common';
import type { FieldType } from './field';
import { filterTreeSchema } from './filter';

/**
 * Edición masiva (v0.1.216). Una edición en lote es una lista ORDENADA de
 * operaciones —«sumar 10 % al precio», «agregar la etiqueta VIP», «correr la
 * fecha 7 días»— que se aplica a cada registro elegido. Vive en `shared`
 * porque la MISMA función calcula la vista previa y escribe: lo que la persona
 * ve antes de confirmar es literalmente lo que se guarda.
 *
 * Cada operación trabaja sobre el valor ACTUAL de la fila (un aumento de
 * precio parte del precio de cada producto, no de un número común), y las
 * operaciones se encadenan: la segunda ve el resultado de la primera.
 */

/** Cuántos registros puede abarcar una edición (por selección o por filtro). */
export const BULK_EDIT_MAX_TARGET = 5000;
/** Cuántos registros escribe cada pedido de «aplicar» (el cliente parte en tandas). */
export const BULK_EDIT_APPLY_CHUNK = 200;
/** Cuántas operaciones entran en una sola edición. */
export const BULK_EDIT_MAX_OPERATIONS = 12;

const fieldRef = { field_id: idSchema };

const operandSchema = z.union([
    z.object({ field_id: idSchema }).strict(),
    z.object({ value: z.number().finite() }).strict(),
]);
export type BulkOperand = z.infer<typeof operandSchema>;

export const BULK_OPS = [
    'set',
    'clear',
    'add',
    'subtract',
    'multiply',
    'divide',
    'percent',
    'round',
    'calc',
    'copy',
    'prepend',
    'append',
    'replace',
    'text_case',
    'trim',
    'add_options',
    'remove_options',
    'toggle',
    'shift_date',
    'today',
    'add_links',
    'remove_links',
] as const;
export type BulkOpKind = (typeof BULK_OPS)[number];

export const bulkOperationSchema = z.discriminatedUnion('op', [
    z.object({ op: z.literal('set'), ...fieldRef, value: z.unknown() }),
    z.object({ op: z.literal('clear'), ...fieldRef }),
    z.object({ op: z.literal('add'), ...fieldRef, amount: z.number().finite() }),
    z.object({ op: z.literal('subtract'), ...fieldRef, amount: z.number().finite() }),
    z.object({ op: z.literal('multiply'), ...fieldRef, factor: z.number().finite() }),
    z.object({
        op: z.literal('divide'),
        ...fieldRef,
        divisor: z.number().finite().refine((n) => n !== 0, 'No se puede dividir por cero'),
    }),
    /** +10 = subir 10 %, -15 = bajar 15 %. */
    z.object({ op: z.literal('percent'), ...fieldRef, percent: z.number().finite().min(-100).max(10_000) }),
    /**
     * Redondeo a la «grilla» `k × multiple + adjust` en la dirección pedida:
     * `multiple 1000, up, adjust -100` lleva cada precio al PRÓXIMO terminado
     * en 900 (25.320 → 25.900, y 11.000 → 11.900: redondear hacia arriba
     * nunca baja un precio); `multiple 1, up, adjust 0.99` deja 12,40 en 12,99.
     */
    z.object({
        op: z.literal('round'),
        ...fieldRef,
        multiple: z.number().positive().finite(),
        mode: z.enum(['nearest', 'up', 'down']).default('nearest'),
        adjust: z.number().finite().default(0),
    }),
    /** `campo = A (+ − × ÷) B`, donde A y B son columnas o números. */
    z.object({
        op: z.literal('calc'),
        ...fieldRef,
        left: operandSchema,
        operator: z.enum(['+', '-', '*', '/']),
        right: operandSchema,
    }),
    z.object({ op: z.literal('copy'), ...fieldRef, source_field_id: idSchema }),
    z.object({ op: z.literal('prepend'), ...fieldRef, text: z.string().max(2000) }),
    z.object({ op: z.literal('append'), ...fieldRef, text: z.string().max(2000) }),
    z.object({
        op: z.literal('replace'),
        ...fieldRef,
        find: z.string().min(1).max(500),
        replace: z.string().max(2000).default(''),
        case_sensitive: z.boolean().default(false),
    }),
    z.object({ op: z.literal('text_case'), ...fieldRef, mode: z.enum(['upper', 'lower', 'title', 'sentence']) }),
    z.object({ op: z.literal('trim'), ...fieldRef }),
    z.object({ op: z.literal('add_options'), ...fieldRef, values: z.array(z.string().min(1).max(190)).min(1).max(100) }),
    z.object({ op: z.literal('remove_options'), ...fieldRef, values: z.array(z.string().min(1).max(190)).min(1).max(100) }),
    z.object({ op: z.literal('toggle'), ...fieldRef }),
    z.object({
        op: z.literal('shift_date'),
        ...fieldRef,
        amount: z.number().int().min(-100_000).max(100_000),
        unit: z.enum(['minutes', 'hours', 'days', 'weeks', 'months', 'years']),
    }),
    z.object({ op: z.literal('today'), ...fieldRef }),
    z.object({ op: z.literal('add_links'), ...fieldRef, ids: z.array(idSchema).min(1).max(100) }),
    z.object({ op: z.literal('remove_links'), ...fieldRef, ids: z.array(idSchema).min(1).max(100) }),
]);
export type BulkOperation = z.infer<typeof bulkOperationSchema>;
export type BulkOperationInput = z.input<typeof bulkOperationSchema>;

const operationsSchema = z.array(bulkOperationSchema).min(1).max(BULK_EDIT_MAX_OPERATIONS);

/**
 * A qué registros: los seleccionados (ids) o TODOS los que coinciden con los
 * filtros y la búsqueda de la vista (lo que ve la persona, sin importar la
 * página en la que esté).
 */
export const bulkEditTargetSchema = z.union([
    z.object({ ids: z.array(idSchema).min(1).max(BULK_EDIT_MAX_TARGET) }).strict(),
    z
        .object({
            filter_tree: filterTreeSchema.optional(),
            search: z.string().trim().max(200).optional(),
            /** Incluir también las subtareas que coinciden (por defecto, sólo el primer nivel). */
            include_subtasks: z.boolean().default(false),
        })
        .strict(),
]);
export type BulkEditTarget = z.infer<typeof bulkEditTargetSchema>;

export const bulkEditPreviewSchema = z.object({
    target: bulkEditTargetSchema,
    operations: operationsSchema,
});
export type BulkEditPreviewInput = z.infer<typeof bulkEditPreviewSchema>;

export const bulkEditApplySchema = z.object({
    ids: z.array(idSchema).min(1).max(BULK_EDIT_APPLY_CHUNK),
    operations: operationsSchema,
    /**
     * v0.1.218 — La edición del historial a la que pertenece esta tanda. La
     * primera tanda no lo manda (el servidor crea la edición y devuelve su id);
     * las siguientes lo repiten, así una edición en 25 tandas se deshace entera.
     */
    edit_id: idSchema.optional(),
});
export type BulkEditApplyInput = z.infer<typeof bulkEditApplySchema>;

export interface BulkChange {
    field_id: number;
    before: unknown;
    after: unknown;
}

export interface BulkEditPreview {
    /** Registros abarcados (seleccionados o que coinciden). */
    total: number;
    /** Los que efectivamente cambian: lo que se aplica. */
    ids: number[];
    unchanged: number;
    error_count: number;
    errors: Array<{ id: number; title: string; message: string }>;
    sample: Array<{ id: number; title: string; changes: BulkChange[] }>;
}

export interface BulkEditResult {
    succeeded: number[];
    unchanged: number[];
    failed: Array<{ id: number; message: string }>;
    /** La edición del historial (v0.1.218): se manda en las tandas siguientes y sirve para deshacer. */
    edit_id: number | null;
}

// ── Qué operación aplica a qué tipo de campo ─────────────────────────────

const NUMERIC: readonly BulkOpKind[] = ['set', 'clear', 'add', 'subtract', 'multiply', 'divide', 'percent', 'round', 'calc', 'copy'];
const TEXT: readonly BulkOpKind[] = ['set', 'clear', 'prepend', 'append', 'replace', 'text_case', 'trim', 'copy'];

/** Operaciones disponibles por tipo (la UI arma el menú con esto; el motor lo exige). */
export const BULK_OPS_BY_TYPE: Partial<Record<FieldType, readonly BulkOpKind[]>> = {
    number: NUMERIC,
    currency: NUMERIC,
    percent: NUMERIC,
    duration: NUMERIC,
    rating: ['set', 'clear', 'add', 'subtract', 'copy'],
    text: TEXT,
    long_text: TEXT,
    email: ['set', 'clear', 'replace', 'text_case', 'trim', 'copy'],
    url: ['set', 'clear', 'prepend', 'append', 'replace', 'trim', 'copy'],
    phone: ['set', 'clear', 'copy'],
    select: ['set', 'clear', 'copy'],
    multi_select: ['set', 'clear', 'add_options', 'remove_options', 'copy'],
    checkbox: ['set', 'toggle', 'copy'],
    date: ['set', 'clear', 'shift_date', 'today', 'copy'],
    datetime: ['set', 'clear', 'shift_date', 'today', 'copy'],
    user: ['set', 'clear', 'copy'],
    relation: ['set', 'clear', 'add_links', 'remove_links'],
    file: ['clear'],
};

export function bulkOpsFor(type: FieldType): readonly BulkOpKind[] {
    return BULK_OPS_BY_TYPE[type] ?? [];
}

/** Tipos numéricos (operandos de «calc» y origen de «copiar» entre números). */
export const BULK_NUMERIC_TYPES: readonly FieldType[] = ['number', 'currency', 'percent', 'duration', 'rating', 'rollup'];

// ── Motor ────────────────────────────────────────────────────────────────

export interface BulkField extends FieldValueSpec {
    id: number;
    label: string;
}

export interface BulkRow {
    /** `data` del registro (claves `f{id}`), con los calculados ya evaluados si se quieren usar de operando. */
    data: Record<string, unknown>;
    /** Vínculos por id de campo `relation`. */
    relations: Record<number, number[]>;
}

export interface BulkRowResult {
    /** Lo que cambia en `data` (claves `f{id}`). Los relation van como arreglo de ids. */
    patch: Record<string, unknown>;
    changes: BulkChange[];
    errors: Array<{ field_id: number; message: string }>;
}

/**
 * Aplica las operaciones a UNA fila. No escribe nada: devuelve qué cambiaría.
 * Si una operación no se puede hacer en esta fila (un número vacío que se
 * quiere multiplicar, un valor que el campo no acepta), esa operación se
 * reporta como error y la FILA ENTERA no se escribe — aplicar la mitad de un
 * cambio pensado como uno solo sería peor que no aplicarlo.
 */
export function applyBulkOperations(
    operations: readonly BulkOperation[],
    fields: ReadonlyMap<number, BulkField>,
    row: BulkRow,
    now: Date = new Date(),
): BulkRowResult {
    const work: Record<string, unknown> = { ...row.data };
    const rels: Record<number, number[]> = {};
    for (const [k, v] of Object.entries(row.relations)) rels[Number(k)] = [...v];
    const touched = new Set<number>();
    const errors: BulkRowResult['errors'] = [];

    for (const op of operations) {
        const field = fields.get(op.field_id);
        if (!field) {
            errors.push({ field_id: op.field_id, message: 'La columna ya no existe.' });
            continue;
        }
        if (!bulkOpsFor(field.type).includes(op.op)) {
            errors.push({ field_id: field.id, message: `«${field.label}» no admite esta operación.` });
            continue;
        }
        const key = `f${field.id}`;
        if (field.type === 'relation') {
            const current = rels[field.id] ?? [];
            let next: number[];
            if (op.op === 'clear') next = [];
            else if (op.op === 'add_links') next = [...new Set([...current, ...op.ids])];
            else if (op.op === 'remove_links') next = current.filter((id) => !op.ids.includes(id));
            else if (op.op === 'set') next = toIdList(op.value);
            else continue;
            rels[field.id] = next;
            touched.add(field.id);
            continue;
        }
        const out = compute(op, field, work[key], work, fields, now);
        if ('skip' in out) continue;
        if ('error' in out) {
            errors.push({ field_id: field.id, message: `${field.label}: ${out.error}` });
            continue;
        }
        // El valor pasa por el MISMO validador que una edición a mano.
        const checked = validateFieldValue(field, out.value);
        if (!checked.ok) {
            errors.push({ field_id: field.id, message: `${field.label}: ${checked.error}` });
            continue;
        }
        work[key] = checked.value;
        touched.add(field.id);
    }

    const patch: Record<string, unknown> = {};
    const changes: BulkChange[] = [];
    if (errors.length > 0) return { patch, changes, errors };
    for (const id of touched) {
        const field = fields.get(id)!;
        const key = `f${id}`;
        if (field.type === 'relation') {
            const before = [...(row.relations[id] ?? [])].sort((a, b) => a - b);
            const after = [...(rels[id] ?? [])].sort((a, b) => a - b);
            if (JSON.stringify(before) === JSON.stringify(after)) continue;
            patch[key] = rels[id] ?? [];
            changes.push({ field_id: id, before: row.relations[id] ?? [], after: rels[id] ?? [] });
            continue;
        }
        const before = row.data[key] ?? null;
        const after = work[key] ?? null;
        if (sameValue(before, after)) continue;
        patch[key] = after;
        changes.push({ field_id: id, before, after });
    }
    return { patch, changes, errors };
}

type Computed = { value: unknown } | { error: string } | { skip: true };

function compute(
    op: BulkOperation,
    field: BulkField,
    current: unknown,
    work: Record<string, unknown>,
    fields: ReadonlyMap<number, BulkField>,
    now: Date,
): Computed {
    switch (op.op) {
        case 'set':
            return { value: op.value };
        case 'clear':
            return { value: field.type === 'checkbox' ? false : null };
        case 'copy': {
            const source = fields.get(op.source_field_id);
            if (!source) return { error: 'la columna de origen ya no existe.' };
            return { value: convertValue(work[`f${source.id}`] ?? null, source, field) };
        }
        case 'toggle':
            return { value: !(current === true) };
        case 'add':
        case 'subtract': {
            // Sumar a un vacío es sumar a cero («sumar 5 al stock» de un producto sin stock cargado).
            const base = toNumber(current) ?? 0;
            const delta = op.op === 'add' ? op.amount : -op.amount;
            return { value: roundFor(field, base + delta) };
        }
        case 'multiply':
        case 'divide':
        case 'percent':
        case 'round': {
            const n = toNumber(current);
            // Multiplicar o redondear un vacío no tiene resultado: se deja como está.
            if (n === null) return { skip: true };
            let v: number;
            if (op.op === 'multiply') v = n * op.factor;
            else if (op.op === 'divide') v = n / op.divisor;
            else if (op.op === 'percent') v = n * (1 + op.percent / 100);
            else v = roundTo(n - op.adjust, op.multiple, op.mode) + op.adjust;
            return { value: roundFor(field, v) };
        }
        case 'calc': {
            const a = operandValue(op.left, work, fields);
            const b = operandValue(op.right, work, fields);
            if ('error' in a) return a;
            if ('error' in b) return b;
            let v: number;
            if (op.operator === '+') v = a.n + b.n;
            else if (op.operator === '-') v = a.n - b.n;
            else if (op.operator === '*') v = a.n * b.n;
            else {
                if (b.n === 0) return { error: 'la división da por cero.' };
                v = a.n / b.n;
            }
            return { value: roundFor(field, v) };
        }
        case 'prepend':
        case 'append': {
            const text = typeof current === 'string' ? current : current === null || current === undefined ? '' : String(current);
            return { value: op.op === 'prepend' ? `${op.text}${text}` : `${text}${op.text}` };
        }
        case 'replace': {
            if (typeof current !== 'string' || current === '') return { skip: true };
            const flags = op.case_sensitive ? 'g' : 'gi';
            const re = new RegExp(escapeRegExp(op.find), flags);
            return { value: current.replace(re, () => op.replace) };
        }
        case 'text_case': {
            if (typeof current !== 'string' || current === '') return { skip: true };
            return { value: changeCase(current, op.mode) };
        }
        case 'trim': {
            if (typeof current !== 'string') return { skip: true };
            return { value: current.replace(/\s+/g, ' ').trim() };
        }
        case 'add_options':
        case 'remove_options': {
            const list = Array.isArray(current) ? current.map(String) : [];
            const next =
                op.op === 'add_options' ? [...new Set([...list, ...op.values])] : list.filter((v) => !op.values.includes(v));
            return { value: next };
        }
        case 'shift_date': {
            if (typeof current !== 'string' || current === '') return { skip: true };
            const shifted = shiftDate(current, field.type === 'datetime', op.amount, op.unit);
            return shifted === null ? { error: 'la fecha guardada no es válida.' } : { value: shifted };
        }
        case 'today':
            return { value: field.type === 'datetime' ? now.toISOString().replace(/\.\d{3}Z$/, 'Z') : now.toISOString().slice(0, 10) };
        case 'add_links':
        case 'remove_links':
            return { skip: true };
    }
}

function operandValue(
    o: BulkOperand,
    work: Record<string, unknown>,
    fields: ReadonlyMap<number, BulkField>,
): { n: number } | { error: string } {
    if ('value' in o) return { n: o.value };
    const f = fields.get(o.field_id);
    if (!f) return { error: 'una columna del cálculo ya no existe.' };
    const n = toNumber(work[`f${f.id}`]);
    return n === null ? { error: `«${f.label}» está vacío.` } : { n };
}

function toNumber(v: unknown): number | null {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

function toIdList(v: unknown): number[] {
    const list = Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v];
    return [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

/** Decimales del campo: moneda 2 por defecto; el resto, los que diga su config (o sin ruido de coma flotante). */
function roundFor(field: BulkField, v: number): number {
    const precision = typeof field.config.precision === 'number' ? field.config.precision : field.type === 'currency' ? 2 : null;
    if (field.type === 'rating' || field.type === 'duration') return Math.round(v);
    if (field.type === 'percent') return clamp(round(v, precision ?? 2), 0, 100);
    return round(v, precision ?? 10);
}

function round(v: number, decimals: number): number {
    const f = 10 ** Math.max(0, Math.min(10, decimals));
    return Math.round((v + Number.EPSILON) * f) / f;
}

function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
}

/** Redondeo a un múltiplo sin ruido de coma flotante (0,1 × 3 = 0,3, no 0,30000000000000004). */
export function roundTo(v: number, multiple: number, mode: 'nearest' | 'up' | 'down'): number {
    const q = v / multiple;
    const snapped = Math.abs(q - Math.round(q)) < 1e-9 ? Math.round(q) : q;
    const k = mode === 'up' ? Math.ceil(snapped) : mode === 'down' ? Math.floor(snapped) : Math.round(snapped);
    const decimals = (String(multiple).split('.')[1] ?? '').length;
    return round(k * multiple, decimals + 2);
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function changeCase(s: string, mode: 'upper' | 'lower' | 'title' | 'sentence'): string {
    if (mode === 'upper') return s.toLocaleUpperCase('es');
    if (mode === 'lower') return s.toLocaleLowerCase('es');
    if (mode === 'sentence') {
        const lower = s.toLocaleLowerCase('es');
        return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1);
    }
    return s
        .toLocaleLowerCase('es')
        .replace(/(^|[\s\-/(«"'])(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toLocaleUpperCase('es'));
}

/**
 * Corre una fecha (`YYYY-MM-DD`) o fecha-hora (ISO con zona) sin cambiar la
 * hora. Los meses y años respetan el fin de mes: 31/01 + 1 mes = 28/02 (o
 * 29), igual que los merge tags de las automatizaciones.
 */
export function shiftDate(
    value: string,
    isDateTime: boolean,
    amount: number,
    unit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years',
): string | null {
    const t = isDateTime ? Date.parse(value) : Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(t)) return null;
    const d = new Date(t);
    if (unit === 'minutes' || unit === 'hours') {
        if (!isDateTime) {
            // Una fecha sin hora sólo se mueve por días enteros.
            const days = Math.trunc((amount * (unit === 'hours' ? 60 : 1)) / (24 * 60));
            d.setUTCDate(d.getUTCDate() + days);
        } else {
            d.setTime(d.getTime() + amount * (unit === 'hours' ? 3_600_000 : 60_000));
        }
    } else if (unit === 'days' || unit === 'weeks') {
        d.setUTCDate(d.getUTCDate() + amount * (unit === 'weeks' ? 7 : 1));
    } else {
        const months = amount * (unit === 'years' ? 12 : 1);
        const day = d.getUTCDate();
        d.setUTCDate(1);
        d.setUTCMonth(d.getUTCMonth() + months);
        const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        d.setUTCDate(Math.min(day, last));
    }
    if (!isDateTime) return d.toISOString().slice(0, 10);
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Copiar el valor de una columna a otra de otro tipo: se convierte a lo que
 * el destino entiende (un número a texto, una fecha-hora a fecha, una opción
 * a su valor). Lo que no tiene conversión razonable llega tal cual y el
 * validador del destino decide.
 */
function convertValue(v: unknown, from: BulkField, to: BulkField): unknown {
    if (v === null || v === undefined) return null;
    if (from.type === to.type) return v;
    const textTypes: FieldType[] = ['text', 'long_text', 'email', 'url', 'phone'];
    if (textTypes.includes(to.type)) {
        if (Array.isArray(v)) return v.join(', ');
        return String(v);
    }
    if (to.type === 'date' && typeof v === 'string') return v.slice(0, 10);
    if (to.type === 'datetime' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00Z`;
    if (to.type === 'multi_select') return Array.isArray(v) ? v : [String(v)];
    if (to.type === 'select' && Array.isArray(v)) return v[0] ?? null;
    if (BULK_NUMERIC_TYPES.includes(to.type)) return toNumber(v);
    return v;
}

function sameValue(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
