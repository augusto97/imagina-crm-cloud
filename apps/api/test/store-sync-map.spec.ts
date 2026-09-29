import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { emptyMaps, remapSyncSettings } from '../src/platform/tenant-transfer.remap';
import { readSettings, readState } from '../src/sync/store-sync.types';
import { buildWooPack, IDENTITY_FIELD_SLUGS, INVENTORY_FIELD_SLUGS, packAddition, PURCHASE_LIST_KEYS, RESTOCK_FIELD_SLUGS, WOO_LIST_KEYS } from '../src/sync/woocommerce/woo-pack';
import { orderSeq, pendingOf, receiveTarget, suggestQuantity } from '../src/sync/store-purchasing.service';
import {
    buildWriteBack,
    isVariationPayload,
    isWooPing,
    metaOut,
    parseWooTopic,
    verifyWooSignature,
    wooHookTopics,
} from '../src/sync/woocommerce/woo-hooks';
import {
    coerceMeta,
    customerFromOrder,
    inventoryState,
    inventoryValue,
    lowStockThreshold,
    managesStock,
    customerRefForOrder,
    mapCustomer,
    mapLineItems,
    mapOrder,
    mapProduct,
    mapVariation,
    metaOf,
    metaSample,
    suggestMetaType,
    wooDate,
    wooNumber,
} from '../src/sync/woocommerce/woo-map';

/**
 * v0.1.206 — lo que decide el mapeo WooCommerce → pack, sin base ni red:
 * clientes invitados, productos variables, fechas, meta de otros plugins, los
 * lectores tolerantes del estado y el re-mapeo al migrar una empresa.
 */

const order = {
    id: 501,
    number: '501',
    status: 'processing',
    date_created_gmt: '2026-06-01T15:04:05',
    date_modified_gmt: '2026-06-02T10:00:00',
    total: '48000.00',
    shipping_total: '8000',
    discount_total: '0',
    total_tax: '0',
    currency: 'COP',
    payment_method: 'bacs',
    payment_method_title: 'Transferencia',
    customer_id: 0,
    customer_note: '',
    billing: { first_name: 'Ana', last_name: 'Gómez', email: ' Ana@Correo.CO ', phone: '+573001112233', city: 'Medellín', country: 'CO', address_1: 'Cra 1', address_2: '' },
    coupon_lines: [{ code: 'VERANO' }],
    meta_data: [{ key: 'nit', value: '900123' }, { key: '_wc_order_attribution', value: 'x' }, { key: 'nit', value: '900999' }],
    line_items: [
        { id: 9001, name: 'Taza', product_id: 10, variation_id: 0, quantity: 2, subtotal: '40000', total: '40000', price: 20000, sku: 'TAZA' },
        { id: 9002, name: 'Camiseta', product_id: 20, variation_id: 22, quantity: 1, subtotal: '0', total: '0', price: 0, sku: '' },
    ],
};

describe('Mapeo WooCommerce → pack (puro)', () => {
    it('números y fechas de la API', () => {
        expect(wooNumber('25000.00')).toBe(25000);
        expect(wooNumber('')).toBeNull();
        expect(wooNumber('abc')).toBeNull();
        expect(wooNumber(3)).toBe(3);
        expect(wooDate('2026-06-01T15:04:05')).toBe('2026-06-01T15:04:05Z');
        expect(wooDate('2026-06-01 15:04:05')).toBe('2026-06-01T15:04:05Z');
        expect(wooDate(null)).toBeNull();
        expect(wooDate('ayer')).toBeNull();
    });

    it('un pedido de INVITADO pertenece a su email (normalizado); uno registrado, a su id', () => {
        expect(customerRefForOrder(order)).toEqual({ resource: 'customers', externalId: 'email:ana@correo.co' });
        expect(customerRefForOrder({ ...order, customer_id: 7 })).toEqual({ resource: 'customers', externalId: 'id:7' });
        expect(customerRefForOrder({ customer_id: 0, billing: {} })).toBeNull();

        const guest = customerFromOrder(order)!;
        expect(guest.externalId).toBe('email:ana@correo.co');
        expect(guest.values).toMatchObject({ nombre: 'Ana Gómez', registrado: false, woo_id: null, fecha_alta: '2026-06-01T15:04:05Z' });
        const reg = customerFromOrder({ ...order, customer_id: 7 })!;
        // Un registrado que se crea desde el pedido NO inventa su fecha de alta.
        expect(reg.values).toMatchObject({ registrado: true, woo_id: '7', fecha_alta: undefined });
    });

    it('cliente registrado: nombre con fallback y meta con la última clave repetida', () => {
        const c = mapCustomer({
            id: 3,
            email: '',
            first_name: '',
            last_name: '',
            date_created_gmt: '2025-01-02T03:04:05',
            billing: { email: 'x@y.co', first_name: 'Luis', last_name: '', city: 'Cali' },
            meta_data: [{ key: 'documento', value: '1' }, { key: 'documento', value: '2' }],
        });
        expect(c.externalId).toBe('id:3');
        expect(c.values).toMatchObject({ nombre: 'Luis', email: 'x@y.co', ciudad: 'Cali', registrado: true, woo_id: '3' });
        expect(c.meta).toEqual({ documento: '2' });
    });

    it('producto: categorías como opciones, stock sólo si se administra, estados de plugins como opción', () => {
        const p = mapProduct({
            id: 20,
            name: 'Camiseta',
            type: 'variable',
            status: 'publish',
            price: '30000',
            stock_status: 'wc-backorder-custom',
            manage_stock: false,
            stock_quantity: 99,
            categories: [{ name: 'Ropa', slug: 'ropa' }, { name: '', slug: 'x' }],
            images: [{ src: 'https://t.co/a.jpg' }],
            meta_data: [{ key: 'garantia_meses', value: '3' }],
        });
        expect(p.values).toMatchObject({ nombre: 'Camiseta', tipo: 'variable', precio: 30000, stock: null, categorias: ['ropa'], imagen: 'https://t.co/a.jpg' });
        expect(p.options.categorias).toEqual([{ value: 'ropa', label: 'Ropa' }]);
        expect(p.options.estado_stock).toEqual([{ value: 'wc-backorder-custom', label: 'Backorder custom' }]);
        expect(p.meta).toEqual({ garantia_meses: '3' });
    });

    it('variación: registro propio vinculado al padre, con el nombre «Padre — opciones»', () => {
        const v = mapVariation(
            { id: 22, parent_id: 20, price: '32000', manage_stock: true, stock_quantity: 4, attributes: [{ name: 'Color', option: 'Rojo' }, { name: 'Talla', option: 'M' }] },
            { id: 20, name: 'Camiseta' },
        );
        expect(v.parentExternalId).toBe('20');
        expect(v.relations.producto).toEqual({ resource: 'products', externalId: '20' });
        expect(v.values).toMatchObject({ nombre: 'Camiseta — Rojo / M', atributos: 'Color: Rojo · Talla: M', stock: 4, precio: 32000 });
    });

    it('pedido y líneas: la línea apunta al pedido, al producto Y a la variación', () => {
        const o = mapOrder(order, 'https://tienda.test/');
        expect(o.values).toMatchObject({
            numero: '#501',
            total: 48000,
            subtotal: 40000,
            cupones: 'VERANO',
            metodo_pago: 'Transferencia',
            enlace: 'https://tienda.test/wp-admin/post.php?post=501&action=edit',
        });
        expect(o.relations.cliente).toEqual({ resource: 'customers', externalId: 'email:ana@correo.co' });
        expect(o.meta.nit).toBe('900999');

        const lines = mapLineItems(order);
        expect(lines).toHaveLength(2);
        expect(lines[0]!.parentExternalId).toBe('501');
        expect(lines[0]!.relations).toEqual({
            pedido: { resource: 'orders', externalId: '501' },
            producto: { resource: 'products', externalId: '10' },
            variacion: null,
        });
        expect(lines[1]!.relations.variacion).toEqual({ resource: 'variations', externalId: '22' });
        expect(lines[1]!.values).toMatchObject({ cantidad: 1, estado_pedido: 'processing', fecha: '2026-06-01T15:04:05Z' });
    });

    it('meta de otros plugins: tipo sugerido, ejemplo corto y coerción al tipo del campo', () => {
        expect(metaOf({ meta_data: 'no es lista' })).toEqual({});
        expect(suggestMetaType('12')).toBe('number');
        expect(suggestMetaType('yes')).toBe('checkbox');
        expect(suggestMetaType('2026-01-02')).toBe('date');
        expect(suggestMetaType('https://x.co')).toBe('url');
        expect(suggestMetaType({ a: 1 })).toBe('long_text');
        expect(suggestMetaType('texto corto')).toBe('text');
        expect(metaSample('x'.repeat(100))!.length).toBe(78);
        expect(metaSample('')).toBeNull();

        expect(coerceMeta('3', 'number')).toBe(3);
        expect(coerceMeta('tres', 'number')).toBeUndefined();
        expect(coerceMeta('yes', 'checkbox')).toBe(true);
        expect(coerceMeta('no', 'checkbox')).toBe(false);
        expect(coerceMeta('2026-01-02 10:00', 'date')).toBe('2026-01-02');
        expect(coerceMeta('javascript:alert(1)', 'url')).toBeUndefined();
        // Un objeto de ACF se guarda como JSON en un texto: se ve y se busca.
        expect(coerceMeta({ material: 'cerámica' }, 'long_text')).toBe('{"material":"cerámica"}');
        expect(coerceMeta('', 'text')).toBeNull();
    });
});

describe('Pack de la tienda', () => {
    it('cinco listas de la tienda + tres de compras, con sus dos tableros y la moneda de la tienda', () => {
        const bp = buildWooPack({ storeName: 'Tienda', currency: 'COP', precision: 0, phoneCountry: 'CO' });
        expect(bp.lists.map((l) => l.key)).toEqual([...Object.values(WOO_LIST_KEYS), ...Object.values(PURCHASE_LIST_KEYS)]);
        for (const l of bp.lists.filter((x) => (Object.values(WOO_LIST_KEYS) as string[]).includes(x.key))) {
            // Cada lista tiene su woo_id indexado: es por donde se busca al sincronizar.
            const woo = l.fields.find((f) => f.slug === 'woo_id');
            expect(woo, l.key).toBeDefined();
            expect(woo!.is_indexed, l.key).toBe(true);
        }
        // Ventas + inventario (v0.1.208).
        expect(bp.dashboards?.map((d) => d.name)).toEqual(['Ventas · Tienda', 'Inventario · Tienda']);
        const productos = bp.lists.find((l) => l.key === 'productos')!;
        expect(productos.fields.find((f) => f.slug === 'precio')!.config).toMatchObject({ currency: 'COP', precision: 0 });
    });
});

describe('Estado de la sincronización (lectores tolerantes)', () => {
    it('un jsonb vacío, viejo o con basura no tira el motor', () => {
        const s = readSettings({ resources: { orders: false }, interval_minutes: 'x', lists: { products: 5, bogus: 3, orders: -1 }, fields: { products: { nombre: '7', malo: 'x' } } });
        expect(s.resources).toEqual({ customers: true, products: true, orders: false });
        expect(s.interval_minutes).toBe(15);
        expect(s.mode).toBe('interval');
        expect(s.lists).toEqual({ products: 5 });
        expect(s.fields.products).toEqual({ nombre: 7 });

        const st = readState({ running: 'sí', cursors: { orders: { at: '2026-01-01T00:00:00', ids: [1, 2] }, products: { at: '' } }, realtime: { webhook_ids: [3, 'x', -1] } });
        expect(st.running).toBe(false);
        expect(st.cursors).toEqual({ products: null, orders: { at: '2026-01-01T00:00:00', ids: ['1', '2'] } });
        expect(st.realtime.webhook_ids).toEqual([3]);
        expect(readState(null).initial_done).toBe(false);
    });

    it('al migrar una empresa, las listas, campos y meta apuntan a los ids NUEVOS', () => {
        const maps = emptyMaps();
        maps.list.set(1, 101).set(2, 102);
        maps.field.set(10, 110).set(11, 111);
        const out = remapSyncSettings(
            {
                store_url: 'https://t.co',
                lists: { products: 1, orders: 2, customers: 99 },
                fields: { products: { nombre: 10, huerfano: 55 } },
                meta_map: { products: { garantia: 11 } },
                folder_id: 4,
                dashboard_id: 8,
            },
            maps,
            new Map([[4, 40]]),
        );
        expect(out.lists).toEqual({ products: 101, orders: 102 });
        expect(out.fields).toEqual({ products: { nombre: 110 } });
        expect(out.meta_map).toEqual({ products: { garantia: 111 } });
        expect(out.folder_id).toBe(40);
        expect(out.dashboard_id).toBeNull();
        expect(out.store_url).toBe('https://t.co');
    });
});

describe('Tiempo real y edición en los dos sentidos (puros, v0.1.207)', () => {
    it('temas según lo que se trae, y parseo de temas', () => {
        expect(wooHookTopics({ resources: { customers: false, products: false, orders: true } })).toEqual([
            'order.created',
            'order.updated',
            'order.deleted',
            'order.restored',
        ]);
        expect(wooHookTopics({ resources: { customers: true, products: true, orders: true } })).toHaveLength(10);
        expect(parseWooTopic('product.updated')).toEqual({ resource: 'product', event: 'updated' });
        expect(parseWooTopic('coupon.created')).toBeNull();
        expect(parseWooTopic(undefined)).toBeNull();
    });

    it('firma: HMAC-SHA256 en base64 sobre el cuerpo CRUDO, en tiempo constante', () => {
        const raw = '{"id":1, "status":"completed"}';
        const sig = createHmac('sha256', 's3cr3t').update(raw).digest('base64');
        expect(verifyWooSignature('s3cr3t', raw, sig)).toBe(true);
        // Re-serializar el JSON (sin el espacio) ya no coincide.
        expect(verifyWooSignature('s3cr3t', JSON.stringify(JSON.parse(raw)), sig)).toBe(false);
        expect(verifyWooSignature('otro', raw, sig)).toBe(false);
        expect(verifyWooSignature('s3cr3t', raw, undefined)).toBe(false);
        expect(verifyWooSignature('s3cr3t', raw, 'no-es-base64-valido!!')).toBe(false);
        expect(verifyWooSignature('', raw, sig)).toBe(false);
    });

    it('ping y variaciones por su forma', () => {
        expect(isWooPing(undefined, 'webhook_id=12')).toBe(true);
        expect(isWooPing('', { webhook_id: '12' })).toBe(true);
        expect(isWooPing('order.created', { webhook_id: '12' })).toBe(false);
        expect(isVariationPayload({ id: 21, parent_id: 20, type: 'variation' })).toBe(true);
        expect(isVariationPayload({ id: 21, parent_id: 20 })).toBe(true);
        expect(isVariationPayload({ id: 20, parent_id: 0, type: 'variable', variations: [21] })).toBe(false);
    });

    it('producto: sólo lo que cambió, rebaja vaciada = sin rebaja, stock vaciado = no se administra', () => {
        expect(
            buildWriteBack({ resource: 'products', externalId: '20', parentExternalId: null, changed: { precio_normal: 35000 }, meta: [] }),
        ).toEqual({ path: '/products/20', body: { regular_price: '35000' }, fields: ['Precio normal'] });
        const r = buildWriteBack({
            resource: 'products',
            externalId: '20',
            parentExternalId: null,
            changed: { precio_rebajado: null, stock: null, nombre: '   ', categorias: ['x'] },
            meta: [],
        })!;
        expect(r.body).toEqual({ sale_price: '', manage_stock: false });
        // Un nombre vacío no se manda (la tienda lo exige) y una columna fuera del catálogo tampoco.
        expect(r.fields).toEqual(['Precio rebajado', 'Stock']);
        // Una columna propia de la app: nada que mandar.
        expect(buildWriteBack({ resource: 'products', externalId: '20', parentExternalId: null, changed: { responsable: 3 }, meta: [] })).toBeNull();
    });

    it('variación, pedido y cliente van a su ruta; el invitado no tiene a quién', () => {
        expect(buildWriteBack({ resource: 'variations', externalId: '22', parentExternalId: '20', changed: { stock: 7.9 }, meta: [] })).toMatchObject({
            path: '/products/20/variations/22',
            body: { manage_stock: true, stock_quantity: 7 },
        });
        expect(buildWriteBack({ resource: 'variations', externalId: '22', parentExternalId: null, changed: { stock: 1 }, meta: [] })).toBeNull();
        expect(buildWriteBack({ resource: 'orders', externalId: '501', parentExternalId: null, changed: { estado: 'completed', total: 9 }, meta: [] })).toEqual({
            path: '/orders/501',
            body: { status: 'completed' },
            fields: ['Estado'],
        });
        expect(buildWriteBack({ resource: 'customers', externalId: 'id:2', parentExternalId: null, changed: { telefono: '+57300', ciudad: 'Cali' }, meta: [] })).toMatchObject({
            path: '/customers/2',
            body: { billing: { phone: '+57300', city: 'Cali' } },
        });
        expect(buildWriteBack({ resource: 'customers', externalId: 'email:a@b.co', parentExternalId: null, changed: { telefono: '1' }, meta: [] })).toBeNull();
    });

    it('campos de otros plugins: sí/no con la convención que ya usaba la tienda, JSON como objeto', () => {
        expect(metaOut(true, 'yes')).toBe('yes');
        expect(metaOut(false, 'no')).toBe('no');
        expect(metaOut(true, '1')).toBe('1');
        expect(metaOut(false, null)).toBe('0');
        expect(metaOut(12, null)).toBe('12');
        expect(metaOut('{"a":1}', null)).toEqual({ a: 1 });
        expect(metaOut('{roto', null)).toBe('{roto');
        expect(metaOut(null, null)).toBe('');
        const r = buildWriteBack({
            resource: 'products',
            externalId: '10',
            parentExternalId: null,
            changed: {},
            meta: [{ key: 'garantia_meses', value: 24, sample: '12' }],
        })!;
        expect(r.body).toEqual({ meta_data: [{ key: 'garantia_meses', value: '24' }] });
    });
});

describe('Inventario (puros, v0.1.208)', () => {
    it('lleva stock si la tienda lo cuenta, incluida la variación que lo cuenta en el padre', () => {
        expect(managesStock({ manage_stock: true })).toBe(true);
        expect(managesStock({ manage_stock: 'parent' })).toBe(true);
        expect(managesStock({ manage_stock: false })).toBe(false);
        expect(managesStock({})).toBe(false);
    });

    it('umbral: el del producto (0 incluido) o el general de la tienda o el default de WooCommerce', () => {
        expect(lowStockThreshold({ low_stock_amount: 10 }, 5)).toBe(10);
        expect(lowStockThreshold({ low_stock_amount: 0 }, 5)).toBe(0);
        expect(lowStockThreshold({ low_stock_amount: null }, 5)).toBe(5);
        expect(lowStockThreshold({ low_stock_amount: '' }, null)).toBe(2);
    });

    it('estado: agotado / bajo / en stock / por encargo / sin control', () => {
        expect(inventoryState({ manage_stock: true, stock_quantity: 0, stock_status: 'outofstock' }, 5)).toBe('agotado');
        expect(inventoryState({ manage_stock: true, stock_quantity: -2, stock_status: 'outofstock' }, 5)).toBe('agotado');
        expect(inventoryState({ manage_stock: true, stock_quantity: 5 }, 5)).toBe('bajo');
        expect(inventoryState({ manage_stock: true, stock_quantity: 6 }, 5)).toBe('en_stock');
        // Sin unidades pero con reservas permitidas se sigue vendiendo.
        expect(inventoryState({ manage_stock: true, stock_quantity: 0, backorders: 'notify', stock_status: 'onbackorder' }, 5)).toBe('por_encargo');
        expect(inventoryState({ manage_stock: false, stock_status: 'outofstock' }, 5)).toBe('agotado');
        expect(inventoryState({ manage_stock: false, stock_status: 'onbackorder' }, 5)).toBe('por_encargo');
        expect(inventoryState({ manage_stock: false, stock_status: 'instock' }, 5)).toBe('sin_control');
        expect(inventoryState({ manage_stock: false, stock_status: 'instock', type: 'variable' }, 5)).toBe('por_variacion');
    });

    it('valor en stock = unidades × precio; sin control no hay valor; sin unidades vale 0', () => {
        expect(inventoryValue({ manage_stock: true, stock_quantity: 3, price: '19999.99' })).toBe(59999.97);
        expect(inventoryValue({ manage_stock: true, stock_quantity: 0, price: '100' })).toBe(0);
        expect(inventoryValue({ manage_stock: false, stock_quantity: 3, price: '100' })).toBeNull();
        expect(inventoryValue({ manage_stock: true, stock_quantity: 3, price: '' })).toBeNull();
    });

    it('el mapeo usa el umbral general de la tienda cuando el producto no trae el suyo', () => {
        const p = mapProduct({ id: 1, manage_stock: true, stock_quantity: 4, price: '10', stock_status: 'instock' }, { lowStockDefault: 5 });
        expect(p.values).toMatchObject({ controla_stock: true, umbral_stock: null, estado_inventario: 'bajo', valor_inventario: 40 });
        const v = mapVariation({ id: 2, manage_stock: 'parent', stock_quantity: 9, price: '5' }, { id: 1, name: 'X' }, { lowStockDefault: 5 });
        expect(v.values).toMatchObject({ stock: 9, estado_inventario: 'en_stock', valor_inventario: 45 });
    });

    it('la edición en dos sentidos manda el umbral y el control de stock', () => {
        expect(
            buildWriteBack({ resource: 'products', externalId: '1', parentExternalId: null, changed: { umbral_stock: 7.6, controla_stock: true }, meta: [] })!.body,
        ).toEqual({ low_stock_amount: 7, manage_stock: true });
        // Vaciar el umbral = volver al general de la tienda.
        expect(
            buildWriteBack({ resource: 'variations', externalId: '2', parentExternalId: '1', changed: { umbral_stock: null }, meta: [] })!.body,
        ).toEqual({ low_stock_amount: null });
        // El estado de inventario es DERIVADO: no viaja.
        expect(buildWriteBack({ resource: 'products', externalId: '1', parentExternalId: null, changed: { estado_inventario: 'bajo' }, meta: [] })).toBeNull();
    });

    it('la actualización del pack agrega SÓLO lo que falta, derivado del pack completo', () => {
        const full = buildWooPack({ storeName: 'T', currency: 'COP', precision: 0, phoneCountry: null });
        // Desde el pack 1: inventario + reposición + las listas de compras.
        const add = packAddition(full, 1, true);
        expect(add.lists.map((l) => l.key)).toEqual(['clientes', 'productos', 'variaciones', 'proveedores', 'compras', 'lineas_compra']);
        const inv = add.lists.filter((l) => l.key === 'productos' || l.key === 'variaciones');
        for (const l of inv) {
            const allowed = [...INVENTORY_FIELD_SLUGS, ...RESTOCK_FIELD_SLUGS, ...(IDENTITY_FIELD_SLUGS[l.key] ?? [])];
            expect(l.fields.every((fd) => allowed.includes(fd.slug))).toBe(true);
            expect(l.views.map((v) => v.name)).toEqual(['Para reponer']);
        }
        expect(inv[0]!.fields.map((fd) => fd.slug)).toContain('stock_variaciones');
        expect(inv[1]!.fields.map((fd) => fd.slug)).not.toContain('stock_variaciones');
        expect(add.dashboards).toHaveLength(1);
        expect(add.dashboards[0]!.name).toBe('Inventario · T');
        // Desde el pack 2: sólo reposición (sin vistas ni tableros repetidos).
        const add2 = packAddition(full, 2, true);
        expect(add2.dashboards).toHaveLength(0);
        expect(add2.lists.find((l) => l.key === 'productos')!.fields.map((fd) => fd.slug).sort()).toEqual(
            [...RESTOCK_FIELD_SLUGS, ...IDENTITY_FIELD_SLUGS.productos!].sort(),
        );
        expect(add2.lists.find((l) => l.key === 'productos')!.views).toHaveLength(0);
        expect(add2.lists.find((l) => l.key === PURCHASE_LIST_KEYS.lines)!.fields.length).toBeGreaterThan(8);
        // Al día: nada. Sin ninguna lista: nada.
        expect(packAddition(full, 4, true).lists).toHaveLength(0);
        expect(packAddition(full, 1, false).lists).toHaveLength(0);
    });

    it('pack 3 → 4: sólo los identificadores, y sólo en las listas que existen', () => {
        const full = buildWooPack({ storeName: 'T', currency: 'COP', precision: 0, phoneCountry: null });
        const add = packAddition(full, 3, true);
        const byKey = Object.fromEntries(add.lists.map((l) => [l.key, l.fields.map((fd) => fd.slug).sort()]));
        expect(byKey).toEqual({
            clientes: ['editar'],
            productos: ['editar'],
            variaciones: ['editar', 'enlace'],
            lineas_compra: ['sku'],
        });
        expect(add.dashboards).toHaveLength(0);
        expect(add.lists.every((l) => l.views.length === 0)).toBe(true);
        // Una tienda que no trae clientes NO gana una lista de Clientes vacía.
        const noCustomers = packAddition(full, 3, new Set(['productos', 'variaciones', 'pedidos', 'lineas']));
        expect(noCustomers.lists.map((l) => l.key)).toEqual(['productos', 'variaciones']);
        // Sin productos igual llegan los identificadores de los clientes.
        expect(packAddition(full, 3, new Set(['clientes', 'pedidos'])).lists.map((l) => l.key)).toEqual(['clientes']);
        // Las imágenes del pack se muestran como miniatura.
        for (const key of ['productos', 'variaciones']) {
            const img = full.lists.find((l) => l.key === key)!.fields.find((fd) => fd.slug === 'imagen')!;
            expect(img.config).toEqual({ display: 'image' });
        }
    });

    it('enlaces para identificar: editar en el panel, enlace de la variación', () => {
        const store = 'https://tienda.test/';
        const p = mapProduct({ id: 12, name: 'Taza', permalink: 'https://tienda.test/p/taza' }, { storeUrl: store });
        expect(p.values.editar).toBe('https://tienda.test/wp-admin/post.php?post=12&action=edit');
        expect(p.values.enlace).toBe('https://tienda.test/p/taza');
        // La variación se edita dentro de su producto.
        const v = mapVariation({ id: 21, permalink: 'https://tienda.test/p/cam?attribute_color=rojo' }, { id: 20, name: 'Camiseta' }, { storeUrl: store });
        expect(v.values.editar).toBe('https://tienda.test/wp-admin/post.php?post=20&action=edit');
        expect(v.values.enlace).toBe('https://tienda.test/p/cam?attribute_color=rojo');
        const c = mapCustomer({ id: 7, email: 'a@b.co' }, store);
        expect(c.values.editar).toBe('https://tienda.test/wp-admin/user-edit.php?user_id=7');
        // Sin la dirección de la tienda no se inventa un enlace.
        expect(mapProduct({ id: 12, name: 'Taza' }).values.editar).toBeNull();
        expect(mapCustomer({ id: 7 }).values.editar).toBeNull();
    });

    it('el pack trae las listas de compras vinculadas a productos y variaciones', () => {
        const full = buildWooPack({ storeName: 'T', currency: 'COP', precision: 0, phoneCountry: null });
        const lines = full.lists.find((l) => l.key === PURCHASE_LIST_KEYS.lines)!;
        const rel = (slug: string) => (lines.fields.find((fd) => fd.slug === slug)!.config as { target_list_id: { $list: string } }).target_list_id.$list;
        expect(rel('orden')).toBe('compras');
        expect(rel('producto')).toBe('productos');
        expect(rel('variacion')).toBe('variaciones');
        const products = full.lists.find((l) => l.key === 'productos')!;
        const enCamino = products.fields.find((fd) => fd.slug === 'en_camino')!;
        expect(enCamino.type).toBe('rollup');
        expect(enCamino.config).toMatchObject({ operation: 'sum', target_field_id: { $field: 'pendiente', $list: 'lineas_compra' } });
    });
});

describe('Reposición (puros, v0.1.209)', () => {
    it('recibir: «Recibida» lleva a lo recibido (o a lo pedido); «en parte» sólo con la cantidad escrita', () => {
        expect(receiveTarget('recibida', 10, null)).toBe(10);
        expect(receiveTarget('recibida', 10, 8)).toBe(8);
        expect(receiveTarget('recibida', null, null)).toBe(0);
        expect(receiveTarget('recibida_parcial', 10, null)).toBeNull();
        expect(receiveTarget('recibida_parcial', 10, 3)).toBe(3);
        expect(receiveTarget('enviada', 10, 3)).toBeNull();
        expect(receiveTarget('cancelada', 10, 3)).toBeNull();
        expect(receiveTarget('recibida', 10, -4)).toBe(0);
    });

    it('pendiente: sólo una orden pedida y no cerrada tiene algo en camino', () => {
        expect(pendingOf('enviada', 10, 0)).toBe(10);
        expect(pendingOf('recibida_parcial', 10, 4)).toBe(6);
        expect(pendingOf('recibida_parcial', 10, 12)).toBe(0);
        expect(pendingOf('borrador', 10, 0)).toBe(0);
        expect(pendingOf('recibida', 10, 4)).toBe(0);
        expect(pendingOf('cancelada', 10, 0)).toBe(0);
    });

    it('sugerencia: un mes de venta + la alerta − lo que hay − lo que viene, nunca menos de 1', () => {
        expect(suggestQuantity(2, 0, 10, 5)).toBe(13);
        expect(suggestQuantity(-3, 0, 0, 2)).toBe(5);
        expect(suggestQuantity(50, 0, 10, 5)).toBe(1);
        expect(suggestQuantity(null, 4, 3.5, 2)).toBe(2);
    });

    it('numeración de órdenes', () => {
        expect(orderSeq('OC-0007')).toBe(7);
        expect(orderSeq(' OC-12 ')).toBe(12);
        expect(orderSeq('Pedido 7')).toBeNull();
    });
});
