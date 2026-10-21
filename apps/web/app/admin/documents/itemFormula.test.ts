import { describe, expect, it } from 'vitest';
import { buildDocumentStarter, type DocItemExpr, type DocItemsColumn } from '@imagina-base/shared';

import { exprToFormula, formulaToExpr, newComputedKey, renameItemsColumnRef } from './itemFormula';

describe('v0.1.292 — fórmulas de las columnas calculadas (editor)', () => {
    it('ida y vuelta de cada forma, incluido el total con descuento de la cotización', () => {
        const exprs: DocItemExpr[] = [
            { op: 'mul', args: [{ op: 'col', slug: 'cant' }, { op: 'col', slug: 'precio' }] },
            { op: 'minus_pct', of: { op: 'mul', args: [{ op: 'col', slug: 'cant' }, { op: 'col', slug: 'precio' }] }, pct: { op: 'col', slug: 'dto' } },
            { op: 'pct', of: { op: 'col', slug: 'base' }, pct: { op: 'const', value: 19 } },
            { op: 'minus_pct', of: { op: 'col', slug: 'calc_bruto' }, pct: { op: 'col', slug: 'dto' } },
            { op: 'sub', args: [{ op: 'col', slug: 'a' }, { op: 'const', value: 2.5 }] },
            { op: 'col', slug: 'calc_bruto' },
        ];
        for (const e of exprs) expect(formulaToExpr(exprToFormula(e)!)).toEqual(e);
        expect(exprToFormula(exprs[1])!.kind).toBe('mul_disc');
        expect(exprToFormula(exprs[5])!.kind).toBe('ref');
    });

    it('una fórmula que no encaja en ninguna forma queda «personalizada» (null)', () => {
        expect(exprToFormula({ op: 'add', args: [{ op: 'col', slug: 'a' }, { op: 'col', slug: 'b' }, { op: 'col', slug: 'c' }] })).toBeNull();
        expect(exprToFormula({ op: 'mul', args: [{ op: 'add', args: [{ op: 'col', slug: 'a' }, { op: 'const', value: 1 }] }, { op: 'col', slug: 'b' }] })).toBeNull();
        expect(exprToFormula(undefined)).toBeNull();
    });

    it('elegir el campo de una columna marcadora re-apunta las fórmulas que la leían', () => {
        const design = buildDocumentStarter('cotizacion', { items: { source: null, fields: { descripcion: 'detalle', cantidad: 'cant' } } }).design;
        const items = design.blocks.find((b) => b.type === 'items');
        const cols = (items && items.type === 'items' ? items.columns : []) as DocItemsColumn[];
        const next = renameItemsColumnRef(cols, '[Precio unitario]', 'precio');
        expect(next.map((c) => c.slug)).toContain('precio');
        expect(JSON.stringify(next)).not.toContain('[Precio unitario]');
        const bruto = next.find((c) => c.slug === 'calc_bruto')!;
        expect(bruto.expr).toEqual({ op: 'mul', args: [{ op: 'col', slug: 'cant' }, { op: 'col', slug: 'precio' }] });
        expect(newComputedKey(next)).toBe('calc_1');
        expect(newComputedKey([...next, { ...bruto, slug: 'calc_1' }])).toBe('calc_2');
    });
});
