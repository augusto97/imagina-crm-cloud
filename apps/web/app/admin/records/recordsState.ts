import {
    EMPTY_FILTER_TREE,
    type FilterOperator,
    type FilterTree,
    type RecordsQuery,
} from '@/types/record';

import { isFlatAndTree, treeFromActiveFilters } from './filterTree';

/**
 * `ActiveFilter` se mantiene como compatibilidad para SavedViews
 * antiguos cuyo `config.filters` viene en forma plana legacy. La UI
 * nueva trabaja contra `FilterTree` directamente, pero los helpers de
 * conversión (`flattenToActiveFilters`, `treeFromActiveFilters` en
 * `filterTree.ts`) permiten ir y venir.
 */
export interface ActiveFilter {
    /** ID estable del campo (no slug — sobrevive a renames). */
    field_id: number;
    op: FilterOperator;
    value: unknown;
}

export interface ActiveSort {
    field_id: number;
    dir: 'asc' | 'desc';
}

export interface RecordsState {
    page: number;
    perPage: number;
    /**
     * Árbol completo de filtros (ClickUp-style, AND/OR + nested groups).
     * Reemplaza el viejo `filters: ActiveFilter[]` plano. Para SavedViews
     * legacy se convierte automáticamente al cargar.
     */
    filterTree: FilterTree;
    sort: ActiveSort[];
    search: string;
    /** Visibilidad por column id (TanStack Table convention). `false`
     * = oculta. Si la key no existe, la columna está visible. */
    columnVisibility: Record<string, boolean>;
    /** Anchura por column id en px (resizing). Si la key no existe,
     * usa el `size` default de la columna. */
    columnSizing: Record<string, number>;
    /**
     * Orden custom de columnas (TanStack convention): array de column
     * ids en el orden visual deseado. Si está vacío, usa el orden
     * default (`field.position`). Se modifica con drag-and-drop sobre
     * los headers de la tabla.
     */
    columnOrder: string[];
    /** Field id por el que se agrupa la table view (ClickUp-style).
     * `null` = vista plana. */
    groupByFieldId: number | null;
    /**
     * Bucket keys (formato `v:<value>` o `__null__` — ver
     * `bucketKey()` en GroupedTableView) que el user quiere que
     * arranquen colapsados al cargar la vista. Persistido en el
     * saved view, así que la próxima vez el user ve los grupos
     * en el mismo estado que dejó. Default vacío = todos cerrados.
     */
    collapsedGroups: string[];
    /**
     * Cálculo elegido por el user en el footer de cada columna
     * (column id → kind slug). Ej. `{valor_cop: 'sum', estado:
     * 'count_unique'}`. Las columnas sin entry no muestran cálculo;
     * la cell del footer queda con "Calcular ▾" como CTA.
     */
    footerAggregates: Record<string, string>;
}

/**
 * Page size por default para `/records`. Subido a 200 (de 50) en
 * 0.29.0 — TanStack Virtual ya virtualiza el render, así que pintar
 * 200 filas es igual de rápido que 50 (solo render lo visible). Pero
 * 200 reduce a 1/4 los roundtrips de paginación al scrollear listas
 * grandes. Combinado con prefetch automático de la siguiente página,
 * la sensación es de scroll infinito sin pausas.
 *
 * El backend tiene cap absoluto de 500 (`QueryParams::MAX_PER_PAGE`)
 * para evitar que un cliente malicioso pida 100k de un solo shot.
 */
export const DEFAULT_PER_PAGE = 200;

export const INITIAL_STATE: RecordsState = {
    page: 1,
    perPage: DEFAULT_PER_PAGE,
    filterTree: { ...EMPTY_FILTER_TREE, children: [] },
    sort: [],
    search: '',
    columnVisibility: {},
    columnSizing: {},
    columnOrder: [],
    groupByFieldId: null,
    collapsedGroups: [],
    footerAggregates: {},
};

/**
 * Convierte el state del frontend al shape `RecordsQuery`. Para
 * filtros usa el atajo plano `filter[...]` cuando el árbol es un
 * AND plano sin subgrupos (compat con backends legacy / cache keys
 * más estables); cuando hay OR o anidación, serializa el árbol
 * completo a `filter_tree` (JSON-encoded en la URL).
 */
export function buildRecordsQuery(state: RecordsState): RecordsQuery {
    const query: RecordsQuery = {
        page: state.page,
        per_page: state.perPage,
    };

    if (state.search.trim() !== '') {
        query.search = state.search.trim();
    }

    if (state.sort.length > 0) {
        query.sort = state.sort.map((s) => `field_${s.field_id}:${s.dir}`).join(',');
    }

    if (state.filterTree.children.length > 0) {
        if (isFlatAndTree(state.filterTree)) {
            const filter: NonNullable<RecordsQuery['filter']> = {};
            for (const c of state.filterTree.children) {
                if (c.type !== 'condition') continue;
                const key = `field_${c.field_id}`;
                const existing = (filter[key] as Partial<Record<FilterOperator, unknown>> | undefined) ?? {};
                existing[c.op] = c.value;
                filter[key] = existing;
            }
            query.filter = filter;
        } else {
            // El árbol con OR / nesting va JSON-encoded para no
            // explotar la URL con docenas de `filter_tree[children]
            // [0][children][1]…`. El backend acepta ambas formas
            // (string JSON o array decodificado por WP REST).
            query.filter_tree = JSON.stringify(state.filterTree);
        }
    }

    return query;
}

export { treeFromActiveFilters };

/**
 * Toggle del sort cuando se clickea en un header.
 *
 * - Click sin shift: reemplaza el sort entero con esta columna asc.
 * - Click sin shift sobre la columna ya activa: alterna asc → desc → off.
 * - Shift+click: añade la columna al sort multi-columna; si ya está,
 *   alterna su dir; si está en desc, la quita.
 */
export function toggleSort(
    current: ActiveSort[],
    fieldId: number,
    multi: boolean,
): ActiveSort[] {
    const existingIndex = current.findIndex((s) => s.field_id === fieldId);

    if (!multi) {
        if (existingIndex === -1) {
            return [{ field_id: fieldId, dir: 'asc' }];
        }
        const existing = current[existingIndex];
        if (!existing) {
            return [{ field_id: fieldId, dir: 'asc' }];
        }
        if (existing.dir === 'asc') {
            return [{ field_id: fieldId, dir: 'desc' }];
        }
        return [];
    }

    if (existingIndex === -1) {
        return [...current, { field_id: fieldId, dir: 'asc' }];
    }

    const existing = current[existingIndex];
    if (!existing) return current;

    if (existing.dir === 'asc') {
        const next = [...current];
        next[existingIndex] = { field_id: fieldId, dir: 'desc' };
        return next;
    }

    return current.filter((_, i) => i !== existingIndex);
}
