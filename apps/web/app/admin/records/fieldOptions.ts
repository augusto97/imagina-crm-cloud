import type { FieldEntity } from '@/types/field';

export interface FieldOption {
    value: string;
    label: string;
    color?: string;
}

/**
 * Extrae las opciones declaradas en `config.options` de un campo
 * `select` / `multi_select`. Tolera shapes legacy: array de strings o
 * array de `{value,label,color}`.
 */
export function extractFieldOptions(field: FieldEntity): FieldOption[] {
    const raw = (field.config as { options?: unknown }).options;
    if (!Array.isArray(raw)) return [];

    const out: FieldOption[] = [];
    for (const opt of raw) {
        if (typeof opt === 'string') {
            out.push({ value: opt, label: opt });
            continue;
        }
        if (
            opt &&
            typeof opt === 'object' &&
            'value' in opt &&
            typeof (opt as { value: unknown }).value === 'string'
        ) {
            const o = opt as { value: string; label?: string; color?: string };
            out.push({
                value: o.value,
                label: o.label ?? o.value,
                ...(o.color !== undefined ? { color: o.color } : {}),
            });
        }
    }
    return out;
}
