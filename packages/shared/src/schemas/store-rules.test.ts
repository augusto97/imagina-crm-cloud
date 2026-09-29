import { describe, expect, it } from 'vitest';

import { storeCellAccess, storeValueError } from './store-rules';
import { storeListMarkerSchema } from './store-sync';

const products = storeListMarkerSchema.parse({
    connection_id: 1,
    role: 'products',
    write_back: true,
    fields: {
        nombre: 10,
        tipo: 11,
        precio_normal: 12,
        precio_rebajado: 13,
        stock: 14,
        controla_stock: 15,
        estado_stock: 16,
        umbral_stock: 17,
        estado: 18,
        sku: 19,
    },
    meta_fields: [30],
});
const row = (v: Record<string, unknown>) => (slug: string) => v[slug];

describe('storeCellAccess', () => {
    it('columnas propias: libres; de la tienda no editables: bloqueadas', () => {
        expect(storeCellAccess(products, 99, row({})).access).toBe('own');
        expect(storeCellAccess(products, 10, row({ tipo: 'simple' }))).toEqual({ access: 'locked', reason: 'Se edita en WooCommerce.' });
        expect(storeCellAccess(products, 19, row({ tipo: 'simple' })).access).toBe('locked');
        // Un campo de otro plugin también es de la tienda (sólo lectura).
        expect(storeCellAccess(products, 30, row({ tipo: 'simple' })).access).toBe('locked');
    });

    it('sin «Editar desde la app» todo lo de la tienda queda bloqueado', () => {
        const ro = { ...products, write_back: false };
        const r = storeCellAccess(ro, 12, row({ tipo: 'simple' }));
        expect(r.access).toBe('locked');
        expect(r.access === 'locked' && r.reason).toMatch(/Editar desde la app/);
    });

    it('producto con variaciones: sin precio ni stock propios', () => {
        const v = row({ tipo: 'variable' });
        expect(storeCellAccess(products, 12, v).access).toBe('locked');
        expect(storeCellAccess(products, 14, v).access).toBe('locked');
        expect(storeCellAccess(products, 15, v).access).toBe('locked');
        expect(storeCellAccess(products, 18, v).access).toBe('editable');
    });

    it('variación y simple: precio sí; stock sólo si se controla; estado del stock sólo si NO', () => {
        for (const tipo of ['simple', 'variacion']) {
            expect(storeCellAccess(products, 12, row({ tipo })).access).toBe('editable');
            expect(storeCellAccess(products, 14, row({ tipo, controla_stock: false })).access).toBe('locked');
            expect(storeCellAccess(products, 14, row({ tipo, controla_stock: true })).access).toBe('editable');
            expect(storeCellAccess(products, 16, row({ tipo, controla_stock: true })).access).toBe('locked');
            expect(storeCellAccess(products, 16, row({ tipo, controla_stock: false })).access).toBe('editable');
        }
    });

    it('pedidos: el estado del pedido sí, el de una línea no; clientes: nada', () => {
        const orders = storeListMarkerSchema.parse({ connection_id: 1, role: 'orders', write_back: true, fields: { estado: 5, total: 6 } });
        expect(storeCellAccess(orders, 5, row({ tipo: 'pedido' })).access).toBe('editable');
        expect(storeCellAccess(orders, 5, row({ tipo: 'linea' })).access).toBe('locked');
        expect(storeCellAccess(orders, 6, row({ tipo: 'pedido' })).access).toBe('locked');
        const customers = storeListMarkerSchema.parse({ connection_id: 1, role: 'customers', write_back: true, fields: { email: 7 } });
        expect(storeCellAccess(customers, 7, row({})).access).toBe('locked');
    });
});

describe('storeValueError', () => {
    it('precios: no negativos y el rebajado menor que el normal', () => {
        expect(storeValueError(products, 12, -1, row({}))).toMatch(/mayor o igual a 0/);
        expect(storeValueError(products, 13, 50, row({ precio_normal: 40 }))).toMatch(/menor que el normal/);
        expect(storeValueError(products, 12, 30, row({ precio_rebajado: 35 }))).toMatch(/mayor que el rebajado/);
        expect(storeValueError(products, 13, null, row({ precio_normal: 40 }))).toBeNull();
        expect(storeValueError(products, 12, 45, row({ precio_rebajado: 40 }))).toBeNull();
    });

    it('stock entero y no vacío; estados que la tienda acepta', () => {
        expect(storeValueError(products, 14, 2.5, row({}))).toMatch(/entero/);
        expect(storeValueError(products, 14, null, row({}))).toMatch(/no puede quedar vacío/);
        expect(storeValueError(products, 18, 'trash', row({}))).toMatch(/papelera/);
        expect(storeValueError(products, 18, 'draft', row({}))).toBeNull();
        const orders = storeListMarkerSchema.parse({ connection_id: 1, role: 'orders', write_back: true, fields: { estado: 5 } });
        expect(storeValueError(orders, 5, 'checkout-draft', row({}))).toMatch(/lo pone la tienda/);
        expect(storeValueError(orders, 5, 'completed', row({}))).toBeNull();
    });
});
