import { describe, expect, it } from 'vitest';

import { calendarRangeQuery } from './CalendarView';

describe('calendario: registros del rango visible (v0.1.286)', () => {
    it('pide el rango de la grilla, ordenado por la fecha, con los filtros y la búsqueda de la vista', () => {
        const base = {
            type: 'group' as const,
            logic: 'and' as const,
            children: [{ type: 'condition' as const, field_id: 3, op: 'eq' as const, value: 'pendiente' }],
        };
        const q = calendarRangeQuery({ id: 9 }, '2026-09-28', '2026-11-08', base, ' ana ');
        expect(q.sort).toBe('field_9:asc');
        expect(q.per_page).toBe(200);
        expect(q.search).toBe('ana');
        const tree = JSON.parse(String(q.filter_tree)) as { children: unknown[] };
        expect(tree.children).toEqual([
            base,
            { type: 'condition', field_id: 9, op: 'gte', value: '2026-09-28' },
            { type: 'condition', field_id: 9, op: 'lte', value: '2026-11-08' },
        ]);
    });

    it('sin filtros ni búsqueda: sólo el rango', () => {
        const q = calendarRangeQuery({ id: 9 }, '2026-09-28', '2026-11-08', undefined, '');
        expect(q.search).toBeUndefined();
        expect((JSON.parse(String(q.filter_tree)) as { children: unknown[] }).children).toHaveLength(2);
    });
});
