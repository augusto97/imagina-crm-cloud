import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

/**
 * Cuál de los campos hace de TÍTULO del registro (v0.1.136).
 *
 * El backend marca `is_primary` en UN campo por lista: el elegido en
 * `settings.title_field_id` o, si la lista no eligió ninguno, el primer
 * campo de texto (ver `resolveTitleFieldId` en `packages/shared`). Acá sólo
 * se lee esa marca, con el mismo fallback por si la respuesta viene de una
 * versión anterior del API.
 */
export function titleFieldOf(fields: FieldEntity[] | undefined): FieldEntity | undefined {
    if (!fields) return undefined;
    const primary = fields.find((f) => f.is_primary);
    if (primary && (primary.type === 'text' || primary.type === 'long_text')) return primary;
    return fields.find((f) => f.type === 'text') ?? fields.find((f) => f.type === 'long_text');
}

/** Etiqueta de respaldo cuando el registro todavía no tiene nombre. */
export function untitledLabel(): string {
    return __('Sin nombre');
}
