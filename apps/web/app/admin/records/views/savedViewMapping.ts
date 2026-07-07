import { type FilterOperator, type FilterTree } from '@/types/record';
import type { SavedViewConfig } from '@/types/view';

import {
    isFlatAndTree,
    treeFromActiveFilters,
} from '../filterTree';
import type { ActiveFilter, ActiveSort, RecordsState } from '../recordsState';

/**
 * Convierte el estado del UI en el `config` que persistimos en
 * `wp_imcrm_saved_views.config`.
 *
 * Persistimos el árbol nuevo bajo `filter_tree`. Si el árbol es
 * AND-plano, también escribimos el espejo `filters` para que SavedViews
 * legacy (sin filter_tree) puedan seguir leyéndose si en algún momento
 * downgradeamos. Cuando el árbol tiene OR/nested NO escribimos
 * `filters` (la forma plana no lo expresa).
 */
export function stateToViewConfig(state: RecordsState): SavedViewConfig {
    const config: SavedViewConfig = {};
    if (state.filterTree.children.length > 0) {
        config.filter_tree = state.filterTree;
        if (isFlatAndTree(state.filterTree)) {
            config.filters = state.filterTree.children
                .filter((c) => c.type === 'condition')
                .map((c) => {
                    const cond = c as Extract<typeof c, { type: 'condition' }>;
                    return { field_id: cond.field_id, op: cond.op, value: cond.value };
                });
        } else {
            // Tree con OR/nested: borramos el espejo legacy si existía.
            delete config.filters;
        }
    }
    if (state.sort.length > 0) {
        config.sort = state.sort.map((s) => ({ field_id: s.field_id, dir: s.dir }));
    }
    if (state.search.trim() !== '') {
        config.search = state.search.trim();
    }
    const hidden = Object.entries(state.columnVisibility)
        .filter(([, v]) => v === false)
        .map(([k]) => k);
    if (hidden.length > 0) {
        config.hidden_columns = hidden;
    }
    if (Object.keys(state.columnSizing).length > 0) {
        config.column_widths = state.columnSizing;
    }
    if (state.columnOrder.length > 0) {
        config.column_order = state.columnOrder;
    }
    if (state.collapsedGroups.length > 0) {
        config.collapsed_groups = state.collapsedGroups;
    }
    if (Object.keys(state.footerAggregates).length > 0) {
        config.footer_aggregates = state.footerAggregates;
    }
    if (state.groupByFieldId !== null) {
        config.group_by_field_id = state.groupByFieldId;
    }
    return config;
}

/**
 * Inverso: aplica la configuración guardada al estado del UI.
 *
 * Prioriza `filter_tree` (formato nuevo). Si solo viene `filters`
 * (SavedViews creados antes del refactor), los convierte a un árbol
 * AND plano automáticamente — backward compatibility.
 */
export function viewConfigToState(config: SavedViewConfig, perPage: number): RecordsState {
    let filterTree: FilterTree = { type: 'group', logic: 'and', children: [] };
    const rawTree = config.filter_tree;
    if (
        rawTree !== null &&
        typeof rawTree === 'object' &&
        !Array.isArray(rawTree) &&
        (rawTree as { type?: unknown }).type === 'group' &&
        Array.isArray((rawTree as { children?: unknown }).children)
    ) {
        filterTree = rawTree as FilterTree;
    } else if (config.filters && config.filters.length > 0) {
        const legacy: ActiveFilter[] = config.filters.map((f) => ({
            field_id: f.field_id,
            op: f.op as FilterOperator,
            value: f.value,
        }));
        filterTree = treeFromActiveFilters(legacy);
    }

    const sort: ActiveSort[] = (config.sort ?? []).map((s) => ({
        field_id: s.field_id,
        dir: s.dir,
    }));

    const columnVisibility: Record<string, boolean> = {};
    for (const id of config.hidden_columns ?? []) {
        columnVisibility[id] = false;
    }

    return {
        page: 1,
        perPage,
        filterTree,
        sort,
        search: config.search ?? '',
        columnVisibility,
        columnSizing: config.column_widths ?? {},
        columnOrder: config.column_order ?? [],
        collapsedGroups: config.collapsed_groups ?? [],
        footerAggregates: config.footer_aggregates ?? {},
        groupByFieldId: config.group_by_field_id ?? null,
    };
}

/**
 * Compara semánticamente el estado actual contra la configuración de la
 * vista activa. Devuelve `true` si hay diferencias persistibles. La
 * paginación NO cuenta como cambio.
 */
export function hasChangesVsView(state: RecordsState, config: SavedViewConfig): boolean {
    const a = JSON.stringify(stateToViewConfig(state));
    const b = JSON.stringify(stripPaginationOnlyKeys(config));
    return a !== b;
}

function stripPaginationOnlyKeys(config: SavedViewConfig): SavedViewConfig {
    const out: SavedViewConfig = {};
    if (config.filter_tree) out.filter_tree = config.filter_tree;
    if (config.filters && config.filters.length > 0) out.filters = config.filters;
    if (config.sort && config.sort.length > 0) out.sort = config.sort;
    if (config.search && config.search.trim() !== '') out.search = config.search.trim();
    if (config.hidden_columns && config.hidden_columns.length > 0) {
        out.hidden_columns = config.hidden_columns;
    }
    if (config.column_widths && Object.keys(config.column_widths).length > 0) {
        out.column_widths = config.column_widths;
    }
    if (config.group_by_field_id !== undefined) {
        out.group_by_field_id = config.group_by_field_id;
    }
    return out;
}
