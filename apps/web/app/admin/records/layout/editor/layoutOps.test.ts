import { describe, expect, it } from 'vitest';
import { recordLayoutV3Schema, type RecordLayoutV3 } from '@imagina-base/shared';

import { BLOCK_CATALOG } from './blockCatalog';
import {
    addPage,
    duplicateSection,
    duplicateBlock,
    findBlock,
    insertBlock,
    insertSection,
    moveBlock,
    moveSection,
    removePage,
    setSectionColumns,
} from './layoutOps';

const base = (): RecordLayoutV3 => ({
    v: 3,
    theme: { preset: 'default' },
    header: { subtitle_field_ids: [], chip_field_ids: [], cover: { kind: 'gradient' }, avatar: { kind: 'initials' }, show_meta: true },
    pages: [
        {
            id: 'p1',
            name: 'Resumen',
            sections: [
                {
                    id: 's1',
                    columns: [8, 4],
                    blocks: [
                        [
                            { id: 'a', type: 'description', config: {} },
                            { id: 'b', type: 'heading', config: { text: 'B' } },
                            { id: 'c', type: 'divider', config: {} },
                        ],
                        [{ id: 'd', type: 'activity', config: {} }],
                    ],
                },
            ],
        },
    ],
});

const valid = (l: RecordLayoutV3): boolean => recordLayoutV3Schema.safeParse(l).success;

describe('operaciones del editor de la ficha', () => {
    it('mover dentro de la misma columna respeta la posición que ve quien arrastra', () => {
        // Soltar "a" entre "b" y "c" (índice 2 antes de sacarlo) → b, a, c.
        const l = moveBlock(base(), 'a', { pageId: 'p1', sectionId: 's1', col: 0, index: 2 });
        expect(l.pages[0]!.sections[0]!.blocks[0]!.map((b) => b.id)).toEqual(['b', 'a', 'c']);
        // Soltarlo justo debajo de sí mismo no lo mueve.
        const same = moveBlock(base(), 'a', { pageId: 'p1', sectionId: 's1', col: 0, index: 1 });
        expect(same.pages[0]!.sections[0]!.blocks[0]!.map((b) => b.id)).toEqual(['a', 'b', 'c']);
        // A otra columna.
        const other = moveBlock(base(), 'c', { pageId: 'p1', sectionId: 's1', col: 1, index: 0 });
        expect(other.pages[0]!.sections[0]!.blocks[1]!.map((b) => b.id)).toEqual(['c', 'd']);
        expect(valid(other)).toBe(true);
    });

    it('cambiar columnas junta lo que sobra en la última y la sección sigue siendo válida', () => {
        const one = setSectionColumns(base(), 's1', [12]);
        expect(one.pages[0]!.sections[0]!.blocks).toHaveLength(1);
        expect(one.pages[0]!.sections[0]!.blocks[0]!.map((b) => b.id)).toEqual(['a', 'b', 'c', 'd']);
        const three = setSectionColumns(base(), 's1', [4, 4, 4]);
        expect(three.pages[0]!.sections[0]!.blocks.map((s) => s.length)).toEqual([3, 1, 0]);
        expect(valid(three)).toBe(true);
        // Columnas que no suman 12 se ignoran.
        expect(setSectionColumns(base(), 's1', [5, 5])).toEqual(base());
    });

    it('duplicar, insertar secciones, moverlas y páginas', () => {
        const d = duplicateBlock(base(), 'b');
        expect(d.newId).not.toBeNull();
        expect(findBlock(d.layout, d.newId!)).toMatchObject({ col: 0, index: 2 });
        const withSection = insertSection(base(), 'p1', 0, [6, 6]);
        expect(withSection.layout.pages[0]!.sections[0]!.id).toBe(withSection.id);
        const moved = moveSection(withSection.layout, withSection.id, 1);
        expect(moved.pages[0]!.sections[1]!.id).toBe(withSection.id);
        const withBlock = insertBlock(moved, { pageId: 'p1', sectionId: withSection.id, col: 1, index: 99 }, { id: 'x', type: 'spacer', config: {} });
        expect(findBlock(withBlock, 'x')).toMatchObject({ col: 1, index: 0 });
        const paged = addPage(withBlock, 'Facturas');
        expect(paged.layout.pages).toHaveLength(2);
        expect(valid(paged.layout)).toBe(true);
        // Nunca queda sin páginas.
        expect(removePage(base(), 'p1').pages).toHaveLength(1);
    });
});

describe('catálogo de bloques', () => {
    const ctx = {
        listId: 7,
        fields: [
            { id: 1, slug: 'nombre', label: 'Nombre', type: 'text', config: {} },
            { id: 2, slug: 'estado', label: 'Estado', type: 'select', config: {} },
            { id: 3, slug: 'valor', label: 'Valor', type: 'currency', config: {} },
        ] as never,
        paths: [{ relation_field_id: 40, relation_label: 'Cliente', direction: 'reverse' as const, list_id: 9, list_name: 'Facturas', other_list_id: 9, other_list_name: 'Facturas' }],
    };

    it('cada entrada crea un bloque que pasa el schema, con la fuente en los vinculados', () => {
        for (const entry of BLOCK_CATALOG) {
            const b = entry.create(ctx);
            const layout = base();
            layout.pages[0]!.sections[0]!.blocks[0]!.push(b);
            expect(recordLayoutV3Schema.safeParse(layout).success, entry.key).toBe(true);
            if (b.type === 'chart' || b.type === 'related') {
                expect(b.config.source).toEqual({ kind: 'related', field_id: 40, direction: 'reverse' });
            }
        }
    });

    it('sin relaciones, los gráficos leen la lista entera', () => {
        const b = BLOCK_CATALOG.find((e) => e.key === 'chart_kpi')!.create({ ...ctx, paths: [] });
        expect(b.config.source).toEqual({ kind: 'list', list_id: 7 });
    });

    it('duplicar una sección da ids nuevos a todos sus bloques', () => {
        const next = duplicateSection(base(), 's1');
        const [orig, copy] = next.pages[0]!.sections;
        expect(copy!.id).not.toBe(orig!.id);
        const ids = (s: typeof orig) => s!.blocks.flat().map((b) => b.id);
        expect(ids(copy).some((id) => ids(orig).includes(id))).toBe(false);
        expect(recordLayoutV3Schema.safeParse(next).success).toBe(true);
    });
});
