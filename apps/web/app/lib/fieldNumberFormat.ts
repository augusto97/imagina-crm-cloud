import type { FieldEntity } from '@/types/field';

/**
 * Decimales CONFIGURADOS de un campo numérico. La clave canónica es
 * `config.precision` (la que escribe el FieldConfigEditor y valida el
 * schema compartido de number/currency — `decimals` NUNCA existió en el
 * schema, Zod la descarta). Defaults cuando no está configurada:
 * currency 2, number 0.
 */
export function fieldPrecision(field: Pick<FieldEntity, 'type' | 'config'>): number {
    const raw = (field.config as { precision?: unknown }).precision;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
        return Math.min(Math.floor(raw), 10);
    }
    return field.type === 'currency' ? 2 : 0;
}

/**
 * Formatea un valor numérico respetando la precisión del campo:
 * - `currency`: decimales FIJOS (precision 0 → "1,032,000"; 2 → "…,000.00").
 * - `number` (y resto): hasta `precision` decimales, sin ceros de relleno.
 */
export function formatFieldNumber(
    field: Pick<FieldEntity, 'type' | 'config'>,
    num: number,
): string {
    const p = fieldPrecision(field);
    return num.toLocaleString(undefined, {
        minimumFractionDigits: field.type === 'currency' ? p : 0,
        maximumFractionDigits: p,
    });
}
