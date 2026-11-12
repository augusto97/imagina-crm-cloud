import { groupNumberPlain } from './shop-number';
import type { PublicDataConsent } from './data-consent';
import type { PublicFormCaptcha } from './form';
import type { FieldType } from './field';
import type { ShopCatalogFields, ShopCheckout, ShopCustomer, ShopDisplay, ShopPolicies, ShopSeller, ShopTexts } from './shop';
import type { TenantFormat } from './tenant';

/**
 * v0.1.412 (ADR-S103) — La lógica PURA de la tienda, sin validadores: la usan
 * el servidor, el editor y la página pública (que no carga zod). El precio,
 * el stock y el total los decide SIEMPRE el servidor con estas funciones; el
 * navegador sólo muestra una estimación.
 */

export const SHOP_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const SHOP_ORDER_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
export const SHOP_ITEM_ID_RE = /^[a-z0-9]{1,16}$/;

/** Cuántos productos muestra una tienda (catálogos chicos y medianos). */
export const SHOP_MAX_PUBLIC_PRODUCTS = 600;
/** Productos distintos en un pedido. */
export const SHOP_MAX_LINES = 50;
/** Unidades de un mismo producto en un pedido. */
export const SHOP_MAX_QTY = 999;
export const SHOP_MAX_DELIVERY_METHODS = 10;
/** v0.1.415 — Zonas de envío por forma de entrega (barrios, ciudades, regiones). */
export const SHOP_MAX_DELIVERY_ZONES = 40;
/** v0.1.415 — Cupones por tienda. */
export const SHOP_MAX_COUPONS = 200;
/** Un código: letras, números, guion y guion bajo (se guarda en mayúsculas). */
export const SHOP_COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;
export const SHOP_COUPON_KINDS = ['percent', 'fixed', 'free_shipping'] as const;
export type ShopCouponKind = (typeof SHOP_COUPON_KINDS)[number];
export const SHOP_COUPON_KIND_LABELS: Record<ShopCouponKind, string> = {
    percent: 'Porcentaje de descuento',
    fixed: 'Monto fijo de descuento',
    free_shipping: 'Envío gratis',
};

/** «  verano-20 » → «VERANO-20»; lo que no sirve como código → ''. */
export function normalizeCouponCode(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    const code = raw.trim().toUpperCase().replace(/\s+/g, '');
    return SHOP_COUPON_CODE_RE.test(code) ? code : '';
}
/** Fotos por producto que se muestran. */
export const SHOP_MAX_IMAGES = 8;
/** v0.1.414 — Atributos que distinguen las variantes (talla, color, material). */
export const SHOP_MAX_VARIANT_ATTRIBUTES = 3;
/** v0.1.414 — Variantes por producto que muestra la tienda (las demás no se venden). */
export const SHOP_MAX_VARIANTS = 60;
/** v0.1.414 — Variantes que crea el generador de una vez. */
export const SHOP_MAX_GENERATED_VARIANTS = 60;
/** Los tipos de campo que sirven como atributo de una variante. */
export const SHOP_VARIANT_ATTRIBUTE_TYPES = ['select', 'text'] as const;
/** Anchos de las miniaturas que sirve la tienda. */
export const SHOP_IMAGE_WIDTHS = [160, 320, 640, 1200] as const;
export type ShopImageWidth = (typeof SHOP_IMAGE_WIDTHS)[number];

const PHONE_RE = /^\+[1-9]\d{6,14}$/;

export const SHOP_WHATSAPP_DEFAULT_INTRO = 'Hola, quiero hacer este pedido:';

// ── Estados del pedido ──────────────────────────────────────────────────

/** Lo que maneja el equipo (columna «Estado del pedido», editable). */
export const SHOP_ORDER_STATUSES = ['nuevo', 'en_preparacion', 'enviado', 'entregado', 'cancelado'] as const;
export type ShopOrderStatus = (typeof SHOP_ORDER_STATUSES)[number];
export const SHOP_ORDER_STATUS_LABELS: Record<ShopOrderStatus, string> = {
    nuevo: 'Nuevo',
    en_preparacion: 'En preparación',
    enviado: 'Enviado',
    entregado: 'Entregado',
    cancelado: 'Cancelado',
};
export const SHOP_ORDER_STATUS_COLORS: Record<ShopOrderStatus, string> = {
    nuevo: '#2563eb',
    en_preparacion: '#d97706',
    enviado: '#7c3aed',
    entregado: '#16a34a',
    cancelado: '#6b7280',
};

/** Lo que escribe la tienda (columna «Estado del pago», protegida). */
export const SHOP_PAYMENT_STATUSES = ['pendiente', 'pagado', 'vencido', 'reembolsado'] as const;
export type ShopPaymentStatus = (typeof SHOP_PAYMENT_STATUSES)[number];
export const SHOP_PAYMENT_STATUS_LABELS: Record<ShopPaymentStatus, string> = {
    pendiente: 'Pendiente de pago',
    pagado: 'Pagado',
    vencido: 'No se pagó',
    reembolsado: 'Reembolsado',
};
export const SHOP_PAYMENT_STATUS_COLORS: Record<ShopPaymentStatus, string> = {
    pendiente: '#d97706',
    pagado: '#16a34a',
    vencido: '#6b7280',
    reembolsado: '#dc2626',
};

export const SHOP_PAYMENT_METHODS = ['whatsapp', 'transfer', 'cod', 'online'] as const;
export type ShopPaymentMethod = (typeof SHOP_PAYMENT_METHODS)[number];
export const SHOP_PAYMENT_METHOD_LABELS: Record<ShopPaymentMethod, string> = {
    whatsapp: 'Pedido por WhatsApp',
    transfer: 'Transferencia',
    cod: 'Contra entrega',
    online: 'Pago en línea',
};

/**
 * v0.1.413 — Cómo se ve el pago en línea en la tienda según la cuenta de cobro
 * de la empresa (Mercado Pago, Wompi o PayPal). Sin zod: lo usa la página.
 */
export function shopOnlinePayment(provider: string | null | undefined): { label: string; instructions: string; provider_label: string } {
    switch (provider) {
        case 'wompi':
            return { label: 'Pagar en línea', provider_label: 'Wompi', instructions: 'Con tarjeta, PSE, Nequi o Bancolombia. Al confirmar te llevamos a Wompi para pagar.' };
        case 'paypal':
            return { label: 'Pagar con PayPal', provider_label: 'PayPal', instructions: 'Con tarjeta o tu cuenta de PayPal. Al confirmar te llevamos a PayPal para pagar.' };
        case 'mercadopago':
            return { label: 'Pagar en línea', provider_label: 'Mercado Pago', instructions: 'Con tarjeta, PSE, Nequi o efectivo. Al confirmar te llevamos a Mercado Pago para pagar.' };
        default:
            return { label: 'Pagar en línea', provider_label: '', instructions: 'Al confirmar te llevamos a pagar en línea.' };
    }
}

/** v0.1.413 — Cuánto se aparta el stock mientras la persona paga en línea. */
export const SHOP_HOLD_MINUTES_MIN = 10;
export const SHOP_HOLD_MINUTES_MAX = 240;

// ── Catálogo: qué campo sirve para cada papel ───────────────────────────

/**
 * Los tipos de campo que sirven para cada papel. Sólo valores GUARDADOS (no
 * calculados): el pedido descuenta stock y congela el precio dentro de una
 * transacción con los productos bloqueados, y ahí no corre el motor de
 * fórmulas. Un precio con IVA se guarda calculado o se usa una automatización.
 */
export const SHOP_CATALOG_FIELD_TYPES: Record<keyof ShopCatalogFields, readonly FieldType[]> = {
    name: ['text', 'long_text'],
    price: ['currency', 'number'],
    compare_price: ['currency', 'number'],
    images: ['file', 'url'],
    description: ['long_text', 'text'],
    category: ['select', 'multi_select', 'text'],
    stock: ['number'],
    sku: ['text', 'autonumber'],
    active: ['checkbox'],
};

export const SHOP_CATALOG_ROLE_LABELS: Record<keyof ShopCatalogFields, string> = {
    name: 'Nombre del producto',
    price: 'Precio',
    compare_price: 'Precio antes (tachado)',
    images: 'Fotos',
    description: 'Descripción',
    category: 'Categoría',
    stock: 'Unidades disponibles',
    sku: 'Referencia (SKU)',
    active: '¿Se vende?',
};

function foldName(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

const ROLE_WORDS: Record<keyof ShopCatalogFields, string[]> = {
    name: ['nombre', 'producto', 'titulo', 'name', 'title', 'articulo'],
    price: ['precio', 'valor', 'price', 'pvp', 'precio venta', 'precio de venta'],
    compare_price: ['precio antes', 'antes', 'precio anterior', 'precio regular', 'precio normal', 'compare', 'precio lista'],
    images: ['foto', 'fotos', 'imagen', 'imagenes', 'image', 'images', 'galeria', 'portada'],
    description: ['descripcion', 'detalle', 'detalles', 'description', 'caracteristicas'],
    category: ['categoria', 'categorias', 'category', 'tipo', 'linea', 'coleccion'],
    stock: ['stock', 'inventario', 'existencias', 'disponibles', 'unidades', 'cantidad', 'disponible'],
    sku: ['sku', 'referencia', 'codigo', 'ref', 'codigo de barras'],
    active: ['activo', 'publicado', 'se vende', 'visible', 'disponible en tienda', 'en tienda', 'a la venta'],
};

/**
 * Propone qué campo cumple cada papel, por el nombre y el tipo. Un campo no
 * cumple dos papeles. El precio y el «precio antes» comparten tipo: gana el
 * nombre (si ninguno dice «antes», el primer numérico es el precio).
 */
export function suggestShopCatalog(
    fields: ReadonlyArray<{ id: number; type: FieldType; label: string; slug: string; is_primary?: boolean }>,
): ShopCatalogFields {
    const out: ShopCatalogFields = {
        name: null,
        price: null,
        compare_price: null,
        images: null,
        description: null,
        category: null,
        stock: null,
        sku: null,
        active: null,
    };
    const used = new Set<number>();
    const score = (role: keyof ShopCatalogFields, f: { label: string; slug: string }): number => {
        const name = foldName(`${f.label}`);
        const slug = foldName(f.slug.replace(/_/g, ' '));
        let best = 0;
        for (const w of ROLE_WORDS[role]) {
            if (name === w || slug === w) best = Math.max(best, 3);
            else if (name.startsWith(`${w} `) || name.endsWith(` ${w}`) || name.includes(` ${w} `)) best = Math.max(best, 2);
            else if (name.includes(w) || slug.includes(w)) best = Math.max(best, 1);
        }
        return best;
    };
    const order: (keyof ShopCatalogFields)[] = ['compare_price', 'price', 'stock', 'sku', 'images', 'category', 'active', 'description', 'name'];
    for (const role of order) {
        const types = SHOP_CATALOG_FIELD_TYPES[role];
        let pick: { id: number; s: number } | null = null;
        for (const f of fields) {
            if (used.has(f.id) || !types.includes(f.type)) continue;
            const s = score(role, f) + (role === 'name' && f.is_primary ? 4 : 0);
            // El «precio antes» sólo por nombre; el resto también por tipo (con desempate por nombre).
            if (s === 0 && (role === 'compare_price' || role === 'active' || role === 'stock' || role === 'sku' || role === 'description' || role === 'category')) continue;
            if (!pick || s > pick.s) pick = { id: f.id, s };
        }
        if (pick) {
            out[role] = pick.id;
            used.add(pick.id);
        }
    }
    return out;
}

/** Clave de una foto en la dirección pública: `f<id>` (archivo) o `u<hash>` (enlace). */
export function shopImageKeyForFile(fileId: number): string {
    return `f${fileId}`;
}

// ── Dinero ──────────────────────────────────────────────────────────────

/** Todas las cuentas en centavos: los decimales de punto flotante no suman bien. */
export function toCents(n: number): number {
    return Math.round(n * 100);
}
export function fromCents(c: number): number {
    return Math.round(c) / 100;
}

/** Monedas sin centavos visibles (COP, CLP…): el precio se muestra entero. */
const ZERO_DECIMAL = new Set(['COP', 'CLP', 'PYG', 'JPY', 'KRW', 'VND', 'ISK', 'HUF']);

export function shopCurrencyDecimals(currency: string): number {
    return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

const CURRENCY_SYMBOL: Record<string, string> = { COP: '$', USD: 'US$', MXN: '$', CLP: '$', PEN: 'S/', ARS: '$', EUR: '€', BRL: 'R$' };

/** `$ 120.000` con los separadores de la empresa. */
export function formatShopMoney(amount: number, currency: string, format: TenantFormat['number_format']): string {
    const dec = shopCurrencyDecimals(currency);
    const value = dec === 0 ? Math.round(amount) : amount;
    const num = groupNumberPlain(value, dec, format);
    const sym = CURRENCY_SYMBOL[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
    return `${sym}${sym.endsWith(' ') ? '' : ' '}${num}`.replace(/\s+/g, ' ').trim();
}

// ── Productos y carrito ─────────────────────────────────────────────────

/** Un producto como lo ve la tienda pública. */
export interface PublicShopProduct {
    id: number;
    title: string;
    price: number | null;
    compare_price: number | null;
    /** Rutas relativas de las miniaturas (`img/<clave>`), sin el ancho. */
    images: string[];
    description: string;
    categories: string[];
    /** null = sin límite (o la tienda no controla stock). */
    stock: number | null;
    sku: string;
    /** `created_at` para ordenar por lo más nuevo. */
    created_at: string;
    /**
     * v0.1.414 — Las variantes (talla, color…). Con variantes el producto no se
     * compra directamente: se elige una. El precio del producto es el más bajo
     * de sus variantes y el stock, la suma (null si alguna no tiene límite).
     */
    variants?: PublicShopVariant[];
    /** v0.1.414 — Los atributos y sus valores, en orden, para elegir la variante. */
    options?: PublicShopOption[];
}

/** v0.1.414 — Una variante como la ve la tienda pública. */
export interface PublicShopVariant {
    id: number;
    /** «M / Rojo»: lo que se ve en el carrito y en el pedido. */
    label: string;
    /** Un valor por atributo, alineado con `options` del producto. */
    values: string[];
    price: number | null;
    compare_price: number | null;
    stock: number | null;
    sku: string;
    /** Sus fotos (vacío = las del producto). */
    images: string[];
}

export interface PublicShopOption {
    name: string;
    values: string[];
}

/** Lo que se compra: un producto simple o una variante (con su producto). */
export interface ShopPurchasable extends ShopCartProduct {
    product: PublicShopProduct;
    variant: PublicShopVariant | null;
    images: string[];
    sku: string;
}

/** «Camiseta · M / Rojo»: el nombre de una variante en el carrito y el pedido. */
export function shopVariantTitle(productTitle: string, label: string): string {
    return label ? `${productTitle} · ${label}`.slice(0, 250) : productTitle;
}

/**
 * Lo que se puede poner en el carrito, por id: los productos sin variantes y
 * cada variante (un producto CON variantes no se compra directamente). La usan
 * la página (estimación) y el servidor (la cuenta del carrito).
 */
export function shopPurchasables(products: readonly PublicShopProduct[]): Map<number, ShopPurchasable> {
    const out = new Map<number, ShopPurchasable>();
    for (const p of products) {
        if (p.variants && p.variants.length > 0) {
            for (const v of p.variants) {
                out.set(v.id, {
                    id: v.id,
                    title: shopVariantTitle(p.title, v.label),
                    price: v.price,
                    stock: v.stock,
                    product: p,
                    variant: v,
                    images: v.images.length > 0 ? v.images : p.images,
                    sku: v.sku || p.sku,
                });
            }
            continue;
        }
        out.set(p.id, { id: p.id, title: p.title, price: p.price, stock: p.stock, product: p, variant: null, images: p.images, sku: p.sku });
    }
    return out;
}

/** La variante que corresponde a lo elegido (un valor por atributo; null = sin elegir). */
export function pickShopVariant(p: PublicShopProduct, selected: readonly (string | null)[]): PublicShopVariant | null {
    const opts = p.options ?? [];
    if (!p.variants || opts.length === 0) return null;
    for (let i = 0; i < opts.length; i++) if (!selected[i]) return null;
    return p.variants.find((v) => opts.every((_, i) => v.values[i] === selected[i])) ?? null;
}

/**
 * Cómo se ve un valor de un atributo dado lo ya elegido en los OTROS: si no
 * hay ninguna variante con esa combinación (`none`), si todas están agotadas
 * (`sold_out`) o si se puede comprar (`ok`).
 */
export function shopOptionValueState(p: PublicShopProduct, selected: readonly (string | null)[], optIdx: number, value: string): 'ok' | 'sold_out' | 'none' {
    const opts = p.options ?? [];
    let any = false;
    for (const v of p.variants ?? []) {
        if (v.values[optIdx] !== value) continue;
        let match = true;
        for (let i = 0; i < opts.length; i++) {
            if (i === optIdx) continue;
            const s = selected[i];
            if (s && v.values[i] !== s) {
                match = false;
                break;
            }
        }
        if (!match) continue;
        any = true;
        if (v.price !== null && (v.stock === null || v.stock > 0)) return 'ok';
    }
    return any ? 'sold_out' : 'none';
}

/** El rango de precios de las variantes (null = sin variantes con precio). */
export function shopVariantPriceRange(p: PublicShopProduct): { min: number; max: number } | null {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const v of p.variants ?? []) {
        if (v.price === null) continue;
        min = Math.min(min, v.price);
        max = Math.max(max, v.price);
    }
    return Number.isFinite(min) ? { min, max } : null;
}

/**
 * El producto visto desde sus variantes: precio = el más bajo (con su «antes»),
 * stock = la suma (null si alguna no tiene límite o la tienda no controla
 * stock) y, sin fotos propias, las de la primera variante que tenga.
 */
export function summarizeVariantProduct(p: PublicShopProduct, variants: PublicShopVariant[], options: PublicShopOption[]): PublicShopProduct {
    if (variants.length === 0) return { ...p, variants: undefined, options: undefined };
    let cheapest: PublicShopVariant | null = null;
    for (const v of variants) if (v.price !== null && (cheapest === null || v.price < (cheapest.price ?? Infinity))) cheapest = v;
    let stock: number | null = 0;
    for (const v of variants) {
        if (v.stock === null) {
            stock = null;
            break;
        }
        stock += Math.max(0, v.stock);
    }
    const images = p.images.length > 0 ? p.images : (variants.find((v) => v.images.length > 0)?.images ?? []);
    return {
        ...p,
        price: cheapest?.price ?? null,
        compare_price: cheapest && cheapest.compare_price !== null && cheapest.price !== null && cheapest.compare_price > cheapest.price ? cheapest.compare_price : null,
        stock,
        images,
        variants,
        options,
    };
}

function foldValue(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * v0.1.414 — Las combinaciones que faltan: todas las de los valores elegidos
 * (Talla × Color) menos las que el producto ya tiene. Compara sin tildes ni
 * mayúsculas. Tope `SHOP_MAX_GENERATED_VARIANTS`.
 */
export function missingVariantCombos(
    chosen: readonly (readonly string[])[],
    existing: readonly (readonly string[])[],
): { combos: string[][]; existing: number; truncated: boolean } {
    const clean = chosen.map((vals) => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const raw of vals) {
            const v = String(raw ?? '').trim().slice(0, 80);
            const k = foldValue(v);
            if (!v || seen.has(k)) continue;
            seen.add(k);
            out.push(v);
        }
        return out;
    });
    if (clean.length === 0 || clean.some((v) => v.length === 0)) return { combos: [], existing: 0, truncated: false };
    const have = new Set(existing.map((vals) => vals.map((v) => foldValue(String(v ?? ''))).join('\u0001')));
    const combos: string[][] = [];
    let found = 0;
    let truncated = false;
    const walk = (i: number, acc: string[]): void => {
        if (truncated) return;
        if (i === clean.length) {
            if (have.has(acc.map(foldValue).join('\u0001'))) {
                found++;
                return;
            }
            if (combos.length >= SHOP_MAX_GENERATED_VARIANTS) {
                truncated = true;
                return;
            }
            combos.push([...acc]);
            return;
        }
        for (const v of clean[i]!) walk(i + 1, [...acc, v]);
    };
    walk(0, []);
    return { combos, existing: found, truncated };
}

export interface ShopCartLineInput {
    product_id: number;
    qty: number;
}

export interface ShopCartProduct {
    id: number;
    title: string;
    price: number | null;
    stock: number | null;
}

export type ShopLineProblem = 'unavailable' | 'no_price' | 'no_stock' | 'low_stock';

export interface ShopCartLine {
    product_id: number;
    title: string;
    qty: number;
    unit_price: number;
    subtotal: number;
    problem: ShopLineProblem | null;
    /** Con `low_stock`: cuántas quedan. */
    available: number | null;
}

export interface ShopCartResult {
    lines: ShopCartLine[];
    subtotal: number;
    /** v0.1.415 — Lo que descuenta el cupón (0 sin cupón). */
    discount: number;
    shipping: number;
    total: number;
    /** Hay algo que impide comprar (producto que no existe, sin stock, sin precio). */
    blocked: boolean;
    /** La compra mínima no se alcanza (en la moneda de la tienda). */
    below_minimum: number | null;
    /** v0.1.415 — El cupón aplicado (null si no hay o no aplica). */
    coupon: { code: string; label: string; kind: ShopCouponKind } | null;
    /** v0.1.415 — Por qué el cupón escrito no aplica a este carrito. */
    coupon_problem: ShopCouponProblem | null;
    /** v0.1.415 — El envío salió gratis (por el cupón o por superar el monto). */
    free_shipping: boolean;
    /** v0.1.415 — Cuánto falta para el envío gratis (null si no hay o ya se alcanzó). */
    free_shipping_missing: number | null;
}

/**
 * v0.1.415 — Un cupón ya validado por el servidor (fechas, usos, activo).
 * `eligible` = los productos (o variantes) que descuenta; null = todos.
 */
export interface ShopCouponRule {
    code: string;
    label: string;
    kind: ShopCouponKind;
    value: number;
    min_subtotal: number | null;
    eligible: number[] | null;
}

export type ShopCouponProblem = 'min_subtotal' | 'no_eligible';

/** v0.1.415 — La cuenta del carrito que devuelve el servidor, con el cupón validado. */
export interface PublicShopQuote extends ShopCartResult {
    /** El cupón escrito no sirve (no existe, venció, se agotó…). */
    coupon_error: string | null;
    /** El cupón que sirve: la página lo usa para recalcular en vivo con `computeShopCart`. */
    coupon_rule: ShopCouponRule | null;
}

/** Sin tildes ni mayúsculas, para comparar categorías. */
function foldText(v: string): string {
    return v
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * v0.1.415 — Qué se puede comprar con descuento: los productos elegidos (un
 * producto con variantes cubre todas) o los de las categorías elegidas. Sin
 * productos ni categorías, todo (null).
 */
export function shopCouponEligible(
    scope: { product_ids?: readonly number[]; categories?: readonly string[] },
    items: Iterable<{ id: number; product_id: number; categories: readonly string[] }>,
): number[] | null {
    const ids = new Set(scope.product_ids ?? []);
    const cats = new Set((scope.categories ?? []).map(foldText).filter(Boolean));
    if (ids.size === 0 && cats.size === 0) return null;
    const out: number[] = [];
    for (const it of items) {
        if (ids.has(it.product_id) || ids.has(it.id) || it.categories.some((c) => cats.has(foldText(c)))) out.push(it.id);
    }
    return out;
}

/** El texto de un cupón que no aplica, para mostrarlo junto al código. */
export function shopCouponProblemText(problem: ShopCouponProblem, rule: Pick<ShopCouponRule, 'min_subtotal'>, money: (n: number) => string): string {
    if (problem === 'min_subtotal') return `Este cupón es para compras desde ${money(rule.min_subtotal ?? 0)}.`;
    return 'Este cupón no aplica a los productos de tu carrito.';
}

/** «15 % de descuento», «$ 10.000 de descuento», «Envío gratis». */
export function shopCouponLabel(rule: Pick<ShopCouponRule, 'kind' | 'value'>, money: (n: number) => string): string {
    if (rule.kind === 'percent') return `${rule.value} % de descuento`;
    if (rule.kind === 'fixed') return `${money(rule.value)} de descuento`;
    return 'Envío gratis';
}

/** Una forma de entrega con lo que cuesta (con sus zonas). */
export interface ShopShippingSource {
    price: number;
    free_over: number | null;
    zones?: ReadonlyArray<{ id: string; price: number; free_over: number | null }>;
}

/**
 * v0.1.415 — Cuánto cuesta el envío y desde cuánto es gratis, según la zona.
 * Con zonas, la zona elegida manda; sin zona elegida se usa el precio de la
 * forma de entrega (la página pide elegirla antes de comprar).
 */
export function shopShippingFor(source: ShopShippingSource | null | undefined, zoneId: string | null | undefined): { price: number; free_over: number | null; zone_required: boolean } {
    if (!source) return { price: 0, free_over: null, zone_required: false };
    const zones = source.zones ?? [];
    if (zones.length === 0) return { price: source.price, free_over: source.free_over, zone_required: false };
    const z = zoneId ? zones.find((x) => x.id === zoneId) : undefined;
    if (!z) return { price: source.price, free_over: source.free_over, zone_required: true };
    return { price: z.price, free_over: z.free_over ?? source.free_over, zone_required: true };
}

/**
 * Suma el carrito con los precios y el stock que manda el servidor. Junta las
 * líneas repetidas, recorta cantidades imposibles y marca lo que no se puede
 * comprar. La usan la página (estimación) y el checkout (la cuenta que vale).
 */
export function computeShopCart(
    input: readonly ShopCartLineInput[],
    products: ReadonlyMap<number, ShopCartProduct>,
    opts: {
        shipping: number;
        minOrder: number | null;
        /** v0.1.415 — Envío gratis cuando los productos (con el descuento) llegan a este monto. */
        freeOver?: number | null;
        coupon?: ShopCouponRule | null;
        /** Decimales de la moneda: el descuento se redondea a la unidad que se cobra. */
        decimals?: number;
    },
): ShopCartResult {
    const merged = new Map<number, number>();
    for (const l of input) {
        if (!Number.isInteger(l.product_id) || l.product_id <= 0) continue;
        const qty = Math.min(SHOP_MAX_QTY, Math.max(0, Math.floor(Number(l.qty) || 0)));
        if (qty === 0) continue;
        merged.set(l.product_id, Math.min(SHOP_MAX_QTY, (merged.get(l.product_id) ?? 0) + qty));
        if (merged.size >= SHOP_MAX_LINES) break;
    }
    const lines: ShopCartLine[] = [];
    let subtotalC = 0;
    let blocked = false;
    for (const [id, qty] of merged) {
        const p = products.get(id);
        if (!p) {
            lines.push({ product_id: id, title: '', qty, unit_price: 0, subtotal: 0, problem: 'unavailable', available: 0 });
            blocked = true;
            continue;
        }
        if (p.price === null || !(p.price >= 0)) {
            lines.push({ product_id: id, title: p.title, qty, unit_price: 0, subtotal: 0, problem: 'no_price', available: null });
            blocked = true;
            continue;
        }
        let problem: ShopLineProblem | null = null;
        let available: number | null = null;
        if (p.stock !== null) {
            const stock = Math.max(0, Math.floor(p.stock));
            if (stock <= 0) {
                problem = 'no_stock';
                available = 0;
                blocked = true;
            } else if (qty > stock) {
                problem = 'low_stock';
                available = stock;
                blocked = true;
            }
        }
        const lineC = toCents(p.price) * qty;
        if (!problem) subtotalC += lineC;
        lines.push({ product_id: id, title: p.title, qty, unit_price: p.price, subtotal: fromCents(lineC), problem, available });
    }
    // v0.1.415 — El cupón: sobre los productos que cubre, después de sumar.
    const rule = opts.coupon ?? null;
    let discountC = 0;
    let couponFreeShipping = false;
    let couponProblem: ShopCouponProblem | null = null;
    if (rule && lines.length > 0) {
        const eligible = rule.eligible ? new Set(rule.eligible) : null;
        let eligibleC = 0;
        for (const l of lines) {
            if (l.problem) continue;
            if (!eligible || eligible.has(l.product_id)) eligibleC += toCents(l.subtotal);
        }
        if (rule.min_subtotal !== null && rule.min_subtotal > 0 && subtotalC < toCents(rule.min_subtotal)) couponProblem = 'min_subtotal';
        else if (rule.kind !== 'free_shipping' && eligibleC <= 0) couponProblem = 'no_eligible';
        else if (rule.kind === 'free_shipping') couponFreeShipping = true;
        else {
            const unit = 10 ** (2 - Math.min(2, Math.max(0, opts.decimals ?? 2)));
            const raw = rule.kind === 'percent' ? (eligibleC * Math.min(100, Math.max(0, rule.value))) / 100 : toCents(Math.max(0, rule.value));
            discountC = Math.min(eligibleC, Math.round(raw / unit) * unit);
        }
    }
    const merchC = subtotalC - discountC;
    const freeOver = opts.freeOver !== null && opts.freeOver !== undefined && opts.freeOver > 0 ? toCents(opts.freeOver) : null;
    const baseShippingC = lines.length > 0 ? toCents(Math.max(0, opts.shipping)) : 0;
    const freeByAmount = freeOver !== null && baseShippingC > 0 && merchC >= freeOver;
    const freeShipping = baseShippingC > 0 && (couponFreeShipping || freeByAmount);
    const shippingC = freeShipping ? 0 : baseShippingC;
    const missing = freeOver !== null && baseShippingC > 0 && !freeShipping && lines.length > 0 ? fromCents(freeOver - merchC) : null;
    const min = opts.minOrder !== null && opts.minOrder > 0 ? opts.minOrder : null;
    const belowMinimum = min !== null && subtotalC < toCents(min) ? fromCents(toCents(min) - subtotalC) : null;
    return {
        lines,
        subtotal: fromCents(subtotalC),
        discount: fromCents(discountC),
        shipping: fromCents(shippingC),
        total: fromCents(merchC + shippingC),
        blocked: blocked || lines.length === 0,
        below_minimum: belowMinimum,
        coupon: rule && couponProblem === null && lines.length > 0 ? { code: rule.code, label: rule.label, kind: rule.kind } : null,
        coupon_problem: rule && lines.length > 0 ? couponProblem : null,
        free_shipping: freeShipping,
        free_shipping_missing: missing !== null && missing > 0 ? missing : null,
    };
}

export function shopLineProblemText(line: Pick<ShopCartLine, 'problem' | 'available'>): string | null {
    switch (line.problem) {
        case 'unavailable':
            return 'Este producto ya no está disponible.';
        case 'no_price':
            return 'Este producto no tiene precio todavía.';
        case 'no_stock':
            return 'Se agotó.';
        case 'low_stock':
            return line.available === 1 ? 'Sólo queda 1.' : `Sólo quedan ${line.available ?? 0}.`;
        default:
            return null;
    }
}

/** Lo que la tienda guarda de cada línea al hacer el pedido (precio congelado). */
export interface ShopOrderLineSnapshot {
    product_id: number;
    title: string;
    sku: string;
    qty: number;
    unit_price: number;
    subtotal: number;
    /** Si la línea descontó stock (para devolverlo al cancelar). */
    stock_taken: boolean;
    /** v0.1.414 — Con una variante: el producto al que pertenece (`product_id` es la variante). */
    parent_id?: number | null;
}

/** El mensaje de WhatsApp de un pedido (lo arma el servidor: el número nunca viaja a la página). */
export function shopWhatsappMessage(
    order: {
        number: string;
        lines: readonly Pick<ShopOrderLineSnapshot, 'title' | 'qty' | 'subtotal'>[];
        shipping: number;
        total: number;
        /** v0.1.415 */
        discount?: number;
        coupon_code?: string;
        delivery: string;
        customer: Pick<ShopCustomer, 'name' | 'address' | 'city' | 'notes'>;
        url: string | null;
    },
    intro: string,
    money: (n: number) => string,
): string {
    const out: string[] = [];
    out.push(`${(intro || SHOP_WHATSAPP_DEFAULT_INTRO).trim()} (${order.number})`);
    out.push('');
    for (const l of order.lines.slice(0, SHOP_MAX_LINES)) out.push(`• ${l.qty} × ${l.title} — ${money(l.subtotal)}`);
    out.push('');
    if ((order.discount ?? 0) > 0) out.push(`Descuento${order.coupon_code ? ` (${order.coupon_code})` : ''}: -${money(order.discount ?? 0)}`);
    out.push(`Entrega: ${order.delivery}${order.shipping > 0 ? ` (${money(order.shipping)})` : ''}`);
    out.push(`Total: ${money(order.total)}`);
    out.push('');
    out.push(`A nombre de: ${order.customer.name}`);
    const where = [order.customer.address, order.customer.city].filter(Boolean).join(', ');
    if (where) out.push(`Dirección: ${where}`);
    if (order.customer.notes) out.push(`Notas: ${order.customer.notes}`);
    if (order.url) {
        out.push('');
        out.push(`Ver el pedido: ${order.url}`);
    }
    return out.join('\n').slice(0, 3500);
}

export function shopWhatsappPhoneOk(phone: string): boolean {
    return PHONE_RE.test(phone.replace(/[\s().-]/g, ''));
}

// ── Meta pública ────────────────────────────────────────────────────────

export interface PublicShopDelivery {
    id: string;
    name: string;
    description: string;
    price: number;
    needs_address: boolean;
    /** v0.1.415 — «2 a 4 días hábiles». */
    eta: string;
    /** v0.1.415 — Envío gratis desde este monto en productos (null = nunca). */
    free_over: number | null;
    /** v0.1.415 — Zonas con su precio: con zonas, la persona elige a dónde. */
    zones: PublicShopZone[];
}

export interface PublicShopZone {
    id: string;
    name: string;
    price: number;
    free_over: number | null;
    eta: string;
}

export interface PublicShopPayment {
    method: ShopPaymentMethod;
    label: string;
    instructions: string;
}

export interface PublicShopMeta {
    title: string;
    description: string;
    company: string;
    logo_url: string | null;
    accent_color: string;
    currency: string;
    number_format: TenantFormat['number_format'];
    display: ShopDisplay;
    texts: ShopTexts;
    categories: string[];
    delivery: PublicShopDelivery[];
    payments: PublicShopPayment[];
    checkout: {
        ask_document: ShopCheckout['ask_document'];
        ask_notes: boolean;
        require_terms: boolean;
        min_order: number | null;
    };
    seller: ShopSeller;
    policies: ShopPolicies;
    captcha?: PublicFormCaptcha | null;
    data_consent?: PublicDataConsent | null;
    /** v0.1.415 — La tienda tiene cupones activos: se ofrece «¿Tienes un cupón?». */
    coupons?: boolean;
    /** null = recibe pedidos; si no, el motivo de cerrada. */
    closed: string | null;
    /** Hay más productos que los que muestra la página. */
    truncated: boolean;
}

/** El estado de un pedido como lo ve quien compró (página del pedido). */
export interface PublicShopOrder {
    number: string;
    created_at: string;
    status: ShopOrderStatus;
    status_label: string;
    payment_status: ShopPaymentStatus;
    payment_status_label: string;
    payment_method: ShopPaymentMethod;
    payment_label: string;
    payment_instructions: string;
    lines: { title: string; qty: number; unit_price: number; subtotal: number }[];
    subtotal: number;
    /** v0.1.415 — Descuento del cupón (0 sin cupón). */
    discount: number;
    /** v0.1.415 — El código del cupón usado ('' sin cupón). */
    coupon_code: string;
    shipping: number;
    total: number;
    currency: string;
    delivery: string;
    customer: { name: string; email: string; address: string; city: string };
    /** Sólo con WhatsApp: abrir el chat con el pedido armado. */
    whatsapp_url: string | null;
    /** v0.1.413 — Con el pago en línea pendiente: adónde ir a pagar. */
    pay_url: string | null;
    /** v0.1.413 — Hasta cuándo se aparta el pedido para pagarlo en línea (ISO). */
    pay_until: string | null;
    /** v0.1.413 — Con qué se paga en línea («Mercado Pago», «Wompi», «PayPal»). */
    pay_provider: string | null;
    /** v0.1.413 — Lo que la persona tiene que saber del pago (se canceló por no pagar, llegó tarde…). */
    payment_note: string | null;
}
