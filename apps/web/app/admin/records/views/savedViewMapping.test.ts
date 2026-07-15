import { describe, expect, it } from 'vitest';

import type { RecordsState } from '../recordsState';
import type { SavedViewConfig } from '@/types/view';

import { hasChangesVsView, stateToViewConfig, viewConfigToState } from './savedViewMapping';

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
