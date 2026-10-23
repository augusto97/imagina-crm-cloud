/**
 * v0.1.296 — Qué columnas exporta «Exportar» y en qué orden: las que la vista
 * MUESTRA, en el orden en que se ven (no el orden del esquema de la lista).
 */

interface ExportableField {
    id: number;
    slug: string;
    position: number;
}

/**
 * Ids de los campos visibles de la vista, en su orden. `columnOrder` usa los
 * ids de columna de la tabla (el slug del campo, más columnas propias como
 * `id`); lo que no está en él sigue el orden de la lista (`position`) — la
 * misma regla de TanStack que usa la tabla.
 */
export function visibleExportFieldIds<F extends ExportableField>(
    fields: readonly F[],
    columnVisibility: Record<string, boolean>,
    columnOrder: readonly string[],
): number[] {
    const byPosition = [...fields].sort((a, b) => a.position - b.position);
    const bySlug = new Map(byPosition.map((f) => [f.slug, f]));
    const out: F[] = [];
    const seen = new Set<string>();
    for (const slug of columnOrder) {
        const f = bySlug.get(slug);
        if (f && !seen.has(slug)) {
            out.push(f);
            seen.add(slug);
        }
    }
    for (const f of byPosition) if (!seen.has(f.slug)) out.push(f);
    return out.filter((f) => columnVisibility[f.slug] !== false).map((f) => f.id);
}

/** Las columnas del diálogo: primero las de la vista (en su orden), después el resto. */
export function orderExportFields<F extends { id: number }>(fields: readonly F[], viewOrder: readonly number[]): F[] {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const first = viewOrder.map((id) => byId.get(id)).filter((f): f is F => f !== undefined);
    const firstIds = new Set(first.map((f) => f.id));
    return [...first, ...fields.filter((f) => !firstIds.has(f.id))];
}

/**
 * El nombre del archivo de la respuesta: el legible (`filename*`, con
 * acentos) si viene; si no, el ASCII de `filename`.
 */
export function exportFileName(contentDisposition: string, fallback: string): string {
    const star = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
    if (star?.[1]) {
        try {
            return decodeURIComponent(star[1].trim());
        } catch {
            // Mal codificado: se usa el otro.
        }
    }
    const plain = /filename="?([^";]+)"?/i.exec(contentDisposition);
    return plain?.[1] ?? fallback;
}
