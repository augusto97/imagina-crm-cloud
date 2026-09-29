import type { ListGroup } from '@/types/list';

/** Una sección del índice: la carpeta (o `null` = sin carpeta) y lo que cuelga de ella. */
export interface FolderSection<T> {
    group: ListGroup | null;
    items: T[];
}

/**
 * Agrupa por carpeta en el MISMO orden que el menú lateral (v0.1.211):
 * carpetas por `position` (desempate por id), sólo las que tienen algo
 * adentro, y al final lo que no está en ninguna. Una lista que apunta a una
 * carpeta que ya no existe (o que el cliente todavía no recibió) cae a "sin
 * carpeta" en vez de desaparecer. Dentro de cada sección se conserva el orden
 * de entrada.
 */
export function sectionsByFolder<T extends { group_id: number | null }>(
    items: readonly T[],
    groups: readonly ListGroup[],
): FolderSection<T>[] {
    const known = new Set(groups.map((g) => g.id));
    const byGroup = new Map<number | null, T[]>();
    for (const it of items) {
        const key = it.group_id !== null && known.has(it.group_id) ? it.group_id : null;
        const arr = byGroup.get(key);
        if (arr) arr.push(it);
        else byGroup.set(key, [it]);
    }
    const out: FolderSection<T>[] = [];
    for (const g of [...groups].sort((a, b) => a.position - b.position || a.id - b.id)) {
        const arr = byGroup.get(g.id);
        if (arr && arr.length > 0) out.push({ group: g, items: arr });
    }
    const root = byGroup.get(null);
    if (root && root.length > 0) out.push({ group: null, items: root });
    return out;
}

const ACCENTS = /[̀-ͯ]/g;

/** Texto comparable para el buscador: minúsculas y sin acentos. */
export function foldText(text: string): string {
    return text.normalize('NFD').replace(ACCENTS, '').toLowerCase();
}

/** ¿La lista coincide con lo buscado? Por nombre, slug, descripción o carpeta. */
export function matchesListQuery(
    list: { name: string; slug: string; description: string | null },
    query: string,
    folderName?: string,
): boolean {
    const q = foldText(query.trim());
    if (q === '') return true;
    return [list.name, list.slug, list.description ?? '', folderName ?? ''].some((s) => foldText(s).includes(q));
}
