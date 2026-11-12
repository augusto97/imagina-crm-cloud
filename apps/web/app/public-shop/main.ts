/**
 * v0.1.412 (ADR-S103) — La tienda pública de una lista.
 *
 * Una sola página: el catálogo (buscador, categorías, tarjetas), la ficha de
 * cada producto, el carrito (cajón lateral), la compra (datos, entrega, forma
 * de pago, resumen) y el estado del pedido (`?pedido=<token>`). El carrito
 * vive en el navegador (localStorage); el precio, el stock y el total los
 * decide SIEMPRE el servidor al recibir el pedido — aquí sólo se muestra la
 * misma cuenta que va a hacer (`computeShopCart`, compartida).
 *
 * Quién vende, el precio total y las condiciones se ven ANTES de comprar
 * (Estatuto del Consumidor, Ley 1480): pie de página con los datos de quien
 * vende y las políticas a un toque.
 *
 * Todo se arma con `createElement`/`textContent`: ningún texto de la empresa
 * ni de un producto llega como HTML. Se compila a un archivo que el servidor
 * sirve EN LÍNEA (con su CSP por hash); de shared sólo importa la lógica pura.
 *
 * En el editor (vista previa) el catálogo y la configuración llegan por
 * `postMessage` y nada se envía: comprar muestra un aviso.
 */
import type {
    PublicShopMeta,
    PublicShopMyOrders,
    PublicShopOrder,
    PublicShopOrderSubscription,
    PublicShopProduct,
    PublicShopQuote,
    PublicShopSubscriptionPlan,
    PublicShopVariant,
    ShopCartResult,
    ShopCouponRule,
    ShopPaymentMethod,
    ShopPurchasable,
} from '@imagina-base/shared';
import {
    SHOP_MAX_QTY,
    computeShopCart,
    formatShopMoney,
    normalizeCouponCode,
    pickShopVariant,
    shopCouponProblemText,
    shopCurrencyDecimals,
    shopLineProblemText,
    shopNeedsDelivery,
    shopOptionValueState,
    shopPurchasables,
    shopShippingFor,
    shopVariantPriceRange,
} from '@imagina-base/shared/src/schemas/shop-logic';
import { subscriptionFrequencyText, subscriptionPlanExtras } from '@imagina-base/shared/src/schemas/form-logic';

interface Boot {
    token: string;
    preview: boolean;
    meta: PublicShopMeta | null;
    products: PublicShopProduct[];
    scripts: Record<string, string>;
}

type Attrs = Record<string, string | boolean | number | null | undefined>;

const BOOT: Boot = (() => {
    try {
        return JSON.parse(document.getElementById('boot')?.textContent ?? '{}') as Boot;
    } catch {
        return { token: '', preview: false, meta: null, products: [], scripts: {} };
    }
})();

const API = `/api/v1/public/shops/${encodeURIComponent(BOOT.token)}`;
const PAGE = `/api/v1/public/s/${encodeURIComponent(BOOT.token)}`;
const CART_KEY = `imb-shop-cart:${BOOT.token}`;
const CUSTOMER_KEY = `imb-shop-customer:${BOOT.token}`;
/** v0.1.415 — El cupón de la sesión (escrito o llegado por `?cupon=`). */
const COUPON_KEY = `imb-shop-coupon:${BOOT.token}`;
/** v0.1.416 — El enlace de «Mis pedidos» de esta pestaña (para volver a la lista). */
const MY_KEY = `imb-shop-my:${BOOT.token}`;
/** v0.1.416 — Dentro de un sitio (iframe): la agenda se abre en otra pestaña. */
const EMBEDDED = ((): boolean => {
    try {
        return window.self !== window.top;
    } catch {
        return true;
    }
})();

let meta: PublicShopMeta | null = BOOT.meta;
let products: PublicShopProduct[] = BOOT.products ?? [];
let byId = new Map<number, PublicShopProduct>();
/** v0.1.414 — Lo que se pone en el carrito: productos simples y variantes. */
let buyable = new Map<number, ShopPurchasable>();
/** v0.1.417 — Lo que se contrata como suscripción (productos y variantes; no va al carrito). */
let subscribable = new Map<number, ShopPurchasable>();

// ───────────────────────────── Utilidades ─────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs & { cls?: string; text?: string } = {}, kids: Array<Node | string | null | false | undefined> = []): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'cls') n.className = String(v);
        else if (k === 'text') n.textContent = String(v);
        else if (k === 'hidden') n.hidden = true;
        else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids) if (c !== null && c !== undefined && c !== false) n.append(c);
    return n;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS: Record<string, string> = {
    cart: 'M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20.5 8H6.2M9.5 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    x: 'M6 6l12 12M18 6L6 18',
    back: 'M15 6l-6 6 6 6',
    image: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-.01M20 15l-4.5-4.5L6 20',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    wa: 'M4 20l1.3-4A8 8 0 1 1 8.5 19zM9 9.5c0 3 2.5 5.5 5.5 5.5l1.5-1.5-2-1-1 1a4 4 0 0 1-2-2l1-1-1-2z',
    tag: 'M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2l8.3 8.3-8.7 8.7zM8 8a1 1 0 1 0 0-.01',
    truck: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 18.5a1.5 1.5 0 1 0 0-.01M17.5 18.5a1.5 1.5 0 1 0 0-.01',
    download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14',
    calendar: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 3v4M16 3v4',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
    repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
};

function icon(name: keyof typeof ICONS): SVGSVGElement {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', ICONS[name] ?? '');
    s.appendChild(p);
    return s;
}

function money(n: number): string {
    if (!meta) return String(n);
    return formatShopMoney(n, meta.currency, meta.number_format);
}

function fold(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}

/** Tinta legible sobre el color de la marca (blanca o casi negra). */
function inkOn(hex: string): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return '#ffffff';
    const v = parseInt(m[1]!, 16);
    const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
        const x = c / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    const lum = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
    return lum > 0.45 ? '#111827' : '#ffffff';
}

/** La foto al ancho pedido: `img/<clave>` es del servidor; en la vista previa llega la URL entera. */
function imgUrl(src: string, width: 160 | 320 | 640 | 1200): string {
    if (src.startsWith('img/')) return `${PAGE}/${src}/${width}`;
    return src;
}

function storageGet(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}
function storageSet(key: string, value: string | null): void {
    try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
    } catch {
        // modo privado o sin espacio: el carrito vive sólo en esta pestaña
    }
}

let toastTimer = 0;
function toast(text: string): void {
    document.querySelector('.s-toast')?.remove();
    const t = el('div', { cls: 's-toast', role: 'status', text });
    document.body.appendChild(t);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => t.remove(), 2600);
}

interface ApiErr {
    code?: string;
    message?: string;
    data?: { status?: number; cart?: ShopCartResult; errors?: Array<{ path?: string; message?: string }> };
}

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; error: ApiErr }> {
    try {
        const res = await fetch(`${API}${path}`, {
            ...init,
            headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
            credentials: 'omit',
        });
        const body = (await res.json().catch(() => ({}))) as unknown;
        if (!res.ok) return { ok: false, status: res.status, error: (body ?? {}) as ApiErr };
        return { ok: true, data: body as T };
    } catch {
        return { ok: false, status: 0, error: { message: 'No hay conexión. Revisa tu internet y vuelve a intentar.' } };
    }
}

// ───────────────────────────── Carrito ─────────────────────────────

const cart = new Map<number, number>();

function loadCart(): void {
    cart.clear();
    const raw = storageGet(CART_KEY);
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw) as Array<[number, number]>;
        for (const [id, qty] of parsed) {
            if (Number.isInteger(id) && id > 0 && Number.isInteger(qty) && qty > 0) cart.set(id, Math.min(qty, SHOP_MAX_QTY));
        }
    } catch {
        // carrito ilegible: se empieza vacío
    }
}

function saveCart(): void {
    storageSet(CART_KEY, cart.size === 0 ? null : JSON.stringify([...cart]));
}

function cartCount(): number {
    let n = 0;
    for (const q of cart.values()) n += q;
    return n;
}

function maxFor(p: { stock: number | null }): number {
    return p.stock === null ? SHOP_MAX_QTY : Math.max(0, Math.min(SHOP_MAX_QTY, Math.floor(p.stock)));
}

function setQty(id: number, qty: number): void {
    const item = buyable.get(id);
    const cap = item ? maxFor(item) : SHOP_MAX_QTY;
    const next = Math.max(0, Math.min(cap, Math.floor(qty)));
    if (next === 0) cart.delete(id);
    else cart.set(id, next);
    saveCart();
    paintCartButtons();
    const productId = item?.product.id ?? id;
    paintCard(productId);
    if (overlay?.kind === 'cart') renderOverlay();
    if (overlay?.kind === 'product' && overlay.id === productId) renderOverlay();
    if (view === 'checkout') paintSummary();
}

/** Cuántas unidades de un producto (todas sus variantes) hay en el carrito. */
function inCart(p: PublicShopProduct): number {
    if (!p.variants || p.variants.length === 0) return cart.get(p.id) ?? 0;
    let n = 0;
    for (const v of p.variants) n += cart.get(v.id) ?? 0;
    return n;
}

function hasVariants(p: PublicShopProduct): boolean {
    return !!p.variants && p.variants.length > 0;
}

/** v0.1.416 — Un servicio no va al carrito: se agenda. */
function isService(p: { kind?: string }): boolean {
    return p.kind === 'service';
}

/** v0.1.416 — ¿Todo el carrito se descarga? Entonces no hay entrega ni envío. */
function digitalCart(): boolean {
    return cart.size > 0 && !shopNeedsDelivery([...cart.keys()].map((product_id) => ({ product_id })), (id) => buyable.get(id)?.product.kind ?? null);
}

/** La agenda sólo se abre por su dirección de la app. */
function bookUrl(p: PublicShopProduct): string | null {
    return typeof p.book_url === 'string' && /^\/api\/v1\/public\/b\/[A-Za-z0-9_-]+\?servicio=[A-Za-z0-9_%-]+$/.test(p.book_url) ? p.book_url : null;
}

/** v0.1.416 — «Agendar»: lleva a la agenda con el servicio ya elegido. */
function bookControl(p: PublicShopProduct, big = false): HTMLElement {
    const url = bookUrl(p);
    if (!url) return el('button', { type: 'button', cls: big ? 's-btn' : 's-add', disabled: true, text: 'Agenda no disponible', 'data-testid': 'shop-book' });
    return el('a', { cls: big ? 's-btn' : 's-add', href: url, ...(EMBEDDED ? { target: '_blank', rel: 'noopener' } : {}), 'data-testid': 'shop-book' }, [icon('calendar'), 'Agendar']);
}

/** v0.1.417 — Una suscripción no va al carrito: se contrata sola (débito automático). */
function isSubscription(p: { kind?: string }): boolean {
    return p.kind === 'subscription';
}

/** v0.1.417 — Con qué se autoriza la tarjeta. */
function providerName(p: 'mercadopago' | 'paypal'): string {
    return p === 'paypal' ? 'PayPal' : 'Mercado Pago';
}

/** v0.1.417 — «cada mes · 7 días gratis · 12 cobros». */
function cadenceText(plan: Pick<PublicShopSubscriptionPlan, 'frequency' | 'frequency_type' | 'trial_days' | 'cycles'>): string {
    const extras = subscriptionPlanExtras({ trial_days: plan.trial_days, cycles: plan.cycles });
    return `${subscriptionFrequencyText(plan.frequency, plan.frequency_type)}${extras ? ` · ${extras}` : ''}`;
}

/** v0.1.417 — «Suscribirme»: lleva a sus datos y de ahí a autorizar la tarjeta. */
function subscribeControl(p: PublicShopProduct, item: { id: number; price: number | null; stock: number | null } = p, big = false): HTMLElement {
    const m = meta!;
    const off = !p.subscription || item.price === null || soldOut(item) || !!m.closed;
    const b = el('button', {
        type: 'button',
        cls: big ? 's-btn' : 's-add',
        disabled: off,
        text: soldOut(item) ? 'Sin cupos' : !p.subscription || item.price === null ? 'No disponible' : 'Suscribirme',
        'data-testid': 'shop-subscribe',
    });
    b.addEventListener('click', () => {
        if (overlay) closeOverlay();
        goSubscribe(item.id);
    });
    return b;
}

/** v0.1.416 — El texto de las descargas de la tienda («tienes 30 días y hasta 5 descargas por archivo»). */
function downloadsText(): string {
    const d = meta?.downloads;
    if (!d) return 'Lo descargas apenas se confirme el pago.';
    const days = d.days === 1 ? '1 día' : `${d.days} días`;
    return `Lo descargas apenas se confirme el pago. Tienes ${days}${d.max !== null ? ` y hasta ${d.max === 1 ? '1 descarga' : `${d.max} descargas`} por archivo` : ''}.`;
}

/** v0.1.415 — Envío de la forma de entrega elegida (y su zona). */
function shipFor(deliveryId: string | null, zoneId: string | null): ReturnType<typeof shopShippingFor> {
    return shopShippingFor(meta?.delivery.find((x) => x.id === deliveryId) ?? null, zoneId);
}

/** La misma cuenta que hará el servidor: envío por zona, envío gratis y el cupón validado. */
function estimate(deliveryId: string | null, zoneId: string | null = null, coupon: ShopCouponRule | null = null): ShopCartResult {
    const ship = deliveryId ? shipFor(deliveryId, zoneId) : { price: 0, free_over: null };
    return computeShopCart(
        [...cart].map(([product_id, qty]) => ({ product_id, qty })),
        buyable,
        {
            shipping: ship.price,
            freeOver: ship.free_over,
            minOrder: meta?.checkout.min_order ?? null,
            coupon,
            decimals: shopCurrencyDecimals(meta?.currency ?? 'COP'),
        },
    );
}

function sessionGet(key: string): string | null {
    try {
        return window.sessionStorage.getItem(key);
    } catch {
        return null;
    }
}
function sessionSet(key: string, value: string | null): void {
    try {
        if (value === null) window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, value);
    } catch {
        // sin almacenamiento: el cupón vale mientras la página esté abierta
    }
}

// ───────────────────────────── Estado de la página ─────────────────────────────

type View = 'catalog' | 'checkout' | 'order' | 'my';
type Overlay =
    | { kind: 'product'; id: number; image: number; sel?: Array<string | null> }
    | { kind: 'cart' }
    | { kind: 'policies'; focus: 'terms' | 'returns' | 'seller' }
    | { kind: 'my' }
    | null;

let view: View = 'catalog';
let overlay: Overlay = null;
let query = '';
let category: string | null = null;
let sort: PublicShopMeta['display']['sort'] = 'manual';
let lastFocus: HTMLElement | null = null;

const app = document.getElementById('app') ?? document.body.appendChild(el('div', { id: 'app' }));
const ovRoot = document.body.appendChild(el('div', { id: 'ov' }));

const cartButtons: HTMLElement[] = [];
const cardEls = new Map<number, { card: HTMLElement; actions: HTMLElement }>();
let gridEl: HTMLElement | null = null;
let mbar: HTMLElement | null = null;

function applyTheme(): void {
    if (!meta) return;
    const accent = /^#[0-9a-f]{6}$/i.test(meta.accent_color) ? meta.accent_color : '#0e7490';
    const root = document.documentElement.style;
    root.setProperty('--s-accent', accent);
    root.setProperty('--s-ink', inkOn(accent));
    root.setProperty('--s-cols', String(meta.display.columns));
    document.title = meta.title || meta.company || 'Tienda';
}

function indexProducts(): void {
    byId = new Map(products.map((p) => [p.id, p]));
    buyable = shopPurchasables(products);
    subscribable = shopPurchasables(products, { subscriptions: true });
    // Lo que ya no está en la tienda sale del carrito (al cargar la página).
    for (const id of [...cart.keys()]) if (!buyable.has(id)) cart.delete(id);
}

// ───────────────────────────── Encabezado y pie ─────────────────────────────

function header(): HTMLElement {
    const m = meta!;
    const brand = el('button', { cls: 's-brand', type: 'button', 'aria-label': 'Ir al inicio de la tienda' }, [
        m.logo_url ? el('img', { cls: 's-logo', src: m.logo_url, alt: m.company || m.title }) : null,
        !m.logo_url || m.title ? el('span', { cls: 's-name', text: m.title || m.company }) : null,
    ]);
    brand.addEventListener('click', () => goCatalog());
    const btn = el('button', { cls: 's-cart-btn', type: 'button', 'data-testid': 'shop-cart-open' }, [icon('cart'), el('span', { cls: 's-cart-l', text: 'Carrito' }), el('span', { cls: 's-badge', text: '0' })]);
    btn.addEventListener('click', () => openOverlay({ kind: 'cart' }));
    cartButtons.push(btn);
    // v0.1.416 — «Mis pedidos»: un enlace al correo con los pedidos y las descargas.
    const my = el('button', { cls: 's-my-btn', type: 'button', 'data-testid': 'shop-my-open', 'aria-label': 'Mis pedidos' }, [icon('receipt'), el('span', { cls: 's-my-l', text: 'Mis pedidos' })]);
    my.addEventListener('click', () => openMyOrders());
    return el('header', { cls: 's-top' }, [el('div', { cls: 's-top-in' }, [brand, my, btn])]);
}

function footer(): HTMLElement {
    const m = meta!;
    const s = m.seller;
    const who = [s.legal_name, s.document ? `NIT/CC ${s.document}` : ''].filter(Boolean).join(' · ');
    const where = [s.address, s.city].filter(Boolean).join(', ');
    const contact = [s.email, s.phone].filter(Boolean).join(' · ');
    const policyBtn = (label: string, focus: 'terms' | 'returns' | 'seller'): HTMLElement => {
        const b = el('button', { type: 'button', cls: 's-link', text: label });
        b.addEventListener('click', () => openOverlay({ kind: 'policies', focus }));
        return b;
    };
    return el('footer', { cls: 's-foot' }, [
        el('div', { cls: 's-foot-in' }, [
            el('div', {}, [
                who ? el('div', {}, [el('strong', { text: who })]) : null,
                where ? el('div', { text: where }) : null,
                contact ? el('div', { text: contact }) : null,
            ]),
            el('div', { cls: 's-links' }, [
                (() => {
                    const b = el('button', { type: 'button', cls: 's-link', text: 'Mis pedidos y descargas' });
                    b.addEventListener('click', () => openMyOrders());
                    return b;
                })(),
                policyBtn('Envíos, cambios y devoluciones', 'returns'),
                policyBtn('Términos y condiciones', 'terms'),
                policyBtn('Quién vende', 'seller'),
            ]),
        ]),
    ]);
}

function paintCartButtons(): void {
    const n = cartCount();
    for (const b of cartButtons) {
        const badge = b.querySelector('.s-badge');
        if (badge) badge.textContent = String(n);
        b.setAttribute('aria-label', n === 1 ? 'Carrito: 1 producto' : `Carrito: ${n} productos`);
    }
    if (mbar) {
        mbar.classList.toggle('s-show', n > 0 && view === 'catalog' && !overlay);
        const t = mbar.querySelector('.s-mbar-t');
        if (t) t.textContent = `Ver carrito · ${money(estimate(null).subtotal)}`;
    }
}

// ───────────────────────────── Catálogo ─────────────────────────────

function visibleProducts(): PublicShopProduct[] {
    const m = meta!;
    const q = fold(query.trim());
    let list = products.filter((p) => {
        if (m.display.hide_sold_out && !isService(p) && p.stock !== null && p.stock <= 0) return false;
        if (category && !p.categories.includes(category)) return false;
        if (q) {
            const hay = fold(`${p.title} ${p.description} ${p.sku} ${p.categories.join(' ')}`);
            if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
        }
        return true;
    });
    if (sort !== 'manual') {
        list = [...list];
        const price = (p: PublicShopProduct): number => (p.price === null ? Number.POSITIVE_INFINITY : p.price);
        if (sort === 'name') list.sort((a, b) => a.title.localeCompare(b.title, 'es'));
        else if (sort === 'price_asc') list.sort((a, b) => price(a) - price(b));
        else if (sort === 'price_desc') list.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
        else if (sort === 'newest') list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return list;
}

function stockText(p: PublicShopProduct): string | null {
    const d = meta!.display;
    if (p.stock === null || isService(p)) return null;
    // v0.1.417 — En una suscripción el stock son los cupos.
    const sub = isSubscription(p);
    if (p.stock <= 0) return sub ? 'Sin cupos' : 'Agotado';
    if (d.show_stock === 'always' || (d.show_stock === 'low' && p.stock <= d.low_stock_at)) {
        if (sub) return p.stock === 1 ? 'Queda 1 cupo' : `Quedan ${p.stock} cupos`;
        return p.stock === 1 ? 'Queda 1' : `Quedan ${p.stock}`;
    }
    return null;
}

function priceNode(p: { price: number | null; compare_price: number | null }, cls = 's-price', from = false): HTMLElement {
    const kids: HTMLElement[] = [];
    if (p.price === null) kids.push(el('span', { cls: 's-was', text: 'Sin precio' }));
    else if (from) kids.push(el('span', { cls: 's-now', text: `Desde ${money(p.price)}` }));
    else {
        kids.push(el('span', { cls: 's-now', text: money(p.price) }));
        if (p.compare_price !== null && p.compare_price > p.price) kids.push(el('span', { cls: 's-was', text: money(p.compare_price), 'aria-label': `Antes ${money(p.compare_price)}` }));
    }
    return el('div', { cls }, kids);
}

function soldOut(p: { stock: number | null }): boolean {
    return p.stock !== null && p.stock <= 0;
}

/** Con variantes, el precio de la tarjeta dice «Desde» si no todas cuestan lo mismo. */
function priceFrom(p: PublicShopProduct): boolean {
    const r = shopVariantPriceRange(p);
    return !!r && r.min < r.max;
}

/** La tarjeta de un producto con variantes: se elige en la ficha. */
function chooseControl(p: PublicShopProduct): HTMLElement {
    const m = meta!;
    const n = inCart(p);
    const b = el('button', {
        type: 'button',
        cls: 's-add',
        disabled: soldOut(p) || p.price === null || !!m.closed || (isSubscription(p) && !p.subscription),
        text: soldOut(p) ? (isSubscription(p) ? 'Sin cupos' : 'Agotado') : p.price === null || (isSubscription(p) && !p.subscription) ? 'No disponible' : 'Elegir opción',
        'data-testid': 'shop-choose',
    });
    b.addEventListener('click', () => openOverlay({ kind: 'product', id: p.id, image: 0 }));
    return el('div', { style: 'display:flex;flex-direction:column' }, [b, n > 0 ? el('span', { cls: 's-incart', style: 'margin-top:6px', text: n === 1 ? '1 en el carrito' : `${n} en el carrito` }) : null]);
}

function addControl(p: { id: number; title: string; price: number | null; stock: number | null }, big = false): HTMLElement {
    const qty = cart.get(p.id) ?? 0;
    const m = meta!;
    if (qty === 0) {
        const unavailable = soldOut(p) || p.price === null || !!m.closed;
        const b = el('button', {
            type: 'button',
            cls: big ? 's-btn' : 's-add',
            disabled: unavailable,
            text: soldOut(p) ? 'Agotado' : p.price === null ? 'No disponible' : m.texts.add_to_cart || 'Agregar al carrito',
            'data-testid': 'shop-add',
            // Al agregar, el foco pasa al «+» que aparece en su lugar.
            'data-k': `plus-${p.id}`,
        });
        b.addEventListener('click', () => {
            setQty(p.id, 1);
            toast(`Agregaste «${p.title}» al carrito.`);
        });
        return b;
    }
    const minus = el('button', { type: 'button', 'aria-label': 'Quitar uno', text: '−', 'data-k': `minus-${p.id}` });
    minus.addEventListener('click', () => setQty(p.id, qty - 1));
    const plus = el('button', { type: 'button', 'aria-label': 'Agregar uno', text: '+', disabled: qty >= maxFor(p), 'data-k': `plus-${p.id}` });
    plus.addEventListener('click', () => setQty(p.id, qty + 1));
    return el('div', { cls: 's-step', 'data-testid': 'shop-step', ...(big ? { style: 'height:50px' } : {}) }, [minus, el('span', { 'aria-live': 'polite', text: String(qty) }), plus]);
}

function productCard(p: PublicShopProduct): HTMLElement {
    const d = meta!.display;
    const img = p.images[0];
    const media = el('button', { cls: 's-media', type: 'button', 'aria-label': `Ver ${p.title}` }, [
        img ? el('img', { src: imgUrl(img, 320), srcset: `${imgUrl(img, 320)} 320w, ${imgUrl(img, 640)} 640w`, sizes: '(max-width:640px) 50vw, 320px', alt: p.title, loading: 'lazy', decoding: 'async' }) : el('div', { cls: 's-noimg' }, [icon('image')]),
    ]);
    const service = isService(p);
    if (soldOut(p) && !service) media.append(el('span', { cls: 's-tag', text: isSubscription(p) ? 'Sin cupos' : 'Agotado' }));
    else if (p.price !== null && p.compare_price !== null && p.compare_price > p.price) {
        const off = Math.round((1 - p.price / p.compare_price) * 100);
        if (off >= 1) media.append(el('span', { cls: 's-tag s-sale', text: `−${off}%` }));
    }
    // v0.1.416 — Qué tipo de producto es (lo físico no lleva marca).
    if (service) media.append(el('span', { cls: 's-kind', 'data-testid': 'shop-kind' }, [icon('calendar'), 'Servicio']));
    else if (p.kind === 'digital') media.append(el('span', { cls: 's-kind', 'data-testid': 'shop-kind' }, [icon('download'), 'Descarga digital']));
    else if (isSubscription(p)) media.append(el('span', { cls: 's-kind', 'data-testid': 'shop-kind' }, [icon('repeat'), 'Suscripción']));
    media.addEventListener('click', () => openOverlay({ kind: 'product', id: p.id, image: 0 }));
    const title = el('button', { cls: 's-title', type: 'button', text: p.title });
    title.addEventListener('click', () => openOverlay({ kind: 'product', id: p.id, image: 0 }));
    const variable = hasVariants(p) && !service;
    const st = variable ? null : stockText(p);
    const actions = el('div', {}, [cardControl(p)]);
    const card = el('article', { cls: `s-card${soldOut(p) && !service ? ' s-out' : ''}`, 'data-testid': 'shop-card', 'data-id': String(p.id) }, [
        media,
        el('div', { cls: 's-body' }, [
            title,
            d.show_sku && p.sku ? el('div', { cls: 's-sku', text: `Ref. ${p.sku}` }) : null,
            st && !soldOut(p) ? el('div', { cls: 's-stock', text: st }) : null,
            priceNode(p, 's-price', variable && priceFrom(p)),
            // v0.1.417 — Cada cuánto se cobra la suscripción.
            isSubscription(p) && p.subscription ? el('div', { cls: 's-cad', 'data-testid': 'shop-cadence', text: cadenceText(p.subscription) }) : null,
            actions,
        ]),
    ]);
    cardEls.set(p.id, { card, actions });
    return card;
}

function cardControl(p: PublicShopProduct): HTMLElement {
    if (isService(p)) return bookControl(p);
    // v0.1.417 — Una suscripción con variantes se elige en la ficha.
    if (isSubscription(p)) return hasVariants(p) ? chooseControl(p) : subscribeControl(p);
    return hasVariants(p) ? chooseControl(p) : addControl(p);
}

function paintCard(id: number): void {
    const c = cardEls.get(id);
    const p = byId.get(id);
    if (!c || !p) return;
    c.actions.replaceChildren(cardControl(p));
}

function paintGrid(): void {
    if (!gridEl || !meta) return;
    cardEls.clear();
    const list = visibleProducts();
    const d = meta.display;
    gridEl.className = `s-grid${d.image_ratio === 'portrait' ? ' s-portrait' : d.image_ratio === 'landscape' ? ' s-landscape' : ''}${d.image_fit === 'contain' ? ' s-contain' : ''}`;
    if (list.length === 0) {
        gridEl.replaceChildren(
            el('p', {
                cls: 's-empty',
                style: 'grid-column:1/-1',
                text: products.length === 0 ? 'Todavía no hay productos en esta tienda.' : 'No encontramos productos con esa búsqueda.',
            }),
        );
        return;
    }
    gridEl.replaceChildren(...list.map(productCard));
}

function catalogView(): HTMLElement[] {
    const m = meta!;
    const kids: Array<HTMLElement | null> = [];
    const hero = el('section', { cls: 's-hero' }, [el('h1', { text: m.texts.title || m.title || m.company }), m.texts.description ? el('p', { text: m.texts.description }) : null]);
    kids.push(hero);
    if (m.closed) kids.push(el('div', { cls: 's-closed', role: 'status', text: m.closed }));
    const tools: HTMLElement[] = [];
    if (m.display.show_search) {
        const input = el('input', { type: 'search', placeholder: 'Buscar productos', 'aria-label': 'Buscar productos', value: query, 'data-testid': 'shop-search' });
        input.addEventListener('input', () => {
            query = input.value;
            paintGrid();
        });
        tools.push(el('label', { cls: 's-search' }, [icon('search'), input]));
    }
    const sortSel = el('select', { cls: 's-sort', 'aria-label': 'Ordenar' });
    const sorts: Array<[typeof sort, string]> = [
        ['manual', 'Destacados'],
        ['newest', 'Lo más nuevo'],
        ['price_asc', 'Menor precio'],
        ['price_desc', 'Mayor precio'],
        ['name', 'Nombre (A-Z)'],
    ];
    for (const [v, label] of sorts) sortSel.append(el('option', { value: v, text: label, selected: v === sort }));
    sortSel.addEventListener('change', () => {
        sort = sortSel.value as typeof sort;
        paintGrid();
    });
    tools.push(sortSel);
    kids.push(el('div', { cls: 's-tools' }, tools));
    if (m.display.show_categories && m.categories.length > 0) {
        const chips = el('div', { cls: 's-cats', role: 'group', 'aria-label': 'Categorías' });
        const chip = (label: string, value: string | null): HTMLElement => {
            const b = el('button', { type: 'button', cls: 's-chip', text: label, 'aria-pressed': category === value ? 'true' : 'false' });
            b.addEventListener('click', () => {
                category = value;
                for (const c of chips.children) c.setAttribute('aria-pressed', 'false');
                b.setAttribute('aria-pressed', 'true');
                paintGrid();
            });
            return b;
        };
        chips.append(chip('Todo', null), ...m.categories.map((c) => chip(c, c)));
        kids.push(chips);
    }
    gridEl = el('div', { cls: 's-grid', 'data-testid': 'shop-grid' });
    kids.push(gridEl);
    if (m.truncated) kids.push(el('p', { cls: 's-more', text: 'Usa el buscador para encontrar más productos.' }));
    return kids.filter((k): k is HTMLElement => k !== null);
}

// ───────────────────────────── Capas (producto, carrito, políticas) ─────────────────────────────

function openOverlay(o: NonNullable<Overlay>): void {
    if (!overlay) lastFocus = document.activeElement as HTMLElement | null;
    overlay = o;
    renderOverlay();
}

function closeOverlay(): void {
    overlay = null;
    ovRoot.replaceChildren();
    document.body.style.overflow = '';
    paintCartButtons();
    lastFocus?.focus?.();
    lastFocus = null;
}

function sheet(kind: 'drawer' | 'modal' | 'narrow', title: string, body: Node[], foot: Node[] | null, testid: string): HTMLElement {
    const x = el('button', { type: 'button', cls: 's-x', 'aria-label': 'Cerrar' }, [icon('x')]);
    x.addEventListener('click', closeOverlay);
    const box = el(
        'div',
        {
            cls: `s-sheet ${kind === 'drawer' ? 's-drawer' : `s-modal${kind === 'narrow' ? ' s-narrow' : ''}`}`,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': title,
            'data-testid': testid,
        },
        [el('div', { cls: 's-sh' }, [el('h2', { text: title }), x]), el('div', { cls: 's-sb' }, body), foot ? el('div', { cls: 's-sf' }, foot) : null],
    );
    return box;
}

function renderOverlay(): void {
    if (!overlay || !meta) return;
    const veil = el('div', { cls: 's-veil' });
    veil.addEventListener('click', closeOverlay);
    let box: HTMLElement;
    if (overlay.kind === 'product') box = productSheet(overlay.id, overlay.image, overlay.sel);
    else if (overlay.kind === 'cart') box = cartSheet();
    else if (overlay.kind === 'my') box = mySheet();
    else box = policiesSheet(overlay.focus);
    const keepFocus = ovRoot.contains(document.activeElement);
    // v0.1.414 — Redibujar la misma capa (elegir talla, sumar una unidad) no
    // repite la animación de entrada, conserva el scroll y deja el foco donde estaba.
    const prev = ovRoot.querySelector<HTMLElement>('.s-sheet');
    const same = prev !== null && prev.dataset.testid === box.dataset.testid;
    const scroll = same ? (prev.querySelector<HTMLElement>('.s-sb')?.scrollTop ?? 0) : 0;
    const focusKey = keepFocus ? ((document.activeElement as HTMLElement | null)?.dataset.k ?? null) : null;
    if (same) {
        veil.classList.add('s-still');
        box.classList.add('s-still');
    }
    ovRoot.replaceChildren(veil, box);
    document.body.style.overflow = 'hidden';
    paintCartButtons();
    if (same) {
        const sb = box.querySelector<HTMLElement>('.s-sb');
        if (sb) sb.scrollTop = scroll;
    }
    const again = focusKey ? box.querySelector<HTMLElement>(`[data-k="${CSS.escape(focusKey)}"]`) : null;
    if (again) again.focus();
    else if (!keepFocus || (same && !box.contains(document.activeElement))) (box.querySelector('.s-x') as HTMLElement | null)?.focus();
}

/** Lo elegido de cada atributo; si un atributo tiene un solo valor (o hay una sola variante), ya viene elegido. */
function initialSelection(p: PublicShopProduct): Array<string | null> {
    const opts = p.options ?? [];
    const variants = p.variants ?? [];
    if (variants.length === 1) return [...variants[0]!.values];
    return opts.map((o) => (o.values.length === 1 ? o.values[0]! : null));
}

function variantOptions(p: PublicShopProduct, sel: Array<string | null>, imageIdx: number): HTMLElement {
    const opts = p.options ?? [];
    return el(
        'div',
        { cls: 's-opts', 'data-testid': 'shop-options' },
        opts.map((o, i) =>
            el('div', { role: 'group', 'aria-label': o.name }, [
                el('p', { cls: 's-opt-l' }, [`${o.name}: `, el('b', { text: sel[i] ?? 'elige una' })]),
                el(
                    'div',
                    { cls: 's-optvs' },
                    o.values.map((v) => {
                        const state = shopOptionValueState(p, sel, i, v);
                        const on = sel[i] === v;
                        const b = el('button', {
                            type: 'button',
                            cls: `s-optv${state === 'sold_out' ? ' s-off' : ''}`,
                            'aria-pressed': on ? 'true' : 'false',
                            disabled: state === 'none' && !on,
                            'aria-label': state === 'sold_out' ? `${v} (agotado)` : v,
                            text: v,
                            'data-testid': 'shop-option',
                            'data-k': `opt-${i}-${v}`,
                        });
                        b.addEventListener('click', () => {
                            const next = [...sel];
                            next[i] = on ? null : v;
                            // Si con lo nuevo otro atributo quedó en una combinación que no existe, se suelta.
                            for (let j = 0; j < next.length; j++) {
                                if (j === i || !next[j]) continue;
                                if (shopOptionValueState(p, next, j, next[j]!) === 'none') next[j] = null;
                            }
                            openOverlay({ kind: 'product', id: p.id, image: imageIdx, sel: next });
                        });
                        return b;
                    }),
                ),
            ]),
        ),
    );
}

/** v0.1.417 — Lo que dice la ficha de una suscripción. */
function subscriptionNote(p: PublicShopProduct): string {
    const plan = p.subscription;
    if (!plan) return 'Esta suscripción todavía no está disponible. Escríbenos para contratarla.';
    return `Se cobra ${cadenceText(plan)} con débito automático. Autorizas tu tarjeta en ${providerName(plan.provider)} una sola vez y los cobros se hacen solos.`;
}

function productSheet(id: number, imageIdx: number, selIn?: Array<string | null>): HTMLElement {
    const p = byId.get(id);
    if (!p) return sheet('narrow', 'Producto', [el('p', { cls: 's-empty', text: 'Este producto ya no está disponible.' })], null, 'shop-product');
    const service = isService(p);
    const variable = hasVariants(p) && !service;
    const sel = variable ? (selIn ?? initialSelection(p)) : [];
    const variant: PublicShopVariant | null = variable ? pickShopVariant(p, sel) : null;
    const imgs = variant && variant.images.length > 0 ? variant.images : p.images;
    const idx = Math.min(imageIdx, Math.max(0, imgs.length - 1));
    const main = el('div', { cls: 's-gal-main' }, [
        imgs[idx] ? el('img', { src: imgUrl(imgs[idx]!, 1200), alt: p.title, decoding: 'async' }) : el('div', { cls: 's-noimg' }, [icon('image')]),
    ]);
    const gallery = el('div', {}, [main]);
    if (imgs.length > 1) {
        gallery.append(
            el(
                'div',
                { cls: 's-thumbs' },
                imgs.map((src, i) => {
                    const b = el('button', { type: 'button', cls: 's-thumb', 'aria-label': `Foto ${i + 1}`, 'aria-pressed': i === idx ? 'true' : 'false' }, [el('img', { src: imgUrl(src, 160), alt: '' })]);
                    b.addEventListener('click', () => openOverlay({ kind: 'product', id, image: i, ...(variable ? { sel } : {}) }));
                    return b;
                }),
            ),
        );
    }
    let buy: HTMLElement;
    let priceEl: HTMLElement;
    let st: string | null;
    let sku = p.sku;
    if (service) {
        buy = bookControl(p, true);
        priceEl = priceNode(p, 's-price s-d-price', priceFrom(p));
        st = null;
    } else if (!variable && isSubscription(p)) {
        buy = subscribeControl(p, p, true);
        priceEl = priceNode(p, 's-price s-d-price');
        st = stockText(p);
    } else if (!variable) {
        buy = addControl(p, true);
        priceEl = priceNode(p, 's-price s-d-price');
        st = stockText(p);
    } else if (variant && isSubscription(p)) {
        // v0.1.417 — La variante elegida de una suscripción (con su precio).
        const item = subscribable.get(variant.id) ?? { id: variant.id, price: variant.price, stock: variant.stock };
        buy = subscribeControl(p, item, true);
        priceEl = priceNode(variant, 's-price s-d-price');
        st = stockText({ ...p, stock: variant.stock });
        sku = variant.sku || p.sku;
    } else if (variant) {
        const item = buyable.get(variant.id)!;
        buy = addControl(item, true);
        priceEl = priceNode(variant, 's-price s-d-price');
        st = stockText({ ...p, stock: variant.stock });
        sku = variant.sku || p.sku;
    } else {
        const missing = (p.options ?? []).filter((_, i) => !sel[i]).map((o) => o.name.toLowerCase());
        buy = el('button', { type: 'button', cls: 's-btn', disabled: true, text: missing.length > 0 ? `Elige ${missing.join(' y ')}` : 'Esa combinación no está disponible', 'data-testid': 'shop-add' });
        priceEl = priceNode(p, 's-price s-d-price', priceFrom(p));
        st = null;
    }
    const n = variable ? inCart(p) : 0;
    const info = el('div', {}, [
        el('h3', { cls: 's-d-title', text: p.title }),
        meta!.display.show_sku && sku ? el('div', { cls: 's-sku', text: `Ref. ${sku}` }) : null,
        priceEl,
        isSubscription(p) && p.subscription ? el('div', { cls: 's-cad', text: cadenceText(p.subscription) }) : null,
        variable ? variantOptions(p, sel, idx) : null,
        st ? el('div', { cls: 's-stock', style: 'margin-top:10px', text: st }) : null,
        el('div', { style: 'margin-top:14px' }, [buy]),
        service
            ? el('p', { cls: 's-kind-note', 'data-testid': 'shop-kind-note' }, [icon('calendar'), bookUrl(p) ? 'Eliges el día y la hora en la agenda.' : 'La agenda de este servicio todavía no está disponible.'])
            : p.kind === 'digital'
              ? el('p', { cls: 's-kind-note', 'data-testid': 'shop-kind-note' }, [icon('download'), downloadsText()])
              : isSubscription(p)
                ? el('p', { cls: 's-kind-note', 'data-testid': 'shop-kind-note' }, [icon('repeat'), subscriptionNote(p)])
                : null,
        n > 0 && !(variant && cart.has(variant.id)) ? el('p', { cls: 's-incart', style: 'margin:8px 0 0', text: n === 1 ? 'Tienes 1 de este producto en el carrito.' : `Tienes ${n} de este producto en el carrito.` }) : null,
        p.description ? el('p', { cls: 's-desc', text: p.description }) : null,
        p.categories.length > 0 ? el('div', { cls: 's-d-cats' }, p.categories.map((c) => el('span', { text: c }))) : null,
    ]);
    const qty = isSubscription(p) ? 0 : variable ? n : (cart.get(p.id) ?? 0);
    const foot = qty > 0 ? [actionButton('Ver carrito', () => openOverlay({ kind: 'cart' }), 's-btn s-ghost')] : null;
    return sheet('modal', p.title, [el('div', { cls: 's-detail' }, [gallery, info])], foot, 'shop-product');
}

function actionButton(label: string, onClick: () => void, cls = 's-btn', testid?: string): HTMLButtonElement {
    const b = el('button', { type: 'button', cls, text: label, 'data-testid': testid });
    b.addEventListener('click', onClick);
    return b;
}

function cartLine(line: ShopCartResult['lines'][number]): HTMLElement {
    const p = buyable.get(line.product_id);
    const img = p?.images[0];
    const minus = el('button', { type: 'button', 'aria-label': 'Quitar uno', text: '−', 'data-k': `cminus-${line.product_id}` });
    minus.addEventListener('click', () => setQty(line.product_id, line.qty - 1));
    const plus = el('button', { type: 'button', 'aria-label': 'Agregar uno', text: '+', disabled: !p || line.qty >= maxFor(p), 'data-k': `cplus-${line.product_id}` });
    plus.addEventListener('click', () => setQty(line.product_id, line.qty + 1));
    const rm = el('button', { type: 'button', cls: 's-rm', text: 'Quitar' });
    rm.addEventListener('click', () => setQty(line.product_id, 0));
    const problem = shopLineProblemText(line);
    return el('div', { cls: 's-line', 'data-testid': 'shop-cart-line' }, [
        el('div', { cls: 's-line-img' }, [img ? el('img', { src: imgUrl(img, 160), alt: '' }) : el('div', { cls: 's-noimg' }, [icon('image')])]),
        el('div', {}, [
            el('div', { cls: 's-line-t', text: p?.title || line.title || 'Producto' }),
            el('div', { cls: 's-line-p', text: money(line.unit_price) }),
            problem ? el('div', { cls: 's-line-err', text: problem }) : null,
            el('div', { cls: 's-step' }, [minus, el('span', { text: String(line.qty) }), plus]),
        ]),
        el('div', {}, [el('div', { cls: 's-line-sub', text: money(line.subtotal) }), rm]),
    ]);
}

function cartSheet(): HTMLElement {
    const est = estimate(null);
    if (est.lines.length === 0) {
        return sheet('drawer', 'Tu carrito', [el('p', { cls: 's-empty', text: 'Tu carrito está vacío.' })], [actionButton('Ver productos', closeOverlay, 's-btn s-ghost')], 'shop-cart');
    }
    const foot: Node[] = [];
    const sum = el('div', { cls: 's-sum' }, [el('div', {}, [el('span', { text: 'Subtotal' }), el('strong', { text: money(est.subtotal) })])]);
    foot.push(sum);
    if (est.below_minimum !== null) foot.push(el('div', { cls: 's-warn', text: `La compra mínima es de ${money(meta!.checkout.min_order ?? 0)}: te faltan ${money(est.below_minimum)}.` }));
    else if (est.blocked) foot.push(el('div', { cls: 's-warn', text: 'Revisa los productos marcados antes de seguir.' }));
    const pendingCoupon = meta!.coupons ? sessionGet(COUPON_KEY) : null;
    if (pendingCoupon) foot.push(el('div', { cls: 's-free-hint', 'data-testid': 'shop-cart-coupon' }, [icon('tag'), el('span', { text: `Tu cupón ${pendingCoupon} se aplica al finalizar la compra.` })]));
    foot.push(el('p', { cls: 's-line-p', style: 'margin:0 0 10px', text: digitalCart() ? 'Todo se descarga: no hay envío.' : 'El envío se calcula en el siguiente paso.' }));
    const go = actionButton(meta!.texts.checkout || 'Finalizar compra', () => {
        closeOverlay();
        goCheckout();
    }, 's-btn', 'shop-checkout');
    go.disabled = est.blocked || est.below_minimum !== null || !!meta!.closed;
    foot.push(go);
    return sheet('drawer', `Tu carrito (${cartCount()})`, est.lines.map(cartLine), foot, 'shop-cart');
}

function policiesSheet(focus: 'terms' | 'returns' | 'seller'): HTMLElement {
    const m = meta!;
    const s = m.seller;
    const blocks: Array<[string, string, string]> = [];
    const sellerText = [
        s.legal_name,
        s.document ? `NIT / documento: ${s.document}` : '',
        [s.address, s.city].filter(Boolean).join(', '),
        s.email ? `Correo: ${s.email}` : '',
        s.phone ? `Teléfono: ${s.phone}` : '',
    ]
        .filter(Boolean)
        .join('\n');
    blocks.push(['seller', 'Quién vende', sellerText]);
    if (m.policies.delivery_time) blocks.push(['returns', 'Tiempos de entrega', m.policies.delivery_time]);
    if (m.policies.returns) blocks.push(['returns', 'Cambios, devoluciones y retracto', m.policies.returns]);
    if (m.policies.reversal) blocks.push(['returns', 'Reversión del pago', m.policies.reversal]);
    if (m.policies.terms) blocks.push(['terms', 'Términos y condiciones', m.policies.terms]);
    const body = el('div', { cls: 's-policy' });
    let target: HTMLElement | null = null;
    for (const [key, title, text] of blocks) {
        const h = el('h3', { text: title });
        if (!target && key === focus) target = h;
        body.append(h, el('div', { text }));
    }
    const box = sheet('narrow', 'Información de la tienda', [body], null, 'shop-policies');
    if (target) window.requestAnimationFrame(() => target!.scrollIntoView({ block: 'start' }));
    return box;
}

// ───────────────────────────── Compra ─────────────────────────────

interface CheckoutState {
    deliveryId: string | null;
    /** v0.1.415 — La zona de envío elegida (si la forma de entrega tiene zonas). */
    zoneId: string | null;
    payment: ShopPaymentMethod | null;
    stamp: string | null;
    stampAt: number;
    sending: boolean;
    serverCart: ShopCartResult | null;
    /** Con qué entrega, zona y cupón se pidió `serverCart`. */
    serverKey: string;
    /** v0.1.415 — El cupón que el servidor aceptó (se recalcula en vivo con él). */
    couponRule: ShopCouponRule | null;
    couponError: string | null;
    couponBusy: boolean;
}

const co: CheckoutState = {
    deliveryId: null,
    zoneId: null,
    payment: null,
    stamp: null,
    stampAt: 0,
    sending: false,
    serverCart: null,
    serverKey: '',
    couponRule: null,
    couponError: null,
    couponBusy: false,
};
let couponBox: HTMLElement | null = null;
let zoneBox: HTMLElement | null = null;
/** v0.1.417 — Lo que se está suscribiendo (producto o variante); null = una compra normal. */
let subscribingId: number | null = null;

function subscribeTarget(): ShopPurchasable | null {
    return subscribingId !== null ? (subscribable.get(subscribingId) ?? null) : null;
}

/** v0.1.416 — Con todo para descargar no hay forma de entrega ni zona. */
function effDelivery(): string | null {
    return digitalCart() ? null : co.deliveryId;
}
function effZone(): string | null {
    return digitalCart() ? null : co.zoneId;
}

function quoteKey(): string {
    return `${effDelivery() ?? ''}|${effZone() ?? ''}|${co.couponRule?.code ?? ''}`;
}

/** La cuenta que se muestra: la del servidor si es de este carrito, si no la estimación. */
function current(): ShopCartResult {
    if (co.serverCart && co.serverKey === quoteKey() && sameCart(co.serverCart)) return co.serverCart;
    return estimate(effDelivery(), effZone(), co.couponRule);
}

/** v0.1.416 — Un pedido sin costo (todo gratis) no pide forma de pago. */
function isFree(): boolean {
    const est = current();
    return est.lines.length > 0 && !est.blocked && est.total === 0;
}
const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = {};
const errs: Record<string, HTMLElement> = {};
let summaryEl: HTMLElement | null = null;
let alertEl: HTMLElement | null = null;
let submitBtn: HTMLButtonElement | null = null;
let addressBox: HTMLElement | null = null;
let deliverySecEl: HTMLElement | null = null;
let digitalNoteEl: HTMLElement | null = null;
let paySecEl: HTMLElement | null = null;
let freeNoteEl: HTMLElement | null = null;
let termsCb: HTMLInputElement | null = null;
let consentCb: HTMLInputElement | null = null;
let hpInput: HTMLInputElement | null = null;
let captchaBox: HTMLElement | null = null;
let captchaToken: string | null = null;
let captchaWidget: unknown = null;
let quoteTimer = 0;

function savedCustomer(): Record<string, string> {
    try {
        const raw = storageGet(CUSTOMER_KEY);
        return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
        return {};
    }
}

function field(key: string, label: string, opts: { type?: string; autocomplete?: string; required?: boolean; wide?: boolean; textarea?: boolean; inputmode?: string } = {}): HTMLElement {
    const id = `c_${key}`;
    const saved = savedCustomer();
    const input = opts.textarea
        ? el('textarea', { id, name: key, autocomplete: opts.autocomplete, 'aria-describedby': `${id}_e` })
        : el('input', { id, name: key, type: opts.type ?? 'text', autocomplete: opts.autocomplete, inputmode: opts.inputmode, 'aria-describedby': `${id}_e` });
    if (key !== 'notes' && saved[key]) input.value = saved[key]!;
    input.addEventListener('input', () => setErr(key, ''));
    inputs[key] = input;
    const err = el('div', { cls: 's-err', id: `${id}_e`, role: 'alert', hidden: true });
    errs[key] = err;
    return el('div', { cls: `s-f${opts.wide ? ' s-wide' : ''}` }, [el('label', { for: id, text: opts.required ? `${label} *` : label }), input, err]);
}

function setErr(key: string, text: string): void {
    const e = errs[key];
    const i = inputs[key];
    if (e) {
        e.textContent = text;
        e.hidden = !text;
    }
    if (i) i.setAttribute('aria-invalid', text ? 'true' : 'false');
}

function needsAddress(): boolean {
    // v0.1.417 — Una suscripción pide dirección sólo si la tienda lo pide (una caja que llega cada período).
    if (subscribingId !== null) return !!meta?.subscriptions?.address;
    if (digitalCart()) return false;
    const d = meta?.delivery.find((x) => x.id === co.deliveryId);
    return d?.needs_address ?? false;
}

/** Términos, autorización de datos y anti-robots: lo mismo en una compra y en una suscripción. */
function legalBlock(): HTMLElement[] {
    const m = meta!;
    const legal: HTMLElement[] = [];
    termsCb = null;
    consentCb = null;
    if (m.checkout.require_terms) {
        termsCb = el('input', { type: 'checkbox', id: 'c_terms', 'data-testid': 'shop-terms' });
        const link = el('button', { type: 'button', cls: 's-link', text: 'los términos y condiciones' });
        link.addEventListener('click', (e) => {
            e.preventDefault();
            openOverlay({ kind: 'policies', focus: 'terms' });
        });
        termsCb.addEventListener('change', () => setErr('terms', ''));
        errs.terms = el('div', { cls: 's-line-err', role: 'alert', hidden: true });
        legal.push(el('label', { cls: 's-check', for: 'c_terms' }, [termsCb, el('span', {}, ['Acepto ', link, ' y la política de cambios y devoluciones.'])]), errs.terms);
    }
    if (m.data_consent) {
        const dc = m.data_consent;
        consentCb = el('input', { type: 'checkbox', id: 'c_consent', 'data-testid': 'shop-consent' });
        consentCb.addEventListener('change', () => setErr('consent', ''));
        const full = el('div', { cls: 's-note', hidden: true, text: dc.text });
        const toggle = el('button', { type: 'button', cls: 's-link', text: 'Ver la autorización completa', 'aria-expanded': 'false' });
        toggle.addEventListener('click', () => {
            full.hidden = !full.hidden;
            toggle.setAttribute('aria-expanded', full.hidden ? 'false' : 'true');
            toggle.textContent = full.hidden ? 'Ver la autorización completa' : 'Ocultar la autorización';
        });
        errs.consent = el('div', { cls: 's-line-err', role: 'alert', hidden: true });
        legal.push(
            el('label', { cls: 's-check', for: 'c_consent' }, [consentCb, el('span', { text: dc.label })]),
            el('div', { style: 'margin:-4px 0 10px 27px;display:flex;gap:12px;flex-wrap:wrap' }, [
                toggle,
                dc.policy_url && /^https:\/\//i.test(dc.policy_url) ? el('a', { href: dc.policy_url, target: '_blank', rel: 'noopener noreferrer', text: 'Política de tratamiento de datos' }) : null,
            ]),
            full,
            errs.consent,
        );
    }
    captchaBox = null;
    if (m.captcha && !BOOT.preview) {
        captchaBox = el('div', { cls: 's-captcha' });
        legal.push(captchaBox);
    }
    return legal;
}

/**
 * v0.1.417 — Suscribirse a un producto: los datos de quien se suscribe (y la
 * dirección si la tienda la pide), cuánto y cada cuánto se cobra, y de ahí a
 * Mercado Pago o PayPal a autorizar la tarjeta. Sin carrito, cupón ni envío.
 */
function subscribeView(): HTMLElement[] {
    const m = meta!;
    for (const k of Object.keys(inputs)) delete inputs[k];
    deliverySecEl = null;
    digitalNoteEl = null;
    paySecEl = null;
    freeNoteEl = null;
    couponBox = null;
    zoneBox = null;
    const back = el('button', { type: 'button', cls: 's-back' }, [icon('back'), 'Volver a la tienda']);
    back.addEventListener('click', goCatalog);
    const item = subscribeTarget();
    const plan = item?.product.subscription ?? null;
    if (!item || !plan) {
        summaryEl = null;
        submitBtn = null;
        return [el('div', { 'data-testid': 'shop-subscribe-view' }, [back, el('h1', { text: 'Suscribirme' }), el('p', { cls: 's-empty', text: 'Esta suscripción ya no está disponible. Escríbenos para contratarla.' })])];
    }
    const you = el('section', { cls: 's-sec' }, [
        el('h3', { text: 'Tus datos' }),
        el('div', { cls: 's-fields' }, [
            field('name', 'Nombre completo', { autocomplete: 'name', required: true, wide: true }),
            field('email', 'Correo', { type: 'email', autocomplete: 'email', required: true }),
            field('phone', 'Celular', { type: 'tel', autocomplete: 'tel', inputmode: 'tel' }),
            m.checkout.ask_document !== 'hidden' ? field('document', 'Cédula o NIT', { required: m.checkout.ask_document === 'required', inputmode: 'numeric' }) : null,
        ].filter((x): x is HTMLElement => x !== null)),
    ]);
    addressBox = null;
    const addrSec = m.subscriptions?.address
        ? el('section', { cls: 's-sec', 'data-testid': 'shop-sub-address' }, [
              el('h3', { text: '¿A dónde te lo enviamos?' }),
              el('p', { cls: 's-line-p', style: 'margin:-4px 0 10px', text: 'Cada envío de tu suscripción llega a esta dirección.' }),
              el('div', { cls: 's-fields' }, [
                  field('address', 'Dirección', { autocomplete: 'street-address', required: true, wide: true }),
                  field('city', 'Ciudad', { autocomplete: 'address-level2', required: true, wide: true }),
              ]),
          ])
        : null;
    const trial = plan.trial_days > 0 ? ` El primer cobro llega cuando ${plan.trial_days === 1 ? 'termina el día gratis' : `terminan los ${plan.trial_days} días gratis`}.` : '';
    const paySec = el('section', { cls: 's-sec', 'data-testid': 'shop-sub-pay' }, [
        el('h3', { text: 'Pago' }),
        el('div', { cls: 's-kind-box' }, [
            icon('repeat'),
            el('span', { text: `Se cobra ${money(item.price ?? 0)} ${cadenceText(plan)} con débito automático. Al continuar te llevamos a ${providerName(plan.provider)} para autorizar tu tarjeta una sola vez.${trial}` }),
        ]),
    ]);
    const notesSec = m.checkout.ask_notes ? el('section', { cls: 's-sec' }, [el('div', { cls: 's-fields' }, [field('notes', 'Notas (opcional)', { textarea: true, wide: true })])]) : null;
    summaryEl = el('div', { cls: 's-sum', 'data-testid': 'shop-summary' });
    alertEl = el('div', { cls: 's-warn', role: 'alert', hidden: true });
    const legal = legalBlock();
    hpInput = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    const hp = el('div', { cls: 's-hp', 'aria-hidden': 'true' }, [hpInput]);
    submitBtn = el('button', { type: 'submit', cls: 's-btn', 'data-testid': 'shop-place' });
    const form = el('form', { novalidate: true }, [you, addrSec, paySec, notesSec, hp]);
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        void placeOrder();
    });
    submitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        void placeOrder();
    });
    const aside = el('aside', { cls: 's-panel s-co-aside' }, [
        el('h3', { text: 'Resumen' }),
        summaryEl,
        alertEl,
        ...legal,
        submitBtn,
        el('p', { cls: 's-line-p', style: 'margin:10px 0 0;text-align:center', text: `Vende: ${m.seller.legal_name || m.company}` }),
    ]);
    const layout = el('div', { cls: 's-checkout', 'data-testid': 'shop-subscribe-view' }, [
        el('div', {}, [back, el('h1', { text: 'Suscribirme' }), m.closed ? el('div', { cls: 's-closed', text: m.closed }) : null, form]),
        aside,
    ]);
    paintSubSummary();
    paintSubmit();
    ensureStamp();
    if (captchaBox) mountCaptcha();
    return [layout];
}

/** v0.1.417 — El resumen de una suscripción: qué, cuánto y cada cuánto. */
function paintSubSummary(): void {
    if (!summaryEl || !meta) return;
    const item = subscribeTarget();
    const plan = item?.product.subscription ?? null;
    if (!item || !plan) return;
    const price = item.price ?? 0;
    const freq = subscriptionFrequencyText(plan.frequency, plan.frequency_type);
    const rows: HTMLElement[] = [
        el('div', {}, [el('span', { text: item.title }), el('span', { text: money(price) })]),
        el('div', {}, [el('span', { text: 'Se cobra' }), el('span', { 'data-testid': 'shop-sub-frequency', text: freq })]),
    ];
    if (plan.trial_days > 0) rows.push(el('div', {}, [el('span', { text: 'Prueba gratis' }), el('span', { text: plan.trial_days === 1 ? '1 día' : `${plan.trial_days} días` })]));
    if (plan.cycles !== null && plan.cycles > 0) rows.push(el('div', {}, [el('span', { text: 'Cobros' }), el('span', { text: String(plan.cycles) })]));
    rows.push(el('div', {}, [el('span', { text: 'Con' }), el('span', { text: providerName(plan.provider) })]));
    rows.push(el('div', { cls: 's-tot' }, [el('span', { text: `Total ${freq}` }), el('span', { 'data-testid': 'shop-total', text: money(price) })]));
    summaryEl.replaceChildren(...rows);
    if (alertEl) {
        const warn = soldOut(item) ? 'Ya no quedan cupos para esta suscripción.' : item.price === null ? 'Esta suscripción no tiene precio.' : '';
        if (warn) {
            alertEl.textContent = warn;
            alertEl.hidden = false;
        } else if (alertEl.dataset.kind !== 'server') alertEl.hidden = true;
    }
}

function checkoutView(): HTMLElement[] {
    const m = meta!;
    for (const k of Object.keys(inputs)) delete inputs[k];
    if (!co.deliveryId || !m.delivery.some((d) => d.id === co.deliveryId)) co.deliveryId = m.delivery[0]?.id ?? null;
    if (!co.payment || !m.payments.some((p) => p.method === co.payment)) co.payment = m.payments[0]?.method ?? null;

    const back = el('button', { type: 'button', cls: 's-back' }, [icon('back'), 'Seguir comprando']);
    back.addEventListener('click', goCatalog);

    const you = el('section', { cls: 's-sec' }, [
        el('h3', { text: 'Tus datos' }),
        el('div', { cls: 's-fields' }, [
            field('name', 'Nombre completo', { autocomplete: 'name', required: true, wide: true }),
            field('email', 'Correo', { type: 'email', autocomplete: 'email', required: true }),
            field('phone', 'Celular', { type: 'tel', autocomplete: 'tel', inputmode: 'tel' }),
            m.checkout.ask_document !== 'hidden' ? field('document', 'Cédula o NIT', { required: m.checkout.ask_document === 'required', inputmode: 'numeric' }) : null,
        ].filter((x): x is HTMLElement => x !== null)),
    ]);

    const deliveryOpts = el('div', { cls: 's-opts', role: 'radiogroup', 'aria-label': 'Cómo recibes tu pedido' });
    for (const d of m.delivery) {
        const radio = el('input', { type: 'radio', name: 'delivery', value: d.id, checked: d.id === co.deliveryId });
        radio.addEventListener('change', () => {
            co.deliveryId = d.id;
            if (!d.zones.some((z) => z.id === co.zoneId)) co.zoneId = null;
            if (addressBox) addressBox.hidden = !needsAddress();
            paintZones();
            paintSummary();
            scheduleQuote();
        });
        const prices = d.zones.length > 0 ? d.zones.map((z) => z.price) : [d.price];
        const low = Math.min(...prices);
        const priceText = d.zones.length > 0 ? (low > 0 ? `Desde ${money(low)}` : 'Según la zona') : d.price > 0 ? money(d.price) : 'Gratis';
        const extra = [d.eta, d.free_over && d.free_over > 0 && d.zones.length === 0 ? `Gratis desde ${money(d.free_over)}` : ''].filter(Boolean).join(' · ');
        deliveryOpts.append(
            el('label', { cls: 's-opt', 'data-testid': 'shop-delivery' }, [
                radio,
                el('span', { cls: 's-opt-t' }, [
                    el('span', { cls: 's-opt-n', text: d.name }),
                    d.description ? el('span', { cls: 's-opt-d', style: 'display:block', text: d.description }) : null,
                    extra ? el('span', { cls: 's-opt-d', style: 'display:block', text: extra }) : null,
                ]),
                el('span', { cls: 's-opt-p', text: priceText }),
            ]),
        );
    }
    zoneBox = el('div', { cls: 's-fields', style: 'margin-top:12px' });
    addressBox = el('div', { cls: 's-fields', style: 'margin-top:12px', hidden: !needsAddress() }, [
        field('address', 'Dirección', { autocomplete: 'street-address', required: true, wide: true }),
        field('city', 'Ciudad', { autocomplete: 'address-level2', required: true, wide: true }),
    ]);
    const deliverySec = el('section', { cls: 's-sec' }, [el('h3', { text: 'Entrega' }), deliveryOpts, zoneBox, addressBox]);
    deliverySecEl = deliverySec;
    // v0.1.416 — Todo para descargar: no se pide entrega ni dirección.
    digitalNoteEl = el('section', { cls: 's-sec', 'data-testid': 'shop-digital-note' }, [
        el('h3', { text: 'Entrega' }),
        el('div', { cls: 's-kind-box' }, [icon('download'), el('span', { text: `Tu pedido se descarga: no hay envío. ${downloadsText()} Te mandamos los enlaces por correo.` })]),
    ]);
    paintZones();

    const payOpts = el('div', { cls: 's-opts', role: 'radiogroup', 'aria-label': 'Forma de pago' });
    for (const p of m.payments) {
        const radio = el('input', { type: 'radio', name: 'payment', value: p.method, checked: p.method === co.payment });
        radio.addEventListener('change', () => {
            co.payment = p.method;
            paintSubmit();
        });
        payOpts.append(
            el('label', { cls: 's-opt', 'data-testid': 'shop-payment' }, [
                radio,
                el('span', { cls: 's-opt-t' }, [el('span', { cls: 's-opt-n', text: p.label }), p.instructions ? el('span', { cls: 's-opt-d', style: 'display:block', text: p.instructions }) : null]),
            ]),
        );
    }
    const paySec = el('section', { cls: 's-sec' }, [el('h3', { text: 'Pago' }), payOpts]);
    paySecEl = paySec;
    freeNoteEl = el('section', { cls: 's-sec', 'data-testid': 'shop-free-note' }, [
        el('h3', { text: 'Pago' }),
        el('div', { cls: 's-kind-box' }, [icon('check'), el('span', { text: 'Este pedido no tiene costo: no hay nada que pagar.' })]),
    ]);

    const notesSec = m.checkout.ask_notes ? el('section', { cls: 's-sec' }, [el('div', { cls: 's-fields' }, [field('notes', 'Notas para el pedido (opcional)', { textarea: true, wide: true })])]) : null;

    summaryEl = el('div', { cls: 's-sum', 'data-testid': 'shop-summary' });
    alertEl = el('div', { cls: 's-warn', role: 'alert', hidden: true });
    const legal = legalBlock();
    hpInput = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    const hp = el('div', { cls: 's-hp', 'aria-hidden': 'true' }, [hpInput]);
    submitBtn = el('button', { type: 'submit', cls: 's-btn', 'data-testid': 'shop-place' });

    const form = el('form', { novalidate: true }, [you, deliverySec, digitalNoteEl, paySec, freeNoteEl, notesSec, hp]);
    paintModes();
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        void placeOrder();
    });
    couponBox = m.coupons ? el('div', { cls: 's-coupon', 'data-testid': 'shop-coupon-box' }) : null;
    const aside = el('aside', { cls: 's-panel s-co-aside' }, [
        el('h3', { text: 'Resumen' }),
        summaryEl,
        couponBox,
        alertEl,
        ...legal,
        submitBtn,
        el('p', { cls: 's-line-p', style: 'margin:10px 0 0;text-align:center', text: `Vende: ${m.seller.legal_name || m.company}` }),
    ]);
    submitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        void placeOrder();
    });

    const layout = el('div', { cls: 's-checkout', 'data-testid': 'shop-checkout-view' }, [
        el('div', {}, [back, el('h1', { text: 'Finalizar compra' }), m.closed ? el('div', { cls: 's-closed', text: m.closed }) : null, form]),
        aside,
    ]);
    paintCoupon();
    paintSummary();
    paintSubmit();
    // v0.1.415 — Un cupón de la sesión (escrito antes o llegado por `?cupon=`) se aplica solo.
    const pending = sessionGet(COUPON_KEY);
    if (m.coupons && pending && !co.couponRule && !BOOT.preview) void applyCoupon(pending, true);
    else scheduleQuote(0);
    ensureStamp();
    if (captchaBox) mountCaptcha();
    return [layout];
}

/** v0.1.415 — La zona de envío: sólo si la forma de entrega elegida tiene zonas. */
let zoneNote: HTMLElement | null = null;
function zoneNoteText(): string {
    const d = meta?.delivery.find((x) => x.id === co.deliveryId);
    const z = d?.zones.find((x) => x.id === co.zoneId);
    if (!z) return '';
    const free = z.free_over ?? d?.free_over ?? null;
    return [z.eta, free && free > 0 ? `Gratis desde ${money(free)}` : ''].filter(Boolean).join(' · ');
}
function paintZones(): void {
    if (!zoneBox || !meta) return;
    const d = meta.delivery.find((x) => x.id === co.deliveryId);
    delete inputs.zone;
    delete errs.zone;
    if (!d || d.zones.length === 0) {
        zoneBox.hidden = true;
        zoneBox.replaceChildren();
        return;
    }
    zoneBox.hidden = false;
    const sel = el('select', { id: 'c_zone', name: 'zone', 'aria-describedby': 'c_zone_e', 'data-testid': 'shop-zone' });
    sel.append(el('option', { value: '', text: 'Elige a dónde enviamos' }));
    for (const z of d.zones) sel.append(el('option', { value: z.id, text: `${z.name} · ${z.price > 0 ? money(z.price) : 'Gratis'}`, selected: z.id === co.zoneId }));
    sel.value = co.zoneId ?? '';
    sel.addEventListener('change', () => {
        co.zoneId = sel.value || null;
        setErr('zone', '');
        if (zoneNote) {
            zoneNote.textContent = zoneNoteText();
            zoneNote.hidden = !zoneNote.textContent;
        }
        paintSummary();
        scheduleQuote();
    });
    inputs.zone = sel;
    const err = el('div', { cls: 's-err', id: 'c_zone_e', role: 'alert', hidden: true });
    errs.zone = err;
    zoneNote = el('div', { cls: 's-opt-d', style: 'margin-top:6px', text: zoneNoteText(), hidden: !zoneNoteText() });
    zoneBox.replaceChildren(el('div', { cls: 's-f s-wide' }, [el('label', { for: 'c_zone', text: '¿A dónde lo enviamos? *' }), sel, zoneNote, err]));
}

function zoneMissing(): boolean {
    if (subscribingId !== null || digitalCart()) return false;
    return shipFor(co.deliveryId, co.zoneId).zone_required && !co.zoneId;
}

// ── v0.1.415 — Cupón ──
let couponOpen = false;
let couponInput: HTMLInputElement | null = null;
let couponMsg: HTMLElement | null = null;

function paintCoupon(): void {
    if (!couponBox || !meta) return;
    const rule = co.couponRule;
    if (rule) {
        couponInput = null;
        couponMsg = null;
        const est = current();
        const problem = est.coupon_problem ? shopCouponProblemText(est.coupon_problem, rule, money) : null;
        const remove = el('button', { type: 'button', cls: 's-link', text: 'Quitar', 'data-testid': 'shop-coupon-remove' });
        remove.addEventListener('click', removeCoupon);
        couponBox.replaceChildren(
            el('div', { cls: `s-coupon-on${problem ? ' s-coupon-off' : ''}`, 'data-testid': 'shop-coupon-applied' }, [
                icon('tag'),
                el('span', { cls: 's-coupon-t' }, [el('strong', { text: rule.code }), el('span', { text: rule.label })]),
                remove,
            ]),
            ...(problem ? [el('div', { cls: 's-line-err', role: 'alert', 'data-testid': 'shop-coupon-problem', text: `${problem} No se descuenta.` })] : []),
        );
        return;
    }
    if (!couponOpen && !co.couponError) {
        couponInput = null;
        couponMsg = null;
        const open = el('button', { type: 'button', cls: 's-link s-coupon-open', 'data-testid': 'shop-coupon-open' }, [icon('tag'), '¿Tienes un cupón?']);
        open.addEventListener('click', () => {
            couponOpen = true;
            paintCoupon();
            couponInput?.focus();
        });
        couponBox.replaceChildren(open);
        return;
    }
    if (!couponInput || !couponBox.contains(couponInput)) {
        couponInput = el('input', { type: 'text', id: 'c_coupon', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '40', placeholder: 'Código del cupón', 'aria-describedby': 'c_coupon_e', 'data-testid': 'shop-coupon-input' });
        couponInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                void applyCoupon(couponInput?.value ?? '', false);
            }
        });
        const btn = el('button', { type: 'button', cls: 's-btn s-ghost s-coupon-btn', 'data-testid': 'shop-coupon-apply' });
        btn.addEventListener('click', () => void applyCoupon(couponInput?.value ?? '', false));
        couponMsg = el('div', { cls: 's-line-err', id: 'c_coupon_e', role: 'alert', hidden: true, 'data-testid': 'shop-coupon-error' });
        couponBox.replaceChildren(el('label', { for: 'c_coupon', cls: 's-coupon-l', text: 'Cupón de descuento' }), el('div', { cls: 's-coupon-row' }, [couponInput, btn]), couponMsg);
    }
    const btn = couponBox.querySelector<HTMLButtonElement>('.s-coupon-btn');
    if (btn) {
        btn.disabled = co.couponBusy;
        btn.replaceChildren(co.couponBusy ? el('span', { cls: 's-spin', 'aria-hidden': 'true' }) : '', co.couponBusy ? 'Revisando…' : 'Aplicar');
    }
    if (couponMsg) {
        couponMsg.textContent = co.couponError ?? '';
        couponMsg.hidden = !co.couponError;
    }
    couponInput.setAttribute('aria-invalid', co.couponError ? 'true' : 'false');
}

async function applyCoupon(raw: string, auto: boolean): Promise<void> {
    if (!meta || co.couponBusy) return;
    const code = normalizeCouponCode(raw);
    if (!code) {
        co.couponError = raw.trim() ? 'Ese código no es válido: revisa cómo lo escribiste.' : 'Escribe el código del cupón.';
        couponOpen = true;
        paintCoupon();
        return;
    }
    if (couponInput) couponInput.value = code;
    co.couponBusy = true;
    co.couponError = null;
    paintCoupon();
    const res = await api<PublicShopQuote>('/quote', {
        method: 'POST',
        body: JSON.stringify({ lines: [...cart].map(([product_id, qty]) => ({ product_id, qty })), delivery_id: co.deliveryId, zone_id: co.zoneId, coupon: code }),
    });
    co.couponBusy = false;
    if (!res.ok) {
        co.couponError = res.error.message || 'No pudimos revisar el cupón. Vuelve a intentar.';
        couponOpen = true;
    } else if (res.data.coupon_error || !res.data.coupon_rule) {
        co.couponError = res.data.coupon_error ?? 'Ese cupón no existe o ya no está vigente.';
        co.couponRule = null;
        sessionSet(COUPON_KEY, null);
        couponOpen = true;
    } else {
        co.couponRule = res.data.coupon_rule;
        co.couponError = null;
        sessionSet(COUPON_KEY, code);
        co.serverCart = res.data;
        co.serverKey = quoteKey();
        if (!auto) toast(`Cupón ${code} aplicado`);
    }
    // Un cupón que llegó por el enlace y ya no sirve no molesta: se olvida sin abrir la caja.
    if (auto && !co.couponRule) {
        co.couponError = null;
        couponOpen = false;
    }
    paintCoupon();
    paintSummary();
    if (auto && co.couponRule === null) scheduleQuote(0);
}

function removeCoupon(): void {
    co.couponRule = null;
    co.couponError = null;
    couponOpen = false;
    sessionSet(COUPON_KEY, null);
    paintCoupon();
    paintSummary();
    scheduleQuote(0);
}

/** v0.1.416 — Entrega (o descarga) y pago (o sin costo) según lo que hay en el carrito. */
function paintModes(): void {
    if (subscribingId !== null) return;
    const digital = digitalCart();
    if (deliverySecEl) deliverySecEl.hidden = digital;
    if (digitalNoteEl) digitalNoteEl.hidden = !digital;
    const free = isFree();
    if (paySecEl) paySecEl.hidden = free;
    if (freeNoteEl) freeNoteEl.hidden = !free;
}

function paintSummary(): void {
    if (!summaryEl || !meta) return;
    if (subscribingId !== null) {
        paintSubSummary();
        return;
    }
    paintModes();
    const est = current();
    const rows: HTMLElement[] = [];
    for (const l of est.lines) {
        const p = buyable.get(l.product_id);
        const problem = shopLineProblemText(l);
        rows.push(
            el('div', {}, [
                el('span', {}, [`${l.qty} × ${p?.title || l.title || 'Producto'}`, problem ? el('span', { cls: 's-line-err', style: 'display:block', text: problem }) : null]),
                el('span', { text: money(l.subtotal) }),
            ]),
        );
    }
    rows.push(el('div', { style: 'padding-top:6px;border-top:1px solid var(--s-line);margin-top:4px' }, [el('span', { text: 'Subtotal' }), el('span', { text: money(est.subtotal) })]));
    if (est.discount > 0) {
        rows.push(
            el('div', { cls: 's-disc', 'data-testid': 'shop-discount' }, [el('span', { text: `Descuento${est.coupon ? ` (${est.coupon.code})` : ''}` }), el('span', { text: `-${money(est.discount)}` })]),
        );
    }
    const digital = digitalCart();
    const d = digital ? undefined : meta.delivery.find((x) => x.id === co.deliveryId);
    const z = d?.zones.find((x) => x.id === co.zoneId);
    const shipText = digital ? 'Sin envío' : zoneMissing() ? 'Elige la zona' : est.shipping > 0 ? money(est.shipping) : 'Gratis';
    rows.push(el('div', {}, [el('span', { text: digital ? 'Entrega · Descarga digital' : d ? `Entrega · ${d.name}${z ? ` · ${z.name}` : ''}` : 'Entrega' }), el('span', { 'data-testid': 'shop-shipping', text: shipText })]));
    if (!digital && est.free_shipping_missing !== null && !zoneMissing()) {
        rows.push(el('div', { cls: 's-free-hint', 'data-testid': 'shop-free-hint' }, [icon('truck'), el('span', { text: `Te faltan ${money(est.free_shipping_missing)} para el envío gratis.` })]));
    }
    rows.push(el('div', { cls: 's-tot' }, [el('span', { text: 'Total' }), el('span', { 'data-testid': 'shop-total', text: money(est.total) })]));
    summaryEl.replaceChildren(...rows);
    if (co.couponRule) paintCoupon();
    if (alertEl) {
        let warn = '';
        if (est.lines.length === 0) warn = 'Tu carrito está vacío.';
        else if (est.below_minimum !== null) warn = `La compra mínima es de ${money(meta.checkout.min_order ?? 0)}: te faltan ${money(est.below_minimum)}.`;
        else if (est.blocked) warn = 'Algo de tu carrito ya no está disponible: quítalo o cambia la cantidad.';
        if (warn) {
            alertEl.textContent = warn;
            alertEl.hidden = false;
        } else if (alertEl.dataset.kind !== 'server') alertEl.hidden = true;
    }
    paintSubmit();
}

function sameCart(c: ShopCartResult): boolean {
    const lines = c.lines.filter((l) => l.qty > 0);
    if (lines.length !== cart.size) return false;
    for (const l of lines) if (cart.get(l.product_id) !== l.qty) return false;
    return true;
}

function paintSubmit(): void {
    if (!submitBtn || !meta) return;
    if (subscribingId !== null) {
        const item = subscribeTarget();
        const plan = item?.product.subscription ?? null;
        const label = item && plan && item.price !== null ? `Suscribirme · ${money(item.price)} ${subscriptionFrequencyText(plan.frequency, plan.frequency_type)}` : 'Suscribirme';
        submitBtn.replaceChildren(co.sending ? el('span', { cls: 's-spin', 'aria-hidden': 'true' }) : '', co.sending ? 'Preparando la suscripción…' : label);
        submitBtn.disabled = co.sending || !item || !plan || item.price === null || soldOut(item) || !!meta.closed;
        return;
    }
    const est = current();
    const free = isFree();
    const label = free
        ? 'Confirmar el pedido'
        : co.payment === 'whatsapp'
          ? 'Confirmar y enviar por WhatsApp'
          : co.payment === 'online'
            ? `Ir a pagar · ${money(est.total)}`
            : `Hacer el pedido · ${money(est.total)}`;
    submitBtn.replaceChildren(co.sending ? el('span', { cls: 's-spin', 'aria-hidden': 'true' }) : '', co.sending ? (co.payment === 'online' && !free ? 'Preparando el pago…' : 'Enviando…') : label);
    submitBtn.disabled = co.sending || est.blocked || est.below_minimum !== null || (!free && !co.payment) || (!digitalCart() && !co.deliveryId) || !!meta.closed;
}

function scheduleQuote(delay = 400): void {
    if (BOOT.preview || subscribingId !== null) return;
    window.clearTimeout(quoteTimer);
    quoteTimer = window.setTimeout(async () => {
        if (cart.size === 0) return;
        const key = quoteKey();
        const res = await api<PublicShopQuote>('/quote', {
            method: 'POST',
            body: JSON.stringify({
                lines: [...cart].map(([product_id, qty]) => ({ product_id, qty })),
                delivery_id: effDelivery(),
                zone_id: effZone(),
                coupon: co.couponRule?.code,
            }),
        });
        if (!res.ok || key !== quoteKey()) return;
        // v0.1.415 — El cupón pudo vencer o agotarse mientras tanto: se quita y se dice por qué.
        if (co.couponRule && res.data.coupon_error) {
            co.couponRule = null;
            co.couponError = res.data.coupon_error;
            couponOpen = true;
            sessionSet(COUPON_KEY, null);
            paintCoupon();
            paintSummary();
            scheduleQuote(0);
            return;
        }
        if (co.couponRule && res.data.coupon_rule) co.couponRule = res.data.coupon_rule;
        co.serverCart = res.data;
        co.serverKey = quoteKey();
        paintSummary();
    }, delay);
}

function ensureStamp(): void {
    if (BOOT.preview || co.stamp) return;
    void api<{ stamp: string }>('/stamp').then((r) => {
        if (r.ok) {
            co.stamp = r.data.stamp;
            co.stampAt = Date.now();
        }
    });
}

interface CaptchaApi {
    render: (el: HTMLElement, opts: Record<string, unknown>) => unknown;
    reset: (id?: unknown) => void;
}
function captchaApi(): CaptchaApi | null {
    const p = meta?.captcha?.provider;
    const w = window as unknown as Record<string, CaptchaApi | undefined>;
    return (p === 'turnstile' ? w.turnstile : p === 'hcaptcha' ? w.hcaptcha : w.grecaptcha) ?? null;
}
function mountCaptcha(): void {
    const c = meta?.captcha;
    const box = captchaBox;
    if (!c || !box) return;
    const w = window as unknown as Record<string, unknown>;
    w.__imbShopCaptcha = (): void => {
        const api2 = captchaApi();
        if (!api2?.render) return;
        const opts: Record<string, unknown> = {
            sitekey: c.site_key,
            callback: (t: string) => {
                captchaToken = t;
            },
            'expired-callback': () => {
                captchaToken = null;
            },
            'error-callback': () => {
                captchaToken = null;
            },
        };
        if (c.provider === 'turnstile') opts.language = 'es';
        try {
            captchaWidget = api2.render(box, opts);
        } catch {
            // el widget dirá qué pasó
        }
    };
    if (captchaApi()?.render) {
        (w.__imbShopCaptcha as () => void)();
        return;
    }
    const src = BOOT.scripts[c.provider];
    if (!src) return;
    const s = document.createElement('script');
    s.src = `${src}?render=explicit&onload=__imbShopCaptcha${c.provider === 'turnstile' ? '' : '&hl=es'}`;
    s.async = true;
    document.head.appendChild(s);
}
function resetCaptcha(): void {
    captchaToken = null;
    const a = captchaApi();
    if (a && captchaWidget !== null) {
        try {
            a.reset(captchaWidget);
        } catch {
            // nada
        }
    }
}

function showServerAlert(text: string): void {
    if (!alertEl) return;
    alertEl.textContent = text;
    alertEl.dataset.kind = 'server';
    alertEl.hidden = false;
    alertEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function validate(): boolean {
    const m = meta!;
    let firstBad: HTMLElement | null = null;
    const bad = (key: string, text: string): void => {
        setErr(key, text);
        if (!firstBad) firstBad = inputs[key] ?? errs[key] ?? null;
    };
    for (const k of Object.keys(errs)) setErr(k, '');
    const v = (k: string): string => (inputs[k]?.value ?? '').trim();
    if (!v('name')) bad('name', 'Escribe tu nombre.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) bad('email', 'Escribe un correo válido.');
    if (m.checkout.ask_document === 'required' && !v('document')) bad('document', 'Escribe tu número de documento.');
    if (zoneMissing()) bad('zone', 'Elige a dónde enviamos tu pedido.');
    if (needsAddress()) {
        if (!v('address')) bad('address', 'Escribe la dirección de entrega.');
        if (!v('city')) bad('city', 'Escribe la ciudad.');
    }
    if (termsCb && !termsCb.checked) bad('terms', 'Para comprar, acepta los términos y condiciones.');
    if (consentCb && !consentCb.checked) bad('consent', 'Para comprar, acepta la autorización para el tratamiento de tus datos.');
    if (firstBad) {
        (firstBad as HTMLElement).focus?.();
        (firstBad as HTMLElement).scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        return false;
    }
    if (m.captcha && !captchaToken) {
        showServerAlert('Completa la verificación anti-robots.');
        return false;
    }
    return true;
}

async function placeOrder(): Promise<void> {
    if (!meta || co.sending) return;
    // v0.1.417 — Suscribirse: un solo producto, sin carrito ni cupón.
    const subItem = subscribeTarget();
    const subscribing = subscribingId !== null;
    if (subscribing && !subItem) return;
    if (alertEl) {
        alertEl.dataset.kind = '';
        alertEl.hidden = true;
    }
    if (BOOT.preview) {
        showServerAlert('Es una vista previa: en la tienda publicada aquí se hace el pedido.');
        return;
    }
    if (!validate()) return;
    co.sending = true;
    paintSubmit();
    try {
        if (!co.stamp) {
            const r = await api<{ stamp: string }>('/stamp');
            if (r.ok) {
                co.stamp = r.data.stamp;
                co.stampAt = Date.now();
            }
        }
        // El servidor rechaza un pedido hecho en menos de 3 s desde que se abrió la compra.
        const wait = 3200 - (Date.now() - co.stampAt);
        if (wait > 0) await new Promise((r) => window.setTimeout(r, wait));
        const v = (k: string): string => (inputs[k]?.value ?? '').trim();
        const customer = { name: v('name'), email: v('email').toLowerCase(), phone: v('phone'), document: v('document'), address: needsAddress() ? v('address') : '', city: needsAddress() ? v('city') : '', notes: v('notes') };
        storageSet(CUSTOMER_KEY, JSON.stringify({ name: customer.name, email: customer.email, phone: customer.phone, document: customer.document, address: customer.address, city: customer.city }));
        const body = {
            lines: subscribing ? [{ product_id: subItem!.id, qty: 1 }] : [...cart].map(([product_id, qty]) => ({ product_id, qty })),
            customer,
            delivery_id: subscribing ? null : effDelivery(),
            zone_id: subscribing ? null : effZone(),
            // v0.1.415 — El cupón viaja sólo si descuenta algo en este carrito (el total que se ve es el que se cobra).
            coupon: !subscribing && co.couponRule && current().coupon ? co.couponRule.code : undefined,
            // v0.1.416 — Sin costo no se elige forma de pago (el servidor lo confirma con su cuenta).
            payment_method: subscribing ? 'subscription' : isFree() ? 'free' : co.payment,
            terms: termsCb ? termsCb.checked : true,
            consent: consentCb ? consentCb.checked : false,
            stamp: co.stamp ?? '',
            captcha: captchaToken ?? undefined,
            website: hpInput?.value ?? '',
            origin: { page: location.href.slice(0, 2000), referrer: document.referrer.slice(0, 2000) },
        };
        const res = await api<{ order_token: string; number: string; total: number; payment_method: ShopPaymentMethod; whatsapp_path: string | null; pay_url: string | null }>('/orders', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            if (meta.captcha) resetCaptcha();
            const e = res.error;
            if (subscribing && (e.code === 'shop_cart_changed' || e.code === 'shop_subscription')) {
                const line = e.data?.cart?.lines?.[0];
                const why = line ? shopLineProblemText(line) : '';
                showServerAlert(why ? `${why} No se pudo hacer la suscripción.` : e.message || 'No se pudo hacer la suscripción. Vuelve a intentar.');
                return;
            }
            if (e.code === 'shop_cart_changed' && e.data?.cart) {
                co.serverCart = e.data.cart;
                for (const l of e.data.cart.lines) {
                    if (l.problem === 'unavailable' || l.problem === 'no_price' || l.problem === 'no_stock') cart.delete(l.product_id);
                    else if (l.problem === 'low_stock' && l.available !== null) cart.set(l.product_id, l.available);
                }
                saveCart();
                paintCartButtons();
                paintSummary();
                showServerAlert(`${e.message ?? 'Algo de tu carrito cambió.'} Ajustamos tu carrito: revísalo y confirma de nuevo.`);
                return;
            }
            if (e.code === 'shop_coupon') {
                co.couponRule = null;
                co.couponError = e.message ?? 'Ese cupón ya no sirve.';
                couponOpen = true;
                sessionSet(COUPON_KEY, null);
                paintCoupon();
                paintSummary();
                showServerAlert(`${e.message ?? 'El cupón ya no sirve.'} Quitamos el cupón: revisa el total y confirma de nuevo.`);
                return;
            }
            if (e.code === 'shop_stale') co.stamp = null;
            if (e.code === 'shop_too_fast') co.stampAt = Date.now();
            const key = { shop_address: needsAddress() ? 'address' : '', shop_document: 'document', shop_terms: 'terms', shop_consent: 'consent', shop_zone: 'zone' }[e.code ?? ''];
            if (key && errs[key]) setErr(key, e.message ?? '');
            showServerAlert(e.message || (res.status === 429 ? 'Hiciste muchos pedidos seguidos. Espera unos minutos y vuelve a intentar.' : 'No pudimos hacer el pedido. Vuelve a intentar.'));
            return;
        }
        if (!subscribing) {
            cart.clear();
            saveCart();
            paintCartButtons();
            co.couponRule = null;
            co.couponError = null;
            couponOpen = false;
            sessionSet(COUPON_KEY, null);
        }
        const url = new URL(location.href);
        url.searchParams.set('pedido', res.data.order_token);
        history.replaceState(null, '', url.pathname + url.search);
        // v0.1.413 — Pago en línea: directo a pagar (al volver, la página muestra cómo quedó).
        const payUrl = safePayUrl(res.data.pay_url);
        if (payUrl && subscribing) {
            // v0.1.417 — A autorizar la tarjeta (al volver, la página muestra cómo quedó).
            const prov = subItem!.product.subscription ? providerName(subItem!.product.subscription.provider) : 'el medio de pago';
            subscribingId = null;
            paint([
                el('div', { cls: 's-wrap', style: 'max-width:640px;padding-top:28px' }, [
                    el('div', { cls: 's-ok', 'data-testid': 'shop-going-to-pay' }, [
                        el('span', { cls: 's-spin', 'aria-hidden': 'true' }),
                        el('h2', { text: `Te llevamos a ${prov}…` }),
                        el('p', { text: `Autoriza tu tarjeta para activar tu suscripción (${res.data.number}).` }),
                        el('a', { cls: 's-btn', href: payUrl, 'data-testid': 'shop-pay-now' }, ['Activar mi suscripción']),
                    ]),
                ]),
            ]);
            location.assign(payUrl);
            return;
        }
        if (payUrl) {
            paint([
                el('div', { cls: 's-wrap', style: 'max-width:640px;padding-top:28px' }, [
                    el('div', { cls: 's-ok', 'data-testid': 'shop-going-to-pay' }, [
                        el('span', { cls: 's-spin', 'aria-hidden': 'true' }),
                        el('h2', { text: 'Te llevamos a pagar…' }),
                        el('p', { text: `Tu pedido ${res.data.number} quedó apartado mientras pagas.` }),
                        el('a', { cls: 's-btn', href: payUrl, 'data-testid': 'shop-pay-now' }, ['Ir a pagar']),
                    ]),
                ]),
            ]);
            location.assign(payUrl);
            return;
        }
        subscribingId = null;
        await showOrder(res.data.order_token, { placed: true, whatsappPath: res.data.whatsapp_path });
    } finally {
        co.sending = false;
        paintSubmit();
    }
}

// ───────────────────────────── Estado del pedido ─────────────────────────────

/** v0.1.413 — Al volver de pagar en línea, se pregunta cómo quedó el pago (hasta 2 minutos). */
let payPoll = 0;
let payPollUntil = 0;

/** El link de pago lo arma el servidor con lo que devolvió el proveedor: sólo una dirección web. */
function safePayUrl(u: string | null | undefined): string | null {
    return typeof u === 'string' && /^https?:\/\/[^\s"<>]+$/i.test(u) ? u : null;
}

function clockTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });
}

async function showOrder(orderToken: string, opts: { placed?: boolean; whatsappPath?: string | null; returned?: boolean; polling?: boolean } = {}): Promise<void> {
    view = 'order';
    window.clearTimeout(payPoll);
    const box = el('div', { cls: 's-wrap', style: 'max-width:640px;padding-top:28px' }, [el('p', { cls: 's-empty', text: 'Cargando tu pedido…' })]);
    if (!opts.polling) paint([box]);
    if (opts.returned && !opts.polling) payPollUntil = Date.now() + 120_000;
    const res = await api<PublicShopOrder>(`/orders/${encodeURIComponent(orderToken)}${opts.returned ? '?refresh=1' : ''}`);
    if (opts.polling) paint([box]);
    if (!res.ok) {
        box.replaceChildren(el('div', { cls: 's-ok' }, [el('h2', { text: 'No encontramos ese pedido' }), el('p', { text: 'Revisa el enlace que te llegó por correo.' })]), el('div', { style: 'margin-top:18px' }, [actionButton('Ir a la tienda', goCatalog, 's-btn s-ghost')]));
        return;
    }
    const o = res.data;
    const m = meta!;
    const fmt = (n: number): string => formatShopMoney(n, o.currency, m.number_format);
    const kids: HTMLElement[] = [];
    kids.push(
        el('div', { cls: 's-ok', 'data-testid': 'shop-order' }, [
            opts.placed ? el('div', { cls: 's-ok-ic' }, [icon('check')]) : null,
            el('h2', { text: opts.placed ? m.texts.success_title || '¡Recibimos tu pedido!' : 'Tu pedido' }),
            opts.placed ? el('p', { text: m.texts.success_message }) : null,
            el('div', { cls: 's-num', 'data-testid': 'shop-order-number', text: o.number }),
        ]),
    );
    // v0.1.413 — El pago en línea: pagar ahora, esperando la confirmación o qué pasó.
    if (o.payment_method === 'online') {
        const waiting = o.payment_status === 'pendiente' && o.status !== 'cancelado';
        if (waiting && opts.returned && Date.now() < payPollUntil) {
            kids.push(
                el('div', { cls: 's-note', 'data-testid': 'shop-pay-waiting', style: 'margin-top:18px;display:flex;gap:10px;align-items:center' }, [
                    el('span', { cls: 's-spin', 'aria-hidden': 'true' }),
                    el('span', { text: 'Estamos confirmando tu pago. Esto toma unos segundos.' }),
                ]),
            );
            payPoll = window.setTimeout(() => void showOrder(orderToken, { returned: true, polling: true }), 4000);
        } else if (o.payment_status === 'pagado' && o.status !== 'cancelado') {
            kids.push(
                el('div', { cls: 's-note', 'data-testid': 'shop-paid', style: 'margin-top:18px;background:#f0fdf4;border-color:#bbf7d0;color:#166534' }, [
                    el('strong', { style: 'display:block;margin-bottom:2px', text: '¡Pago recibido!' }),
                    o.digital_only
                        ? `${o.pay_provider ? `Pagaste en línea con ${o.pay_provider}. ` : ''}Ya puedes descargar tus archivos.`
                        : o.pay_provider
                          ? `Pagaste en línea con ${o.pay_provider}. Te avisamos cuando enviemos tu pedido.`
                          : 'Te avisamos cuando enviemos tu pedido.',
                ]),
            );
        }
        const orderPayUrl = safePayUrl(o.pay_url);
        if (orderPayUrl) {
            const until = o.pay_until ? clockTime(o.pay_until) : '';
            kids.push(
                el('div', { style: 'margin:18px 0 0' }, [
                    el('a', { cls: 's-btn', href: orderPayUrl, 'data-testid': 'shop-pay-now' }, [o.pay_provider ? `Pagar con ${o.pay_provider}` : 'Pagar ahora']),
                    until
                        ? el('p', { cls: 's-line-p', style: 'margin:8px 0 0;text-align:center', text: `Tu pedido queda apartado hasta las ${until}. Si no pagas a tiempo, se cancela.` })
                        : null,
                ]),
            );
        }
        if (o.payment_note && !(waiting && opts.returned && Date.now() < payPollUntil)) {
            kids.push(el('div', { cls: 's-note', 'data-testid': 'shop-pay-note', style: 'margin-top:18px', text: o.payment_note }));
        }
    }
    // v0.1.417 — La suscripción: activarla, esperando la confirmación o cómo va.
    if (o.payment_method === 'subscription') {
        const sub = o.subscription ?? null;
        const confirming = !!sub && sub.state === 'pending' && o.status !== 'cancelado' && !!opts.returned && Date.now() < payPollUntil;
        if (confirming) {
            kids.push(
                el('div', { cls: 's-note', 'data-testid': 'shop-sub-waiting', style: 'margin-top:18px;display:flex;gap:10px;align-items:center' }, [
                    el('span', { cls: 's-spin', 'aria-hidden': 'true' }),
                    el('span', { text: 'Estamos confirmando tu suscripción. Esto toma unos segundos.' }),
                ]),
            );
            payPoll = window.setTimeout(() => void showOrder(orderToken, { returned: true, polling: true }), 4000);
        } else if (sub) kids.push(subscriptionBox(sub, fmt));
        if (o.payment_note && !confirming) kids.push(el('div', { cls: 's-note', 'data-testid': 'shop-pay-note', style: 'margin-top:18px', text: o.payment_note }));
    }
    const wa = o.whatsapp_url ?? (opts.whatsappPath ?? null);
    if (wa && o.payment_method === 'whatsapp') {
        kids.push(
            el('div', { style: 'margin:18px 0 0' }, [
                el('a', { cls: 's-btn s-wa', href: wa, target: '_blank', rel: 'noopener noreferrer', 'data-testid': 'shop-whatsapp' }, [icon('wa'), 'Enviar el pedido por WhatsApp']),
                el('p', { cls: 's-line-p', style: 'margin:8px 0 0;text-align:center', text: 'Se abre WhatsApp con tu pedido listo para enviar.' }),
            ]),
        );
    }
    kids.push(
        el('div', { cls: 's-sec', style: 'margin-top:22px;display:flex;gap:8px;flex-wrap:wrap' }, [
            el('span', { cls: 's-status', text: o.status_label }),
            el('span', { cls: 's-status', style: 'background:#f3f4f6;color:#374151', text: `Pago: ${o.payment_status_label}` }),
        ]),
    );
    if (o.payment_status !== 'pagado' && o.payment_method !== 'online' && o.payment_method !== 'subscription' && o.payment_instructions) {
        kids.push(el('div', { cls: 's-note' }, [el('strong', { style: 'display:block;margin-bottom:4px', text: o.payment_label }), o.payment_instructions]));
    }
    // v0.1.416 — Las descargas del pedido (con el pago confirmado).
    if (o.downloads.length > 0 || o.downloads_note) kids.push(downloadsBox(o));
    // v0.1.417 — Una suscripción: lo que se cobra cada período (sin subtotal ni envío).
    const subFreq = o.payment_method === 'subscription' && o.subscription ? subscriptionFrequencyText(o.subscription.frequency, o.subscription.frequency_type) : null;
    const sum = subFreq
        ? el('div', { cls: 's-sum' }, [
              ...o.lines.map((l) => el('div', {}, [el('span', { text: l.title }), el('span', { text: fmt(l.subtotal) })])),
              el('div', { style: 'padding-top:6px;border-top:1px solid var(--s-line);margin-top:4px' }, [el('span', { text: 'Se cobra' }), el('span', { text: subFreq })]),
              el('div', { cls: 's-tot' }, [el('span', { text: `Total ${subFreq}` }), el('span', { text: fmt(o.total) })]),
          ])
        : el('div', { cls: 's-sum' }, [
              ...o.lines.map((l) => el('div', {}, [el('span', { text: `${l.qty} × ${l.title}` }), el('span', { text: fmt(l.subtotal) })])),
              el('div', { style: 'padding-top:6px;border-top:1px solid var(--s-line);margin-top:4px' }, [el('span', { text: 'Subtotal' }), el('span', { text: fmt(o.subtotal) })]),
              o.discount > 0 ? el('div', { cls: 's-disc' }, [el('span', { text: `Descuento${o.coupon_code ? ` (${o.coupon_code})` : ''}` }), el('span', { text: `-${fmt(o.discount)}` })]) : null,
              o.digital_only
                  ? el('div', {}, [el('span', { text: 'Entrega · Descarga digital' }), el('span', { text: 'Sin envío' })])
                  : el('div', {}, [el('span', { text: `Entrega · ${o.delivery}` }), el('span', { text: o.shipping > 0 ? fmt(o.shipping) : 'Gratis' })]),
              el('div', { cls: 's-tot' }, [el('span', { text: 'Total' }), el('span', { text: o.total > 0 ? fmt(o.total) : 'Sin costo' })]),
          ]);
    kids.push(el('div', { cls: 's-panel' }, [sum]));
    const where = [o.customer.address, o.customer.city].filter(Boolean).join(', ');
    kids.push(el('p', { cls: 's-line-p', style: 'margin:14px 0 0', text: `A nombre de ${o.customer.name}${where ? ` · ${where}` : ''}. Te enviamos el detalle a ${o.customer.email}.` }));
    const myCode = sessionGet(MY_KEY);
    kids.push(
        el('div', { style: 'margin-top:20px;display:flex;flex-direction:column;gap:10px' }, [
            myCode ? actionButton('Volver a mis pedidos', () => void showMyOrders(myCode), 's-btn s-ghost', 'shop-my-back') : null,
            actionButton('Seguir comprando', goCatalog, 's-btn s-ghost'),
        ]),
    );
    box.replaceChildren(...kids);
    window.scrollTo({ top: 0 });
}

/** v0.1.417 — Cómo va la suscripción de un pedido. */
function subscriptionBox(sub: PublicShopOrderSubscription, fmt: (n: number) => string): HTMLElement {
    const prov = providerName(sub.provider);
    const charge = `${fmt(sub.amount)} ${cadenceText(sub)}`;
    const box = (style: string, title: string, text: string, extra: HTMLElement | null = null): HTMLElement =>
        el('div', { cls: 's-note', 'data-testid': 'shop-subscription', 'data-state': sub.state, style: `margin-top:18px;${style}` }, [el('strong', { style: 'display:block;margin-bottom:2px', text: title }), text, extra]);
    if (sub.state === 'active') {
        const next = sub.next_charge ? longDate(`${sub.next_charge}T12:00:00`) : '';
        return box('background:#f0fdf4;border-color:#bbf7d0;color:#166534', '¡Tu suscripción está activa!', `Se cobra ${charge} con tu tarjeta en ${prov}.${next ? ` Próximo cobro: ${next}.` : ''}`);
    }
    if (sub.state === 'failed') {
        return box('background:#fffbeb;border-color:#fde68a;color:#92400e', sub.label || 'Un cobro no pasó', `No pudimos hacer el último cobro de ${charge} con tu tarjeta. ${prov} lo vuelve a intentar; si cambiaste de tarjeta, escríbenos.`);
    }
    if (sub.state === 'cancelled') return box('', sub.label || 'Suscripción terminada', 'Esta suscripción ya no se cobra.');
    const url = safePayUrl(sub.url);
    return box(
        '',
        'Falta activar tu suscripción',
        `Se cobra ${charge}. Autoriza tu tarjeta en ${prov} una sola vez para que empiece.`,
        url ? el('div', { style: 'margin-top:12px' }, [el('a', { cls: 's-btn', href: url, 'data-testid': 'shop-sub-activate' }, ['Activar mi suscripción'])]) : null,
    );
}

function longDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fileSize(n: number | null): string {
    if (n === null || !Number.isFinite(n) || n <= 0) return '';
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',')} MB`;
}

/** v0.1.416 — Los archivos del pedido: «Descargar» con el pago confirmado; si no, por qué. */
function downloadsBox(o: PublicShopOrder): HTMLElement {
    const rows = o.downloads.map((d) => {
        const used = d.max !== null ? `Descargado ${d.used} de ${d.max} ${d.max === 1 ? 'vez' : 'veces'}` : d.used > 0 ? `Descargado ${d.used} ${d.used === 1 ? 'vez' : 'veces'}` : '';
        const meta2 = [d.title !== d.name ? d.title : '', fileSize(d.size), used].filter(Boolean).join(' · ');
        const go =
            d.url && d.url.startsWith(`${PAGE}/d/`)
                ? el('a', { cls: 's-dl-go', href: d.url, rel: 'nofollow', 'data-testid': 'shop-download' }, [icon('download'), 'Descargar'])
                : el('span', { cls: 's-dl-off', text: d.max !== null && d.used >= d.max ? 'Sin descargas' : 'No disponible' });
        return el('div', { cls: 's-dl', 'data-testid': 'shop-download-row' }, [
            el('span', { cls: 's-dl-ic' }, [icon('download')]),
            el('div', { cls: 's-dl-t' }, [el('div', { cls: 's-dl-n', text: d.name }), meta2 ? el('div', { cls: 's-dl-m', text: meta2 }) : null]),
            go,
        ]);
    });
    const until = !o.downloads_note && o.downloads_until ? longDate(o.downloads_until) : '';
    return el('div', { cls: 's-panel', style: 'margin-top:18px', 'data-testid': 'shop-downloads' }, [
        el('h3', { style: 'margin:0 0 4px;font-size:16px', text: 'Tus descargas' }),
        o.downloads_note ? el('div', { cls: 's-note', style: 'margin:8px 0 4px', 'data-testid': 'shop-downloads-note', text: o.downloads_note }) : null,
        until ? el('p', { cls: 's-line-p', style: 'margin:0 0 4px', text: `Disponibles hasta el ${until}. También te llegaron por correo.` }) : null,
        ...rows,
    ]);
}

// ───────────────────────────── «Mis pedidos» (v0.1.416) ─────────────────────────────

const myReq = { sending: false, sent: false, error: '' };

function openMyOrders(): void {
    myReq.sent = false;
    myReq.error = '';
    openOverlay({ kind: 'my' });
}

/** Pedir el enlace: llega al correo sólo si tiene pedidos en esta tienda (la respuesta es la misma). */
function mySheet(): HTMLElement {
    if (myReq.sent) {
        return sheet(
            'narrow',
            'Mis pedidos',
            [
                el('div', { cls: 's-ok', 'data-testid': 'shop-my-sent' }, [
                    el('div', { cls: 's-ok-ic' }, [icon('check')]),
                    el('h2', { text: 'Revisa tu correo' }),
                    el('p', { text: 'Si ese correo tiene pedidos en esta tienda, te llegará un enlace en unos minutos para verlos con sus descargas. Revisa también la carpeta de spam.' }),
                ]),
            ],
            [actionButton('Listo', closeOverlay, 's-btn s-ghost')],
            'shop-my',
        );
    }
    const input = el('input', { id: 'my_email', type: 'email', autocomplete: 'email', inputmode: 'email', 'data-testid': 'shop-my-email', 'data-k': 'my-email', 'aria-describedby': 'my_email_e' });
    input.value = savedCustomer().email ?? '';
    const hp = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    const err = el('div', { cls: 's-err', id: 'my_email_e', role: 'alert', hidden: !myReq.error, text: myReq.error });
    const send = actionButton('Enviarme el enlace', () => void requestMy(input, hp), 's-btn', 'shop-my-send');
    if (myReq.sending) {
        send.disabled = true;
        send.replaceChildren(el('span', { cls: 's-spin', 'aria-hidden': 'true' }), 'Enviando…');
    }
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            void requestMy(input, hp);
        }
    });
    return sheet(
        'narrow',
        'Mis pedidos',
        [
            el('p', { style: 'margin:0 0 14px;color:#374151', text: 'Escribe el correo con el que compraste y te mandamos un enlace para ver tus pedidos, cómo van y tus descargas.' }),
            el('div', { cls: 's-f' }, [el('label', { for: 'my_email', text: 'Tu correo' }), input, err]),
            el('div', { cls: 's-hp', 'aria-hidden': 'true' }, [hp]),
        ],
        [send],
        'shop-my',
    );
}

async function requestMy(input: HTMLInputElement, hp: HTMLInputElement): Promise<void> {
    if (myReq.sending) return;
    const email = input.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        myReq.error = 'Escribe un correo válido.';
        renderOverlay();
        return;
    }
    if (BOOT.preview) {
        myReq.error = 'Es una vista previa: en la tienda publicada aquí llega el enlace al correo.';
        renderOverlay();
        return;
    }
    myReq.sending = true;
    myReq.error = '';
    renderOverlay();
    const res = await api<{ ok: true }>('/my-orders', { method: 'POST', body: JSON.stringify({ email, website: hp.value }) });
    myReq.sending = false;
    if (res.ok) myReq.sent = true;
    else myReq.error = res.error.message || (res.status === 429 ? 'Pediste muchos enlaces seguidos. Espera unos minutos.' : 'No pudimos mandar el enlace. Vuelve a intentar.');
    if (overlay?.kind === 'my') renderOverlay();
}

/** La lista de pedidos del enlace del correo. */
async function showMyOrders(code: string): Promise<void> {
    view = 'my';
    window.clearTimeout(payPoll);
    if (location.search.includes('pedido=')) {
        const url = new URL(location.href);
        url.searchParams.delete('pedido');
        history.replaceState(null, '', url.pathname + url.search);
    }
    const box = el('div', { cls: 's-wrap', style: 'max-width:720px;padding-top:28px' }, [el('p', { cls: 's-empty', text: 'Cargando tus pedidos…' })]);
    paint([box]);
    const res = await api<PublicShopMyOrders>(`/my-orders/${encodeURIComponent(code)}`);
    if (!res.ok) {
        sessionSet(MY_KEY, null);
        box.replaceChildren(
            el('div', { cls: 's-ok', 'data-testid': 'shop-my-expired' }, [el('h2', { text: 'Este enlace ya no sirve' }), el('p', { text: 'Los enlaces de «Mis pedidos» duran unos días. Pide uno nuevo y te llega al correo.' })]),
            el('div', { style: 'margin-top:18px;display:flex;flex-direction:column;gap:10px' }, [actionButton('Pedir un enlace nuevo', openMyOrders, 's-btn'), actionButton('Ir a la tienda', goCatalog, 's-btn s-ghost')]),
        );
        return;
    }
    const data = res.data;
    const m = meta!;
    const kids: HTMLElement[] = [
        el('div', { cls: 's-ok', style: 'text-align:left' }, [el('h2', { text: 'Tus pedidos' }), el('p', { style: 'margin:0', text: `Los pedidos de ${data.email} en esta tienda.` })]),
    ];
    if (data.orders.length === 0) kids.push(el('p', { cls: 's-empty', text: 'No encontramos pedidos con ese correo.' }));
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:10px;margin-top:16px', 'data-testid': 'shop-my-list' });
    for (const o of data.orders) {
        const fmt = (n: number): string => formatShopMoney(n, o.currency, m.number_format);
        const go = actionButton('Ver pedido', () => {
            const url = new URL(location.href);
            url.searchParams.set('pedido', o.order_token);
            history.replaceState(null, '', url.pathname + url.search);
            void showOrder(o.order_token);
        }, 's-btn s-ghost', 'shop-my-open-order');
        go.style.width = 'auto';
        go.style.height = '40px';
        go.style.padding = '0 16px';
        go.style.fontSize = '14px';
        const facts = [longDate(o.created_at), o.items === 1 ? '1 producto' : `${o.items} productos`, o.downloads > 0 ? (o.downloads === 1 ? '1 descarga' : `${o.downloads} descargas`) : ''].filter(Boolean).join(' · ');
        list.append(
            el('div', { cls: 's-panel s-myo', 'data-testid': 'shop-my-order' }, [
                el('div', { cls: 's-myo-t' }, [
                    el('div', { cls: 's-myo-n' }, [o.number, el('span', { style: 'font-weight:600;margin-left:8px', text: o.total > 0 ? fmt(o.total) : 'Sin costo' })]),
                    el('div', { cls: 's-myo-m', text: facts }),
                    el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px' }, [
                        el('span', { cls: 's-status', text: o.status_label }),
                        el('span', { cls: 's-status', style: 'background:#f3f4f6;color:#374151', text: `Pago: ${o.payment_status_label}` }),
                        // v0.1.417 — «Suscripción cada mes · Al día».
                        o.subscription ? el('span', { cls: 's-status', style: 'background:#fdf2f8;color:#9d174d', 'data-testid': 'shop-my-subscription', text: o.subscription }) : null,
                    ]),
                ]),
                go,
            ]),
        );
    }
    kids.push(list);
    kids.push(el('div', { style: 'margin-top:20px' }, [actionButton('Ir a la tienda', goCatalog, 's-btn s-ghost')]));
    box.replaceChildren(...kids);
    window.scrollTo({ top: 0 });
}

// ───────────────────────────── Navegación ─────────────────────────────

function paint(main: HTMLElement[]): void {
    cartButtons.length = 0;
    mbar = null;
    const wrap = view === 'order' || view === 'my' ? el('div', {}, main) : el('div', { cls: 's-wrap' }, main);
    const kids: HTMLElement[] = [header(), el('main', {}, [wrap]), footer()];
    if (view === 'catalog') {
        const b = actionButton('', () => openOverlay({ kind: 'cart' }), 's-btn');
        b.append(icon('cart'), el('span', { cls: 's-mbar-t' }));
        mbar = el('div', { cls: 's-mbar' }, [b]);
        kids.push(mbar);
    }
    app.replaceChildren(...kids);
    paintCartButtons();
}

function goCatalog(): void {
    view = 'catalog';
    subscribingId = null;
    window.clearTimeout(payPoll);
    if (location.search.includes('pedido=')) {
        const url = new URL(location.href);
        url.searchParams.delete('pedido');
        history.replaceState(null, '', url.pathname + url.search);
    }
    paint(catalogView());
    paintGrid();
    window.scrollTo({ top: 0 });
}

function goCheckout(): void {
    view = 'checkout';
    subscribingId = null;
    co.serverCart = null;
    paint(checkoutView());
    window.scrollTo({ top: 0 });
}

/** v0.1.417 — Suscribirse a un producto (o a una de sus variantes). */
function goSubscribe(id: number): void {
    view = 'checkout';
    subscribingId = id;
    co.serverCart = null;
    if (alertEl) {
        alertEl.dataset.kind = '';
        alertEl.hidden = true;
    }
    paint(subscribeView());
    window.scrollTo({ top: 0 });
}

function render(): void {
    if (!meta) {
        app.replaceChildren(el('p', { cls: 's-empty', text: BOOT.preview ? 'Cargando la vista previa…' : 'Esta tienda no está disponible.' }));
        return;
    }
    applyTheme();
    indexProducts();
    sort = meta.display.sort;
    const qs = new URLSearchParams(location.search);
    // v0.1.415 — `?cupon=CODIGO`: se guarda para la compra (se aplica solo al finalizar) y se quita de la dirección.
    if (qs.has('cupon') && !BOOT.preview) {
        const code = normalizeCouponCode(qs.get('cupon'));
        const url = new URL(location.href);
        url.searchParams.delete('cupon');
        history.replaceState(null, '', url.pathname + url.search);
        if (code && meta.coupons) {
            sessionSet(COUPON_KEY, code);
            window.setTimeout(() => toast(`Cupón ${code}: se aplica al finalizar la compra`), 300);
        }
    }
    // v0.1.416 — `?mis-pedidos=<código>`: el enlace del correo (se guarda en la pestaña y se quita de la dirección).
    const myCode = qs.get('mis-pedidos');
    if (myCode !== null && !BOOT.preview) {
        const url = new URL(location.href);
        url.searchParams.delete('mis-pedidos');
        history.replaceState(null, '', url.pathname + url.search);
        if (/^[A-Za-z0-9_-]{20,64}$/.test(myCode)) {
            sessionSet(MY_KEY, myCode);
            void showMyOrders(myCode);
            return;
        }
    }
    const pedido = qs.get('pedido');
    if (pedido && /^[A-Za-z0-9_-]{20,64}$/.test(pedido) && !BOOT.preview) {
        // v0.1.413 — `?pago=1`: volvió de pagar en línea (se quita para que recargar no vuelva a esperar).
        // v0.1.417 — `?suscripcion=1`: volvió de autorizar la tarjeta de una suscripción.
        const returned = qs.has('pago') || qs.has('suscripcion');
        if (returned) {
            const url = new URL(location.href);
            url.searchParams.delete('pago');
            url.searchParams.delete('suscripcion');
            history.replaceState(null, '', url.pathname + url.search);
        }
        void showOrder(pedido, { returned });
        return;
    }
    if (view === 'checkout' && subscribingId !== null && subscribable.has(subscribingId)) goSubscribe(subscribingId);
    else if (view === 'checkout') goCheckout();
    else goCatalog();
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay) {
        e.preventDefault();
        closeOverlay();
        return;
    }
    if (e.key === 'Tab' && overlay) {
        const box = ovRoot.querySelector('.s-sheet');
        if (!box) return;
        const items = [...box.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
});

// Otra pestaña cambió el carrito: se sigue el mismo.
window.addEventListener('storage', (e) => {
    if (e.key !== CART_KEY) return;
    loadCart();
    paintCartButtons();
    for (const id of cardEls.keys()) paintCard(id);
    if (overlay?.kind === 'cart') renderOverlay();
    if (view === 'checkout') paintSummary();
});

// Vista previa del editor: lo que se está editando llega por postMessage.
if (BOOT.preview) {
    window.addEventListener('message', (e) => {
        if (e.origin !== location.origin || e.source !== window.parent) return;
        const d = e.data as { type?: string; meta?: PublicShopMeta; products?: PublicShopProduct[]; view?: View } | null;
        if (!d || d.type !== 'imb-shop-preview' || !d.meta) return;
        meta = d.meta;
        products = d.products ?? [];
        const first = [...shopPurchasables(products).keys()][0];
        if (d.view === 'checkout' && cart.size === 0 && first !== undefined) cart.set(first, 1);
        if (d.view) view = d.view;
        overlay = null;
        ovRoot.replaceChildren();
        document.body.style.overflow = '';
        render();
    });
    window.parent?.postMessage({ type: 'imb-shop-ready' }, location.origin);
} else {
    loadCart();
}
render();
