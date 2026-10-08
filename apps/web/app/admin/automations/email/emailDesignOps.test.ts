import { describe, expect, it } from 'vitest';
import { emailDesignSchema } from '@imagina-base/shared';

import {
    appendToColumn,
    canDrop,
    duplicateBlock,
    findBlock,
    insertAt,
    insertBlock,
    isNoopDrop,
    makeBlock,
    makeInner,
    moveBlock,
    moveTo,
    removeBlock,
    setColumnCount,
    updateBlock,
} from './emailDesignOps';

const base = () =>
    emailDesignSchema.parse({
        blocks: [
            { id: 'a', type: 'heading', text: 'A' },
            { id: 'cols', type: 'columns', columns: [{ blocks: [{ id: 'x', type: 'text' }] }, { blocks: [] }] },
            { id: 'b', type: 'divider' },
        ],
    });

describe('emailDesignOps', () => {
    it('cada bloque nuevo valida contra el schema compartido', () => {
        for (const t of ['heading', 'text', 'button', 'image', 'divider', 'spacer', 'fields', 'signature', 'html', 'columns'] as const) {
            expect(emailDesignSchema.safeParse({ blocks: [makeBlock(t)] }).success, t).toBe(true);
        }
    });

    it('mover, actualizar y borrar dentro y fuera de columnas', () => {
        let d = moveBlock(base(), 'b', -1);
        expect(d.blocks.map((b) => b.id)).toEqual(['a', 'b', 'cols']);
        d = updateBlock(d, 'x', { align: 'center' });
        expect(findBlock(d, 'x')).toMatchObject({ align: 'center' });
        d = removeBlock(d, 'x');
        expect(findBlock(d, 'x')).toBeNull();
    });

    it('duplicar copia con ids nuevos (también los internos)', () => {
        const { design, newId } = duplicateBlock(base(), 'cols');
        expect(design.blocks).toHaveLength(4);
        const copy = findBlock(design, newId!);
        expect(copy?.type).toBe('columns');
        if (copy?.type === 'columns') expect(copy.columns[0]!.blocks[0]!.id).not.toBe('x');
    });

    it('insertar después de un bloque interno: los internos quedan en la columna, el resto sale afuera', () => {
        let d = insertBlock(base(), makeBlock('button'), 'x');
        const cols = d.blocks[1];
        expect(cols?.type === 'columns' && cols.columns[0]!.blocks).toHaveLength(2);
        d = insertBlock(d, makeBlock('fields'), 'x');
        expect(d.blocks[2]?.type).toBe('fields');
        d = appendToColumn(d, 'cols', 1, makeInner('image'));
        const c2 = d.blocks[1];
        expect(c2?.type === 'columns' && c2.columns[1]!.blocks[0]!.type).toBe('image');
    });

    it('pasar de 3 a 2 columnas conserva el contenido', () => {
        let d = setColumnCount(base(), 'cols', 3);
        const c = d.blocks[1];
        expect(c?.type === 'columns' && c.columns).toHaveLength(3);
        d = setColumnCount(d, 'cols', 2);
        const c2 = d.blocks[1];
        expect(c2?.type === 'columns' && c2.columns[1]!.blocks).toHaveLength(1);
    });

    describe('arrastrar y soltar', () => {
        const top = (index: number) => ({ parentId: null, columnIndex: null, index });
        const col = (ci: number, index: number) => ({ parentId: 'cols', columnIndex: ci, index });

        it('soltar un bloque nuevo en el lugar exacto (primer nivel y columna vacía)', () => {
            let r = insertAt(base(), 'button', top(1));
            expect(r.design.blocks.map((b) => b.type)).toEqual(['heading', 'button', 'columns', 'divider']);
            r = insertAt(r.design, 'heading', col(1, 0));
            const c = findBlock(r.design, 'cols');
            expect(c?.type === 'columns' && c.columns[1]!.blocks[0]).toMatchObject({ type: 'heading', level: 3 });
            expect(r.id).toBeTruthy();
        });

        it('las columnas sólo aceptan bloques simples', () => {
            expect(canDrop(base(), { kind: 'new', type: 'fields' }, col(0, 0))).toBe(false);
            expect(canDrop(base(), { kind: 'new', type: 'columns' }, col(0, 0))).toBe(false);
            expect(canDrop(base(), { kind: 'move', id: 'cols' }, col(0, 0))).toBe(false);
            expect(insertAt(base(), 'signature', col(0, 0)).id).toBeNull();
        });

        it('mover hacia abajo en la misma lista corrige el índice (cuenta sobre la lista original)', () => {
            const d = moveTo(base(), 'a', top(3));
            expect(d.blocks.map((b) => b.id)).toEqual(['cols', 'b', 'a']);
            const up = moveTo(base(), 'b', top(0));
            expect(up.blocks.map((b) => b.id)).toEqual(['b', 'a', 'cols']);
        });

        it('soltar en el mismo lugar no cambia nada', () => {
            expect(isNoopDrop(base(), { kind: 'move', id: 'a' }, top(0))).toBe(true);
            expect(isNoopDrop(base(), { kind: 'move', id: 'a' }, top(1))).toBe(true);
            const d = base();
            expect(moveTo(d, 'a', top(1))).toBe(d);
        });

        it('mover dentro y fuera de una columna, y entre columnas', () => {
            let d = moveTo(base(), 'a', col(1, 0));
            expect(d.blocks.map((b) => b.id)).toEqual(['cols', 'b']);
            const c = findBlock(d, 'cols');
            expect(c?.type === 'columns' && c.columns[1]!.blocks.map((b) => b.id)).toEqual(['a']);
            d = moveTo(d, 'x', col(1, 1));
            const c2 = findBlock(d, 'cols');
            expect(c2?.type === 'columns' && c2.columns[0]!.blocks).toHaveLength(0);
            expect(c2?.type === 'columns' && c2.columns[1]!.blocks.map((b) => b.id)).toEqual(['a', 'x']);
            d = moveTo(d, 'x', top(0));
            expect(d.blocks[0]!.id).toBe('x');
            expect(emailDesignSchema.safeParse(d).success).toBe(true);
        });
    });
});
