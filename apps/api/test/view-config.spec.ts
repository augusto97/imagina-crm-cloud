import { describe, expect, it } from 'vitest';
import { parseViewConfig } from '@imagina-base/shared';

describe('parseViewConfig (shape real del fork)', () => {
    it('conserva hidden_columns / column_widths / search al guardar una tabla', () => {
        // Regresión: el schema anterior descartaba estas claves en silencio
        // → ocultar columnas funcionaba en vivo pero se perdía al recargar.
        const cfg = parseViewConfig('table', {
            hidden_columns: ['ciudad', 'updated_at'],
            column_widths: { razon_social: 320 },
            column_order: ['id', 'razon_social', 'ciudad'],
            search: 'acme',
            sort: [{ field_id: 3, dir: 'desc' }],
            filter_tree: {
                type: 'group',
                logic: 'and',
                children: [{ type: 'condition', field_id: 130, op: 'contains', value: 'x' }],
            },
            filters: [{ field_id: 130, op: 'contains', value: 'x' }],
            footer_aggregates: { presupuesto: 'sum' },
        });
        expect(cfg.hidden_columns).toEqual(['ciudad', 'updated_at']);
        expect(cfg.column_widths).toEqual({ razon_social: 320 });
        expect(cfg.column_order).toEqual(['id', 'razon_social', 'ciudad']);
        expect(cfg.search).toBe('acme');
        expect(cfg.filters).toHaveLength(1);
        expect(cfg.footer_aggregates).toEqual({ presupuesto: 'sum' });
    });

    it('los ids de columna son strings TanStack (slugs), no field_ids', () => {
        // column_order numérico legacy también se acepta (coerce a string).
        const cfg = parseViewConfig('table', { column_order: [5, 'estado'] });
        expect(cfg.column_order).toEqual(['5', 'estado']);
    });

    it('v0.1.287 — conserva columnas fijas, colores condicionales y el segundo agrupado', () => {
        const rules = [
            { id: 'r1', enabled: true, condition: { type: 'condition', field_id: 3, op: 'eq', value: 'baja' }, color: 'red', target: 'row' },
            { id: 'r2', enabled: false, condition: { type: 'condition', field_id: 4, op: 'between_relative', value: 'today' }, color: 'amber', target: 'cell', cell_field_id: 4 },
        ];
        const cfg = parseViewConfig('table', { group_by_field_id: 3, sub_group_by_field_id: 5, frozen_columns: 2, color_rules: rules });
        expect(cfg.sub_group_by_field_id).toBe(5);
        expect(cfg.frozen_columns).toBe(2);
        expect(cfg.color_rules).toEqual(rules);
        // Sin claves nuevas, no aparecen (las vistas viejas no cambian).
        const old = parseViewConfig('table', {});
        expect('frozen_columns' in old).toBe(false);
        expect('color_rules' in old).toBe(false);
        // Paleta cerrada y conteo de columnas acotado.
        expect(() => parseViewConfig('table', { color_rules: [{ ...rules[0], color: '#ff0000' }] })).toThrow();
        expect(() => parseViewConfig('table', { frozen_columns: 0 })).toThrow();
    });

    it('kanban/cards también conservan el estado común (filtros + columnas)', () => {
        const kanban = parseViewConfig('kanban', {
            group_by_field_id: 7,
            hidden_columns: ['notas'],
            search: 'q',
        });
        expect(kanban.hidden_columns).toEqual(['notas']);
        expect(kanban.search).toBe('q');

        const cards = parseViewConfig('cards', { card_field_ids: [1], search: 'z' });
        expect(cards.search).toBe('z');
    });
});
