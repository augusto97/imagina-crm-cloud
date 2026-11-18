import { MERGE_CHOICE_UNION, type MergeFieldPreview } from '@imagina-base/shared';

/** Lo que se elige en un campo: el id del registro cuyo valor gana, o juntar. */
export type MergeChoice = number | typeof MERGE_CHOICE_UNION;

export interface MergeValueOption {
    /** El id del primer registro con ese valor (lo que se manda al servidor). */
    choice: number;
    /** Los registros que tienen ese mismo valor. */
    ids: number[];
    value: unknown;
    empty: boolean;
}

function isEmpty(v: unknown): boolean {
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * A14 (v0.1.445) — Las opciones de un campo al fusionar: una por valor
 * DISTINTO (dos registros con el mismo correo son una sola opción), en el
 * orden de los registros (el que queda primero), y «(vacío)» al final si
 * alguno no lo tiene.
 */
export function mergeValueOptions(preview: Pick<MergeFieldPreview, 'values'>, ids: readonly number[]): MergeValueOption[] {
    const byKey = new Map<string, MergeValueOption>();
    let empty: MergeValueOption | null = null;
    ids.forEach((id, i) => {
        const value = preview.values[i] ?? null;
        if (isEmpty(value)) {
            if (empty) empty.ids.push(id);
            else empty = { choice: id, ids: [id], value: null, empty: true };
            return;
        }
        const key = JSON.stringify(value);
        const found = byKey.get(key);
        if (found) found.ids.push(id);
        else byKey.set(key, { choice: id, ids: [id], value, empty: false });
    });
    const out = [...byKey.values()];
    if (empty) out.push(empty);
    return out;
}
