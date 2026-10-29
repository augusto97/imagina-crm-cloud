import { mirrorCellAccess, mirrorFieldMap, mirrorValueError, type MirrorListMarker } from '@imagina-base/shared';

/**
 * Las MISMAS reglas que una edición a mano en una lista de la tienda
 * (v0.1.213) o de un sitio WordPress (v0.1.333): qué columna se puede cambiar
 * y con qué valor. La usan las ediciones en lote (masiva, CSV) para avisar por
 * fila en la vista previa en vez de fallar recién al aplicar. `null` = todo en
 * orden.
 */
export function storeRuleError(
    marker: MirrorListMarker,
    labelOf: (fieldId: number) => string,
    currentData: Record<string, unknown>,
    patch: Record<string, unknown>,
): string | null {
    const merged = { ...currentData, ...patch };
    const map = mirrorFieldMap(marker);
    const get = (slug: string): unknown => {
        const id = map[slug];
        return id ? merged[`f${id}`] : undefined;
    };
    for (const key of Object.keys(patch)) {
        const fieldId = Number(key.slice(1));
        const label = labelOf(fieldId);
        const access = mirrorCellAccess(marker, fieldId, get);
        if (access.access === 'locked') return `${label}: ${access.reason}`;
        if (access.access === 'editable') {
            const err = mirrorValueError(marker, fieldId, patch[key], get);
            if (err) return `${label}: ${err}`;
        }
    }
    return null;
}
