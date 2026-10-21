/**
 * La lista pública guarda sus campos POR ID (regla de oro nº 1: renombrar un
 * campo o cambiarle el slug no lo saca de la página pública). Los paneles
 * trabajan con slugs —son las claves que ya tenían— y los traducen al guardar.
 */
export function publicFieldIds(slugs: readonly string[], fields: ReadonlyArray<{ id: number; slug: string }>): number[] {
    const bySlug = new Map(fields.map((f) => [f.slug, f.id]));
    return slugs.map((s) => bySlug.get(s)).filter((id): id is number => id !== undefined);
}

/** `slug:asc|desc` → campo por id y dirección (o null). */
export function publicDefaultSort(
    raw: string,
    fields: ReadonlyArray<{ id: number; slug: string }>,
): { default_sort_field_id: number | null; default_sort_dir: 'asc' | 'desc' } {
    const [slug, dir] = raw.split(':');
    const id = fields.find((f) => f.slug === slug)?.id ?? null;
    return { default_sort_field_id: id, default_sort_dir: dir === 'desc' ? 'desc' : 'asc' };
}
