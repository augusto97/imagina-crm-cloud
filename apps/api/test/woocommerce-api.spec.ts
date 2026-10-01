import { integrationDef, type ConnectorAction } from '@imagina-base/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
    buildIntegrationRequest,
    checkIntegrationResponse,
    compileIntegrationValues,
    type IntegrationCreds,
} from '../src/connectors/integration-calls';
import {
    classifyWooVerify,
    parseMetaLines,
    wooPrice,
    wooSiteName,
    wooStoreUrl,
    wooUrl,
    wooVerifyPlan,
} from '../src/connectors/woocommerce/wc-api';

/**
 * v0.1.205 — WooCommerce: la forma exacta de las peticiones, sin salir a la
 * red. Lo que se prueba acá es lo mismo que ejecutan el motor, el probador y
 * (fase 2) la sincronización.
 */
const creds = (fields: Record<string, string> = {}): IntegrationCreds => ({
    secret: 'cs_secreto123',
    accessToken: '',
    fields: { store_url: 'https://tienda.test', consumer_key: 'ck_clave456', ...fields },
});
const action = (key: string): ConnectorAction => integrationDef('woocommerce')!.actions.find((a) => a.key === key)!;
const id = (raw: unknown): string => String(raw ?? '');
const req = (key: string, raw: Record<string, unknown>, c = creds()) =>
    buildIntegrationRequest('woocommerce', key, compileIntegrationValues('woocommerce', action(key), raw, id, id), c);

afterEach(() => {
    delete process.env.DEV_ALLOW_PRIVATE_EGRESS;
});

describe('dirección de la tienda', () => {
    it('normaliza: agrega https, quita la barra final, /wp-admin y la query; conserva el subdirectorio', () => {
        expect(wooStoreUrl('tienda.com')).toBe('https://tienda.com');
        expect(wooStoreUrl('https://tienda.com/')).toBe('https://tienda.com');
        expect(wooStoreUrl('https://tienda.com/wp-admin/admin.php?page=wc')).toBe('https://tienda.com');
        expect(wooStoreUrl('https://ejemplo.com/shop/')).toBe('https://ejemplo.com/shop');
    });

    it('exige HTTPS (WooCommerce no acepta la clave sin conexión segura) salvo el interruptor de desarrollo', () => {
        expect(() => wooStoreUrl('http://tienda.com')).toThrow(/HTTPS/);
        expect(() => wooStoreUrl('')).toThrow(/Falta/);
        process.env.DEV_ALLOW_PRIVATE_EGRESS = '1';
        expect(wooStoreUrl('http://127.0.0.1:9999')).toBe('http://127.0.0.1:9999');
    });
});

describe('URLs y autenticación', () => {
    it('por defecto: /wp-json + cabecera Basic con clave:secreto', () => {
        const r = req('update_order_status', { order_id: '77', status: 'completed' });
        expect(r.url).toBe('https://tienda.test/wp-json/wc/v3/orders/77');
        expect(r.method).toBe('PUT');
        expect(r.headers.authorization).toBe(`Basic ${Buffer.from('ck_clave456:cs_secreto123').toString('base64')}`);
        expect(JSON.parse(r.body!)).toEqual({ status: 'completed' });
    });

    it('hosting que tira la cabecera → la clave va en la URL; sin enlaces permanentes → ?rest_route=', () => {
        const c = creds({ auth_mode: 'query', api_style: 'plain' });
        expect(wooUrl(c, '/products', [['per_page', '100']])).toBe(
            'https://tienda.test/?rest_route=/wc/v3/products&per_page=100&consumer_key=ck_clave456&consumer_secret=cs_secreto123',
        );
        const r = req('update_order_status', { order_id: '5', status: 'on-hold' }, c);
        expect(r.headers.authorization).toBeUndefined();
    });

    it('la verificación prueba las cuatro combinaciones, la ideal primero', () => {
        const plan = wooVerifyPlan(creds());
        expect(plan.map((p) => `${p.fields.api_style}/${p.fields.auth_mode}`)).toEqual([
            'pretty/header',
            'pretty/query',
            'plain/header',
            'plain/query',
        ]);
        expect(plan[0]!.url).toBe('https://tienda.test/wp-json/wc/v3/products?per_page=1&_fields=id');
    });
});

describe('acciones', () => {
    it('producto: sólo viajan los datos completados; el stock activa la gestión de inventario', () => {
        const r = req('update_product', { product_id: '12', regular_price: '1.234,50', stock_quantity: '8' });
        expect(r.url).toBe('https://tienda.test/wp-json/wc/v3/products/12');
        expect(JSON.parse(r.body!)).toEqual({ regular_price: '1234.50', manage_stock: true, stock_quantity: 8 });
    });

    it('variación: va a /products/{padre}/variations/{id} y no toca el nombre', () => {
        const r = req('update_product', { product_id: '12', variation_id: '34', name: 'X', sale_price: 'quitar' });
        expect(r.url).toBe('https://tienda.test/wp-json/wc/v3/products/12/variations/34');
        expect(JSON.parse(r.body!)).toEqual({ sale_price: '' });
    });

    it('campos de otros plugins: clave=valor por renglón → meta_data', () => {
        const r = req('update_product', { product_id: '12', meta: '_yoast_wpseo_title=Oferta\ngarantia_meses = 12\n' });
        expect(JSON.parse(r.body!)).toEqual({
            meta_data: [
                { key: '_yoast_wpseo_title', value: 'Oferta' },
                { key: 'garantia_meses', value: '12' },
            ],
        });
        expect(() => parseMetaLines(['sin igual'])).toThrow(/clave=valor/);
    });

    it('rechaza lo que no se puede mandar, con el mensaje para la persona', () => {
        expect(() => req('update_product', { product_id: '12' })).toThrow(/nada para cambiar/);
        expect(() => req('update_product', { product_id: 'SKU-1', name: 'x' })).toThrow(/ID de producto/);
        expect(() => req('update_product', { product_id: '12', stock_quantity: '2.5' })).toThrow(/entero/);
        expect(() => wooPrice('abc', 'precio')).toThrow(/precio/);
        // Punto de miles (Latinoamérica), coma decimal, y los dos a la vez.
        expect(wooPrice('26.000', 'precio')).toBe('26000');
        expect(wooPrice('1.250.000', 'precio')).toBe('1250000');
        expect(wooPrice('1,250,000', 'precio')).toBe('1250000');
        expect(wooPrice('19,99', 'precio')).toBe('19.99');
        expect(wooPrice('19.99', 'precio')).toBe('19.99');
        expect(wooPrice('$ 1.234,50', 'precio')).toBe('1234.50');
        expect(wooPrice('45000', 'precio')).toBe('45000');
    });

    it('nota al pedido y cupón', () => {
        const nota = req('add_order_note', { order_id: '#90', note: 'Enviado', customer_note: 'true' });
        expect(nota.url).toBe('https://tienda.test/wp-json/wc/v3/orders/90/notes');
        expect(JSON.parse(nota.body!)).toEqual({ note: 'Enviado', customer_note: true });

        const cupon = req('create_coupon', {
            code: 'VIP10',
            amount: '10',
            date_expires: '2026-12-31T00:00:00',
            email_restrictions: 'ana@x.co, no-es-correo',
            usage_limit: '1',
        });
        expect(JSON.parse(cupon.body!)).toEqual({
            code: 'VIP10',
            discount_type: 'percent',
            amount: '10',
            individual_use: false,
            free_shipping: false,
            date_expires: '2026-12-31',
            usage_limit: 1,
            email_restrictions: ['ana@x.co'],
        });
    });
});

describe('respuestas', () => {
    it('los errores de WooCommerce se traducen; un 200 con HTML no es éxito', () => {
        expect(checkIntegrationResponse('woocommerce', 200, '{"id":12}')).toBeNull();
        expect(
            checkIntegrationResponse('woocommerce', 403, '{"code":"woocommerce_rest_cannot_edit","message":"No"}'),
        ).toMatch(/Lectura\/Escritura/);
        expect(
            checkIntegrationResponse('woocommerce', 404, '{"code":"woocommerce_rest_product_invalid_id","message":"ID <b>no válido</b>."}'),
        ).toBe('WooCommerce respondió 404: ID no válido.');
        expect(checkIntegrationResponse('woocommerce', 200, '<html>mantenimiento</html>')).toMatch(/página web/);
    });

    it('verificación: lista = ok, 401 con código = clave, HTML o 404 = no hay API, rest_no_route = sin WooCommerce', () => {
        expect(classifyWooVerify(200, '[{"id":1}]').kind).toBe('ok');
        expect(classifyWooVerify(401, '{"code":"woocommerce_rest_cannot_view","message":"No"}').kind).toBe('auth');
        expect(classifyWooVerify(404, '<html></html>').kind).toBe('no_api');
        expect(classifyWooVerify(404, '{"code":"rest_no_route","message":"x"}')).toMatchObject({ kind: 'other' });
        expect(wooSiteName('{"name":"Mi <b>Tienda</b>"}')).toBe('Mi Tienda');
    });
});
