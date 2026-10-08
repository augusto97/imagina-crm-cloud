import { describe, expect, it } from 'vitest';
import { emailDesignSchema } from '@imagina-base/shared';

import { resolveDrop, type DropGeometry } from './emailDnd';

const design = emailDesignSchema.parse({
    blocks: [
        { id: 'a', type: 'heading', text: 'A' },
        { id: 'cols', type: 'columns', columns: [{ blocks: [{ id: 'x', type: 'text' }] }, { blocks: [] }] },
        { id: 'b', type: 'divider' },
    ],
});

// Hoja de 0 a 600 de ancho; "a" 0-50, columnas 50-250 (col 0: 0-300, col 1: 300-600), "b" 250-270.
const geo: DropGeometry = {
    sheet: { top: 0, bottom: 300, left: 0, right: 600 },
    top: [
        { id: 'a', box: { top: 0, bottom: 50, left: 0, right: 600 } },
        { id: 'cols', box: { top: 50, bottom: 250, left: 0, right: 600 } },
        { id: 'b', box: { top: 250, bottom: 270, left: 0, right: 600 } },
    ],
    columns: [
        { parentId: 'cols', columnIndex: 0, box: { top: 60, bottom: 240, left: 0, right: 300 }, blocks: [{ id: 'x', box: { top: 60, bottom: 120, left: 0, right: 300 } }] },
        { parentId: 'cols', columnIndex: 1, box: { top: 60, bottom: 240, left: 300, right: 600 }, blocks: [] },
    ],
};

describe('resolveDrop', () => {
    it('primer nivel: antes de la mitad va arriba, después va abajo', () => {
        expect(resolveDrop(design, { kind: 'new', type: 'button' }, 300, 10, geo)?.target).toEqual({ parentId: null, columnIndex: null, index: 0 });
        expect(resolveDrop(design, { kind: 'new', type: 'button' }, 300, 265, geo)?.target).toEqual({ parentId: null, columnIndex: null, index: 3 });
        expect(resolveDrop(design, { kind: 'new', type: 'button' }, 300, 290, geo)?.line.top).toBe(270);
    });

    it('un bloque simple sobre una columna entra en esa columna (también si está vacía)', () => {
        const r = resolveDrop(design, { kind: 'new', type: 'image' }, 450, 100, geo);
        expect(r?.target).toEqual({ parentId: 'cols', columnIndex: 1, index: 0 });
        expect(r?.line.left).toBe(300);
        const r2 = resolveDrop(design, { kind: 'new', type: 'text' }, 100, 200, geo);
        expect(r2?.target).toEqual({ parentId: 'cols', columnIndex: 0, index: 1 });
    });

    it('un bloque que no entra en columnas cae en el primer nivel', () => {
        expect(resolveDrop(design, { kind: 'new', type: 'fields' }, 450, 100, geo)?.target.parentId).toBeNull();
    });

    it('soltar un bloque en su mismo lugar no marca nada', () => {
        expect(resolveDrop(design, { kind: 'move', id: 'a' }, 300, 10, geo)).toBeNull();
        expect(resolveDrop(design, { kind: 'move', id: 'x' }, 100, 70, geo)).toBeNull();
        expect(resolveDrop(design, { kind: 'move', id: 'x' }, 450, 100, geo)?.target).toEqual({ parentId: 'cols', columnIndex: 1, index: 0 });
    });
});
