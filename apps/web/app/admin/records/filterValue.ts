import type { FilterOperator } from '@/types/record';

import { isNullaryOperator } from './operators';

/** Operadores cuyo valor es una LISTA (`es alguno de` / `no es ninguno de`). */
export function isMultiValueOperator(op: FilterOperator): boolean {
    return op === 'in' || op === 'nin';
}

/**
 * Normaliza el valor de un filtro a lista de strings (lo que el
 * QueryBuilder espera en `in`/`nin`). Tolera el CSV que escribía la
 * versión anterior del input ("a, b") y los escalares sueltos.
 */
export function toValueList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .filter((v) => v !== null && v !== undefined && v !== '')
            .map((v) => String(v));
    }
    if (typeof value === 'string') {
        return value.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
    return [];
}

/**
 * v0.1.191 — al CAMBIAR el operador de una condición, el valor tiene que
 * cambiar de forma con él: `es` guarda un escalar, `es alguno de` una
 * lista. Sin esta conversión, pasar de "es: pendiente" a "es alguno de"
 * dejaba el string suelto (que el backend descartaba) y el picker
 * arrancaba vacío; y al revés, la lista quedaba pegada a un `eq` que
 * compara contra `"a,b"`. Conserva lo elegido cuando tiene sentido:
 * `pendiente` → `[pendiente]` y `[pendiente, pagada]` → `pendiente`.
 */
export function valueForOperator(nextOp: FilterOperator, value: unknown): unknown {
    if (isNullaryOperator(nextOp)) return null;
    if (nextOp === 'between_relative') {
        // El valor pasa de ser una fecha (string ISO) a un preset slug.
        // Si no es ya un preset válido, default a este mes.
        if (typeof value !== 'string' || value === '' || value.includes('-')) {
            return 'this_month';
        }
        return value;
    }
    if (isMultiValueOperator(nextOp)) {
        if (Array.isArray(value)) return value;
        if (value === null || value === undefined || value === '') return [];
        return [value];
    }
    if (Array.isArray(value)) return value[0] ?? '';
    return value;
}
