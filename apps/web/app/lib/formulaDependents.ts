import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

/**
 * Fórmulas (A1) — las fórmulas de la lista que usan un campo (el servidor
 * manda de qué depende cada una). Lo usan las confirmaciones de borrado: el
 * campo se puede mandar a la papelera, pero quien lo hace tiene que saber qué
 * fórmulas van a mostrar «#ERROR» mientras no vuelva.
 */
export function formulasUsing(field: Pick<FieldEntity, 'id'>, fields: readonly FieldEntity[]): FieldEntity[] {
    // Directa o indirectamente: si «Doble» usa «Total» y «Total» usa el campo,
    // las dos se quedan sin él.
    const using = new Set<number>([field.id]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const f of fields) {
            if (f.type !== 'formula' || using.has(f.id)) continue;
            if ((f.formula?.dependencies ?? []).some((d) => using.has(d))) {
                using.add(f.id);
                changed = true;
            }
        }
    }
    return fields.filter((f) => f.id !== field.id && using.has(f.id));
}

/** El aviso para la confirmación de borrado (o null si nadie lo usa). */
export function formulaDeleteWarning(field: Pick<FieldEntity, 'id'>, fields: readonly FieldEntity[]): string | null {
    const users = formulasUsing(field, fields);
    if (users.length === 0) return null;
    const names = users.map((f) => `«${f.label}»`).join(', ');
    return sprintf(
        users.length === 1
            ? __('Lo usa la fórmula %s: mientras esté en la papelera mostrará #ERROR, y al recuperarlo vuelve a calcularse.')
            : __('Lo usan las fórmulas %s: mientras esté en la papelera mostrarán #ERROR, y al recuperarlo vuelven a calcularse.'),
        names,
    );
}
