import type { ListGroup } from '@/types/list';

import { sectionsByFolder } from './folderSections';

export type FavoritesGrouping = 'folders' | 'type';
export const FAVORITES_GROUPING_KEY = 'imcrm:favorites:grouping';
export const FAVORITES_GROUPINGS: readonly FavoritesGrouping[] = ['folders', 'type'];

export type FavoriteSection<L, D> =
    | { kind: 'folder'; key: string; group: ListGroup; lists: L[]; dashboards: [] }
    | { kind: 'root' | 'lists'; key: string; group: null; lists: L[]; dashboards: [] }
    | { kind: 'dashboards'; key: string; group: null; lists: []; dashboards: D[] };

/**
 * Secciones de Favoritos (v0.1.211), para la página y el panel lateral:
 *  - `folders`: una sección por carpeta con las listas ancladas que tiene
 *    (mismo orden que el menú), después las ancladas sin carpeta y al final
 *    los dashboards (no viven en carpetas);
 *  - `type`: "Listas" y "Dashboards".
 * Se respeta el orden en que se anclaron dentro de cada sección, y un id
 * anclado que ya no existe (lista borrada) se descarta sin romper nada.
 */
export function favoriteSections<L extends { id: number; group_id: number | null }, D extends { id: number }>(
    favs: { lists: number[]; dashboards: number[] },
    lists: readonly L[],
    dashboards: readonly D[],
    groups: readonly ListGroup[],
    grouping: FavoritesGrouping,
): FavoriteSection<L, D>[] {
    const listById = new Map(lists.map((l) => [l.id, l]));
    const dashById = new Map(dashboards.map((d) => [d.id, d]));
    const favLists = favs.lists.map((id) => listById.get(id)).filter((l): l is L => l !== undefined);
    const favDashes = favs.dashboards.map((id) => dashById.get(id)).filter((d): d is D => d !== undefined);

    const out: FavoriteSection<L, D>[] = [];
    if (grouping === 'folders') {
        for (const s of sectionsByFolder(favLists, groups)) {
            if (s.group) out.push({ kind: 'folder', key: `g-${s.group.id}`, group: s.group, lists: s.items, dashboards: [] });
            else out.push({ kind: 'root', key: 'root', group: null, lists: s.items, dashboards: [] });
        }
    } else if (favLists.length > 0) {
        out.push({ kind: 'lists', key: 'lists', group: null, lists: favLists, dashboards: [] });
    }
    if (favDashes.length > 0) out.push({ kind: 'dashboards', key: 'dashboards', group: null, lists: [], dashboards: favDashes });
    return out;
}
