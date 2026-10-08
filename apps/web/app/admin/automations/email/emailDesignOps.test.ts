import { describe, expect, it } from 'vitest';
import { emailDesignSchema } from '@imagina-base/shared';

import {
    appendToColumn,
    duplicateBlock,
    findBlock,
    insertBlock,
    makeBlock,
    makeInner,
    moveBlock,
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
});
