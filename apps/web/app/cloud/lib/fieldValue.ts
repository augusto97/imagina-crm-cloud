import type { Field, SelectOption } from '@imagina-base/shared';

/** Opciones de un campo select/multi_select desde su config. */
export function fieldOptions(field: Field): SelectOption[] {
    const opts = (field.config as { options?: unknown }).options;
    return Array.isArray(opts) ? (opts as SelectOption[]) : [];
}

/** Formatea un valor de `data` para mostrar (label de la opción si aplica). */
export function formatValue(field: Field, value: unknown): string {
    if (value === null || value === undefined || value === '') return '';
    if (field.type === 'select') {
        return fieldOptions(field).find((o) => o.value === value)?.label ?? String(value);
    }
    if (field.type === 'multi_select' && Array.isArray(value)) {
        const opts = fieldOptions(field);
        return value.map((v) => opts.find((o) => o.value === v)?.label ?? String(v)).join(', ');
    }
    if (field.type === 'checkbox') return value ? 'Sí' : 'No';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
}

/** Convierte lo que escribe el usuario (string) al valor tipado de `data`. */
export function parseInput(field: Field, raw: string): unknown {
    if (raw === '') return null;
    if (field.type === 'number' || field.type === 'currency') return Number(raw);
    if (field.type === 'checkbox') return raw === 'true' || raw === '1';
    if (field.type === 'multi_select') return raw.split(',').map((s) => s.trim()).filter(Boolean);
    return raw;
}
