import { describe, expect, it } from 'vitest';
import {
    computeShopCart,
    defaultShopConfig,
    formatShopMoney,
    missingVariantCombos,
    normalizeCouponCode,
    parseShopCartParam,
    pickShopVariant,
    readShopConfig,
    shopCouponEligible,
    shopCartParam,
    shopCouponProblemText,
    shopLineProblemText,
    shopOptionValueState,
    shopProblems,
    shopPurchasables,
    shopKindFromText,
    shopNeedsDelivery,
    shopPlanFor,
    shopServiceFor,
    shopShippingFor,
    shopVariantPriceRange,
    suggestShopKindFields,
    shopWhatsappMessage,
    summarizeVariantProduct,
    type PublicShopProduct,
    type PublicShopVariant,
    type ShopCartProduct,
    type ShopCouponRule,
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

    it('v0.1.413 — el pago en línea pide una cuenta del equipo y una moneda que acepte', () => {
        const c = defaultShopConfig();
        c.catalog.price = 10;
        c.seller = { legal_name: 'Café Aurora SAS', document: '900123456-7', address: 'Calle 1 # 2-3', city: 'Bogotá', email: 'hola@cafe.co', phone: '' };
        c.payments.online = { enabled: true, connection_id: null, hold_minutes: 30 };
        const ok = { hasOrdersLists: true, priceFieldOk: true };
        expect(shopProblems(c, ok).map((p) => p.section)).toEqual(['payment']);
        c.payments.online.connection_id = 4;
        expect(shopProblems(c, { ...ok, onlineConnectionOk: false }).map((p) => p.section)).toEqual(['payment']);
        expect(shopProblems(c, { ...ok, onlineConnectionOk: true })).toEqual([]);
        const money = shopProblems(c, { ...ok, onlineConnectionOk: true, onlineCurrencyError: 'PayPal no cobra en pesos colombianos (COP).' });
        expect(money).toEqual([{ section: 'payment', text: 'PayPal no cobra en pesos colombianos (COP).' }]);
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

// ── v0.1.414: variantes ─────────────────────────────────────────────────

function camiseta(): PublicShopProduct {
    const base: PublicShopProduct = {
        id: 10,
        title: 'Camiseta',
        price: 40000,
        compare_price: null,
        images: ['img/f1'],
        description: '',
        categories: [],
        stock: null,
        sku: 'CAM',
        created_at: '2026-11-01T00:00:00.000Z',
    };
    const v = (id: number, talla: string, color: string, price: number | null, stock: number | null): PublicShopVariant => ({
        id,
        label: `${talla} / ${color}`,
        values: [talla, color],
        price,
        compare_price: null,
        stock,
        sku: `CAM-${talla}-${color}`.toUpperCase(),
        images: color === 'Rojo' ? ['img/f9'] : [],
    });
    return summarizeVariantProduct(
        base,
        [v(11, 'S', 'Rojo', 40000, 3), v(12, 'M', 'Rojo', 42000, 0), v(13, 'M', 'Azul', 45000, null)],
        [
            { name: 'Talla', values: ['S', 'M'] },
            { name: 'Color', values: ['Rojo', 'Azul'] },
        ],
    );
}

describe('variantes', () => {
    it('el producto toma el precio más bajo y el stock como suma (null si alguna no tiene límite)', () => {
        const p = camiseta();
        expect(p.price).toBe(40000);
        expect(p.stock).toBeNull();
        expect(shopVariantPriceRange(p)).toEqual({ min: 40000, max: 45000 });
        const limited = summarizeVariantProduct({ ...p, variants: undefined, options: undefined }, p.variants!.slice(0, 2), p.options!);
        expect(limited.stock).toBe(3);
    });

    it('se compra la variante, no el producto, con su nombre y sus fotos', () => {
        const buy = shopPurchasables([camiseta()]);
        expect(buy.has(10)).toBe(false);
        expect(buy.get(11)).toMatchObject({ title: 'Camiseta · S / Rojo', price: 40000, stock: 3, images: ['img/f9'] });
        // Sin fotos propias, las del producto.
        expect(buy.get(13)!.images).toEqual(['img/f1']);
        const cart = computeShopCart([{ product_id: 13, qty: 2 }, { product_id: 10, qty: 1 }], buy, { shipping: 0, minOrder: null });
        expect(cart.lines.find((l) => l.product_id === 13)).toMatchObject({ subtotal: 90000, problem: null });
        expect(cart.lines.find((l) => l.product_id === 10)!.problem).toBe('unavailable');
    });

    it('elige la variante por los valores y marca lo agotado o lo que no existe', () => {
        const p = camiseta();
        expect(pickShopVariant(p, ['M', 'Azul'])!.id).toBe(13);
        expect(pickShopVariant(p, ['M', null])).toBeNull();
        expect(pickShopVariant(p, ['S', 'Azul'])).toBeNull();
        expect(shopOptionValueState(p, ['S', null], 1, 'Azul')).toBe('none');
        expect(shopOptionValueState(p, ['M', null], 1, 'Rojo')).toBe('sold_out');
        expect(shopOptionValueState(p, [null, 'Rojo'], 0, 'S')).toBe('ok');
    });

    it('el generador crea sólo las combinaciones que faltan, sin tildes ni mayúsculas', () => {
        const out = missingVariantCombos(
            [
                ['S', 'M', 'm'],
                ['Rojo', 'Azúl'],
            ],
            [['S', 'rojo']],
        );
        expect(out.combos).toEqual([
            ['S', 'Azúl'],
            ['M', 'Rojo'],
            ['M', 'Azúl'],
        ]);
        expect(out.existing).toBe(1);
        expect(out.truncated).toBe(false);
        const many = missingVariantCombos([Array.from({ length: 10 }, (_, i) => `T${i}`), Array.from({ length: 10 }, (_, i) => `C${i}`)], []);
        expect(many.combos.length).toBe(60);
        expect(many.truncated).toBe(true);
    });

    it('la configuración tolera atributos rotos', () => {
        const c = readShopConfig({ variants: { enabled: true, attributes: [1, 'x', 2, 3, 4] } });
        expect(c.variants.enabled).toBe(true);
        expect(c.variants.attributes).toEqual([]);
        expect(readShopConfig({ variants: { enabled: true, attributes: [5, 6] } }).variants.attributes).toEqual([5, 6]);
    });
});

describe('v0.1.415 — envío por zona, envío gratis y cupones', () => {
    const cupon = (over: Partial<ShopCouponRule>): ShopCouponRule => ({ code: 'X', label: '', kind: 'percent', value: 10, min_subtotal: null, eligible: null, ...over });
    const lines = [
        { product_id: 1, qty: 1 },
        { product_id: 2, qty: 2 },
    ];

    it('la zona elegida manda; sin zona elegida la página la pide', () => {
        const source = { price: 9000, free_over: 200000, zones: [{ id: 'norte', price: 12000, free_over: null }, { id: 'sur', price: 6000, free_over: 100000 }] };
        expect(shopShippingFor(source, 'sur')).toEqual({ price: 6000, free_over: 100000, zone_required: true });
        expect(shopShippingFor(source, 'norte')).toEqual({ price: 12000, free_over: 200000, zone_required: true });
        expect(shopShippingFor(source, null).zone_required).toBe(true);
        expect(shopShippingFor({ price: 5000, free_over: null }, 'lo-que-sea')).toEqual({ price: 5000, free_over: null, zone_required: false });
        expect(shopShippingFor(null, null)).toEqual({ price: 0, free_over: null, zone_required: false });
    });

    it('el envío sale gratis al llegar al monto (con el descuento) y avisa cuánto falta', () => {
        const falta = computeShopCart([{ product_id: 1, qty: 1 }], products, { shipping: 8000, minOrder: null, freeOver: 50000 });
        expect(falta.shipping).toBe(8000);
        expect(falta.free_shipping).toBe(false);
        expect(falta.free_shipping_missing).toBe(10000);
        const gratis = computeShopCart([{ product_id: 1, qty: 2 }], products, { shipping: 8000, minOrder: null, freeOver: 50000 });
        expect(gratis.shipping).toBe(0);
        expect(gratis.free_shipping).toBe(true);
        expect(gratis.total).toBe(80000);
        // Con un 50 % de descuento los productos bajan a 40.000: ya no llega al envío gratis.
        const conCupon = computeShopCart([{ product_id: 1, qty: 2 }], products, { shipping: 8000, minOrder: null, freeOver: 50000, coupon: cupon({ value: 50 }), decimals: 0 });
        expect(conCupon.discount).toBe(40000);
        expect(conCupon.shipping).toBe(8000);
        expect(conCupon.free_shipping_missing).toBe(10000);
        expect(conCupon.total).toBe(48000);
    });

    it('un porcentaje se redondea a la unidad que se cobra y no pasa del monto', () => {
        // 40.000 + 50.001 = 90.001 → 15 % = 13.500,15 → en pesos, 13.500.
        const r = computeShopCart(lines, products, { shipping: 0, minOrder: null, coupon: cupon({ code: 'QUINCE', value: 15 }), decimals: 0 });
        expect(r.subtotal).toBe(90001);
        expect(r.discount).toBe(13500);
        expect(r.total).toBe(76501);
        expect(r.coupon).toEqual({ code: 'QUINCE', label: '', kind: 'percent' });
        const usd = computeShopCart(lines, products, { shipping: 0, minOrder: null, coupon: cupon({ value: 15 }), decimals: 2 });
        expect(usd.discount).toBe(13500.15);
        const fijo = computeShopCart([{ product_id: 2, qty: 1 }], products, { shipping: 3000, minOrder: null, coupon: cupon({ kind: 'fixed', value: 999999 }), decimals: 0 });
        expect(fijo.discount).toBe(25000.5);
        expect(fijo.total).toBe(3000);
    });

    it('descuenta sólo lo que el cupón cubre y dice por qué no aplica', () => {
        const soloGorra = computeShopCart(lines, products, { shipping: 0, minOrder: null, coupon: cupon({ value: 10, eligible: [2] }), decimals: 0 });
        expect(soloGorra.discount).toBe(5000);
        const nada = computeShopCart([{ product_id: 1, qty: 1 }], products, { shipping: 0, minOrder: null, coupon: cupon({ eligible: [2] }) });
        expect(nada.discount).toBe(0);
        expect(nada.coupon).toBeNull();
        expect(nada.coupon_problem).toBe('no_eligible');
        const minimo = computeShopCart([{ product_id: 1, qty: 1 }], products, { shipping: 0, minOrder: null, coupon: cupon({ min_subtotal: 100000 }) });
        expect(minimo.coupon_problem).toBe('min_subtotal');
        expect(minimo.discount).toBe(0);
        const money = (n: number): string => formatShopMoney(n, 'COP', 'comma_dot');
        expect(shopCouponProblemText('min_subtotal', { min_subtotal: 100000 }, money)).toContain('100,000');
        expect(shopCouponProblemText('no_eligible', { min_subtotal: null }, money)).toContain('no aplica');
        // Lo agotado no cuenta para el descuento.
        const conAgotado = computeShopCart([{ product_id: 3, qty: 1 }, { product_id: 2, qty: 1 }], products, { shipping: 0, minOrder: null, coupon: cupon({ kind: 'fixed', value: 30000 }) });
        expect(conAgotado.discount).toBe(25000.5);
    });

    it('el cupón de envío gratis sólo quita el envío', () => {
        const r = computeShopCart(lines, products, { shipping: 9000, minOrder: null, coupon: cupon({ kind: 'free_shipping', value: 0 }) });
        expect(r.discount).toBe(0);
        expect(r.shipping).toBe(0);
        expect(r.free_shipping).toBe(true);
        expect(r.total).toBe(90001);
    });

    it('los códigos se escriben sin importar mayúsculas y los productos se eligen por producto o categoría', () => {
        expect(normalizeCouponCode('  verano 20 ')).toBe('VERANO20');
        expect(normalizeCouponCode('mal código!')).toBe('');
        expect(normalizeCouponCode(42)).toBe('');
        const items = [
            { id: 10, product_id: 10, categories: ['Camisetas'] },
            { id: 21, product_id: 20, categories: ['Gorras'] },
            { id: 22, product_id: 20, categories: ['Gorras'] },
            { id: 30, product_id: 30, categories: ['Accesorios'] },
        ];
        expect(shopCouponEligible({}, items)).toBeNull();
        // Elegir el producto cubre todas sus variantes; la categoría, sin tildes ni mayúsculas.
        expect(shopCouponEligible({ product_ids: [20] }, items)).toEqual([21, 22]);
        expect(shopCouponEligible({ categories: ['camísetas'] }, items)).toEqual([10]);
        expect(shopCouponEligible({ product_ids: [30], categories: ['Gorras'] }, items)).toEqual([21, 22, 30]);
    });

    it('la configuración guarda zonas válidas y descarta las rotas', () => {
        const c = readShopConfig({
            delivery: [
                {
                    id: 'envio',
                    name: 'Envío',
                    price: 9000,
                    needs_address: true,
                    active: true,
                    free_over: 150000,
                    zones: [
                        { id: 'norte', name: 'Norte', price: 12000 },
                        { id: 'norte', name: 'Repetida', price: 1 },
                        { id: 'MAL ID', name: 'Rota', price: 1 },
                        { id: 'sur', name: 'Sur', price: 6000, free_over: 80000, eta: '1 día' },
                    ],
                },
            ],
        });
        const d = c.delivery.find((x) => x.id === 'envio');
        expect(d?.free_over).toBe(150000);
        expect(d?.zones.map((z) => z.id)).toEqual(['norte', 'sur']);
        expect(d?.zones[1]?.eta).toBe('1 día');
    });
});

describe('v0.1.416 — tipos de producto', () => {
    it('lee el tipo de una columna de selección o de texto (sin tildes ni mayúsculas)', () => {
        expect(shopKindFromText('digital')).toBe('digital');
        expect(shopKindFromText('Descarga digital')).toBe('digital');
        expect(shopKindFromText('E-book')).toBe('digital');
        expect(shopKindFromText('Servicio')).toBe('service');
        expect(shopKindFromText('Sesión de asesoría')).toBe('service');
        expect(shopKindFromText('Físico')).toBe('physical');
        expect(shopKindFromText('Otro')).toBeNull();
        expect(shopKindFromText(3)).toBeNull();
    });

    it('elige el servicio de la agenda: el elegido a mano si sigue activo; si no, el del mismo nombre', () => {
        const services = [
            { id: 'svca', name: 'Asesoria personalizada', active: true },
            { id: 'svcb', name: 'Masaje', active: true },
            { id: 'svcc', name: 'Clase', active: false },
        ];
        expect(shopServiceFor({ id: 1, title: 'Asesoría  Personalizada' }, {}, services)).toBe('svca');
        expect(shopServiceFor({ id: 2, title: 'Otro nombre' }, { '2': 'svcb' }, services)).toBe('svcb');
        // Elegido a mano pero apagado: cae al nombre (y si no hay, a ninguno).
        expect(shopServiceFor({ id: 3, title: 'Clase' }, { '3': 'svcc' }, services)).toBeNull();
        expect(shopServiceFor({ id: 4, title: 'Masaje' }, { '4': 'svcx' }, services)).toBe('svcb');
    });

    it('sólo pide entrega si algo se envía o se recoge', () => {
        const kinds: Record<number, 'physical' | 'digital'> = { 1: 'digital', 2: 'physical' };
        const kindOf = (id: number) => kinds[id] ?? null;
        expect(shopNeedsDelivery([], kindOf)).toBe(false);
        expect(shopNeedsDelivery([{ product_id: 1 }], kindOf)).toBe(false);
        expect(shopNeedsDelivery([{ product_id: 1 }, { product_id: 2 }], kindOf)).toBe(true);
        // Sin tipo conocido se trata como físico (lo seguro: pedir la entrega).
        expect(shopNeedsDelivery([{ product_id: 9 }], kindOf)).toBe(true);
    });

    it('los servicios no van al carrito', () => {
        const p = (id: number, kind?: PublicShopProduct['kind']): PublicShopProduct =>
            ({ id, title: `P${id}`, description: '', price: 1000, compare_price: null, stock: null, images: [], categories: [], sku: '', created_at: '', ...(kind ? { kind } : {}) }) as PublicShopProduct;
        const map = shopPurchasables([p(1), p(2, 'digital'), p(3, 'service')]);
        expect([...map.keys()]).toEqual([1, 2]);
    });

    it('sugiere las columnas de tipo y de descarga por el nombre', () => {
        const fields = [
            { id: 1, type: 'select', label: 'Categoría', slug: 'categoria' },
            { id: 2, type: 'select', label: 'Tipo de producto', slug: 'tipo_de_producto' },
            { id: 3, type: 'file', label: 'Fotos', slug: 'fotos' },
            { id: 4, type: 'file', label: 'Archivo descargable', slug: 'descargable' },
        ] as const;
        expect(suggestShopKindFields(fields as never)).toEqual({ kind_field: 2, download_field: 4 });
        expect(suggestShopKindFields(fields as never, new Set([2, 4]))).toEqual({ kind_field: null, download_field: null });
    });

    it('lee la configuración de tipos con tolerancia', () => {
        const c = readShopConfig({ kinds: { download_days: 9999, max_downloads: 'x', service_links: { '12': 'svcok', 'abc': 'svcx', '13': 5 } } });
        expect(c.kinds.download_days).toBe(30);
        expect(c.kinds.max_downloads).toBe(5);
        expect(c.kinds.service_links).toEqual({ '12': 'svcok' });
        expect(readShopConfig({ kinds: { max_downloads: null } }).kinds.max_downloads).toBeNull();
    });
});

describe('v0.1.417 — suscripciones', () => {
    const p = (id: number, kind?: PublicShopProduct['kind'], variants?: PublicShopVariant[]): PublicShopProduct =>
        ({ id, title: `P${id}`, description: '', price: 1000, compare_price: null, stock: null, images: [], categories: [], sku: '', created_at: '', ...(kind ? { kind } : {}), ...(variants ? { variants } : {}) }) as PublicShopProduct;

    it('reconoce el tipo suscripción antes que los demás', () => {
        expect(shopKindFromText('Suscripción')).toBe('subscription');
        expect(shopKindFromText('Membresía mensual')).toBe('subscription');
        expect(shopKindFromText('Mensualidad')).toBe('subscription');
        expect(shopKindFromText('Curso por suscripción')).toBe('subscription');
        expect(shopKindFromText('subscription')).toBe('subscription');
        expect(shopKindFromText('Curso virtual')).toBe('digital');
    });

    it('elige el plan del producto: el elegido (si sirve) o el del mismo nombre, en la moneda de la tienda', () => {
        const plans = [
            { id: 1, name: 'Club del café', currency: 'COP' },
            { id: 2, name: 'Plan Pro', currency: 'USD' },
            { id: 3, name: 'Caja mensual', currency: 'COP' },
        ];
        expect(shopPlanFor({ id: 10, title: 'Club del Cafe' }, {}, plans, 'COP')).toBe(1);
        expect(shopPlanFor({ id: 10, title: 'Club del café' }, { '10': 3 }, plans, 'COP')).toBe(3);
        // Un plan elegido en otra moneda no sirve: cae al del mismo nombre.
        expect(shopPlanFor({ id: 10, title: 'Club del café' }, { '10': 2 }, plans, 'COP')).toBe(1);
        expect(shopPlanFor({ id: 11, title: 'Plan Pro' }, {}, plans, 'COP')).toBeNull();
        expect(shopPlanFor({ id: 11, title: 'Plan Pro' }, {}, plans, 'usd')).toBe(2);
        expect(shopPlanFor({ id: 12, title: 'Otra cosa' }, {}, plans, 'COP')).toBeNull();
    });

    it('las suscripciones no van al carrito; con `subscriptions` se listan sólo ellas (y sus variantes)', () => {
        const v = (id: number): PublicShopVariant => ({ id, label: `V${id}`, values: [`V${id}`], price: 2000, compare_price: null, stock: null, sku: '', images: [] });
        const list = [p(1), p(2, 'subscription'), p(3, 'service'), p(4, 'subscription', [v(41), v(42)])];
        expect([...shopPurchasables(list).keys()]).toEqual([1]);
        expect([...shopPurchasables(list, { subscriptions: true }).keys()]).toEqual([2, 41, 42]);
    });

    it('lee los planes elegidos con tolerancia', () => {
        const c = readShopConfig({ kinds: { subscription_links: { '5': 7, x: 3, '6': 'a', '7': -1, '8': 2.5 }, subscription_address: 'si' } });
        expect(c.kinds.subscription_links).toEqual({ '5': 7 });
        expect(c.kinds.subscription_address).toBe(false);
        expect(readShopConfig({ kinds: { subscription_address: true } }).kinds.subscription_address).toBe(true);
    });
});

describe('v0.1.421 — qué pasa al agregar y el enlace que arma el carrito', () => {
    it('por defecto se abre el carrito al costado y se ofrece «Comprar ahora»; lo raro vuelve al default', () => {
        const c = readShopConfig({});
        expect(c.display.after_add).toBe('drawer');
        expect(c.display.buy_now).toBe(true);
        expect(c.texts.buy_now).toBe('Comprar ahora');
        expect(readShopConfig({ display: { after_add: 'checkout' } }).display.after_add).toBe('checkout');
        expect(readShopConfig({ display: { after_add: 'volar' } }).display.after_add).toBe('drawer');
    });

    it('lee ?comprar= con ids, cantidades y `cantidad`, y junta repetidos', () => {
        expect(parseShopCartParam('12')).toEqual([{ id: 12, qty: 1 }]);
        expect(parseShopCartParam('12', '3')).toEqual([{ id: 12, qty: 3 }]);
        expect(parseShopCartParam('12:2,15')).toEqual([
            { id: 12, qty: 2 },
            { id: 15, qty: 1 },
        ]);
        expect(parseShopCartParam(' 12 x 2 , 12:1 , abc, -4, 0, 15*9999')).toEqual([
            { id: 12, qty: 3 },
            { id: 15, qty: 999 },
        ]);
        expect(parseShopCartParam('')).toEqual([]);
        expect(parseShopCartParam(null)).toEqual([]);
        expect(parseShopCartParam(Array.from({ length: 40 }, (_, i) => String(i + 1)).join(','))).toHaveLength(20);
    });

    it('arma el valor del enlace', () => {
        expect(shopCartParam([{ id: 12, qty: 2 }, { id: 15, qty: 1 }, { id: -1, qty: 1 }])).toBe('12:2,15');
        expect(parseShopCartParam(shopCartParam([{ id: 7, qty: 4 }]))).toEqual([{ id: 7, qty: 4 }]);
    });
});
