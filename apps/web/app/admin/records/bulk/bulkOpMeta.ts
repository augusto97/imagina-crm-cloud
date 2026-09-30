import {
    BULK_NUMERIC_TYPES,
    bulkOperationSchema,
    bulkOpsFor,
    type BulkOpKind,
    type BulkOperation,
} from '@imagina-base/shared';

import { __ } from '@/lib/i18n';
import { formatNumber, getTenantFormat, type NumberFormatId } from '@/lib/tenantFormat';
import type { FieldEntity, FieldTypeSlug } from '@/types/field';

/**
 * Piezas PURAS del diálogo de edición masiva (v0.1.216): cómo se llama cada
 * operación en criollo, qué columnas se pueden editar, y cómo un borrador del
 * formulario se convierte en una operación que el backend acepta.
 */

export const OP_LABELS: Record<BulkOpKind, string> = {
    set: 'Poner este valor',
    clear: 'Vaciar',
    add: 'Sumar',
    subtract: 'Restar',
    multiply: 'Multiplicar por',
    divide: 'Dividir por',
    percent: 'Subir o bajar un porcentaje',
    round: 'Redondear',
    calc: 'Calcular con otras columnas',
    copy: 'Copiar de otra columna',
    prepend: 'Agregar texto al inicio',
    append: 'Agregar texto al final',
    replace: 'Buscar y reemplazar',
    text_case: 'Mayúsculas y minúsculas',
    trim: 'Quitar espacios de sobra',
    add_options: 'Agregar opciones',
    remove_options: 'Quitar opciones',
    toggle: 'Invertir (marcado ↔ sin marcar)',
    shift_date: 'Correr la fecha',
    today: 'Poner la fecha de hoy',
    add_links: 'Vincular registros',
    remove_links: 'Desvincular registros',
};

export function opLabel(op: BulkOpKind, type: FieldTypeSlug): string {
    if (op === 'today' && type === 'datetime') return __('Poner la fecha y hora actual');
    if (op === 'set' && type === 'checkbox') return __('Marcar o desmarcar');
    return __(OP_LABELS[op]);
}

/** Las columnas que una edición masiva puede ESCRIBIR. */
export function bulkEditableFields(fields: FieldEntity[], isLocked: (f: FieldEntity) => boolean = () => false): FieldEntity[] {
    return fields.filter((f) => bulkOpsFor(f.type as never).length > 0 && !isLocked(f));
}

/** Las columnas que sirven de número en «calcular» (también las calculadas y los rollups). */
export function numericSourceFields(fields: FieldEntity[]): FieldEntity[] {
    return fields.filter((f) => (BULK_NUMERIC_TYPES as readonly string[]).includes(f.type) || f.type === 'computed');
}

/**
 * Un número tal como lo escribe la persona, con los separadores de SU
 * empresa: con punto de miles, «12.500» es doce mil quinientos y «12,5» es
 * doce y medio. Vacío o ilegible → null.
 */
export function parseNumberInput(text: string, format: NumberFormatId = getTenantFormat().number_format): number | null {
    let s = text.replace(/[\s\u00a0]/g, '').replace(/[$\u20ac%]/g, '');
    if (s === '' || s === '-') return null;
    const decimalComma = format === 'dot_comma' || format === 'space_comma';
    if (decimalComma) {
        if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
        // Sin coma: un punto con grupos de a tres es de miles; si no, decimal.
        else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    } else {
        s = s.replace(/,/g, '');
    }
    if (!/^-?\d*\.?\d+$/.test(s) && !/^-?\d+\.?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/**
 * Lo que el formulario guarda de una operación mientras se edita. Los
 * números van como TEXTO (lo tipeado, con los separadores de la empresa) y
 * se convierten recién al armar la operación.
 */
export interface BulkDraft {
    key: string;
    field_id: number | null;
    op: BulkOpKind | null;
    value?: unknown;
    amount?: string;
    mode?: string;
    adjust?: string;
    unit?: string;
    text?: string;
    find?: string;
    replace?: string;
    case_sensitive?: boolean;
    values?: string[];
    ids?: number[];
    source_field_id?: number | null;
    left?: { field_id?: number; value?: string };
    right?: { field_id?: number; value?: string };
    operator?: '+' | '-' | '*' | '/';
}

let seq = 0;
export function newDraft(): BulkDraft {
    seq += 1;
    return { key: `op-${Date.now()}-${seq}`, field_id: null, op: null };
}

/** Al elegir una operación, los valores iniciales que tienen sentido. */
export function draftDefaults(op: BulkOpKind): Partial<BulkDraft> {
    switch (op) {
        case 'round':
            return { amount: '1000', mode: 'up', adjust: '0' };
        case 'shift_date':
            return { amount: '7', unit: 'days' };
        case 'text_case':
            return { mode: 'title' };
        case 'calc':
            return { left: {}, right: { value: '' }, operator: '*' };
        case 'set':
            return { value: '' };
        default:
            return {};
    }
}

export type DraftResult = { ok: true; operation: BulkOperation } | { ok: false; error: string };

/** Borrador → operación validada con el MISMO schema del backend. */
export function draftToOperation(d: BulkDraft, format?: NumberFormatId, fieldType?: FieldTypeSlug): DraftResult {
    if (d.field_id === null) return { ok: false, error: __('Elegí la columna.') };
    if (d.op === null) return { ok: false, error: __('Elegí qué hacer.') };
    const num = (s: string | undefined, what: string): number | { error: string } => {
        const n = parseNumberInput(s ?? '', format);
        return n === null ? { error: `${__('Escribí')} ${what}.` } : n;
    };
    const base = { op: d.op, field_id: d.field_id };
    let raw: Record<string, unknown>;
    switch (d.op) {
        case 'set': {
            let value = d.value ?? null;
            // Un número tipeado se lee con los separadores de la empresa
            // (el backend haría Number("12.500") = 12,5).
            if (fieldType && ['number', 'currency', 'percent'].includes(fieldType) && typeof value === 'string') {
                if (value.trim() === '') value = null;
                else {
                    const n = parseNumberInput(value, format);
                    if (n === null) return { ok: false, error: __('El valor no es un número.') };
                    value = n;
                }
            }
            raw = { ...base, value };
            break;
        }
        case 'add':
        case 'subtract': {
            const n = num(d.amount, __('la cantidad'));
            if (typeof n !== 'number') return { ok: false, error: n.error };
            raw = { ...base, amount: n };
            break;
        }
        case 'multiply':
        case 'divide': {
            const n = num(d.amount, __('el número'));
            if (typeof n !== 'number') return { ok: false, error: n.error };
            raw = d.op === 'multiply' ? { ...base, factor: n } : { ...base, divisor: n };
            break;
        }
        case 'percent': {
            const n = num(d.amount, __('el porcentaje'));
            if (typeof n !== 'number') return { ok: false, error: n.error };
            // El selector «subir / bajar» decide el signo; lo tipeado es la magnitud.
            raw = { ...base, percent: d.mode === 'down' ? -Math.abs(n) : Math.abs(n) };
            break;
        }
        case 'round': {
            const m = num(d.amount, __('el múltiplo'));
            if (typeof m !== 'number') return { ok: false, error: m.error };
            const adj = parseNumberInput(d.adjust ?? '', format) ?? 0;
            raw = { ...base, multiple: m, mode: d.mode ?? 'nearest', adjust: adj };
            break;
        }
        case 'calc': {
            const operand = (o: { field_id?: number; value?: string } | undefined): Record<string, number> | { error: string } => {
                if (o?.field_id) return { field_id: o.field_id };
                const n = parseNumberInput(o?.value ?? '', format);
                return n === null ? { error: __('Completá los dos lados del cálculo.') } : { value: n };
            };
            const l = operand(d.left);
            const r = operand(d.right);
            if ('error' in l) return { ok: false, error: l.error as string };
            if ('error' in r) return { ok: false, error: r.error as string };
            raw = { ...base, left: l, right: r, operator: d.operator ?? '*' };
            break;
        }
        case 'copy':
            if (!d.source_field_id) return { ok: false, error: __('Elegí de qué columna copiar.') };
            raw = { ...base, source_field_id: d.source_field_id };
            break;
        case 'prepend':
        case 'append':
            if (!d.text) return { ok: false, error: __('Escribí el texto.') };
            raw = { ...base, text: d.text };
            break;
        case 'replace':
            if (!d.find) return { ok: false, error: __('Escribí qué buscar.') };
            raw = { ...base, find: d.find, replace: d.replace ?? '', case_sensitive: d.case_sensitive === true };
            break;
        case 'text_case':
            raw = { ...base, mode: d.mode ?? 'title' };
            break;
        case 'add_options':
        case 'remove_options':
            if (!d.values || d.values.length === 0) return { ok: false, error: __('Elegí al menos una opción.') };
            raw = { ...base, values: d.values };
            break;
        case 'shift_date': {
            const n = num(d.amount, __('cuánto correrla'));
            if (typeof n !== 'number') return { ok: false, error: n.error };
            raw = { ...base, amount: Math.trunc(d.mode === 'back' ? -Math.abs(n) : Math.abs(n)), unit: d.unit ?? 'days' };
            break;
        }
        case 'add_links':
        case 'remove_links':
            if (!d.ids || d.ids.length === 0) return { ok: false, error: __('Elegí al menos un registro.') };
            raw = { ...base, ids: d.ids };
            break;
        default:
            raw = base;
    }
    const parsed = bulkOperationSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? __('Revisá la operación.') };
    return { ok: true, operation: parsed.data };
}

/**
 * v0.1.221 — La inversa de `draftToOperation`: vuelve a abrir en el editor una
 * operación ya guardada (la acción «Editar en lote» de una automatización).
 * Los números salen con los separadores de la empresa, que es como se leen.
 */
export function operationToDraft(o: BulkOperation): BulkDraft {
    const d: BulkDraft = { ...newDraft(), field_id: o.field_id, op: o.op };
    const n = (v: number): string => formatNumber(v, { maxFrac: 6 });
    switch (o.op) {
        case 'set':
            d.value = o.value;
            break;
        case 'add':
        case 'subtract':
            d.amount = n(o.amount);
            break;
        case 'multiply':
            d.amount = n(o.factor);
            break;
        case 'divide':
            d.amount = n(o.divisor);
            break;
        case 'percent':
            d.amount = n(Math.abs(o.percent));
            d.mode = o.percent < 0 ? 'down' : 'up';
            break;
        case 'round':
            d.amount = n(o.multiple);
            d.mode = o.mode;
            d.adjust = n(o.adjust ?? 0);
            break;
        case 'calc': {
            const side = (s: { field_id: number } | { value: number }) => ('field_id' in s ? { field_id: s.field_id } : { value: n(s.value) });
            d.left = side(o.left);
            d.right = side(o.right);
            d.operator = o.operator;
            break;
        }
        case 'copy':
            d.source_field_id = o.source_field_id;
            break;
        case 'prepend':
        case 'append':
            d.text = o.text;
            break;
        case 'replace':
            d.find = o.find;
            d.replace = o.replace;
            d.case_sensitive = o.case_sensitive;
            break;
        case 'text_case':
            d.mode = o.mode;
            break;
        case 'add_options':
        case 'remove_options':
            d.values = [...o.values];
            break;
        case 'shift_date':
            d.amount = n(Math.abs(o.amount));
            d.mode = o.amount < 0 ? 'back' : 'forward';
            d.unit = o.unit;
            break;
        case 'add_links':
        case 'remove_links':
            d.ids = [...o.ids];
            break;
        default:
            break;
    }
    return d;
}
