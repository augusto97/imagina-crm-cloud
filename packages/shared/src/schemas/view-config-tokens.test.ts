import { describe, expect, it } from 'vitest';
import { resolveFieldRefs, tokenizeFieldRefs } from './list-template';
import { parseViewConfig } from './view';

/**
 * v0.1.287 — Las plantillas (blueprint) y duplicar una lista llevan la config
 * de las vistas con los ids de campo como tokens `{ $field: slug }`. Las
 * claves nuevas (segundo agrupado, colores condicionales) siguen la
 * convención `*field_id`, así viajan sin tocar el blueprint.
 */
describe('config de vista ↔ tokens del blueprint', () => {
    it('segundo agrupado y colores condicionales se re-mapean a los ids de la lista nueva', () => {
        const config = parseViewConfig('table', {
            group_by_field_id: 10,
            sub_group_by_field_id: 11,
            frozen_columns: 2,
            color_rules: [
                { id: 'r1', enabled: true, condition: { type: 'condition', field_id: 10, op: 'eq', value: 'baja' }, color: 'red', target: 'row' },
                { id: 'r2', enabled: true, condition: { type: 'condition', field_id: 12, op: 'is_null' }, color: 'amber', target: 'cell', cell_field_id: 11 },
            ],
        });
        const tokens = tokenizeFieldRefs(config, new Map([[10, 'estado'], [11, 'region'], [12, 'telefono']]));
        expect(tokens).toMatchObject({
            sub_group_by_field_id: { $field: 'region' },
            color_rules: [
                { condition: { field_id: { $field: 'estado' } } },
                { condition: { field_id: { $field: 'telefono' } }, cell_field_id: { $field: 'region' } },
            ],
        });
        const resolved = resolveFieldRefs(tokens, new Map([['estado', 210], ['region', 211], ['telefono', 212]])) as Record<string, unknown>;
        const reparsed = parseViewConfig('table', resolved);
        expect(reparsed.group_by_field_id).toBe(210);
        expect(reparsed.sub_group_by_field_id).toBe(211);
        expect(reparsed.frozen_columns).toBe(2);
        expect(reparsed.color_rules).toEqual([
            { id: 'r1', enabled: true, condition: { type: 'condition', field_id: 210, op: 'eq', value: 'baja' }, color: 'red', target: 'row' },
            { id: 'r2', enabled: true, condition: { type: 'condition', field_id: 212, op: 'is_null' }, color: 'amber', target: 'cell', cell_field_id: 211 },
        ]);
    });
});
