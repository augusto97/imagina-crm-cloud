import { describe, expect, it } from 'vitest';

import { storeDraftDefaults, storeDraftToOperation } from './storeBulkMeta';

describe('storeDraftToOperation', () => {
    it('precio: % hacia abajo con redondeo a terminados en 900', () => {
        const r = storeDraftToOperation(
            { key: 'a', op: 'regular_price', ...storeDraftDefaults('regular_price'), amount: '15', direction: 'down', round: true },
            'dot_comma',
        );
        expect(r.ok && r.operation).toEqual({
            op: 'regular_price',
            change: { kind: 'percent', amount: -15, round: { multiple: 1000, mode: 'up', adjust: -100 } },
        });
    });

    it('rebajado: descuento sobre el normal, y sacar la rebaja', () => {
        const r = storeDraftToOperation({ key: 'a', op: 'sale_price', kind: 'percent_off', amount: '20' }, 'comma_dot');
        expect(r.ok && r.operation).toEqual({ op: 'sale_price', change: { kind: 'percent_off', amount: 20 } });
        const c = storeDraftToOperation({ key: 'a', op: 'sale_price', kind: 'clear' }, 'comma_dot');
        expect(c.ok && c.operation).toEqual({ op: 'sale_price', change: { kind: 'clear', amount: 0 } });
    });

    it('stock entero, atributos con valores y medidas parciales', () => {
        expect(storeDraftToOperation({ key: 'a', op: 'stock', kind: 'add', amount: '2,5' }, 'dot_comma')).toMatchObject({ ok: false });
        const a = storeDraftToOperation({ key: 'a', op: 'attribute', mode: 'add', attributeId: 1, attributeName: 'Color', values: ['Rojo'], visible: true });
        expect(a.ok && a.operation).toEqual({ op: 'attribute', mode: 'add', attribute: { id: 1, name: 'Color' }, options: ['Rojo'], visible: true });
        const d = storeDraftToOperation({ key: 'a', op: 'dimensions', width: '8,5' }, 'dot_comma');
        expect(d.ok && d.operation).toEqual({ op: 'dimensions', width: 8.5 });
    });

    it('explica lo que falta', () => {
        expect(storeDraftToOperation({ key: 'a', op: null })).toMatchObject({ ok: false });
        expect(storeDraftToOperation({ key: 'a', op: 'categories', mode: 'add', values: [] })).toMatchObject({ ok: false });
        expect(storeDraftToOperation({ key: 'a', op: 'attribute', mode: 'add', attributeName: '', values: [] })).toMatchObject({ ok: false });
        expect(storeDraftToOperation({ key: 'a', op: 'meta', metaKey: '' })).toMatchObject({ ok: false });
    });

    it('v0.1.223 — precio desde una columna: costo × 1,35 con punto de miles y redondeo', () => {
        const r = storeDraftToOperation(
            { key: 'a', op: 'price_from_field', ...storeDraftDefaults('price_from_field'), sourceFieldId: 7, factor: '1,35', amount: '1.000', round: true },
            'dot_comma',
        );
        expect(r.ok && r.operation).toEqual({
            op: 'price_from_field',
            price: 'regular',
            field_id: 7,
            factor: 1.35,
            add: 1000,
            round: { multiple: 1000, mode: 'up', adjust: -100 },
        });
        expect(storeDraftToOperation({ key: 'a', op: 'price_from_field', ...storeDraftDefaults('price_from_field') }, 'comma_dot').ok).toBe(false);
    });
});
