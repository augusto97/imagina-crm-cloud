import { describe, expect, it } from 'vitest';
import {
    computeShopCart,
    defaultShopConfig,
    formatShopMoney,
    missingVariantCombos,
    normalizeCouponCode,
    parseShopCartParam,
    parseShopProductPath,
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
    shopProductPath,
    shopProductSlug,
    shopServiceFor,
    shopShippingFor,
    shopVariantPriceRange,
    suggestShopCatalog,
    suggestShopKindFields,
    shopWhatsappMessage,
    summarizeVariantProduct,
    parseShopQtyInput,
    pluralizeShopUnit,
    shopLineText,
    shopPerUnit,
    shopQtyCap,
    shopQtyLabel,
    shopQtyNext,
    shopQtyRuleFrom,
    shopQtyRuleText,
    shopQtyText,
    shopQtyValid,
    shopUnitFrom,
    snapShopQty,
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
        const r = computeShopCart([{ product_id: 2, qty: 50000 }, { product_id: 2, qty: -3 }], products, { shipping: 0, minOrder: null });
        expect(r.lines[0]!.qty).toBe(10000);
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
        expect(parseShopCartParam(' 12 x 2 , 12:1 , abc, -4, 0, 15*99999')).toEqual([
            { id: 12, qty: 3 },
            { id: 15, qty: 10000 },
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

describe('v0.1.423 — direcciones de producto en el dominio propio', () => {
    it('el nombre pasa a una dirección limpia que termina en el id', () => {
        expect(shopProductSlug('Camiseta azul', 12)).toBe('camiseta-azul-12');
        expect(shopProductSlug('Gorra «Ñandú» & Co', 3)).toBe('gorra-nandu-co-3');
        expect(shopProductSlug('  Café   Orgánico 500g  ', 7)).toBe('cafe-organico-500g-7');
        expect(shopProductSlug('¡¡!!', 9)).toBe('9');
        expect(shopProductSlug('x'.repeat(200), 4)).toBe(`${'x'.repeat(60)}-4`);
        expect(shopProductPath('Pack 12', 7)).toBe('/p/pack-12-7');
    });

    it('de la dirección sale el id, aunque el nombre cambie o falte', () => {
        expect(parseShopProductPath('/p/camiseta-azul-12')).toBe(12);
        expect(parseShopProductPath('/p/pack-12-7')).toBe(7);
        expect(parseShopProductPath('/p/12')).toBe(12);
        expect(parseShopProductPath('/p/otro-nombre-12/')).toBe(12);
        expect(parseShopProductPath('/p/camiseta')).toBeNull();
        expect(parseShopProductPath('/p/camiseta-0')).toBeNull();
        expect(parseShopProductPath('/x/camiseta-12')).toBeNull();
        expect(parseShopProductPath('/p/12/otra')).toBeNull();
        expect(parseShopProductPath('/p/1234567890123456')).toBeNull();
    });

    it('Google: se deja indexar por defecto, y un valor raro no rompe la configuración', () => {
        expect(readShopConfig({}).seo).toEqual({ index: true, title: '', description: '' });
        expect(readShopConfig({ seo: { index: false, title: 'x'.repeat(300), description: 42 } }).seo).toEqual({ index: false, title: '', description: '' });
    });
});

describe('v0.1.424 — la descripción corta', () => {
    const f = (id: number, label: string, type: string, extra: Record<string, unknown> = {}) => ({ id, label, slug: label.toLowerCase().replace(/\s+/g, '_'), type: type as never, ...extra });

    it('se reconoce sola y no le quita la columna a la descripción larga', () => {
        const c = suggestShopCatalog([f(1, 'Nombre', 'text', { is_primary: true }), f(2, 'Precio', 'currency'), f(3, 'Descripción corta', 'text'), f(4, 'Descripción', 'long_text')]);
        expect(c.name).toBe(1);
        expect(c.summary).toBe(3);
        expect(c.description).toBe(4);
    });

    it('también por otros nombres (resumen, extracto) y nunca una columna de otro tipo', () => {
        expect(suggestShopCatalog([f(1, 'Nombre', 'text'), f(2, 'Resumen', 'long_text')]).summary).toBe(2);
        expect(suggestShopCatalog([f(1, 'Nombre', 'text'), f(2, 'Extracto', 'text')]).summary).toBe(2);
        expect(suggestShopCatalog([f(1, 'Nombre', 'text'), f(2, 'Resumen', 'number')]).summary).toBeNull();
    });

    it('sin una columna que parezca descripción corta, queda vacía (y el nombre no se usa dos veces)', () => {
        const c = suggestShopCatalog([f(1, 'Nombre', 'text'), f(2, 'Descripción', 'long_text')]);
        expect(c.summary).toBeNull();
        expect(c.description).toBe(2);
        expect(c.name).toBe(1);
    });

    it('mostrarla en las tarjetas viene encendido y se lee con tolerancia', () => {
        expect(readShopConfig({}).display.show_summary).toBe(true);
        expect(readShopConfig({ display: { show_summary: false } }).display.show_summary).toBe(false);
        expect(readShopConfig({ display: { show_summary: 'quizá' } }).display.show_summary).toBe(true);
        expect(readShopConfig({ catalog: { summary: 'x' } }).catalog.summary).toBeNull();
    });
});

describe('v0.1.429 — unidades de venta', () => {
    it('arma el plural de la unidad y respeta lo escrito a mano', () => {
        expect(pluralizeShopUnit('hora')).toBe('horas');
        expect(pluralizeShopUnit('mes')).toBe('meses');
        expect(pluralizeShopUnit('sesión')).toBe('sesiones');
        expect(pluralizeShopUnit('licencia')).toBe('licencias');
        expect(pluralizeShopUnit('lápiz')).toBe('lápices');
        expect(pluralizeShopUnit('metro cuadrado')).toBe('metros cuadrados');
        expect(pluralizeShopUnit('hora de asesoría')).toBe('horas de asesoría');
        expect(pluralizeShopUnit('kg')).toBe('kg');
        expect(pluralizeShopUnit('GB')).toBe('GB');
        expect(pluralizeShopUnit('m²')).toBe('m²');
        expect(shopUnitFrom('mes/meses')).toEqual({ one: 'mes', many: 'meses' });
        expect(shopUnitFrom(' Año ')).toEqual({ one: 'Año', many: 'Años' });
        expect(shopUnitFrom('unidad')).toBeNull();
        expect(shopUnitFrom('und')).toBeNull();
        expect(shopUnitFrom('')).toBeNull();
        expect(shopUnitFrom(12)).toBeNull();
    });

    it('lee la regla de las columnas y vuelve a lo de siempre con lo vacío o raro', () => {
        expect(shopQtyRuleFrom({})).toBeNull();
        expect(shopQtyRuleFrom({ min: 1, step: 1 })).toBeNull();
        expect(shopQtyRuleFrom({ min: 2 })).toEqual({ min: 2, max: null, step: 1 });
        // Sin mínimo, el mínimo es el paso.
        expect(shopQtyRuleFrom({ step: 5 })).toEqual({ min: 5, max: null, step: 5 });
        expect(shopQtyRuleFrom({ step: '0,5' })).toEqual({ min: 0.5, max: null, step: 0.5 });
        // Un máximo menor que el mínimo se ignora; negativos y texto, también.
        expect(shopQtyRuleFrom({ min: 10, max: 3 })).toEqual({ min: 10, max: null, step: 1 });
        expect(shopQtyRuleFrom({ min: -2, max: 'mucho', step: 0 })).toBeNull();
    });

    it('lleva la cantidad a la válida más cercana y respeta el máximo y el stock', () => {
        const rule = { min: 2, max: 40, step: 1 };
        expect(snapShopQty(1, rule)).toBe(2);
        expect(snapShopQty(7, rule)).toBe(7);
        expect(snapShopQty(99, rule)).toBe(40);
        expect(snapShopQty(0, rule)).toBe(0);
        const kg = { min: 0.5, max: null, step: 0.5 };
        expect(snapShopQty(1.3, kg)).toBe(1.5);
        expect(snapShopQty(0.2, kg)).toBe(0.5);
        // De a 5 desde 10: 10, 15, 20…
        const box = { min: 10, max: null, step: 5 };
        expect(snapShopQty(12, box)).toBe(10);
        expect(snapShopQty(13, box)).toBe(15);
        expect(shopQtyCap(box, 23)).toBe(20);
        expect(shopQtyCap(box, 9)).toBe(0);
        expect(shopQtyCap(null, 4.7)).toBe(4);
        expect(shopQtyValid(15, box)).toBe(true);
        expect(shopQtyValid(16, box)).toBe(false);
    });

    it('suma y resta de a pasos; bajar del mínimo saca el producto', () => {
        const box = { min: 10, max: 20, step: 5 };
        expect(shopQtyNext(0, box, 1)).toBe(10);
        expect(shopQtyNext(10, box, 1)).toBe(15);
        expect(shopQtyNext(20, box, 1)).toBe(20);
        expect(shopQtyNext(15, box, -1)).toBe(10);
        expect(shopQtyNext(10, box, -1)).toBe(0);
        expect(shopQtyNext(1.5, { min: 0.5, max: null, step: 0.5 }, 1)).toBe(2);
        expect(shopQtyNext(1, null, 1, 1)).toBe(1);
    });

    it('dice la cantidad y la regla en palabras', () => {
        const hora = shopUnitFrom('hora');
        expect(shopQtyText(1, hora, 'dot_comma')).toBe('1 hora');
        expect(shopQtyText(3, hora, 'dot_comma')).toBe('3 horas');
        expect(shopQtyText(1.5, shopUnitFrom('kg'), 'dot_comma')).toBe('1,5 kg');
        expect(shopQtyText(1.5, shopUnitFrom('kg'), 'comma_dot')).toBe('1.5 kg');
        expect(shopQtyText(2, null, 'dot_comma')).toBe('2');
        expect(shopQtyText(2, shopUnitFrom('Hora'), 'dot_comma')).toBe('2 horas');
        expect(shopQtyLabel(hora)).toBe('Horas');
        expect(shopQtyLabel(null)).toBe('Cantidad');
        expect(shopQtyLabel(shopUnitFrom('kg'))).toBe('Cantidad (kg)');
        expect(shopQtyLabel(shopUnitFrom('mes/meses'))).toBe('Meses');
        expect(shopPerUnit(hora)).toBe(' / hora');
        expect(shopPerUnit(null)).toBe('');
        expect(shopQtyRuleText({ min: 2, max: 40, step: 1 }, hora, 'dot_comma')).toBe('Mínimo 2 horas · máximo 40 horas');
        expect(shopQtyRuleText({ min: 5, max: null, step: 5 }, null, 'dot_comma')).toBe('De a 5');
        expect(shopQtyRuleText(null, hora, 'dot_comma')).toBe('');
    });

    it('lee la cantidad que escribe la persona', () => {
        expect(parseShopQtyInput('1,5')).toBe(1.5);
        expect(parseShopQtyInput('1.5')).toBe(1.5);
        expect(parseShopQtyInput('1.500', 'dot_comma')).toBe(1500);
        expect(parseShopQtyInput('1,500', 'comma_dot')).toBe(1500);
        expect(parseShopQtyInput('abc')).toBeNull();
        expect(parseShopQtyInput('0')).toBeNull();
        expect(parseShopQtyInput('')).toBeNull();
    });

    it('el carrito corrige la cantidad, la marca y cobra los decimales', () => {
        const map = new Map<number, ShopCartProduct>([
            [1, { id: 1, title: 'Asesoría', price: 50000, stock: null, unit: { one: 'hora', many: 'horas' }, qty: { min: 2, max: 40, step: 1 } }],
            [2, { id: 2, title: 'Café', price: 32000, stock: 3.2, unit: { one: 'kg', many: 'kg' }, qty: { min: 0.5, max: null, step: 0.5 } }],
        ]);
        const r = computeShopCart(
            [
                { product_id: 1, qty: 1 },
                { product_id: 2, qty: 1.5 },
            ],
            map,
            { shipping: 0, minOrder: null },
        );
        expect(r.lines.map((l) => [l.qty, l.subtotal, l.adjusted ?? false])).toEqual([
            [2, 100000, true],
            [1.5, 48000, false],
        ]);
        expect(r.total).toBe(148000);
        expect(r.blocked).toBe(false);
        // Pasa el stock: lo que alcanza en pasos de 0,5.
        const low = computeShopCart([{ product_id: 2, qty: 5 }], map, { shipping: 0, minOrder: null });
        expect(low.lines[0]!.problem).toBe('low_stock');
        expect(low.lines[0]!.available).toBe(3);
        expect(shopLineProblemText(low.lines[0]!)).toContain('3 kg');
        expect(shopLineText({ title: 'Asesoría', qty: 3, unit: { one: 'hora', many: 'horas' } }, 'dot_comma')).toBe('Asesoría · 3 horas');
        expect(shopLineText({ title: 'Camiseta', qty: 2 }, 'dot_comma')).toBe('2 × Camiseta');
    });

    it('el enlace del carrito lleva cantidades con decimales', () => {
        expect(parseShopCartParam('7:1.5,8:2')).toEqual([
            { id: 7, qty: 1.5 },
            { id: 8, qty: 2 },
        ]);
        expect(shopCartParam([{ id: 7, qty: 1.5 }])).toBe('7:1.5');
        expect(parseShopCartParam(shopCartParam([{ id: 7, qty: 0.25 }]))).toEqual([{ id: 7, qty: 0.25 }]);
    });

    it('las variantes heredan la unidad y la regla del producto', () => {
        const base: PublicShopProduct = {
            id: 1,
            title: 'Café',
            price: 30000,
            compare_price: null,
            images: [],
            description: '',
            categories: [],
            stock: null,
            sku: '',
            created_at: '2026-11-01T00:00:00Z',
            unit: { one: 'kg', many: 'kg' },
            qty: { min: 0.5, max: null, step: 0.5 },
        };
        const v: PublicShopVariant = { id: 11, label: 'Molido', price: 32000, compare_price: null, stock: 10, sku: '', images: [], values: ['Molido'] };
        const items = shopPurchasables([{ ...base, variants: [v] }]);
        const it11 = items.get(11)!;
        expect(it11.unit).toEqual({ one: 'kg', many: 'kg' });
        expect(it11.qty).toEqual({ min: 0.5, max: null, step: 0.5 });
    });
});
