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

describe('paginación por página (v0.1.187)', () => {
    it('`page` y `with_total` llegan al service (el whitelist los copia)', () => {
        const q = parseListQuery({ page: '3', limit: '200', with_total: '1' });
        expect(q.page).toBe(3);
        expect(q.limit).toBe(200);
        expect(q.with_total).toBe(true);
    });

    it('page inválida → 400', () => {
        expect(() => parseListQuery({ page: '0' })).toThrow();
        expect(() => parseListQuery({ page: 'x' })).toThrow();
    });
});

describe('subtareas en la query (v0.1.132)', () => {
    it('`parent` e `include_subtasks` llegan al service', () => {
        const q = parseListQuery({ parent: '42', include_subtasks: '1' });
        expect(q.parent).toBe(42);
        expect(q.include_subtasks).toBe(true);
    });

    it('sin esos params el listado queda como siempre (sólo primer nivel)', () => {
        const q = parseListQuery({});
        expect(q.parent).toBeUndefined();
        expect(q.include_subtasks).toBeUndefined();
    });
});
