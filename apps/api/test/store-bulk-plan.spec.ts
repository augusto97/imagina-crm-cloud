import { storeBulkOperationSchema, type StoreBulkOperationInput } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';
import { planBulkUpdate, wooMoney, type BulkPlanContext } from '../src/sync/woocommerce/woo-bulk';

const ctx = (over: Partial<BulkPlanContext> = {}): BulkPlanContext => ({
    kind: 'product',
    priceDecimals: 0,
    terms: {
        categories: new Map([
            ['tazas', 10],
            ['ofertas', 11],
            ['cocina', 12],
        ]),
        tags: new Map([['regalo', 20]]),
    },
    termNames: new Map([
        [10, 'Tazas'],
        [11, 'Ofertas'],
        [12, 'Cocina'],
        [20, 'Regalo'],
    ]),
    editable: null,
    ...over,
});
const ops = (list: StoreBulkOperationInput[]) => list.map((o) => storeBulkOperationSchema.parse(o));

const simple = {
    id: 5,
    type: 'simple',
    name: 'Taza roja',
    regular_price: '25000',
    sale_price: '',
    manage_stock: true,
    stock_quantity: 4,
    stock_status: 'instock',
    categories: [{ id: 10, name: 'Tazas', slug: 'tazas' }],
    tags: [],
    attributes: [
        { id: 1, name: 'Color', position: 0, visible: true, variation: false, options: ['Rojo'] },
    ],
    dimensions: { length: '10', width: '', height: '' },
};

describe('planBulkUpdate (edición masiva de la tienda)', () => {
    it('sube el precio un % y lo redondea al próximo terminado en 900', () => {
        const plan = planBulkUpdate(
            ops([{ op: 'regular_price', change: { kind: 'percent', amount: 10, round: { multiple: 1000, mode: 'up', adjust: -100 } } }]),
            simple,
            ctx(),
        );
        expect(plan.body).toEqual({ regular_price: '27900' });
        expect(plan.changes).toEqual([{ label: 'Precio normal', before: '25000', after: '27900' }]);
    });

    it('rebaja como % del normal ya actualizado, y el rebajado nunca queda arriba del normal', () => {
        const plan = planBulkUpdate(
            ops([
                { op: 'regular_price', change: { kind: 'set', amount: 30000 } },
                { op: 'sale_price', change: { kind: 'percent_off', amount: 20 } },
            ]),
            simple,
            ctx(),
        );
        expect(plan.body).toEqual({ regular_price: '30000', sale_price: '24000' });
        const bad = planBulkUpdate(ops([{ op: 'sale_price', change: { kind: 'set', amount: 26000 } }]), simple, ctx());
        expect(bad.body).toEqual({});
        expect(bad.notes[0]).toMatch(/rebajado quedaría igual o más alto/);
        expect(planBulkUpdate(ops([{ op: 'sale_price', change: { kind: 'clear' } }]), { ...simple, sale_price: '20000' }, ctx()).body).toEqual({
            sale_price: '',
        });
    });

    it('un producto con variaciones no tiene precio propio (va en cada variación)', () => {
        const plan = planBulkUpdate(ops([{ op: 'regular_price', change: { kind: 'add', amount: 1000 } }]), { ...simple, type: 'variable' }, ctx());
        expect(plan.body).toEqual({});
        expect(plan.notes[0]).toMatch(/cada variación/);
        // La variación sí.
        const v = planBulkUpdate(ops([{ op: 'regular_price', change: { kind: 'add', amount: 1000 } }]), { id: 9, regular_price: '12000' }, ctx({ kind: 'variation' }));
        expect(v.body).toEqual({ regular_price: '13000' });
    });

    it('stock: suma sobre lo que la tienda tiene, y no toca una variación que hereda el stock del padre', () => {
        expect(planBulkUpdate(ops([{ op: 'stock', kind: 'add', amount: 10 }]), simple, ctx()).body).toEqual({ manage_stock: true, stock_quantity: 14 });
        const inherited = planBulkUpdate(ops([{ op: 'stock', kind: 'add', amount: 10 }]), { id: 9, manage_stock: 'parent', stock_quantity: 3 }, ctx({ kind: 'variation' }));
        expect(inherited.body).toEqual({});
        expect(inherited.notes[0]).toMatch(/Hereda el stock/);
        // Con control de stock el estado lo calcula WooCommerce.
        expect(planBulkUpdate(ops([{ op: 'stock_status', value: 'outofstock' }]), simple, ctx()).body).toEqual({});
    });

    it('categorías: agregar, quitar y reemplazar mandan la lista COMPLETA', () => {
        expect(planBulkUpdate(ops([{ op: 'categories', mode: 'add', values: ['ofertas'] }]), simple, ctx()).body).toEqual({
            categories: [{ id: 10 }, { id: 11 }],
        });
        expect(planBulkUpdate(ops([{ op: 'categories', mode: 'remove', values: ['tazas'] }]), simple, ctx()).body).toEqual({ categories: [] });
        const rep = planBulkUpdate(ops([{ op: 'categories', mode: 'replace', values: ['cocina', 'ofertas'] }]), simple, ctx());
        expect(rep.body).toEqual({ categories: [{ id: 12 }, { id: 11 }] });
        expect(rep.changes[0]).toEqual({ label: 'Categorías', before: 'Tazas', after: 'Cocina, Ofertas' });
        // Ya la tiene: sin cambio.
        expect(planBulkUpdate(ops([{ op: 'categories', mode: 'add', values: ['tazas'] }]), simple, ctx()).body).toEqual({});
    });

    it('atributos: agrega valores a uno existente, crea uno nuevo y no rompe los de las variaciones', () => {
        const add = planBulkUpdate(
            ops([{ op: 'attribute', mode: 'add', attribute: { id: 1, name: 'Color' }, options: ['Azul'] }]),
            simple,
            ctx(),
        );
        expect(add.body.attributes).toEqual([{ id: 1, position: 0, visible: true, variation: false, options: ['Rojo', 'Azul'] }]);
        const custom = planBulkUpdate(
            ops([{ op: 'attribute', mode: 'add', attribute: { name: 'Material' }, options: ['Cerámica'] }]),
            simple,
            ctx(),
        );
        expect(custom.body.attributes).toEqual([
            { id: 1, position: 0, visible: true, variation: false, options: ['Rojo'] },
            { name: 'Material', position: 1, visible: true, variation: false, options: ['Cerámica'] },
        ]);
        const usedByVariations = { ...simple, attributes: [{ id: 2, name: 'Talla', position: 0, visible: true, variation: true, options: ['S', 'M'] }] };
        const rm = planBulkUpdate(ops([{ op: 'attribute', mode: 'remove', attribute: { id: 2, name: 'Talla' } }]), usedByVariations, ctx());
        expect(rm.body).toEqual({});
        expect(rm.notes[0]).toMatch(/lo usan las variaciones/);
    });

    it('respeta las columnas que la empresa no dejó editar', () => {
        const plan = planBulkUpdate(
            ops([
                { op: 'regular_price', change: { kind: 'add', amount: 1 } },
                { op: 'featured', value: true },
            ]),
            simple,
            ctx({ editable: new Set(['stock']) }),
        );
        // El precio no (columna no habilitada); destacado no es una columna del catálogo: sí.
        expect(plan.body).toEqual({ featured: true });
        expect(plan.notes[0]).toMatch(/precio_normal/);
    });

    it('envío, nombre y medidas; las operaciones de producto se saltean en una variación', () => {
        const plan = planBulkUpdate(
            ops([
                { op: 'name', kind: 'append', text: ' (edición limitada)' },
                { op: 'dimensions', width: 8 },
                { op: 'shipping_class', value: 'fragil' },
                { op: 'weight', value: 0.35 },
            ]),
            simple,
            ctx(),
        );
        expect(plan.body).toEqual({
            name: 'Taza roja (edición limitada)',
            dimensions: { length: '10', width: '8', height: '' },
            shipping_class: 'fragil',
            weight: '0.35',
        });
        expect(planBulkUpdate(ops([{ op: 'featured', value: true }]), { id: 9 }, ctx({ kind: 'variation' })).body).toEqual({});
    });

    it('formatea precios como los espera la API', () => {
        expect(wooMoney(12.5, 2)).toBe('12.5');
        expect(wooMoney(12.499, 2)).toBe('12.5');
        expect(wooMoney(25900, 0)).toBe('25900');
    });
});
