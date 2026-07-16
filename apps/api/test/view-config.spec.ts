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
