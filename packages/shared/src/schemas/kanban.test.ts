import { describe, expect, it } from 'vitest';

import {
    DEFAULT_KANBAN_SETTINGS,
    isKanbanEmptyValue,
    kanbanBucketKeyOf,
    kanbanBucketValue,
    kanbanCellKey,
    kanbanSettingsToConfig,
    readKanbanSettings,
    withKanbanSettings,
} from './kanban';
import { parseViewConfig } from './view';

describe('Kanban para ventas (B5) — config de la vista', () => {
    const full = {
        group_by_field_id: 7,
        kanban_title_field_id: 3,
        kanban_meta_field_ids: [4, 5, 4],
        kanban_value_field_id: 9,
        kanban_value_metric: 'avg',
        kanban_lane_field_id: 11,
        kanban_collapsed_lanes: ['2'],
        kanban_collapsed_columns: ['ganado'],
        kanban_hidden_columns: ['__null__'],
        kanban_hide_empty: true,
        kanban_wip_limits: [{ column: 'negociacion', limit: 5 }],
        kanban_move_rules: [
            { column: 'perdido', required_field_ids: [12] },
            { column: 'ganado', required_field_ids: [13, 9] },
        ],
        kanban_cover_field_id: 14,
        kanban_card_size: 'compact',
    };

    it('el schema del servidor conserva todas las claves del tablero', () => {
        const cfg = parseViewConfig('kanban', full);
        for (const [k, v] of Object.entries(full)) expect(cfg[k]).toEqual(v);
        // Una vista vieja no gana claves vacías.
        const old = parseViewConfig('kanban', { group_by_field_id: 7 });
        expect('kanban_lane_field_id' in old).toBe(false);
        expect('kanban_wip_limits' in old).toBe(false);
        // Límite inválido y métrica desconocida se rechazan.
        expect(() => parseViewConfig('kanban', { group_by_field_id: 7, kanban_wip_limits: [{ column: 'x', limit: 0 }] })).toThrow();
        expect(() => parseViewConfig('kanban', { group_by_field_id: 7, kanban_value_metric: 'max' })).toThrow();
    });

    it('lee la config normalizada y vuelve a la misma forma (round-trip)', () => {
        const s = readKanbanSettings(full);
        expect(s).toEqual({
            titleFieldId: 3,
            metaFieldIds: [4, 5],
            valueFieldId: 9,
            valueMetric: 'avg',
            laneFieldId: 11,
            collapsedLanes: ['2'],
            collapsedColumns: ['ganado'],
            hiddenColumns: ['__null__'],
            hideEmpty: true,
            wipLimits: { negociacion: 5 },
            moveRules: { perdido: [12], ganado: [13, 9] },
            coverFieldId: 14,
            cardSize: 'compact',
        });
        const back = kanbanSettingsToConfig(s);
        expect(readKanbanSettings({ ...back, group_by_field_id: 7 })).toEqual(s);
        expect(parseViewConfig('kanban', { group_by_field_id: 7, ...back })).toMatchObject(back);
    });

    it('es tolerante: lo que no tiene forma se descarta y lo ausente toma el default', () => {
        const s = readKanbanSettings({
            group_by_field_id: 7,
            kanban_lane_field_id: 7, // el mismo campo de las columnas: no hay carriles
            kanban_wip_limits: [{ column: 'a', limit: -1 }, { column: '', limit: 3 }, 'x', { column: 'b', limit: 4 }],
            kanban_move_rules: [{ column: 'perdido', required_field_ids: [] }, { column: 'c', required_field_ids: ['x', 5] }],
            kanban_card_size: 'gigante',
        });
        expect(s.laneFieldId).toBeNull();
        expect(s.wipLimits).toEqual({ b: 4 });
        expect(s.moveRules).toEqual({ c: [5] });
        expect(s.cardSize).toBe('normal');
        expect(readKanbanSettings(null)).toEqual(DEFAULT_KANBAN_SETTINGS);
        // Sin ajustes, sólo título y campos (lo que ya escribía el diálogo viejo).
        expect(kanbanSettingsToConfig(DEFAULT_KANBAN_SETTINGS)).toEqual({ kanban_title_field_id: null, kanban_meta_field_ids: [] });
    });

    it('withKanbanSettings reemplaza sólo las claves del tablero', () => {
        const merged = withKanbanSettings(
            { ...full, filter_tree: { type: 'group', logic: 'and', children: [] }, sort: [{ field_id: 9, dir: 'desc' }] },
            { ...readKanbanSettings(full), laneFieldId: null, wipLimits: {} },
        );
        expect(merged.sort).toEqual([{ field_id: 9, dir: 'desc' }]);
        expect(merged.group_by_field_id).toBe(7);
        expect('kanban_lane_field_id' in merged).toBe(false);
        expect('kanban_collapsed_lanes' in merged).toBe(false);
        expect('kanban_wip_limits' in merged).toBe(false);
        expect(merged.kanban_move_rules).toEqual(full.kanban_move_rules);
    });
});

describe('Kanban — claves de grupo ↔ valores', () => {
    it('clave de celda: columna sola o el par [carril, columna]', () => {
        expect(kanbanCellKey(undefined, 'ganado')).toBe('ganado');
        expect(kanbanCellKey(undefined, null)).toBe('__null__');
        expect(kanbanCellKey('3', 'ganado')).toBe('["3","ganado"]');
        expect(kanbanCellKey(null, null)).toBe('["__null__","__null__"]');
    });

    it('el valor a escribir al soltar en un grupo, por tipo', () => {
        expect(kanbanBucketValue('select', 'ganado')).toEqual({ ok: true, value: 'ganado' });
        expect(kanbanBucketValue('select', null)).toEqual({ ok: true, value: null });
        expect(kanbanBucketValue('user', '12')).toEqual({ ok: true, value: 12 });
        expect(kanbanBucketValue('user', 'x')).toEqual({ ok: false });
        expect(kanbanBucketValue('checkbox', 'true')).toEqual({ ok: true, value: true });
        expect(kanbanBucketValue('checkbox', 'false')).toEqual({ ok: true, value: false });
        expect(kanbanBucketValue('currency', '1500.5')).toEqual({ ok: true, value: 1500.5 });
        expect(kanbanBucketValue('multi_select', '["promo", "vip"]')).toEqual({ ok: true, value: ['promo', 'vip'] });
        expect(kanbanBucketValue('lookup', 'x')).toEqual({ ok: false });
        expect(kanbanBucketValue('rollup', '10')).toEqual({ ok: false });
    });

    it('la clave de un valor coincide con la que arma el servidor', () => {
        expect(kanbanBucketKeyOf('select', 'ganado')).toBe('ganado');
        expect(kanbanBucketKeyOf('select', '')).toBeNull();
        expect(kanbanBucketKeyOf('user', 12)).toBe('12');
        expect(kanbanBucketKeyOf('checkbox', true)).toBe('true');
        expect(kanbanBucketKeyOf('checkbox', false)).toBe('false');
        // Conjunto ordenado con ", " — la salida de texto de un jsonb.
        expect(kanbanBucketKeyOf('multi_select', ['vip', 'promo'])).toBe('["promo", "vip"]');
        expect(kanbanBucketKeyOf('multi_select', [])).toBeNull();
        expect(kanbanBucketKeyOf('lookup', ['x'])).toBeUndefined();
        // Ida y vuelta: soltar en un grupo deja el registro en ESE grupo.
        for (const [type, key] of [['select', 'perdido'], ['user', '7'], ['checkbox', 'false'], ['multi_select', '["a", "b"]'], ['number', '42']] as const) {
            const v = kanbanBucketValue(type, key);
            expect(v.ok).toBe(true);
            if (v.ok) expect(kanbanBucketKeyOf(type, v.value)).toBe(key);
        }
    });

    it('vacío para una regla al mover', () => {
        expect(isKanbanEmptyValue(null)).toBe(true);
        expect(isKanbanEmptyValue('  ')).toBe(true);
        expect(isKanbanEmptyValue([])).toBe(true);
        expect(isKanbanEmptyValue(false)).toBe(true);
        expect(isKanbanEmptyValue(0)).toBe(false);
        expect(isKanbanEmptyValue('Precio')).toBe(false);
    });
});
