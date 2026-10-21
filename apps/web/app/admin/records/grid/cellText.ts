import { formatDuration, formatPhone, type DurationFormat } from '@imagina-base/shared';

import { formatFieldNumber } from '@/lib/fieldNumberFormat';
import { formatDateStr, formatDateTimeStr, formatNumber } from '@/lib/tenantFormat';
import { lookupDisplayField, lookupValues, rollupDisplayField } from '@/lib/throughFields';
import type { FieldEntity } from '@/types/field';

import { extractFieldOptions } from '../fieldOptions';
import { isCheckedValue } from '../renderCellValue';

/**
 * v0.1.287 — El texto LEGIBLE de una celda, para copiar a Excel/Sheets: lo
 * mismo que se ve en la tabla (la etiqueta de la opción, la fecha en el
 * formato de la empresa, el número con sus separadores, el nombre de la
 * persona, «Sí/No»), no el valor interno. Pegarlo de vuelta en la tabla lo
 * convierte al mismo valor (ver `coerceTextToFieldValue`).
 */
export interface CellTextContext {
    /** Nombre de una persona por id (null si todavía no se conoce). */
    userName: (id: number) => string | null;
    /** Título de un registro vinculado por (campo relation, id). */
    relationTitle: (fieldId: number, id: number) => string | null;
    /** Nombre de un archivo por id. */
    fileName: (id: number) => string | null;
}

export function cellToText(field: FieldEntity, value: unknown, ctx: CellTextContext): string {
    if (field.type === 'lookup') {
        const display = lookupDisplayField(field);
        const values = lookupValues(value);
        if (!display) return values.map((v) => String(v ?? '')).join(', ');
        return values.map((v) => cellToText(display, v, ctx)).filter((t) => t !== '').join(', ');
    }
    if (field.type === 'rollup') return cellToText(rollupDisplayField(field), value, ctx);
    if (field.type === 'checkbox') return isCheckedValue(value) ? 'Sí' : 'No';
    if (value === null || value === undefined || value === '') return '';

    switch (field.type) {
        case 'select': {
            const opt = extractFieldOptions(field).find((o) => o.value === value);
            return opt?.label ?? String(value);
        }
        case 'multi_select': {
            const opts = new Map(extractFieldOptions(field).map((o) => [o.value, o.label]));
            const list = Array.isArray(value) ? value : [value];
            return list.map((v) => opts.get(String(v)) ?? String(v)).join(', ');
        }
        case 'date':
            return typeof value === 'string' ? formatDateStr(value) : String(value);
        case 'datetime':
            return typeof value === 'string' ? formatDateTimeStr(value) : String(value);
        case 'number':
        case 'currency':
            return typeof value === 'number' ? formatFieldNumber(field, value) : String(value);
        case 'percent': {
            const n = typeof value === 'number' ? value : Number(value);
            return Number.isFinite(n) ? `${formatNumber(n, { maxFrac: 2 })}%` : String(value);
        }
        case 'rating':
            return String(value);
        case 'duration':
            return formatDuration(value, (field.config as { format?: DurationFormat }).format);
        case 'phone':
            return formatPhone(value) || String(value);
        case 'user': {
            const id = typeof value === 'number' ? value : Number(value);
            if (!Number.isInteger(id) || id <= 0) return String(value);
            return ctx.userName(id) ?? String(id);
        }
        case 'relation': {
            const ids = (Array.isArray(value) ? value : [value]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
            return ids.map((id) => ctx.relationTitle(field.id, id) ?? `#${id}`).join(', ');
        }
        case 'file': {
            const ids = (Array.isArray(value) ? value : [value]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
            return ids.map((id) => ctx.fileName(id) ?? `#${id}`).join(', ');
        }
        case 'computed':
            return typeof value === 'number' ? formatNumber(value, { maxFrac: 2 }) : String(value);
        default:
            return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
}
