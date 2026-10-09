import { describe, expect, it } from 'vitest';

import { storeCellAccess, storeValueError } from './store-rules';
import { defaultStoreEditable, normalizeStoreEditable, storeListMarkerSchema } from './store-sync';

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
        // Nombre y SKU se PUEDEN habilitar, pero por defecto no lo están.
        const name = storeCellAccess(products, 10, row({ tipo: 'simple' }));
        expect(name.access === 'locked' && name.reason).toMatch(/habilítala/);
        expect(storeCellAccess(products, 19, row({ tipo: 'simple' })).access).toBe('locked');
        // El tipo no está en el catálogo: nunca se edita desde aquí.
        expect(storeCellAccess(products, 11, row({ tipo: 'simple' }))).toEqual({ access: 'locked', reason: 'Se edita en WooCommerce.' });
        // Un campo de otro plugin también es de la tienda (sólo lectura hasta habilitarlo).
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
        expect(storeCellAccess(customers, 7, row({ registrado: true })).access).toBe('locked');
    });

    it('columnas habilitadas por la empresa (v0.1.214)', () => {
        const chosen = { ...products, editable: ['nombre', 'sku', 'meta:30', 'precio_normal'] };
        expect(storeCellAccess(chosen, 10, row({ tipo: 'simple' })).access).toBe('editable');
        expect(storeCellAccess(chosen, 19, row({ tipo: 'variacion' })).access).toBe('editable');
        expect(storeCellAccess(chosen, 30, row({ tipo: 'simple' })).access).toBe('editable');
        // El nombre de una variación sale de su producto.
        const v = storeCellAccess(chosen, 10, row({ tipo: 'variacion' }));
        expect(v.access === 'locked' && v.reason).toMatch(/variación/);
        // Deshabilitar una de las de por defecto la bloquea.
        expect(storeCellAccess(chosen, 14, row({ tipo: 'simple', controla_stock: true })).access).toBe('locked');
        // Un slug que no está en el catálogo no se habilita aunque venga en la lista.
        const typed = { ...products, editable: ['tipo'] };
        expect(storeCellAccess(typed, 11, row({ tipo: 'simple' })).access).toBe('locked');
        // Categorías y etiquetas: del producto, no de la variación.
        const cats = storeListMarkerSchema.parse({ ...products, fields: { ...products.fields, categorias: 40 }, editable: ['categorias'] });
        expect(storeCellAccess(cats, 40, row({ tipo: 'variable' })).access).toBe('editable');
        expect(storeCellAccess(cats, 40, row({ tipo: 'variacion' })).access).toBe('locked');
    });

    it('slug del producto: se habilita, la variación no tiene; valores que WordPress no acepta (v0.1.215)', () => {
        const withSlug = storeListMarkerSchema.parse({ ...products, fields: { ...products.fields, slug_url: 41 }, editable: ['slug_url'] });
        expect(storeCellAccess(withSlug, 41, row({ tipo: 'simple' })).access).toBe('editable');
        const v = storeCellAccess(withSlug, 41, row({ tipo: 'variacion' }));
        expect(v.access === 'locked' && v.reason).toMatch(/dirección propia/);
        // Sin habilitarla, se bloquea con cómo habilitarla.
        const off = storeCellAccess({ ...withSlug, editable: null }, 41, row({ tipo: 'simple' }));
        expect(off.access === 'locked' && off.reason).toMatch(/habilítala/);
        expect(storeValueError(withSlug, 41, '', row({}))).toMatch(/vacío/);
        expect(storeValueError(withSlug, 41, 'ropa/taza', row({}))).toMatch(/«\/»/);
        expect(storeValueError(withSlug, 41, 'taza-roja', row({}))).toBeNull();
    });

    it('clientes: sólo los que tienen cuenta', () => {
        const customers = storeListMarkerSchema.parse({
            connection_id: 1,
            role: 'customers',
            write_back: true,
            fields: { nombre: 7, email: 8 },
            editable: ['nombre', 'email'],
        });
        expect(storeCellAccess(customers, 7, row({ registrado: true })).access).toBe('editable');
        const guest = storeCellAccess(customers, 7, row({ registrado: false }));
        expect(guest.access === 'locked' && guest.reason).toMatch(/invitado/);
        expect(storeValueError(customers, 8, '', row({}))).toMatch(/no puede quedar vacío/);
        expect(storeValueError(customers, 7, '  ', row({}))).toMatch(/nombre/);
    });

    it('normalizeStoreEditable: sólo catálogo y campos de plugins traídos', () => {
        expect(normalizeStoreEditable('products', ['nombre', 'tipo', 'nombre', 'meta:30', 'meta:99'], [30])).toEqual(['nombre', 'meta:30']);
        expect(defaultStoreEditable('orders')).toEqual(['estado']);
        expect(defaultStoreEditable('customers')).toEqual([]);
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
