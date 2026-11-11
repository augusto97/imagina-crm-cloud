import type { FieldEntity } from '@/types/field';

/**
 * ¿El campo es el MISMO para dibujar una celda? Misma referencia (lo normal:
 * los campos salen de una sola query y TanStack conserva la identidad de lo
 * que no cambió) o, si el objeto se rearmó, las mismas propiedades una por
 * una. Comparar sólo el `id` dejaba las celdas montadas con la configuración
 * VIEJA —decimales, etiqueta y color de una opción, validaciones, moneda—
 * hasta que cambiaba su valor o se recargaba la tabla.
 */
export function sameCellField(a: FieldEntity, b: FieldEntity): boolean {
    if (a === b) return true;
    if (a.id !== b.id) return false;
    const ka = Object.keys(a) as Array<keyof FieldEntity>;
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (a[k] !== b[k]) return false;
    return true;
}

interface CellMemoProps {
    field: FieldEntity;
    recordId: number;
    listId: number;
    value: unknown;
    canEdit?: boolean;
    lockedReason?: string | null;
    record?: unknown;
}

/** Comparador del `memo` de `EditableCell`. */
export function editableCellPropsEqual(prev: CellMemoProps, next: CellMemoProps): boolean {
    return (
        prev.recordId === next.recordId
        && prev.listId === next.listId
        && sameCellField(prev.field, next.field)
        && prev.value === next.value
        && prev.canEdit === next.canEdit
        && prev.lockedReason === next.lockedReason
        // Campo «Botón»: no tiene valor propio; su «deshabilitado si…» mira la
        // FILA — sin esto quedaba con el estado viejo.
        && (next.field.type !== 'button' || prev.record === next.record)
    );
}
