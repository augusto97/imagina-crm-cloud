import { describe, expect, it } from 'vitest';
import { parseListQuery } from '../src/records/records.controller';

const TREE = JSON.stringify({
    type: 'group',
    logic: 'and',
    children: [{ type: 'condition', field_id: 130, op: 'contains', value: 'Scroll 1' }],
});

describe('parseListQuery (query del listado de records)', () => {
    it('lee el árbol del param `filter_tree` (el que manda el front)', () => {
        // Regresión: el listado leía SOLO el alias `filter`, así que el
        // `filter_tree` del front se descartaba en silencio y los filtros
        // de la tabla no filtraban nada server-side.
        const q = parseListQuery({ filter_tree: TREE, limit: '200' });
        expect(q.filter_tree?.children).toHaveLength(1);
        expect(q.limit).toBe(200);
    });

    it('acepta también el alias histórico `filter`', () => {
        const q = parseListQuery({ filter: TREE });
        expect(q.filter_tree?.children).toHaveLength(1);
    });

    it('filter_tree malformado → 400, no silencio', () => {
        expect(() => parseListQuery({ filter_tree: '{no-json' })).toThrow();
        expect(() => parseListQuery({ filter_tree: '{"type":"group"}' })).toThrow();
    });

    it('sin filtros → query válida con defaults', () => {
        const q = parseListQuery({});
        expect(q.filter_tree).toBeUndefined();
        expect(q.limit).toBe(50);
        expect(q.sort_dir).toBe('asc');
    });
});
