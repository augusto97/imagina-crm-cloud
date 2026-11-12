import { describe, expect, it } from 'vitest';
import { readShopConfig, shopConversionSchema, shopE164Phone, shopPurchaseConversion, shopStatEventsSchema, shopStatFields, shopStatsDayRange, summarizeShopStats } from '../index';

/** v0.1.418 — Estadísticas y conversiones de la tienda (lo puro). */
describe('estadísticas de la tienda', () => {
    it('cada evento suma sólo sus contadores (lo raro no suma nada)', () => {
        expect(shopStatFields({ kind: 'view', src: 'u:google', dev: 'mobile' })).toEqual(['v', 'src:u:google', 'dev:m']);
        // Un origen con forma rara cuenta como directo.
        expect(shopStatFields({ kind: 'view', src: 'u:<script>' })).toEqual(['v', 'src:d', 'dev:d']);
        expect(shopStatFields({ kind: 'product', item: 7, first: true })).toEqual(['p:7', 'pvv']);
        expect(shopStatFields({ kind: 'product', item: 7 })).toEqual(['p:7']);
        expect(shopStatFields({ kind: 'add', item: 7, first: true })).toEqual(['a:7', 'av']);
        expect(shopStatFields({ kind: 'add', item: -1 })).toEqual([]);
        expect(shopStatFields({ kind: 'checkout' })).toEqual(['c']);
        // El esquema de lo que manda la página: hasta 20 eventos por lote.
        expect(shopStatEventsSchema.safeParse({ events: Array.from({ length: 21 }, () => ({ kind: 'view' })) }).success).toBe(false);
        expect(shopStatEventsSchema.safeParse({ events: [{ kind: 'buy' }] }).success).toBe(false);
    });

    it('arma el embudo, los productos y los orígenes con los pedidos', () => {
        const range = { from: '2026-11-01', to: '2026-11-03' };
        expect(shopStatsDayRange(range.from, range.to)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
        const dto = summarizeShopStats({
            counts: [
                { day: '2026-11-01', counts: { v: 10, 'src:u:google': 6, 'src:d': 4, 'dev:m': 7, 'dev:d': 3, pvv: 8, 'p:1': 8, 'p:2': 3, av: 4, 'a:1': 4, c: 3 } },
                { day: '2026-11-03', counts: { v: 5, 'src:d': 5, 'dev:d': 5 } },
                // Fuera del rango: no cuenta.
                { day: '2026-10-30', counts: { v: 99 } },
            ],
            orders: [
                { day: '2026-11-01', orders: 2, paid: 1, revenue: 50000 },
                { day: '2026-11-03', orders: 1, paid: 1, revenue: 25000.5 },
            ],
            sold: [
                { product_id: 1, units: 2, revenue: 50000 },
                { product_id: 3, units: 1, revenue: 25000.5 },
            ],
            orderSources: [
                { key: 'u:google', orders: 2, paid: 1, revenue: 50000 },
                { key: 'd', orders: 1, paid: 1, revenue: 25000.5 },
            ],
            range,
            currency: 'COP',
            titles: new Map([
                [1, 'Taza'],
                [2, 'Libreta'],
            ]),
        });
        expect(dto.days.map((d) => d.visits)).toEqual([10, 0, 5]);
        expect(dto.totals).toEqual({ visits: 15, orders: 3, paid: 2, revenue: 75000.5, average_order: 37500.25, conversion_rate: 2 / 15 });
        expect(dto.funnel.map((s) => [s.key, s.count])).toEqual([
            ['visits', 15],
            ['product', 8],
            ['cart', 4],
            ['checkout', 3],
            ['orders', 3],
            ['paid', 2],
        ]);
        // El que más vendió primero; uno vendido que ya no está queda sin nombre.
        expect(dto.products[0]).toEqual({ id: 1, title: 'Taza', views: 8, adds: 4, units: 2, revenue: 50000 });
        expect(dto.products.find((p) => p.id === 3)?.title).toBe('');
        expect(dto.sources[0]).toEqual({ key: 'u:google', visits: 6, orders: 2, paid: 1, revenue: 50000 });
        expect(dto.devices).toEqual({ mobile: 7, tablet: 0, desktop: 8 });
    });

    it('sin visitas no hay tasa de conversión ni ticket promedio', () => {
        const dto = summarizeShopStats({ counts: [], orders: [], sold: [], orderSources: [], range: { from: '2026-11-01', to: '2026-11-01' }, currency: 'USD' });
        expect(dto.totals.conversion_rate).toBeNull();
        expect(dto.totals.average_order).toBeNull();
        expect(dto.sources).toEqual([]);
    });
});

describe('conversiones de la tienda', () => {
    it('la configuración se lee con tolerancia (una etiqueta rota no tira el resto)', () => {
        const c = readShopConfig({ conversion: { google_ads: 'no-es-una-etiqueta', meta_event: true, google_tag_id: 'G-AB12CD34EF' } }).conversion;
        expect(c.google_ads).toBeNull();
        expect(c.meta_event).toBe(true);
        expect(c.google_tag_id).toBe('G-AB12CD34EF');
        expect(c.cookie_notice).toBe(true);
        expect(shopConversionSchema.parse({}).direct_tags).toBe(false);
    });

    it('la compra lleva el número del pedido, el total y cada producto (la variante aparte)', () => {
        const c = shopPurchaseConversion({
            number: 'PED-0042',
            total: 129900,
            currency: 'COP',
            shipping: 9900,
            couponCode: 'BIENVENIDA',
            lines: [
                { product_id: 11, title: 'Camiseta · M / Rojo', sku: 'CAM-M', qty: 2, unit_price: 50000, subtotal: 100000, stock_taken: true, parent_id: 10 },
                { product_id: 20, title: 'Taza · edición 1', sku: '', qty: 1, unit_price: 20000, subtotal: 20000, stock_taken: true },
            ],
            customer: { email: ' Ana@Correo.co ', phone: '+57 300 111 2233' },
            shareContact: false,
        });
        expect(c).toEqual({
            transaction_id: 'PED-0042',
            value: 129900,
            currency: 'COP',
            shipping: 9900,
            coupon: 'BIENVENIDA',
            items: [
                { item_id: '10', item_name: 'Camiseta', price: 50000, quantity: 2, item_variant: 'M / Rojo' },
                // Sin variante, el nombre queda entero aunque tenga « · ».
                { item_id: '20', item_name: 'Taza · edición 1', price: 20000, quantity: 1 },
            ],
        });
        expect(c.user_data).toBeUndefined();
    });

    it('con conversiones mejoradas manda el correo y el teléfono normalizados', () => {
        const c = shopPurchaseConversion({
            number: 'PED-1',
            total: 1,
            currency: 'USD',
            shipping: 0,
            couponCode: '',
            lines: [],
            customer: { email: ' Ana@Correo.co ', phone: '+57 300 111 2233' },
            shareContact: true,
        });
        expect(c.coupon).toBeNull();
        expect(c.user_data).toEqual({ email: 'ana@correo.co', phone_number: '+573001112233' });
        // Sin indicativo y con una moneda de varios países: no se adivina (Google lo pide con el +).
        expect(shopPurchaseConversion({ number: 'x', total: 1, currency: 'USD', shipping: 0, couponCode: '', lines: [], customer: { phone: '3001112233' }, shareContact: true }).user_data).toBeUndefined();
        // Con la moneda de un país, toma su indicativo (y entiende el que ya viene sin «+»).
        expect(shopE164Phone('300 111 2233', 'COP')).toBe('+573001112233');
        expect(shopE164Phone('573001112233', 'COP')).toBe('+573001112233');
        expect(shopE164Phone('0034 600 111 222', 'COP')).toBe('+34600111222');
        expect(shopE164Phone('(55) 1234-5678', 'mxn')).toBe('+525512345678');
        expect(shopE164Phone('abc', 'COP')).toBe('');
    });
});
