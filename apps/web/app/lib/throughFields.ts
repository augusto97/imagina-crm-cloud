import type { FieldEntity } from '@/types/field';

/**
 * Campos a través de una relación — lookup / rollup (v0.1.170, ADR-S19).
 *
 * El valor de un lookup es una LISTA de valores del campo del otro lado
 * (uno por registro vinculado); el de un rollup es un número (o un texto
 * ISO para min/max de fecha). Para formatearlos como corresponde (moneda
 * con sus decimales, opciones con su color, fecha regional) la UI arma un
 * campo "de vista" con el tipo y la config del campo destino, que el
 * backend adjunta en `field.through`.
 */

/** Campo de vista de un lookup: el campo destino, con su tipo y config. */
export function lookupDisplayField(field: FieldEntity): FieldEntity | null {
    const t = field.through?.target_field;
    if (!t) return null;
    return { ...field, type: t.type, config: t.config };
}

/**
 * Campo de vista de un rollup: número con la precisión/moneda del destino
 * (sum/min/max), número entero (count), hasta 2 decimales (avg) o fecha
 * (min/max de un campo de fecha).
 */
export function rollupDisplayField(field: FieldEntity): FieldEntity {
    const op = String(field.config.operation ?? 'count');
    const t = field.through?.target_field ?? null;
    if (op === 'count' || !t) return { ...field, type: 'number', config: { precision: 0 } };
    if (t.type === 'date' || t.type === 'datetime') return { ...field, type: t.type, config: {} };
    if (op === 'avg') return { ...field, type: 'number', config: { precision: 2 } };
    return { ...field, type: t.type, config: t.config };
}

/** Los valores de un lookup como array (tolerante a un valor suelto). */
export function lookupValues(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined || value === '') return [];
    return [value];
}
