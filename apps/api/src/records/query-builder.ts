import { BadRequestException } from '@nestjs/common';
import {
    isDataField,
    jsonbKeyForField,
    type DateRangePreset,
    type FieldType,
    type FilterCondition,
    type FilterNode,
    type FilterOperator,
} from '@imagina-base/shared';
import { and, or, sql, type SQL } from 'drizzle-orm';
import { records } from '../db/schema';

export interface FilterableField {
    id: number;
    type: FieldType;
}

/** Tipos que no admiten WHERE (viven fuera de `data`) — CONTRACT.md §4. */
const NON_FILTERABLE: readonly FieldType[] = ['relation', 'computed'];

/**
 * Compila un filter tree a una condición SQL sobre `records.data` (JSONB).
 *
 * Whitelist estricta (regla de oro nº 4): cada condición referencia un
 * `field_id`; se resuelve al field de la lista y a una expresión JSONB tipada
 * (`(data->>'fN')::numeric`, `::date`, …). El valor JAMÁS se interpola —
 * siempre viaja como parámetro. Condiciones sobre campos inexistentes o no
 * filtrables se descartan (igual que el plugin).
 */
export function compileFilterTree(
    fieldsById: Map<number, FilterableField>,
    tree: FilterNode | undefined,
    now: Date,
): SQL | undefined {
    if (!tree) return undefined;
    return compileNode(fieldsById, tree, now);
}

function compileNode(
    fieldsById: Map<number, FilterableField>,
    node: FilterNode,
    now: Date,
): SQL | undefined {
    if (node.type === 'group') {
        const parts = node.children
            .map((c) => compileNode(fieldsById, c, now))
            .filter((c): c is SQL => c !== undefined);
        if (parts.length === 0) return undefined;
        return node.logic === 'or' ? or(...parts) : and(...parts);
    }
    return compileCondition(fieldsById, node, now);
}

function compileCondition(
    fieldsById: Map<number, FilterableField>,
    cond: FilterCondition,
    now: Date,
): SQL | undefined {
    const field = fieldsById.get(cond.field_id);
    if (!field || !isDataField(field.type) || NON_FILTERABLE.includes(field.type)) {
        return undefined; // whitelist: campo desconocido / no filtrable → se descarta
    }

    const key = jsonbKeyForField(field.id);
    const op = cond.op;

    if (field.type === 'multi_select') {
        return compileMultiSelect(key, op, cond.value);
    }

    // Expresión de texto base y expresión tipada según el tipo del campo.
    const asText = sql`(${records.data} ->> ${key})`;

    switch (op) {
        case 'is_null':
            return sql`${asText} IS NULL`;
        case 'is_not_null':
            return sql`${asText} IS NOT NULL`;
        case 'contains':
            return sql`${asText} ILIKE ${'%' + escapeLike(str(cond.value)) + '%'}`;
        case 'not_contains':
            return sql`(${asText} IS NULL OR ${asText} NOT ILIKE ${'%' + escapeLike(str(cond.value)) + '%'})`;
        case 'starts_with':
            return sql`${asText} ILIKE ${escapeLike(str(cond.value)) + '%'}`;
        case 'ends_with':
            return sql`${asText} ILIKE ${'%' + escapeLike(str(cond.value))}`;
        case 'in':
        case 'nin': {
            const values = toArray(cond.value).map(str);
            if (values.length === 0) return op === 'in' ? sql`false` : undefined;
            const membership = sql`${asText} = ANY(${values})`;
            return op === 'in' ? membership : sql`(${asText} IS NULL OR NOT (${membership}))`;
        }
        case 'between_relative': {
            const range = computePresetRange(asPreset(cond.value), field.type, now);
            const expr = typedExpr(key, field.type);
            return sql`(${expr} >= ${range.from} AND ${expr} <= ${range.to})`;
        }
        case 'eq':
        case 'neq':
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
            return compileComparison(key, field.type, op, cond.value);
        default: {
            const _exhaustive: never = op;
            throw new BadRequestException(`Operador no soportado: ${String(_exhaustive)}`);
        }
    }
}

function compileComparison(
    key: string,
    type: FieldType,
    op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte',
    rawValue: unknown,
): SQL {
    const expr = typedExpr(key, type);
    const value = castValue(type, rawValue);
    switch (op) {
        case 'eq':
            return sql`${expr} = ${value}`;
        case 'neq':
            // IS DISTINCT FROM trata NULL como valor (neq de X incluye los null).
            return sql`${expr} IS DISTINCT FROM ${value}`;
        case 'gt':
            return sql`${expr} > ${value}`;
        case 'gte':
            return sql`${expr} >= ${value}`;
        case 'lt':
            return sql`${expr} < ${value}`;
        case 'lte':
            return sql`${expr} <= ${value}`;
    }
}

/** Expresión JSONB tipada por tipo de campo (STANDALONE.md §3.3). */
function typedExpr(key: string, type: FieldType): SQL {
    const asText = sql`(${records.data} ->> ${key})`;
    switch (type) {
        case 'number':
        case 'currency':
            return sql`${asText}::numeric`;
        case 'date':
            return sql`${asText}::date`;
        case 'datetime':
            return sql`${asText}::timestamptz`;
        default:
            return asText;
    }
}

function castValue(type: FieldType, value: unknown): number | string {
    if (type === 'number' || type === 'currency') {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) {
            throw new BadRequestException('Valor numérico inválido en el filtro');
        }
        return n;
    }
    return str(value);
}

function compileMultiSelect(key: string, op: FilterOperator, value: unknown): SQL | undefined {
    const arr = sql`(${records.data} -> ${key})`;
    switch (op) {
        case 'is_null':
            return sql`(${arr} IS NULL OR ${arr} = '[]'::jsonb)`;
        case 'is_not_null':
            return sql`(${arr} IS NOT NULL AND ${arr} <> '[]'::jsonb)`;
        case 'eq':
        case 'contains':
            return sql`${arr} @> to_jsonb(${str(value)}::text)`;
        case 'neq':
        case 'not_contains':
            return sql`(${arr} IS NULL OR NOT (${arr} @> to_jsonb(${str(value)}::text)))`;
        case 'in': {
            const values = toArray(value).map(str);
            return values.length === 0 ? sql`false` : sql`${arr} ?| ${values}::text[]`;
        }
        case 'nin': {
            const values = toArray(value).map(str);
            return values.length === 0
                ? undefined
                : sql`(${arr} IS NULL OR NOT (${arr} ?| ${values}::text[]))`;
        }
        default:
            // starts_with/ends_with/gt/… no aplican a multi_select → se descartan.
            return undefined;
    }
}

// --- Presets de rango relativo (se resuelven contra `now` en cada query) ---

interface Range {
    from: string;
    to: string;
}

function computePresetRange(preset: DateRangePreset, type: FieldType, now: Date): Range {
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const addDays = (d: Date, n: number) => {
        const x = new Date(d);
        x.setDate(x.getDate() + n);
        return x;
    };
    const today = startOfDay(now);
    // Semana ISO: lunes como primer día.
    const dow = (today.getDay() + 6) % 7;
    const startOfWeek = addDays(today, -dow);

    let from: Date;
    let to: Date;
    switch (preset) {
        case 'today':
            from = today;
            to = today;
            break;
        case 'yesterday':
            from = addDays(today, -1);
            to = addDays(today, -1);
            break;
        case 'this_week':
            from = startOfWeek;
            to = addDays(startOfWeek, 6);
            break;
        case 'last_week':
            from = addDays(startOfWeek, -7);
            to = addDays(startOfWeek, -1);
            break;
        case 'this_month':
            from = new Date(today.getFullYear(), today.getMonth(), 1);
            to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            break;
        case 'last_month':
            from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            to = new Date(today.getFullYear(), today.getMonth(), 0);
            break;
        case 'last_7_days':
            from = addDays(today, -6);
            to = today;
            break;
        case 'last_15_days':
            from = addDays(today, -14);
            to = today;
            break;
        case 'last_30_days':
            from = addDays(today, -29);
            to = today;
            break;
        case 'this_year':
            from = new Date(today.getFullYear(), 0, 1);
            to = new Date(today.getFullYear(), 11, 31);
            break;
        case 'last_year':
            from = new Date(today.getFullYear() - 1, 0, 1);
            to = new Date(today.getFullYear() - 1, 11, 31);
            break;
    }

    if (type === 'datetime') {
        // Cubre el día completo: 00:00:00 del `from` a 23:59:59.999 del `to`.
        const endOfDay = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
        return { from: from.toISOString(), to: endOfDay.toISOString() };
    }
    return { from: fmtDate(from), to: fmtDate(to) };
}

function fmtDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// --- helpers ---

function str(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    throw new BadRequestException('Valor de filtro inválido (se esperaba escalar)');
}

function toArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
    return [value];
}

function asPreset(value: unknown): DateRangePreset {
    const preset =
        typeof value === 'string'
            ? value
            : value && typeof value === 'object' && 'preset' in value
              ? (value as { preset?: unknown }).preset
              : undefined;
    if (typeof preset !== 'string') {
        throw new BadRequestException('between_relative requiere el slug de un preset');
    }
    return preset as DateRangePreset;
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}
