import { readKanbanSettings, withKanbanSettings, type KanbanSettings, type ViewColorRule } from '@imagina-base/shared';

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
    if (state.wrapText) {
        config.wrap_text = true;
    }
    if (state.spreadsheet) {
        config.spreadsheet = true;
    }
    if (state.density !== null) {
        config.density = state.density;
    }
    if (state.fontSize !== null) {
        config.font_size = state.fontSize;
    }
    if (state.singleClickEdit) {
        config.single_click_edit = true;
    }
    // v0.1.287 — el segundo nivel sólo tiene sentido con el primero.
    if (state.groupByFieldId !== null && state.subGroupByFieldId !== null && state.subGroupByFieldId !== state.groupByFieldId) {
        config.sub_group_by_field_id = state.subGroupByFieldId;
    }
    if (state.frozenColumns !== null && state.frozenColumns >= 1) {
        config.frozen_columns = state.frozenColumns;
    }
    if (state.colorRules.length > 0) {
        config.color_rules = state.colorRules;
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
        wrapText: config.wrap_text === true,
        spreadsheet: config.spreadsheet === true,
        density:
            config.density === 'compact' || config.density === 'normal' || config.density === 'comfortable'
                ? config.density
                : null,
        fontSize:
            config.font_size === 'sm' || config.font_size === 'md' || config.font_size === 'lg'
                ? config.font_size
                : null,
        singleClickEdit: config.single_click_edit === true,
        subGroupByFieldId:
            typeof config.sub_group_by_field_id === 'number' && config.group_by_field_id
                ? config.sub_group_by_field_id
                : null,
        frozenColumns:
            typeof config.frozen_columns === 'number' && config.frozen_columns >= 1
                ? Math.min(20, Math.floor(config.frozen_columns))
                : null,
        colorRules: readColorRules(config.color_rules),
    };
}

/**
 * Compara semánticamente el estado actual contra la configuración de la
 * vista activa. Devuelve `true` si hay diferencias persistibles. La
 * paginación NO cuenta como cambio.
 *
 * Ambos lados se CANONICALIZAN por el mismo camino
 * (`config → estado → config` + claves ordenadas) antes de comparar:
 * la config guardada vuelve de Postgres como JSONB, que REORDENA las
 * claves de cada objeto (p.ej. las condiciones del filter_tree), y una
 * comparación por `JSON.stringify` crudo daba "dirty" eterno con
 * cualquier filtro activo — aunque se acabara de guardar. La versión
 * anterior además omitía column_order/collapsed_groups/footer_aggregates
 * del lado guardado (mismo síntoma con columnas reordenadas o footer).
 */
export function hasChangesVsView(state: RecordsState, config: SavedViewConfig): boolean {
    const a = stableStringify(stateToViewConfig(state));
    const b = stableStringify(stateToViewConfig(viewConfigToState(config, state.perPage)));
    return a !== b;
}

/**
 * Las reglas de color guardadas, tolerante: una regla a medias (sin
 * condición o sin color) se descarta en vez de romper la vista. Los
 * defaults del schema (`enabled`, `target`) se completan aquí para que la
 * comparación de "cambios sin guardar" no los cuente como diferencia.
 */
function readColorRules(raw: unknown): ViewColorRule[] {
    if (!Array.isArray(raw)) return [];
    const out: ViewColorRule[] = [];
    for (const r of raw) {
        if (r === null || typeof r !== 'object') continue;
        const rule = r as Partial<ViewColorRule>;
        const cond = rule.condition;
        if (!cond || typeof cond !== 'object' || typeof cond.field_id !== 'number' || typeof rule.color !== 'string') continue;
        const target = rule.target === 'cell' ? 'cell' : 'row';
        out.push({
            id: typeof rule.id === 'string' && rule.id !== '' ? rule.id : `r${out.length + 1}`,
            enabled: rule.enabled !== false,
            condition: cond,
            color: rule.color,
            target,
            ...(target === 'cell' && typeof rule.cell_field_id === 'number' ? { cell_field_id: rule.cell_field_id } : {}),
        });
    }
    return out;
}

/** JSON.stringify con claves de objeto ordenadas, recursivo (orden-estable). */
function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
            .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

/**
 * v0.1.297 — Kanban para ventas (B5): los ajustes del tablero (carriles, total por
 * columna, tarjetas, límites, reglas al mover, columnas plegadas/ocultas)
 * viven en la config de la vista con claves `kanban_*`. La lectura es
 * tolerante (lo que no tiene forma se descarta) y la escritura reemplaza SÓLO
 * esas claves: filtros, orden y demás quedan como estaban.
 */
export function viewConfigToKanban(config: SavedViewConfig): KanbanSettings {
    return readKanbanSettings(config);
}

export function kanbanToViewConfig(config: SavedViewConfig, settings: KanbanSettings): SavedViewConfig {
    return withKanbanSettings(config as Record<string, unknown>, settings) as SavedViewConfig;
}
