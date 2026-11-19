import { describe, expect, it } from 'vitest';
import { REPORT_MAX_BLOCKS, reportBlocksSchema, type ReportBlock } from '@imagina-base/shared';

import {
    addBlockProblem,
    allBlockIds,
    blockLabel,
    commit,
    dataWidgetFromSpec,
    duplicateBlock,
    findBlock,
    historyOf,
    insertBlock,
    joinWithNext,
    moveBlock,
    moveTo,
    newBlockId,
    redo,
    removeBlock,
    replaceBlock,
    specFromBlock,
    splitColumns,
    undo,
    type ReportDraft,
} from './reportEditor';

const w = (id: string, list = 1): ReportBlock => ({ id, type: 'widget', widget: { type: 'kpi', list_id: list, title: id.toUpperCase(), config: {} } });
const h = (id: string, text = 'T'): ReportBlock => ({ id, type: 'heading', text, subtitle: '' });

describe('v0.1.464 — operaciones del editor de informes', () => {
    it('ids nuevos que no chocan con los de adentro de las columnas', () => {
        const blocks: ReportBlock[] = [{ id: 'row', type: 'columns', children: [w('a') as never, w('b') as never] }];
        let n = 0;
        // El primer intento repite «b000000»: el segundo sale distinto.
        const seq = [0, 0, 0.5];
        const id = newBlockId([...blocks, { id: 'b000000', type: 'divider' }], () => seq[n++] ?? 0.9);
        expect(id).not.toBe('b000000');
        expect(allBlockIds(blocks)).toEqual(['row', 'a', 'b']);
        expect(findBlock(blocks, 'b')).toMatchObject({ index: 0, child: 1 });
    });

    it('insertar después del elegido y al final; reemplazar dentro de una fila', () => {
        let blocks: ReportBlock[] = [h('h1'), w('a')];
        blocks = insertBlock(blocks, w('b'), 'h1');
        expect(blocks.map((b) => b.id)).toEqual(['h1', 'b', 'a']);
        blocks = insertBlock(blocks, h('h2'), null);
        expect(blocks.at(-1)!.id).toBe('h2');
        const joined = joinWithNext(blocks, 'b')!;
        const renamed = replaceBlock(joined, 'a', (x) => (x.type === 'widget' ? { ...x, widget: { ...x.widget, title: 'Nuevo' } } : x));
        const row = renamed[1]!;
        expect(row.type === 'columns' && row.children[1]!.widget.title).toBe('Nuevo');
    });

    it('subir/bajar entre los de arriba y a izquierda/derecha dentro de una fila', () => {
        const blocks: ReportBlock[] = [h('h1'), w('a'), w('b'), w('c')];
        expect(moveBlock(blocks, 'a', -1).map((b) => b.id)).toEqual(['a', 'h1', 'b', 'c']);
        expect(moveBlock(blocks, 'h1', -1).map((b) => b.id)).toEqual(['h1', 'a', 'b', 'c']);
        const row = joinWithNext(blocks, 'a')!; // [h1, row(a,b), c]
        const swapped = moveBlock(row, 'a', 1);
        const r = swapped[1]!;
        expect(r.type === 'columns' && r.children.map((c) => c.id)).toEqual(['b', 'a']);
        expect(moveTo(blocks, 3, 0).map((b) => b.id)).toEqual(['c', 'h1', 'a', 'b']);
        expect(blocks.map((b) => b.id)).toEqual(['h1', 'a', 'b', 'c']); // sin mutar
    });

    it('juntar en columnas (2 y 3), no más de 3, y separar', () => {
        const blocks: ReportBlock[] = [w('a'), w('b'), w('c'), w('d'), h('h')];
        const two = joinWithNext(blocks, 'a')!;
        expect(two).toHaveLength(4);
        const three = joinWithNext(two, two[0]!.id)!;
        const row = three[0]!;
        expect(row.type === 'columns' && row.children.map((c) => c.id)).toEqual(['a', 'b', 'c']);
        expect(joinWithNext(three, row.id)).toBeNull(); // ya tiene 3
        expect(joinWithNext(three, 'd')).toBeNull(); // el siguiente es un título
        expect(reportBlocksSchema.safeParse(three).success).toBe(true);
        expect(splitColumns(three, 'b').map((b) => b.id)).toEqual(['a', 'b', 'c', 'd', 'h']);
    });

    it('quitar de una fila: con uno solo, la fila desaparece', () => {
        const blocks = joinWithNext([w('a'), w('b'), h('h')], 'a')!;
        const left = removeBlock(blocks, 'a');
        expect(left.map((b) => b.id)).toEqual(['b', 'h']);
        expect(removeBlock(left, 'h').map((b) => b.id)).toEqual(['b']);
    });

    it('duplicar con ids nuevos (también los hijos) y válido para guardar', () => {
        const blocks = joinWithNext([w('a'), w('b'), h('h')], 'a')!;
        const rowId = blocks[0]!.id;
        const r = duplicateBlock(blocks, rowId);
        expect(r.blocks).toHaveLength(3);
        expect(new Set(allBlockIds(r.blocks)).size).toBe(allBlockIds(r.blocks).length);
        expect(reportBlocksSchema.safeParse(r.blocks).success).toBe(true);
        // Un hijo se duplica dentro de su fila si cabe.
        const child = duplicateBlock(blocks, 'b');
        const row = child.blocks[0]!;
        expect(row.type === 'columns' && row.children).toHaveLength(3);
    });

    it('topes: bloques y bloques de datos', () => {
        const full = Array.from({ length: REPORT_MAX_BLOCKS }, (_, i) => h(`h${i}`));
        expect(addBlockProblem(full, false)).toMatch(/hasta 40 bloques/);
        expect(addBlockProblem([h('x')], true)).toBeNull();
    });

    it('del diálogo del widget a un bloque y de vuelta (sólo tipos de datos)', () => {
        const spec = specFromBlock(w('a', 7) as never);
        expect(spec).toMatchObject({ id: 'a', type: 'kpi', list_id: 7 });
        expect(dataWidgetFromSpec(spec)).toEqual({ type: 'kpi', list_id: 7, title: 'A', config: {} });
        expect(dataWidgetFromSpec({ ...spec, type: 'heading' })).toBeNull();
        expect(dataWidgetFromSpec({ ...spec, list_id: 0 })).toBeNull();
        expect(blockLabel(w('a', 7), (id) => (id === 7 ? 'Facturas' : null))).toEqual({ kind: 'Indicador', text: 'A · Facturas' });
        expect(blockLabel({ id: 't', type: 'text', text: '## Resumen\nlo demás' }, () => null).text).toBe('Resumen');
    });

    it('deshacer/rehacer, y lo que se tipea seguido es un solo paso', () => {
        const d0: ReportDraft = { name: 'A', description: '', blocks: [], period: '', compare: '', visibility: 'workspace', allowed_roles: [] };
        let hist = historyOf(d0);
        hist = commit(hist, { ...d0, name: 'Ab' }, 'name');
        hist = commit(hist, { ...d0, name: 'Abc' }, 'name');
        hist = commit(hist, { ...hist.present, blocks: [h('h')] });
        expect(hist.past).toHaveLength(2);
        hist = undo(hist);
        expect(hist.present.blocks).toHaveLength(0);
        hist = undo(hist);
        expect(hist.present.name).toBe('A');
        hist = redo(redo(hist));
        expect(hist.present).toMatchObject({ name: 'Abc', blocks: [{ id: 'h' }] });
        expect(commit(hist, hist.present)).toBe(hist); // sin cambios, sin paso
    });
});
