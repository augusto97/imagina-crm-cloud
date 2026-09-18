/**
 * v0.1.190 — Grupo de una vista agrupada por `multi_select`.
 *
 * El backend agrupa por la COMBINACIÓN exacta de opciones (como ClickUp:
 * cada registro aparece en UN solo grupo) y la clave del bucket es el JSON
 * del conjunto normalizado (`["a", "b"]`, ordenado). Estos helpers lo
 * traducen para la UI: parsear la clave y ordenar las opciones como en el
 * catálogo del campo.
 */

/** `["a", "b"]` → `['a','b']`; cualquier otra cosa → null. */
export function parseMultiBucket(value: string | null | undefined): string[] | null {
    if (typeof value !== 'string' || !value.startsWith('[')) return null;
    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) return null;
        return parsed.map((v) => String(v));
    } catch {
        return null;
    }
}

/**
 * Opciones del bucket en el ORDEN del catálogo del campo (las desconocidas
 * al final, tal cual). Así los chips del grupo se leen como en la celda.
 */
export function orderByCatalog(values: string[], catalog: ReadonlyArray<{ value: string }>): string[] {
    const rank = new Map(catalog.map((o, i) => [o.value, i]));
    return [...values].sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER));
}
