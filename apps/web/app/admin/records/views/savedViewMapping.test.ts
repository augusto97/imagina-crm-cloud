import { describe, expect, it } from 'vitest';

import type { RecordsState } from '../recordsState';
import type { SavedViewConfig } from '@/types/view';

import { parseViewConfig, readCalendarSettings } from '@imagina-base/shared';

import { calendarToViewConfig, hasChangesVsView, kanbanToViewConfig, stateToViewConfig, viewConfigToCalendar, viewConfigToKanban, viewConfigToState } from './savedViewMapping';

const baseState: RecordsState = {
    page: 1,
    perPage: 50,
    filterTree: { type: 'group', logic: 'and', children: [] },
    sort: [],
    search: '',
    columnVisibility: {},
    columnSizing: {},
    columnOrder: [],
    collapsedGroups: [],
    footerAggregates: {},
    groupByFieldId: null,
    wrapText: false,
    spreadsheet: false,
    density: null,
    fontSize: null,
    singleClickEdit: false,
    subGroupByFieldId: null,
    frozenColumns: null,
    colorRules: [],
};

/**
 * Postgres guarda `config` como JSONB, que REORDENA las claves de cada
 * objeto (por longitud y luego alfabético). Este helper simula ese
 * round-trip para que los tests comparen contra lo que de verdad vuelve
 * del servidor.
 */
function jsonbRoundTrip(config: SavedViewConfig): SavedViewConfig {
    const reorder = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(reorder);
        if (value !== null && typeof value === 'object') {
            const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
                a.length !== b.length ? a.length - b.length : a < b ? -1 : 1,
            );
            return Object.fromEntries(entries.map(([k, v]) => [k, reorder(v)]));
        }
        return value;
    };
    return reorder(config) as SavedViewConfig;
}

describe('hasChangesVsView', () => {
    it('recién guardada (round-trip JSONB con filtros): NO está dirty', () => {
        const state: RecordsState = {
            ...baseState,
            filterTree: {
                type: 'group',
                logic: 'and',
                children: [{ type: 'condition', field_id: 12, op: 'contains', value: 'hola' }],
            },
            sort: [{ field_id: 3, dir: 'desc' }],
            columnOrder: ['f1', 'f12', 'f3'],
            footerAggregates: { f3: 'sum' },
        };
        // Lo que el usuario acaba de guardar, tal como vuelve del server.
        const saved = jsonbRoundTrip(JSON.parse(JSON.stringify(stateToViewConfig(state))) as SavedViewConfig);
        expect(hasChangesVsView(state, saved)).toBe(false);
    });

    it('config con column_order/collapsed/footer intactos: NO está dirty (regresión)', () => {
        const state: RecordsState = {
            ...baseState,
            columnOrder: ['f2', 'f1'],
            collapsedGroups: ['Abierto'],
            footerAggregates: { f9: 'avg' },
        };
        const saved = jsonbRoundTrip(stateToViewConfig(state));
        expect(hasChangesVsView(state, saved)).toBe(false);
    });

    it('cambio real (nuevo filtro / quitar sort): SÍ está dirty', () => {
        const savedConfig: SavedViewConfig = jsonbRoundTrip({
            filter_tree: {
                type: 'group',
                logic: 'and',
                children: [{ type: 'condition', field_id: 12, op: 'eq', value: 'x' }],
            },
            sort: [{ field_id: 3, dir: 'asc' }],
        });
        const stateWithExtraFilter = viewConfigToState(savedConfig, 50);
        expect(hasChangesVsView(stateWithExtraFilter, savedConfig)).toBe(false); // sanity
        expect(
            hasChangesVsView(
                {
                    ...stateWithExtraFilter,
                    filterTree: {
                        type: 'group',
                        logic: 'and',
                        children: [
                            ...stateWithExtraFilter.filterTree.children,
                            { type: 'condition', field_id: 5, op: 'is_null', value: null },
                        ],
                    },
                },
                savedConfig,
            ),
        ).toBe(true);
        expect(hasChangesVsView({ ...stateWithExtraFilter, sort: [] }, savedConfig)).toBe(true);
    });

    it('la paginación NO cuenta como cambio', () => {
        const saved = jsonbRoundTrip(stateToViewConfig(baseState));
        expect(hasChangesVsView({ ...baseState, page: 4, perPage: 100 }, saved)).toBe(false);
    });

    it('vista legacy con `filters` planos (sin filter_tree): NO está dirty al aplicarla', () => {
        const legacy: SavedViewConfig = { filters: [{ field_id: 7, op: 'eq', value: 'a' }] };
        const state = viewConfigToState(legacy, 50);
        expect(hasChangesVsView(state, legacy)).toBe(false);
    });
});

describe('ajustar texto', () => {
    it('viaja a la vista guardada y vuelve', () => {
        const config = stateToViewConfig({ ...baseState, wrapText: true });
        expect(config.wrap_text).toBe(true);
        expect(viewConfigToState(config, 50).wrapText).toBe(true);
    });

    it('apagado no ensucia la config (es el default)', () => {
        expect(stateToViewConfig(baseState).wrap_text).toBeUndefined();
        expect(viewConfigToState({}, 50).wrapText).toBe(false);
        // Y encenderlo cuenta como cambio pendiente de guardar.
        expect(hasChangesVsView({ ...baseState, wrapText: true }, {})).toBe(true);
    });
});

describe('hoja de cálculo (v0.1.137/139)', () => {
    it('viaja a la vista guardada y vuelve', () => {
        const config = stateToViewConfig({ ...baseState, spreadsheet: true });
        expect(config.spreadsheet).toBe(true);
        expect(viewConfigToState(config, 50).spreadsheet).toBe(true);
    });

    it('apagada no ensucia la config, y encenderla es un cambio a guardar', () => {
        expect(stateToViewConfig(baseState).spreadsheet).toBeUndefined();
        expect(viewConfigToState({}, 50).spreadsheet).toBe(false);
        expect(hasChangesVsView({ ...baseState, spreadsheet: true }, {})).toBe(true);
    });
});

describe('densidad de las filas (v0.1.140)', () => {
    it('viaja a la vista guardada y vuelve', () => {
        const config = stateToViewConfig({ ...baseState, density: 'comfortable' });
        expect(config.density).toBe('comfortable');
        expect(viewConfigToState(config, 50).density).toBe('comfortable');
    });

    it('sin elegir no ensucia la config, y un valor raro no se adopta', () => {
        expect(stateToViewConfig(baseState).density).toBeUndefined();
        expect(viewConfigToState({}, 50).density).toBeNull();
        expect(viewConfigToState({ density: 'gigante' }, 50).density).toBeNull();
    });
});

describe('tamaño de letra (v0.1.141)', () => {
    it('viaja a la vista guardada y vuelve', () => {
        const config = stateToViewConfig({ ...baseState, fontSize: 'lg' });
        expect(config.font_size).toBe('lg');
        expect(viewConfigToState(config, 50).fontSize).toBe('lg');
    });

    it('sin elegir no ensucia la config, y un valor raro no se adopta', () => {
        expect(stateToViewConfig(baseState).font_size).toBeUndefined();
        expect(viewConfigToState({}, 50).fontSize).toBeNull();
        expect(viewConfigToState({ font_size: 'enorme' }, 50).fontSize).toBeNull();
    });
});

describe('editar con un click (v0.1.295)', () => {
    it('viaja a la vista guardada y vuelve', () => {
        const config = stateToViewConfig({ ...baseState, singleClickEdit: true });
        expect(config.single_click_edit).toBe(true);
        expect(viewConfigToState(jsonbRoundTrip(config), 50).singleClickEdit).toBe(true);
    });

    it('apagado no ensucia la config (el modelo de hoja de cálculo es el default)', () => {
        expect(stateToViewConfig(baseState).single_click_edit).toBeUndefined();
        expect(viewConfigToState({}, 50).singleClickEdit).toBe(false);
        expect(viewConfigToState({ single_click_edit: 'sí' as unknown as boolean }, 50).singleClickEdit).toBe(false);
    });
});

describe('v0.1.287 — columnas fijas, colores y segundo agrupado', () => {
    const rule = {
        id: 'r1',
        enabled: true,
        condition: { type: 'condition' as const, field_id: 7, op: 'eq' as const, value: 'vencida' },
        color: 'red' as const,
        target: 'row' as const,
    };

    it('viajan a la vista guardada y vuelven iguales', () => {
        const state = { ...baseState, groupByFieldId: 3, subGroupByFieldId: 5, frozenColumns: 2, colorRules: [rule] };
        const config = stateToViewConfig(state);
        expect(config.sub_group_by_field_id).toBe(5);
        expect(config.frozen_columns).toBe(2);
        expect(config.color_rules).toEqual([rule]);
        const back = viewConfigToState(config, 50);
        expect(back.subGroupByFieldId).toBe(5);
        expect(back.frozenColumns).toBe(2);
        expect(back.colorRules).toEqual([rule]);
        expect(hasChangesVsView(state, jsonbRoundTrip(config))).toBe(false);
    });

    it('el segundo agrupado sin el primero no se guarda', () => {
        expect(stateToViewConfig({ ...baseState, subGroupByFieldId: 5 }).sub_group_by_field_id).toBeUndefined();
        expect(viewConfigToState({ sub_group_by_field_id: 5 }, 50).subGroupByFieldId).toBeNull();
    });

    it('una regla guardada sin enabled/target se completa y no cuenta como cambio', () => {
        const saved = { color_rules: [{ id: 'x', condition: rule.condition, color: 'red' }] } as unknown as SavedViewConfig;
        const state = viewConfigToState(saved, 50);
        expect(state.colorRules[0]).toMatchObject({ enabled: true, target: 'row' });
        expect(hasChangesVsView(state, saved)).toBe(false);
    });

    it('cambiar una regla o el fijado marca cambios sin guardar', () => {
        const config = stateToViewConfig({ ...baseState, colorRules: [rule] });
        expect(hasChangesVsView({ ...baseState, colorRules: [{ ...rule, color: 'blue' }] }, config)).toBe(true);
        expect(hasChangesVsView({ ...baseState, colorRules: [rule], frozenColumns: 3 }, config)).toBe(true);
    });
});

describe('v0.1.297 — kanban para ventas: ajustes del tablero en la vista', () => {
    const saved: SavedViewConfig = {
        group_by_field_id: 2,
        sort: [{ field_id: 3, dir: 'desc' }],
        filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: 5, op: 'eq', value: 'alta' }] },
        kanban_title_field_id: 1,
        kanban_meta_field_ids: [5, 8],
        kanban_value_field_id: 3,
        kanban_lane_field_id: 4,
        kanban_collapsed_lanes: ['3'],
        kanban_collapsed_columns: ['ganado'],
        kanban_hidden_columns: ['__null__'],
        kanban_hide_empty: true,
        kanban_wip_limits: [{ column: 'negociacion', limit: 40 }],
        kanban_move_rules: [{ column: 'perdido', required_field_ids: [6] }],
        kanban_cover_field_id: 9,
        kanban_card_size: 'compact',
    };

    it('config → ajustes → config deja la vista igual (round-trip)', () => {
        const settings = viewConfigToKanban(saved);
        expect(settings).toMatchObject({
            laneFieldId: 4,
            valueFieldId: 3,
            valueMetric: 'sum',
            wipLimits: { negociacion: 40 },
            moveRules: { perdido: [6] },
            cardSize: 'compact',
        });
        const back = kanbanToViewConfig(saved, settings);
        expect(back).toEqual(saved);
    });

    it('cambiar un ajuste del tablero no toca filtros, orden ni agrupación', () => {
        const settings = viewConfigToKanban(saved);
        const next = kanbanToViewConfig(saved, { ...settings, laneFieldId: null, wipLimits: {}, valueMetric: 'avg' });
        expect(next.filter_tree).toEqual(saved.filter_tree);
        expect(next.sort).toEqual(saved.sort);
        expect(next.group_by_field_id).toBe(2);
        expect(next.kanban_lane_field_id).toBeUndefined();
        expect(next.kanban_collapsed_lanes).toBeUndefined();
        expect(next.kanban_wip_limits).toBeUndefined();
        expect(next.kanban_value_metric).toBe('avg');
        // Una vista vieja (sólo columnas) no gana claves vacías al guardarse.
        expect(kanbanToViewConfig({ group_by_field_id: 2 }, viewConfigToKanban({ group_by_field_id: 2 }))).toEqual({
            group_by_field_id: 2,
            kanban_title_field_id: null,
            kanban_meta_field_ids: [],
        });
    });
});

// B4 — Calendario completo.
describe('calendario completo: la config de la vista (B4)', () => {
    it('round-trip de los ajustes del calendario y las reglas, sin tocar el resto, y el servidor los conserva', () => {
        const base = { date_field_id: 2, filter_tree: { type: 'group', logic: 'and', children: [] }, search: 'ana', sort: [] };
        const { settings } = viewConfigToCalendar(base);
        const next = {
            ...settings,
            sources: [
                { ...settings.sources[0]!, endFieldId: 3, label: 'Citas', color: 'violet' as const },
                { id: 's2', startFieldId: 4, endFieldId: 5, durationFieldId: null, label: 'Vence', color: 'red' as const, enabled: false },
            ],
            colorBy: 'field' as const,
            colorFieldId: 7,
            defaultMode: 'week' as const,
            weekStart: 0 as const,
            dayStartHour: 8,
            dayEndHour: 19,
            showWeekends: false,
            defaultDuration: 30,
        };
        const rules = [{ id: 'r1', enabled: true, condition: { type: 'condition' as const, field_id: 7, op: 'eq' as const, value: 'cerrado' }, color: 'gray' as const, target: 'row' as const }];
        const config = calendarToViewConfig(base, next, rules);
        expect(config.search).toBe('ana');
        expect(config.filter_tree).toEqual(base.filter_tree);
        // Lo que vuelve del servidor (Zod + JSONB) se lee igual.
        const saved = JSON.parse(JSON.stringify(parseViewConfig('calendar', config))) as typeof config;
        const back = viewConfigToCalendar(saved);
        expect(back.settings).toEqual(next);
        expect(back.colorRules).toEqual(rules);
        expect(readCalendarSettings(saved).sources[1]!.enabled).toBe(false);
        // Sin reglas, la clave se borra (no queda un array vacío).
        expect(calendarToViewConfig(saved, back.settings, []).color_rules).toBeUndefined();
    });
});
