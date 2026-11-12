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
/** Fotos por producto que se muestran. */
export const SHOP_MAX_IMAGES = 8;
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
    shipping: number;
    total: number;
    /** Hay algo que impide comprar (producto que no existe, sin stock, sin precio). */
    blocked: boolean;
    /** La compra mínima no se alcanza (en la moneda de la tienda). */
    below_minimum: number | null;
}

/**
 * Suma el carrito con los precios y el stock que manda el servidor. Junta las
 * líneas repetidas, recorta cantidades imposibles y marca lo que no se puede
 * comprar. La usan la página (estimación) y el checkout (la cuenta que vale).
 */
export function computeShopCart(
    input: readonly ShopCartLineInput[],
    products: ReadonlyMap<number, ShopCartProduct>,
    opts: { shipping: number; minOrder: number | null },
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
    const shippingC = lines.length > 0 ? toCents(Math.max(0, opts.shipping)) : 0;
    const min = opts.minOrder !== null && opts.minOrder > 0 ? opts.minOrder : null;
    const belowMinimum = min !== null && subtotalC < toCents(min) ? fromCents(toCents(min) - subtotalC) : null;
    return {
        lines,
        subtotal: fromCents(subtotalC),
        shipping: fromCents(shippingC),
        total: fromCents(subtotalC + shippingC),
        blocked: blocked || lines.length === 0,
        below_minimum: belowMinimum,
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
}

/** El mensaje de WhatsApp de un pedido (lo arma el servidor: el número nunca viaja a la página). */
export function shopWhatsappMessage(
    order: {
        number: string;
        lines: readonly Pick<ShopOrderLineSnapshot, 'title' | 'qty' | 'subtotal'>[];
        shipping: number;
        total: number;
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
    shipping: number;
    total: number;
    currency: string;
    delivery: string;
    customer: { name: string; email: string; address: string; city: string };
    /** Sólo con WhatsApp: abrir el chat con el pedido armado. */
    whatsapp_url: string | null;
    /** v0.1.413 — Con el pago en línea pendiente: adónde ir a pagar. */
    pay_url: string | null;
}
