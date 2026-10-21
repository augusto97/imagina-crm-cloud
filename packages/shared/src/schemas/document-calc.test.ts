import { describe, expect, it } from 'vitest';
import { DOCUMENT_STARTERS, buildDocumentStarter, emptyIssuer } from '../templates/document-templates';
import {
    computeDesignTotals,
    computeItemColumns,
    computeItemsRows,
    computeTotalRows,
    describeDocItemExpr,
    evalDocItemExpr,
    roundMoney,
} from './document-calc';
import { docDesignSchema, docItemsColumnSchema, parseDocDesign, type DocDesign, type DocItemsColumn } from './document-design';

/** Lo que hace el servidor con una cotización: filas → columnas calculadas → totales. */
function run(design: DocDesign, rows: Array<Record<string, number | null>>, record: Record<string, number | null> = {}) {
    const items = design.blocks.find((b) => b.type === 'items');
    if (!items || items.type !== 'items') throw new Error('sin ítems');
    const calc = computeItemsRows(
        items.columns,
        rows.map((r) => (slug: string) => r[slug] ?? null),
    );
    const totals = computeDesignTotals(design, {
        itemsSum: (block, slug) => (block === items.id ? calc.sums.get(slug) ?? null : null),
        fieldNumber: (slug) => record[slug] ?? null,
        resolve: (t) => t,
    });
    const rowsOut = totals.byBlock.get('totals')!;
    return {
        lines: calc.values.map((v) => v.get('calc_total') ?? null),
        totals: Object.fromEntries(rowsOut.map((r) => [r.id, r.num])),
        shown: rowsOut.filter((r) => !r.hidden).map((r) => r.id),
    };
}

describe('v0.1.292 — cálculos de documentos', () => {
    it('redondeo comercial: la mitad se aleja del cero y sin errores de punto flotante', () => {
        expect(roundMoney(1.005, 2)).toBe(1.01);
        expect(roundMoney(2.5, 0)).toBe(3);
        expect(roundMoney(-2.5, 0)).toBe(-3);
        expect(roundMoney(0.1 + 0.2, 2)).toBe(0.3);
        expect(roundMoney(237.5, 0)).toBe(238);
        expect(roundMoney(59.970000000000006, 2)).toBe(59.97);
    });

    it('fórmulas: productos, porcentajes y vacíos sin explotar', () => {
        const v = (r: Record<string, number | null>) => (s: string) => r[s] ?? null;
        expect(evalDocItemExpr({ op: 'mul', args: [{ op: 'col', slug: 'q' }, { op: 'col', slug: 'p' }] }, v({ q: 3, p: 19.99 }))).toBeCloseTo(59.97);
        // Un vacío en un producto deja la celda vacía…
        expect(evalDocItemExpr({ op: 'mul', args: [{ op: 'col', slug: 'q' }, { op: 'col', slug: 'p' }] }, v({ p: 10 }))).toBeNull();
        // …en una suma cuenta como 0, y si todo está vacío, vacío.
        expect(evalDocItemExpr({ op: 'add', args: [{ op: 'col', slug: 'a' }, { op: 'const', value: 5 }] }, v({}))).toBe(5);
        expect(evalDocItemExpr({ op: 'add', args: [{ op: 'col', slug: 'a' }, { op: 'col', slug: 'b' }] }, v({}))).toBeNull();
        expect(evalDocItemExpr({ op: 'sub', args: [{ op: 'const', value: 10 }, { op: 'col', slug: 'b' }, { op: 'const', value: 3 }] }, v({ b: 2 }))).toBe(5);
        // División por cero: vacía (no Infinity en el PDF).
        expect(evalDocItemExpr({ op: 'div', args: [{ op: 'const', value: 10 }, { op: 'col', slug: 'z' }] }, v({ z: 0 }))).toBeNull();
        // Un porcentaje vacío es 0 % (sin descuento).
        expect(evalDocItemExpr({ op: 'minus_pct', of: { op: 'const', value: 200 }, pct: { op: 'col', slug: 'd' } }, v({}))).toBe(200);
        expect(evalDocItemExpr({ op: 'pct', of: { op: 'const', value: 200 }, pct: { op: 'const', value: 19 } }, v({}))).toBe(38);
    });

    it('columnas calculadas: leen las anteriores, redondean a la moneda y una posterior se lee vacía', () => {
        const cols: DocItemsColumn[] = [
            { slug: 'bruto', label: '', align: 'right', width: 'auto', kind: 'computed', decimals: 0, expr: { op: 'mul', args: [{ op: 'col', slug: 'cant' }, { op: 'col', slug: 'precio' }] } },
            { slug: 'neto', label: '', align: 'right', width: 'auto', kind: 'computed', decimals: 0, expr: { op: 'minus_pct', of: { op: 'col', slug: 'bruto' }, pct: { op: 'col', slug: 'desc' } } },
            { slug: 'antes', label: '', align: 'right', width: 'auto', kind: 'computed', decimals: 0, expr: { op: 'add', args: [{ op: 'col', slug: 'despues' }, { op: 'const', value: 1 }] } },
            { slug: 'despues', label: '', align: 'right', width: 'auto', kind: 'computed', decimals: 0, expr: { op: 'const', value: 7 } },
        ];
        // Cantidades decimales: 2,5 × 1.000,4 = 2.501 (redondeado a pesos).
        const out = computeItemColumns(cols, (s) => ({ cant: 2.5, precio: 1000.4, desc: 15 })[s] ?? null);
        expect(out.get('bruto')).toBe(2501);
        expect(out.get('neto')).toBe(2126); // 2501 × 0,85 = 2125,85
        expect(out.get('antes')).toBe(1); // «despues» todavía no existía
        expect(describeDocItemExpr(cols[1]!.expr!, (s) => ({ bruto: 'Bruto', desc: 'Descuento' })[s] ?? s)).toBe('Bruto − Descuento %');
        expect(describeDocItemExpr(cols[0]!.expr!, (s) => s)).toBe('cant × precio');
    });

    it('el schema exige la fórmula de una calculada y acota su tamaño', () => {
        expect(docItemsColumnSchema.safeParse({ slug: 'x', kind: 'computed' }).success).toBe(false);
        let deep: unknown = { op: 'const', value: 1 };
        for (let i = 0; i < 8; i++) deep = { op: 'add', args: [deep, { op: 'const', value: 1 }] };
        expect(docItemsColumnSchema.safeParse({ slug: 'x', kind: 'computed', expr: deep }).success).toBe(false);
        expect(docItemsColumnSchema.safeParse({ slug: 'x', kind: 'computed', expr: { op: 'col', slug: 'y' } }).success).toBe(true);
        // Un operador que no existe no pasa (nada de evaluar texto).
        expect(docItemsColumnSchema.safeParse({ slug: 'x', kind: 'computed', expr: { op: 'eval', code: '1+1' } }).success).toBe(false);
    });

    it('totales: redondea cada fila a los decimales del bloque y el porcentaje puede salir de un campo y restarse', () => {
        const out = computeTotalRows(
            [
                { id: 'base', label: '', emphasis: false, source: { kind: 'field', slug: 'base' } },
                { id: 'desc', label: '', emphasis: false, source: { kind: 'percent', of: 'base', pct: 0, pct_field: 'dto', negate: true }, hide_zero: true },
                { id: 'neto', label: '', emphasis: false, source: { kind: 'sum', rows: ['base', 'desc'], minus: [] }, hidden: true },
                { id: 'iva', label: '', emphasis: false, source: { kind: 'percent', of: 'neto', pct: 19 } },
            ],
            { itemsSum: () => null, fieldNumber: (s) => ({ base: 1250, dto: 10 })[s] ?? null, resolve: (t) => t },
            { decimals: 0 },
        );
        expect(Object.fromEntries(out.map((r) => [r.id, r.num]))).toEqual({ base: 1250, desc: -125, neto: 1125, iva: 214 });
        expect(out.find((r) => r.id === 'neto')!.hidden).toBe(true);
        // Sin descuento en el registro: la fila «desc» da 0 y se oculta.
        const none = computeTotalRows(
            [
                { id: 'base', label: '', emphasis: false, source: { kind: 'field', slug: 'base' } },
                { id: 'desc', label: '', emphasis: false, source: { kind: 'percent', of: 'base', pct: 0, pct_field: 'dto', negate: true }, hide_zero: true },
            ],
            { itemsSum: () => null, fieldNumber: (s) => ({ base: 1250 })[s] ?? null, resolve: (t) => t },
            { decimals: 0 },
        );
        expect(none.map((r) => [r.id, r.num, r.hidden])).toEqual([
            ['base', 1250, false],
            ['desc', 0, true],
        ]);
    });
});

describe('v0.1.292 — plantillas «Cotización» y «Factura»', () => {
    const items = {
        source: { relation_field_id: 9, direction: 'reverse' as const, list_id: 4 },
        fields: { descripcion: 'detalle', cantidad: 'cant', precio: 'precio', descuento: 'dto' },
    };

    it('las dos validan contra el schema, mapeadas o no', () => {
        for (const key of ['cotizacion', 'factura']) {
            expect(docDesignSchema.safeParse(buildDocumentStarter(key).design).success).toBe(true);
            expect(docDesignSchema.safeParse(buildDocumentStarter(key, { fields: { cliente: 'nombre' }, items }).design).success).toBe(true);
        }
        expect(DOCUMENT_STARTERS.find((s) => s.key === 'factura')!.notice).toMatch(/No es factura electrónica DIAN/);
    });

    it('cotización completa: descuento por línea + global, IVA sobre la base gravable y total exacto', () => {
        const r = buildDocumentStarter('cotizacion', {
            fields: { cliente: 'nombre', descuento_global: 'dto_global', validez: 'vence' },
            items,
            issuer: emptyIssuer('Acme'),
            tax: { iva: true, rate: 19 },
            money_decimals: 0,
        });
        const design = parseDocDesign(r.design)!;
        const out = run(
            design,
            [
                { cant: 2, precio: 150000, dto: 10 }, // 300.000 − 10 % = 270.000
                { cant: 1.5, precio: 99999, dto: null }, // 149.998,5 → 149.999
                { cant: 3, precio: 12500, dto: 0 }, // 37.500
            ],
            { dto_global: 5 },
        );
        expect(out.lines).toEqual([270000, 149999, 37500]);
        expect(out.totals).toEqual({
            subtotal: 487499, // 300.000 + 149.999 + 37.500 (brutos ya redondeados)
            descuentos: -30000,
            neto: 457499,
            descuento_global: -22875, // 5 % de 457.499 = 22.874,95
            base: 434624,
            iva: 82579, // 19 % de 434.624 = 82.578,56
            total: 517203,
        });
        // El neto es interno: no se dibuja.
        expect(out.shown).toEqual(['subtotal', 'descuentos', 'descuento_global', 'base', 'iva', 'total']);
        const json = JSON.stringify(design);
        expect(json).toContain('{{totales.total|pesos|mayusculas}} M/CTE.');
        expect(json).toContain('{{vence|larga}}');
        expect(design.numbering).toMatchObject({ enabled: true, prefix: 'COT-', freeze: false });
    });

    it('sin IVA (no responsable): sin base ni IVA, con la leyenda; y sin descuentos se ocultan sus filas', () => {
        const r = buildDocumentStarter('factura', {
            fields: { cliente: 'nombre' },
            items: { ...items, fields: { descripcion: 'detalle', cantidad: 'cant', precio: 'precio' } },
            tax: { iva: false, rate: 19 },
        });
        const design = parseDocDesign(r.design)!;
        const out = run(design, [{ cant: 4, precio: 2500 }]);
        expect(out.totals).toEqual({ subtotal: 10000, total: 10000 });
        expect(JSON.stringify(design)).toContain('no soy responsable del impuesto sobre las ventas');
        expect(design.footer.text).toMatch(/no es una factura electrónica/);
        // La factura congela por defecto.
        expect(design.numbering).toMatchObject({ enabled: true, prefix: 'FAC-', freeze: true });
    });

    it('descuento global fijo, cantidades decimales e ítems vacíos', () => {
        const design = parseDocDesign(
            buildDocumentStarter('cotizacion', {
                fields: { cliente: 'nombre' },
                items: { ...items, fields: { descripcion: 'detalle', cantidad: 'cant', precio: 'precio' } },
                global_discount_pct: 10,
                money_decimals: 2,
            }).design,
        )!;
        const out = run(design, [{ cant: 0.75, precio: 33.33 }]); // 24,9975 → 25,00
        expect(out.totals).toMatchObject({ subtotal: 25, descuento_global: -2.5, base: 22.5, iva: 4.28, total: 26.78 });
        const empty = run(design, []);
        expect(empty.totals).toMatchObject({ subtotal: 0, base: 0, iva: 0, total: 0 });
        expect(empty.shown).not.toContain('descuento_global');
    });

    it('lo que no se mapea queda como marcador visible en la tabla («[Precio unitario]»)', () => {
        const design = buildDocumentStarter('cotizacion', { items: { source: items.source, fields: { descripcion: 'detalle' } } }).design;
        const json = JSON.stringify(design);
        expect(json).toContain('[Precio unitario]');
        expect(json).toContain('[Cantidad]');
        expect(json).toContain('[Nombre del cliente]');
        // Con el precio sin mapear, la línea queda sin dato (no un cero engañoso).
        const out = run(parseDocDesign(design)!, [{ cant: 1 }]);
        expect(out.lines).toEqual([null]);
        expect(out.totals.total).toBeNull();
    });
});
