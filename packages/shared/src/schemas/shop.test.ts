import { describe, expect, it } from 'vitest';
import {
    computeShopCart,
    defaultShopConfig,
    formatShopMoney,
    readShopConfig,
    shopLineProblemText,
    shopProblems,
    shopWhatsappMessage,
    type ShopCartProduct,
} from './shop';

const products = new Map<number, ShopCartProduct>([
    [1, { id: 1, title: 'Camiseta', price: 40000, stock: 5 }],
    [2, { id: 2, title: 'Gorra', price: 25000.5, stock: null }],
    [3, { id: 3, title: 'Agotado', price: 10000, stock: 0 }],
    [4, { id: 4, title: 'Sin precio', price: null, stock: null }],
]);

describe('computeShopCart', () => {
    it('suma en centavos, junta líneas repetidas y agrega el envío', () => {
        const r = computeShopCart(
            [
                { product_id: 1, qty: 1 },
                { product_id: 2, qty: 2 },
                { product_id: 1, qty: 1 },
            ],
            products,
            { shipping: 8000, minOrder: null },
        );
        expect(r.lines.map((l) => [l.product_id, l.qty, l.subtotal])).toEqual([
            [1, 2, 80000],
            [2, 2, 50001],
        ]);
        expect(r.subtotal).toBe(130001);
        expect(r.shipping).toBe(8000);
        expect(r.total).toBe(138001);
        expect(r.blocked).toBe(false);
    });

    it('marca lo agotado, lo que pasa el stock, lo que no existe y lo que no tiene precio', () => {
        const r = computeShopCart(
            [
                { product_id: 1, qty: 9 },
                { product_id: 3, qty: 1 },
                { product_id: 99, qty: 1 },
                { product_id: 4, qty: 1 },
            ],
            products,
            { shipping: 0, minOrder: null },
        );
        expect(r.lines.map((l) => l.problem)).toEqual(['low_stock', 'no_stock', 'unavailable', 'no_price']);
        expect(shopLineProblemText(r.lines[0]!)).toBe('Sólo quedan 5.');
        expect(r.blocked).toBe(true);
        expect(r.subtotal).toBe(0);
    });

    it('avisa cuánto falta para la compra mínima y no cobra envío con el carrito vacío', () => {
        expect(computeShopCart([{ product_id: 2, qty: 1 }], products, { shipping: 5000, minOrder: 30000 }).below_minimum).toBe(4999.5);
        const empty = computeShopCart([], products, { shipping: 5000, minOrder: null });
        expect(empty.shipping).toBe(0);
        expect(empty.blocked).toBe(true);
    });

    it('recorta cantidades imposibles', () => {
        const r = computeShopCart([{ product_id: 2, qty: 5000 }, { product_id: 2, qty: -3 }], products, { shipping: 0, minOrder: null });
        expect(r.lines[0]!.qty).toBe(999);
    });
});

describe('formatShopMoney', () => {
    it('usa los separadores de la empresa y sin decimales en pesos', () => {
        expect(formatShopMoney(1250000.4, 'COP', 'dot_comma')).toBe('$ 1.250.000');
        expect(formatShopMoney(49.9, 'USD', 'comma_dot')).toBe('US$ 49.90');
    });
});

describe('shopProblems', () => {
    it('pide precio, pago, entrega y quién vende antes de publicar', () => {
        const c = defaultShopConfig();
        const texts = shopProblems(c, { hasOrdersLists: true, priceFieldOk: false }).map((p) => p.section);
        expect(texts).toContain('catalog');
        expect(texts).toContain('payment');
        expect(texts).toContain('seller');
    });

    it('queda sin problemas con lo mínimo legal y una forma de pago', () => {
        const c = defaultShopConfig();
        c.catalog.price = 10;
        c.payments.whatsapp = { enabled: true, phone: '+57 300 111 2233', intro: '' };
        c.seller = { legal_name: 'Café Aurora SAS', document: '900123456-7', address: 'Calle 1 # 2-3', city: 'Bogotá', email: 'hola@cafe.co', phone: '' };
        expect(shopProblems(c, { hasOrdersLists: true, priceFieldOk: true })).toEqual([]);
        c.payments.whatsapp.phone = '3001112233';
        expect(shopProblems(c, { hasOrdersLists: true, priceFieldOk: true }).map((p) => p.section)).toEqual(['payment']);
    });
});

describe('readShopConfig', () => {
    it('tolera lo roto sin tirar la tienda', () => {
        const c = readShopConfig({
            currency: 'xx',
            delivery: [{ id: 'a', name: 'Envío', price: 5000 }, { id: 'a', name: 'Duplicado' }, { id: 'MAL ID' }, 'basura'],
            display: { columns: 7 },
            payments: { whatsapp: { enabled: 'si' } },
        });
        expect(c.currency).toBe('COP');
        expect(c.delivery.map((d) => d.id)).toEqual(['a']);
        expect(c.display.columns).toBe(3);
        expect(c.payments.whatsapp.enabled).toBe(false);
    });
});

describe('shopWhatsappMessage', () => {
    it('arma el pedido legible con el total y el enlace', () => {
        const msg = shopWhatsappMessage(
            {
                number: 'PED-0007',
                lines: [{ title: 'Camiseta', qty: 2, subtotal: 80000 }],
                shipping: 8000,
                total: 88000,
                delivery: 'Envío a domicilio',
                customer: { name: 'Ana', address: 'Calle 1', city: 'Bogotá', notes: '' },
                url: 'https://x.test/o/abc',
            },
            '',
            (n) => formatShopMoney(n, 'COP', 'dot_comma'),
        );
        expect(msg).toContain('Hola, quiero hacer este pedido: (PED-0007)');
        expect(msg).toContain('• 2 × Camiseta — $ 80.000');
        expect(msg).toContain('Entrega: Envío a domicilio ($ 8.000)');
        expect(msg).toContain('Total: $ 88.000');
        expect(msg).toContain('Dirección: Calle 1, Bogotá');
        expect(msg).toContain('Ver el pedido: https://x.test/o/abc');
    });
});
