import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { emptyMaps, remapSyncSettings } from '../src/platform/tenant-transfer.remap';
import { readSettings, readState } from '../src/sync/store-sync.types';
import { buildWooPack, WOO_LIST_KEYS } from '../src/sync/woocommerce/woo-pack';
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
    it('cinco listas vinculadas con su tablero y la moneda de la tienda', () => {
        const bp = buildWooPack({ storeName: 'Tienda', currency: 'COP', precision: 0, phoneCountry: 'CO' });
        expect(bp.lists.map((l) => l.key)).toEqual(Object.values(WOO_LIST_KEYS));
        for (const l of bp.lists) {
            // Cada lista tiene su woo_id indexado: es por donde se busca al sincronizar.
            const woo = l.fields.find((f) => f.slug === 'woo_id');
            expect(woo, l.key).toBeDefined();
            expect(woo!.is_indexed, l.key).toBe(true);
        }
        expect(bp.dashboards?.length).toBe(1);
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
