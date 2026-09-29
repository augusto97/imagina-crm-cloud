import { defaultStoreEditable } from '@imagina-base/shared';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { emptyMaps, remapSyncSettings } from '../src/platform/tenant-transfer.remap';
import { readSettings, readState, roleOfResource } from '../src/sync/store-sync.types';
import { buildWooPack, WOO_LIST_KEYS } from '../src/sync/woocommerce/woo-pack';
import {
    buildWriteBack,
    splitPersonName,
    type WriteBackInput,
    isVariationPayload,
    isWooPing,
    parseWooTopic,
    verifyWooSignature,
    wooDeliveryUrlProblem,
    wooDisabledHooksMessage,
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
    summarizeVariations,
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


/** El envío con las columnas de por defecto (las de v0.1.213) salvo que el test elija otras. */
const wb = (i: Omit<WriteBackInput, 'editable'> & { editable?: string[] }) =>
    buildWriteBack({ editable: defaultStoreEditable(roleOfResource(i.resource)), ...i });

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
        expect(p.values).toMatchObject({ nombre: 'Camiseta', tipo: 'variable', precio: 30000, categorias: ['ropa'], imagen: 'https://t.co/a.jpg' });
        // Un producto con variaciones no escribe stock ni estado de inventario:
        // son el resumen de sus variaciones (lo calcula el motor).
        expect('stock' in p.values).toBe(false);
        expect('estado_inventario' in p.values).toBe(false);
        expect(p.values.precio_normal).toBeNull();
        expect(p.options.categorias).toEqual([{ value: 'ropa', label: 'Ropa' }]);
        expect(p.options.estado_stock).toEqual([{ value: 'wc-backorder-custom', label: 'Backorder custom' }]);
        expect(p.meta).toEqual({ garantia_meses: '3' });
    });

    it('variación: SUBTAREA de su producto (v0.1.213), con el nombre «Padre — opciones»', () => {
        const v = mapVariation(
            { id: 22, parent_id: 20, price: '32000', manage_stock: true, stock_quantity: 4, attributes: [{ name: 'Color', option: 'Rojo' }, { name: 'Talla', option: 'M' }] },
            { id: 20, name: 'Camiseta' },
        );
        expect(v.parentExternalId).toBe('20');
        expect(v.relations).toEqual({});
        expect(v.values).toMatchObject({ nombre: 'Camiseta — Rojo / M', tipo: 'variacion', atributos: 'Color: Rojo · Talla: M', stock: 4, precio: 32000 });
    });

    it('pedido y líneas: la línea es SUBTAREA del pedido y apunta al producto Y a la variación', () => {
        const o = mapOrder(order, 'https://tienda.test/');
        expect(o.values).toMatchObject({
            numero: '#501',
            tipo: 'pedido',
            cantidad: 3,
            total: 48000,
            subtotal: 40000,
            cupones: 'VERANO',
            metodo_pago: 'Transferencia',
            enlace: 'https://tienda.test/wp-admin/post.php?post=501&action=edit',
        });
        expect(o.relations.cliente).toEqual({ resource: 'customers', externalId: 'email:ana@correo.co' });
        expect(o.meta.nit).toBe('900999');

        const lines = mapLineItems(order, 'https://tienda.test');
        expect(lines).toHaveLength(2);
        expect(lines[0]!.parentExternalId).toBe('501');
        expect(lines[0]!.relations).toEqual({ producto: [{ resource: 'products', externalId: '10' }] });
        expect(lines[1]!.relations.producto).toEqual([
            { resource: 'products', externalId: '20' },
            { resource: 'variations', externalId: '22' },
        ]);
        // La línea copia el estado y la fecha del pedido (los rollups de ventas filtran por ellos).
        expect(lines[1]!.values).toMatchObject({
            numero: 'Camiseta',
            tipo: 'linea',
            cantidad: 1,
            estado: 'processing',
            fecha: '2026-06-01T15:04:05Z',
            enlace: 'https://tienda.test/wp-admin/post.php?post=501&action=edit',
        });
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

describe('Pack de la tienda (v0.1.213)', () => {
    const bp = buildWooPack({ storeName: 'Tienda', currency: 'COP', precision: 0, phoneCountry: 'CO' });

    it('TRES listas (las variaciones y las líneas viven en la lista de su padre) y dos tableros', () => {
        expect(bp.lists.map((l) => l.key)).toEqual(['clientes', 'productos', 'pedidos']);
        expect(new Set(Object.values(WOO_LIST_KEYS))).toEqual(new Set(['clientes', 'productos', 'pedidos']));
        for (const l of bp.lists) {
            // Cada lista tiene su woo_id indexado: es por donde se busca al sincronizar.
            const woo = l.fields.find((f) => f.slug === 'woo_id');
            expect(woo?.is_indexed, l.key).toBe(true);
        }
        expect(bp.dashboards?.map((d) => d.name)).toEqual(['Ventas · Tienda', 'Inventario · Tienda']);
        const productos = bp.lists.find((l) => l.key === 'productos')!;
        expect(productos.fields.find((f) => f.slug === 'precio')!.config).toMatchObject({ currency: 'COP', precision: 0 });
        // Nada de compras (no son de la tienda).
        expect(bp.lists.some((l) => /compra|proveedor/.test(l.key))).toBe(false);
    });

    it('los rollups de ventas suman las LÍNEAS (subtareas de Pedidos) que apuntan al producto', () => {
        const productos = bp.lists.find((l) => l.key === 'productos')!;
        const vendidas = productos.fields.find((f) => f.slug === 'unidades_vendidas')!;
        expect(vendidas.config).toMatchObject({
            operation: 'sum',
            relation_field_id: { $field: 'producto', $list: 'pedidos' },
            target_field_id: { $field: 'cantidad', $list: 'pedidos' },
        });
        const tipo = productos.fields.find((f) => f.slug === 'tipo')!;
        expect((tipo.config.options as Array<{ value: string }>).map((o) => o.value)).toContain('variacion');
        // Los clientes suman sólo PEDIDOS (una línea no tiene cliente, pero se dice explícito).
        const clientes = bp.lists.find((l) => l.key === 'clientes')!;
        const total = clientes.fields.find((f) => f.slug === 'total_comprado')!;
        expect(JSON.stringify(total.config)).toContain('"pedido"');
    });

    it('los tableros no cuentan dos veces: filtran por tipo de fila', () => {
        const ventas = bp.dashboards![0]!;
        const pedidos = ventas.widgets.find((w) => w.title === 'Pedidos')!;
        expect(JSON.stringify(pedidos.config)).toContain('"pedido"');
        const inv = bp.dashboards![1]!;
        const valor = inv.widgets.find((w) => w.title === 'Valor en stock')!;
        // El producto con variaciones ya es la suma de sus variaciones: se excluye.
        expect(JSON.stringify(valor.config)).toContain('"variacion"');
        expect(JSON.stringify(valor.config)).not.toContain('"variable"');
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

    it('sólo precios, stock y estados viajan; lo demás se edita en WooCommerce', () => {
        expect(wb({ resource: 'products', externalId: '20', parentExternalId: null, changed: { precio_normal: 35000 } })).toEqual({
            path: '/products/20',
            body: { regular_price: '35000' },
            fields: ['Precio normal'],
        });
        const r = wb({
            resource: 'products',
            externalId: '20',
            parentExternalId: null,
            changed: { precio_rebajado: null, stock: null, nombre: 'Otro', sku: 'X', categorias: ['x'] },
        })!;
        // Rebaja vaciada = sin rebaja. Nombre, SKU y categorías NO viajan (v0.1.213).
        expect(r.body).toEqual({ sale_price: '' });
        expect(r.fields).toEqual(['Precio rebajado']);
        expect(wb({ resource: 'products', externalId: '20', parentExternalId: null, changed: { responsable: 3 } })).toBeNull();
    });

    it('columnas habilitadas por la empresa: nombre, SKU, categorías, etiquetas y plugins (v0.1.214)', () => {
        const editable = ['nombre', 'sku', 'categorias', 'etiquetas', 'meta:77'];
        const r = wb({
            resource: 'products',
            externalId: '20',
            parentExternalId: null,
            changed: { nombre: '  Taza grande ', sku: 'TZ-2', categorias: ['cocina'], etiquetas: ['regalo', 'nuevo'], precio_normal: 10 },
            editable,
            terms: { categorias: [16], etiquetas: [19, 33] },
            meta: [
                { key: 'garantia', fieldId: 77, value: true, sample: 'yes' },
                { key: 'otro', fieldId: 78, value: 'x', sample: null },
            ],
        })!;
        // El precio no está habilitado en esta elección: no viaja.
        expect(r.body).toEqual({
            name: 'Taza grande',
            sku: 'TZ-2',
            categories: [{ id: 16 }],
            tags: [{ id: 19 }, { id: 33 }],
            meta_data: [{ key: 'garantia', value: 'yes' }],
        });
        expect(r.fields).toEqual(['Nombre', 'SKU', 'Categorías', 'Etiquetas', 'garantia']);
        // En una variación: el nombre y las categorías son del producto.
        const v = wb({
            resource: 'variations',
            externalId: '22',
            parentExternalId: '20',
            changed: { nombre: 'X', categorias: ['a'], sku: 'V-1' },
            editable,
            terms: { categorias: [1] },
        })!;
        expect(v.body).toEqual({ sku: 'V-1' });
        // Sin los ids resueltos, las categorías no se mandan (nunca `[{id: undefined}]`).
        expect(wb({ resource: 'products', externalId: '20', parentExternalId: null, changed: { categorias: ['a'] }, editable })).toBeNull();
    });

    it('slug del producto: se lee decodificado y viaja sólo del producto (v0.1.215)', () => {
        expect(mapProduct({ id: 3, name: 'Café', slug: 'caf%c3%a9-de-origen' }).values.slug_url).toBe('café-de-origen');
        expect(mapProduct({ id: 3, name: 'X', slug: '' }).values.slug_url).toBeNull();
        expect(mapProduct({ id: 3, name: 'X', slug: '%E0%A4%A' }).values.slug_url).toBe('%E0%A4%A');
        const r = wb({ resource: 'products', externalId: '3', parentExternalId: null, changed: { slug_url: ' taza-roja ' }, editable: ['slug_url'] })!;
        expect(r.body).toEqual({ slug: 'taza-roja' });
        expect(r.fields).toEqual(['Slug (dirección)']);
        expect(wb({ resource: 'variations', externalId: '9', parentExternalId: '3', changed: { slug_url: 'x' }, editable: ['slug_url'] })).toBeNull();
        expect(wb({ resource: 'products', externalId: '3', parentExternalId: null, changed: { slug_url: 'x' } })).toBeNull();
    });

    it('clientes con cuenta y datos del pedido, sólo si se habilitaron', () => {
        const c = wb({
            resource: 'customers',
            externalId: 'id:2',
            parentExternalId: null,
            changed: { nombre: 'Ana María López', email: 'ana@x.co', telefono: '+57300', ciudad: 'Cali', region: 'VAC' },
            editable: ['nombre', 'email', 'telefono', 'ciudad'],
        })!;
        expect(c.path).toBe('/customers/2');
        expect(c.body).toEqual({
            first_name: 'Ana',
            last_name: 'María López',
            email: 'ana@x.co',
            billing: { first_name: 'Ana', last_name: 'María López', phone: '+57300', city: 'Cali' },
        });
        // Una invitada no tiene cuenta: no hay a quién editar.
        expect(wb({ resource: 'customers', externalId: 'email:a@b.co', parentExternalId: null, changed: { telefono: '1' }, editable: ['telefono'] })).toBeNull();
        const o = wb({
            resource: 'orders',
            externalId: '501',
            parentExternalId: null,
            changed: { estado: 'completed', nota_cliente: 'Dejar en portería', email: 'b@x.co' },
            editable: ['nota_cliente', 'email'],
        })!;
        expect(o.body).toEqual({ customer_note: 'Dejar en portería', billing: { email: 'b@x.co' } });
        expect(splitPersonName('  Ana ')).toEqual({ first_name: 'Ana', last_name: '' });
    });

    it('variación y pedido van a su ruta; los clientes no se editan desde la app', () => {
        expect(wb({ resource: 'variations', externalId: '22', parentExternalId: '20', changed: { stock: 7.9 } })).toMatchObject({
            path: '/products/20/variations/22',
            body: { manage_stock: true, stock_quantity: 7 },
        });
        expect(wb({ resource: 'variations', externalId: '22', parentExternalId: null, changed: { stock: 1 } })).toBeNull();
        expect(wb({ resource: 'orders', externalId: '501', parentExternalId: null, changed: { estado: 'completed', total: 9, nota_cliente: 'x' } })).toEqual({
            path: '/orders/501',
            body: { status: 'completed' },
            fields: ['Estado'],
        });
        expect(wb({ resource: 'customers', externalId: 'id:2', parentExternalId: null, changed: { telefono: '+57300' } })).toBeNull();
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
            wb({ resource: 'products', externalId: '1', parentExternalId: null, changed: { umbral_stock: 7.6, controla_stock: true } })!.body,
        ).toEqual({ low_stock_amount: 7, manage_stock: true });
        // Vaciar el umbral = volver al general de la tienda.
        expect(wb({ resource: 'variations', externalId: '2', parentExternalId: '1', changed: { umbral_stock: null } })!.body).toEqual({
            low_stock_amount: null,
        });
        // El estado de inventario es DERIVADO: no viaja.
        expect(wb({ resource: 'products', externalId: '1', parentExternalId: null, changed: { estado_inventario: 'bajo' } })).toBeNull();
    });

    it('producto con variaciones: su inventario es el RESUMEN de sus variaciones', () => {
        expect(
            summarizeVariations([
                { stock: 5, value: 50, state: 'en_stock' },
                { stock: 1, value: 10, state: 'bajo' },
                { stock: null, value: null, state: 'sin_control' },
            ]),
        ).toEqual({ stock: 6, value: 60, state: 'bajo' });
        // Todas agotadas = agotado; alguna agotada = hay que reponer (bajo).
        expect(summarizeVariations([{ stock: 0, value: 0, state: 'agotado' }, { stock: 0, value: 0, state: 'agotado' }]).state).toBe('agotado');
        expect(summarizeVariations([{ stock: 0, value: 0, state: 'agotado' }, { stock: 9, value: 9, state: 'en_stock' }]).state).toBe('bajo');
        expect(summarizeVariations([]).state).toBe('sin_control');
        expect(summarizeVariations([{ stock: null, value: null, state: 'por_encargo' }])).toEqual({ stock: null, value: null, state: 'por_encargo' });
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

    it('avisos: WordPress sólo entrega a 80/443/8080 (probado contra un WooCommerce real)', () => {
        expect(wooDeliveryUrlProblem('https://app.test/api/v1/public/store-hooks/x')).toBeNull();
        expect(wooDeliveryUrlProblem('http://app.test/api/v1/public/store-hooks/x')).toBeNull();
        expect(wooDeliveryUrlProblem('http://app.test:8080/h')).toBeNull();
        expect(wooDeliveryUrlProblem('https://app.test:8443/h')).toMatch(/puertos 80, 443 y 8080.*8443/);
        expect(wooDeliveryUrlProblem('http://localhost:5174/h')).toMatch(/5174/);
        expect(wooDeliveryUrlProblem('no es una url')).toMatch(/no es válida/);
        expect(wooDeliveryUrlProblem('ftp://app.test/h')).toMatch(/http/);
        expect(wooDisabledHooksMessage(1, 'https://app.test')).toMatch(/desactivado 1 aviso porque.*https:\/\/app\.test/);
        expect(wooDisabledHooksMessage(3, 'https://app.test')).toMatch(/3 avisos/);
    });
});
