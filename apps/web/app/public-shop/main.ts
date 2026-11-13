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
    RichNode,
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
    ShopDesignCheckout,
    ShopPaymentMethod,
    ShopPurchasable,
    ShopQtyRule,
    ShopUnit,
} from '@imagina-base/shared';
import {
    SHOP_MAX_QTY,
    computeShopCart,
    formatShopQty,
    parseShopQtyInput,
    roundShopQty,
    shopLineText,
    shopPerUnit,
    shopQtyCap,
    shopQtyLabel,
    shopQtyNext,
    shopQtyRuleText,
    shopQtyText,
    snapShopQty,
    formatShopMoney,
    normalizeCouponCode,
    parseShopCartParam,
    parseShopProductPath,
    pickShopVariant,
    shopCouponProblemText,
    shopCurrencyDecimals,
    shopLineProblemText,
    shopNeedsDelivery,
    shopOptionValueState,
    shopPurchasables,
    shopProductPath,
    shopShippingFor,
    shopVariantPriceRange,
} from '@imagina-base/shared/src/schemas/shop-logic';
import { subscriptionFrequencyText, subscriptionPlanExtras } from '@imagina-base/shared/src/schemas/form-logic';
import { formStatSource } from '@imagina-base/shared/src/schemas/form-stats-logic';
import { attributionFromSearch, cleanAttribution, type AttributionData } from '@imagina-base/shared/src/schemas/conversion-logic';
import type { ShopStatDevice, ShopStatEvent } from '@imagina-base/shared/src/schemas/shop-stats-logic';
import { isShopEditTarget, shopEditTargetText, type ShopEditTargetId } from '@imagina-base/shared/src/schemas/shop-edit-targets';
import type { PublicDirectTags } from '@imagina-base/shared/src/schemas/conversion-logic';
import { isDemoFrame } from '../public-form/demoGate';

interface Boot {
    token: string;
    preview: boolean;
    meta: PublicShopMeta | null;
    products: PublicShopProduct[];
    scripts: Record<string, string>;
    /** v0.1.423 — La tienda en su dominio: cada producto tiene su dirección (`/p/…`). */
    site?: { product_id: number | null; home_title: string } | null;
}

type Attrs = Record<string, string | boolean | number | null | undefined>;

const BOOT: Boot = (() => {
    try {
        return JSON.parse(document.getElementById('boot')?.textContent ?? '{}') as Boot;
    } catch {
        return { token: '', preview: false, meta: null, products: [], scripts: {} };
    }
})();

/**
 * v0.1.419 — La demostración de «Compartir» (dentro de la app): la tienda real,
 * que se usa como de verdad, pero no hace pedidos, no cuenta visitas ni avisa
 * conversiones. Sólo vale metida en un marco de la propia app (`isDemoFrame`).
 */
const DEMO = !BOOT.preview && isDemoFrame(window);
/** Nada se envía ni se cuenta: la vista previa del editor y la demostración. */
const DRY = BOOT.preview || DEMO;
/** v0.1.423 — En su dominio propio (no en la vista previa ni en la demostración). */
const SITE = !DRY && BOOT.site ? BOOT.site : null;

const API = `/api/v1/public/shops/${encodeURIComponent(BOOT.token)}`;
const PAGE = `/api/v1/public/s/${encodeURIComponent(BOOT.token)}`;
// La demostración no toca el carrito de verdad de este navegador.
const CART_KEY = `imb-shop-cart:${BOOT.token}${DEMO ? ':demo' : ''}`;
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
    // v0.1.425 — El pago.
    lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    chev: 'M6 9l6 6 6-6',
    next: 'M9 6l6 6-6 6',
    bag: 'M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8',
    // v0.1.428 — La etiqueta de la vista previa del editor.
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
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
function imgUrl(src: string, width: 160 | 320 | 640 | 1200 | 1600): string {
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
/** Un aviso abajo; con `action`, un botón (ej.: «Ver carrito»). */
function toast(text: string, action?: { label: string; run: () => void }): void {
    document.querySelector('.s-toast')?.remove();
    const t = el('div', { cls: 's-toast', role: 'status', 'data-testid': 'shop-toast' }, [el('span', { text })]);
    if (action) {
        const b = el('button', { type: 'button', cls: 's-toast-a', text: action.label, 'data-testid': 'shop-toast-action' });
        b.addEventListener('click', () => {
            t.remove();
            action.run();
        });
        t.append(b);
    }
    document.body.appendChild(t);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => t.remove(), action ? 4500 : 2600);
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

// ─────────────── De dónde llegó la visita (v0.1.418) ───────────────
// Insertada en un sitio con el script (`embed.js`), el sitio le pasa a la
// tienda de dónde vino la persona (la campaña, el clic del anuncio, la página
// del sitio) y, al comprar, convierte el aviso en un evento DEL SITIO. Sin ese
// script (un iframe pegado solo), se usa lo que trae la propia dirección.
let hostAttribution: AttributionData | null = null;
let hostOrigin: string | null = null;
const conversionAcks = new Set<string>();
const contextWaiters: Array<() => void> = [];
if (EMBEDDED && !DRY) {
    window.addEventListener('message', (e: MessageEvent) => {
        if (e.source !== window.parent) return;
        const d = e.data as { type?: string; attribution?: unknown; ref?: string } | null;
        if (!d || typeof d !== 'object') return;
        if (d.type === 'imb-context') {
            hostAttribution = cleanAttribution(d.attribution);
            hostOrigin = typeof e.origin === 'string' && /^https?:\/\//.test(e.origin) ? e.origin : null;
            contextWaiters.splice(0).forEach((fn) => fn());
        } else if (d.type === 'imb-conversion-ack' && typeof d.ref === 'string') {
            conversionAcks.add(d.ref);
        }
    });
    try {
        window.parent.postMessage({ type: 'imb-hello' }, '*');
    } catch {
        // nada
    }
}

/**
 * Lo que se sabe de dónde vino: lo del sitio (insertada) sobre lo de la
 * propia dirección; la página es la del sitio (o, sin el script, la que cargó
 * el marco) o, por el enlace directo, el propio enlace. El servidor lo limpia.
 */
function attributionNow(): AttributionData {
    const own = attributionFromSearch(location.search);
    let outsideRef = '';
    try {
        if (document.referrer && new URL(document.referrer).host !== location.host) outsideRef = document.referrer.slice(0, 1000);
    } catch {
        // nada
    }
    if (!EMBEDDED) {
        if (outsideRef) own.referrer = outsideRef;
        own.page_url = location.href.split('#')[0]!.slice(0, 1000);
    } else if (outsideRef) {
        own.page_url = outsideRef;
    }
    return { ...own, ...(hostAttribution ?? {}) };
}

/** Espera (un rato corto) a que el sitio diga de dónde vino la persona. */
function whenContext(ms: number): Promise<void> {
    if (!EMBEDDED || DRY || hostAttribution !== null) return Promise.resolve();
    return new Promise((ok) => {
        const t = window.setTimeout(ok, ms);
        contextWaiters.push(() => {
            window.clearTimeout(t);
            ok();
        });
    });
}

/** La clave de origen (`d`, `u:<campaña>`, `h:<sitio>`) para las estadísticas y el pedido. */
function sourceKey(): string {
    const a = attributionNow();
    return formStatSource({ utm_source: a.utm_source ?? null, referrer: a.referrer ?? (EMBEDDED ? a.page_url : null) ?? null, own_hosts: [location.hostname] });
}

// ─────────────────── Estadísticas (v0.1.418) ───────────────────
// Sólo contadores: una visita, los productos que abrió, lo que agregó al
// carrito y si empezó la compra. Sin cookies ni datos de la persona. Van en
// lotes y, al cerrar la página, con sendBeacon (no frena nada).
const statQueue: ShopStatEvent[] = [];
let statTimer: number | null = null;

/** ¿Es la primera vez en esta visita (esta pestaña)? */
function onceThisVisit(key: string): boolean {
    try {
        const k = `imb-shop-st:${BOOT.token}:${key}`;
        if (sessionStorage.getItem(k)) return false;
        sessionStorage.setItem(k, '1');
    } catch {
        // Sin sessionStorage (modo privado estricto) se cuenta igual.
    }
    return true;
}

function flushStats(beacon = false): void {
    if (statTimer !== null) {
        window.clearTimeout(statTimer);
        statTimer = null;
    }
    while (statQueue.length) {
        const body = JSON.stringify({ events: statQueue.splice(0, 20) });
        try {
            if (beacon && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(`${API}/events`, new Blob([body], { type: 'application/json' }))) continue;
        } catch {
            // cae al fetch
        }
        void fetch(`${API}/events`, { method: 'POST', credentials: 'omit', keepalive: true, headers: { 'Content-Type': 'application/json' }, body }).catch(() => undefined);
    }
}

function stat(e: ShopStatEvent): void {
    if (DRY) return;
    statQueue.push(e);
    if (statQueue.length >= 20) flushStats();
    else if (statTimer === null) statTimer = window.setTimeout(() => flushStats(), 1500);
}

function deviceKind(): ShopStatDevice {
    const coarse = matchMedia('(pointer: coarse)').matches;
    if (!coarse) return 'desktop';
    return Math.min(screen.width, screen.height) >= 600 ? 'tablet' : 'mobile';
}

/** Una visita a la tienda (una por pestaña). */
function trackVisit(): void {
    if (DRY || !meta || !onceThisVisit('v')) return;
    void whenContext(700).then(() => stat({ kind: 'view', src: sourceKey(), dev: deviceKind() }));
}

/** Abrió la ficha de un producto (una vez por producto y visita). */
function trackProduct(productId: number): void {
    if (DRY || !onceThisVisit(`p${productId}`)) return;
    stat({ kind: 'product', item: productId, first: onceThisVisit('pv') });
}

/** Agregó un producto al carrito (una vez por producto y visita). */
function trackAdd(productId: number): void {
    if (DRY || !onceThisVisit(`a${productId}`)) return;
    stat({ kind: 'add', item: productId, first: onceThisVisit('av') });
}

/** Empezó la compra o la suscripción (una vez por visita). */
function trackCheckout(): void {
    if (DRY || !onceThisVisit('c')) return;
    stat({ kind: 'checkout' });
}

// ─────────────── Medir conversiones (v0.1.418) ───────────────
// Insertada en un sitio con el script, cada paso de la compra se le avisa al
// sitio con los eventos de comercio electrónico de Google (view_item,
// add_to_cart, begin_checkout, purchase): Tag Manager, la etiqueta de Google
// Ads (la compra) y el píxel de Meta los toman ahí. Por el enlace directo, si
// la tienda lo pidió, la página carga las etiquetas de la empresa por su ID.
type EcommerceAction = 'view_item' | 'add_to_cart' | 'begin_checkout' | 'purchase';
interface EcommerceItem {
    item_id: string;
    item_name: string;
    price: number;
    quantity: number;
    item_variant?: string;
    item_category?: string;
}
interface DirectPixels {
    start(cfg: PublicDirectTags): boolean;
    shop?(ev: unknown, done: (() => void) | null): void;
}
const conversionCfg = BOOT.meta?.conversion ?? null;
let directPixels: DirectPixels | null = null;
if (!EMBEDDED && !DRY && conversionCfg?.direct) {
    const p = (window as unknown as { imbPixels?: DirectPixels }).imbPixels;
    if (p && typeof p.start === 'function' && typeof p.shop === 'function' && p.start(conversionCfg.direct)) directPixels = p;
}
let ecoSeq = 0;

function targetOrigin(): string {
    if (hostOrigin) return hostOrigin;
    try {
        const anc = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
        if (anc && anc.length > 0 && anc[0]) return anc[0];
    } catch {
        // nada
    }
    return '*';
}

/** Un producto (o variante) del carrito como lo piden Google y Meta. */
function ecoItem(id: number, qty: number): EcommerceItem | null {
    const it = buyable.get(id) ?? subscribable.get(id);
    if (!it) return null;
    // v0.1.429 — Google y Meta esperan cantidades enteras: 1,5 kg va como 1 al precio de la línea.
    const whole = Number.isInteger(qty);
    const out: EcommerceItem = { item_id: String(it.product.id), item_name: it.product.title.slice(0, 120), price: whole ? (it.price ?? 0) : Math.round((it.price ?? 0) * qty * 100) / 100, quantity: whole ? qty : 1 };
    if (it.variant?.label) out.item_variant = it.variant.label.slice(0, 120);
    if (it.product.categories[0]) out.item_category = it.product.categories[0].slice(0, 80);
    return out;
}

/**
 * Le avisa al sitio (o a las etiquetas del enlace directo) un paso de la
 * compra. Con `done`, se llama cuando las etiquetas terminaron (o a los 1,6 s).
 */
function ecommerce(action: EcommerceAction, data: { value: number | null; items: EcommerceItem[]; transaction_id?: string; shipping?: number; coupon?: string | null; user_data?: unknown }, done?: () => void): void {
    const finish = (): void => done?.();
    if (DRY || !meta) return finish();
    const ev = {
        kind: 'shop',
        action,
        id: BOOT.token.slice(0, 12),
        name: meta.title,
        currency: meta.currency,
        value: data.value,
        items: data.items.slice(0, 50),
        google_ads: conversionCfg?.google_ads ?? null,
        meta_event: conversionCfg?.meta_event === true,
        ...(action === 'purchase' ? { transaction_id: data.transaction_id ?? '', submission_id: data.transaction_id ?? '', shipping: data.shipping ?? 0, coupon: data.coupon ?? null, user_data: data.user_data ?? null } : {}),
    };
    if (EMBEDDED) {
        const ref = `e${++ecoSeq}${Date.now().toString(36)}`;
        try {
            window.parent.postMessage({ type: 'imb-conversion', ref, event: ev }, targetOrigin());
        } catch {
            return finish();
        }
        if (!done) return;
        // Si el sitio no tiene el script (un iframe pegado solo), nadie contesta: se sigue enseguida.
        const t0 = Date.now();
        const tick = (): void => {
            if (conversionAcks.has(ref)) return void window.setTimeout(finish, 900);
            if (Date.now() - t0 >= 500) return finish();
            window.setTimeout(tick, 50);
        };
        tick();
        return;
    }
    if (directPixels?.shop) directPixels.shop(ev, done ? finish : null);
    else finish();
}

/** La compra de un pedido (una sola vez por pedido en este navegador). */
function trackPurchase(c: NonNullable<PublicShopOrder['conversion']>): void {
    try {
        const k = `imb-shop-buy:${c.transaction_id}`;
        if (localStorage.getItem(k)) return;
        localStorage.setItem(k, '1');
    } catch {
        // sin almacenamiento: se avisa igual (Google y Meta no cuentan dos veces el mismo pedido)
    }
    ecommerce('purchase', { value: c.value, items: c.items as EcommerceItem[], transaction_id: c.transaction_id, shipping: c.shipping, coupon: c.coupon, user_data: c.user_data ?? null });
}

if (!DRY) {
    window.addEventListener('pagehide', () => flushStats(true));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushStats(true);
    });
}

function loadCart(): void {
    cart.clear();
    const raw = storageGet(CART_KEY);
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw) as Array<[number, number]>;
        for (const [id, qty] of parsed) {
            // v0.1.429 — Con unidades la cantidad puede tener decimales (1,5 kg).
            if (Number.isInteger(id) && id > 0 && typeof qty === 'number' && Number.isFinite(qty) && qty > 0) cart.set(id, Math.min(roundShopQty(qty), SHOP_MAX_QTY));
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
    // v0.1.429 — Una línea con unidad (3 horas, 1,5 kg) cuenta como un producto.
    for (const [id, q] of cart) n += buyable.get(id)?.unit || !Number.isInteger(q) ? 1 : q;
    return n;
}

/** Lo que se compra de a cuánto y en qué (v0.1.429). */
type QtyItem = { stock: number | null; unit?: ShopUnit; qty?: ShopQtyRule };

/** Lo máximo que se puede tener en el carrito (el máximo del producto y el stock, en cantidades válidas). */
function maxFor(p: QtyItem): number {
    return shopQtyCap(p.qty, p.stock);
}

/** «3 horas», «1,5 kg» o «3» (sin unidad), con los separadores de la empresa. */
function qtyText(n: number, unit: ShopUnit | null | undefined): string {
    return shopQtyText(n, unit, meta?.number_format ?? 'dot_comma');
}

/** El número solo (para el selector). */
function qtyNum(n: number): string {
    return formatShopQty(n, meta?.number_format ?? 'dot_comma');
}

/**
 * v0.1.429 — El selector de cantidad: −, el número (se puede escribir: 2,5) y
 * +. `next` dice qué pasa con cada botón; `commit` recibe lo escrito.
 */
function qtyStepper(o: {
    value: number;
    unit?: ShopUnit;
    canMinus: boolean;
    canPlus: boolean;
    onMinus: () => void;
    onPlus: () => void;
    onType?: (n: number) => void;
    key: string;
    testid?: string;
    cls?: string;
    style?: string;
    labels?: [string, string];
}): HTMLElement {
    const minus = el('button', { type: 'button', 'aria-label': o.labels?.[0] ?? 'Menos', text: '−', disabled: !o.canMinus, 'data-k': `${o.key}-m` });
    minus.addEventListener('click', o.onMinus);
    const plus = el('button', { type: 'button', 'aria-label': o.labels?.[1] ?? 'Más', text: '+', disabled: !o.canPlus, 'data-k': `${o.key}-p` });
    plus.addEventListener('click', o.onPlus);
    const label = `Cantidad: ${qtyText(o.value, o.unit)}`;
    let mid: HTMLElement;
    if (o.onType) {
        const onType = o.onType;
        const input = el('input', { type: 'text', inputmode: 'decimal', cls: 's-step-in', value: qtyNum(o.value), 'aria-label': label, 'data-k': `${o.key}-i`, autocomplete: 'off' }) as HTMLInputElement;
        const commit = (): void => {
            const n = parseShopQtyInput(input.value, meta?.number_format);
            if (n === null) {
                input.value = qtyNum(o.value);
                return;
            }
            if (n !== o.value) onType(n);
            else input.value = qtyNum(o.value);
        };
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commit();
            }
        });
        mid = input;
    } else {
        // Sin caja para escribir (la tarjeta): el número con su unidad, «3 horas».
        mid = el('span', { 'aria-live': 'polite', 'aria-label': label, text: o.unit ? qtyText(o.value, o.unit) : qtyNum(o.value) });
    }
    const kids: Node[] = [minus, mid, plus];
    return el('div', { cls: o.cls ?? 's-step', 'data-testid': o.testid, ...(o.style ? { style: o.style } : {}) }, kids);
}

/** La palabra de la unidad junto al selector («horas»), o nada. */
function unitWord(n: number, unit: ShopUnit | null | undefined): HTMLElement | null {
    if (!unit) return null;
    return el('span', { cls: 's-unit', text: qtyText(n, unit).replace(/^\S+\s/, '') });
}

function setQty(id: number, qty: number): void {
    const item = buyable.get(id);
    const cap = item ? maxFor(item) : SHOP_MAX_QTY;
    // v0.1.429 — La cantidad válida más cercana (mínimo, «de a cuánto», máximo) que entra en el stock.
    const next = qty <= 0 || cap <= 0 ? 0 : Math.min(cap, snapShopQty(qty, item?.qty));
    const prev = cart.get(id) ?? 0;
    if (next > prev) {
        trackAdd(item?.product.id ?? id);
        const eco = ecoItem(id, next - prev);
        if (eco) ecommerce('add_to_cart', { value: eco.price * eco.quantity, items: [eco] });
    }
    if (next === 0) cart.delete(id);
    else cart.set(id, next);
    saveCart();
    paintCartButtons();
    const productId = item?.product.id ?? id;
    paintCard(productId);
    if (overlay?.kind === 'cart') {
        // Un cambio en el carrito apaga el «Agregaste…» de recién.
        if (overlay.flash !== undefined) overlay = { kind: 'cart' };
        renderOverlay();
    }
    if (view === 'cart') paintCartPage();
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

type View = 'catalog' | 'cart' | 'checkout' | 'order' | 'my';
type Overlay =
    | { kind: 'product'; id: number; image: number; sel?: Array<string | null>; pick?: number }
    | { kind: 'cart'; flash?: number }
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
    // v0.1.422 — El estilo armado en el servidor (en la vista previa cambia en vivo).
    const d = meta.design;
    if (d) {
        let style = document.getElementById('s-design');
        if (!style) {
            style = document.createElement('style');
            style.id = 's-design';
            document.head.appendChild(style);
        }
        if (style.textContent !== d.css) style.textContent = d.css;
        document.body.className = d.classes;
        // v0.1.428 — En la vista previa, «tocar para editar» sobrevive al cambio de clases.
        if (BOOT.preview && pvOn) document.body.classList.add('s-pv-on');
        if (d.hero_image) root.setProperty('--s-hero-img', `url("${imgUrl(d.hero_image, 1600).replace(/["\\\n]/g, '')}")`);
        else root.removeProperty('--s-hero-img');
    }
    document.title = meta.title || meta.company || 'Tienda';
}

/** Los productos por id (sin tocar el índice de la página). */
function byIdOf(list: PublicShopProduct[]): Map<number, PublicShopProduct> {
    return new Map(list.map((p) => [p.id, p]));
}

function indexProducts(): void {
    byId = new Map(products.map((p) => [p.id, p]));
    buyable = shopPurchasables(products);
    subscribable = shopPurchasables(products, { subscriptions: true });
    // Lo que ya no está en la tienda sale del carrito (al cargar la página).
    for (const id of [...cart.keys()]) if (!buyable.has(id)) cart.delete(id);
    // v0.1.429 — Si cambió el mínimo o el «de a cuánto», lo del carrito se acomoda.
    for (const [id, q] of [...cart]) {
        const it = buyable.get(id);
        if (!it) continue;
        const v = snapShopQty(q, it.qty);
        if (v !== q) cart.set(id, v);
    }
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
    btn.addEventListener('click', () => openCart());
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
        // v0.1.418 — Con las etiquetas del enlace directo, el aviso de cookies.
        directPixels && conversionCfg?.direct?.notice ? el('div', { cls: 's-foot-in s-pixels-note', 'data-testid': 'shop-pixels-note', text: conversionCfg.direct.notice }) : null,
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
            const hay = fold(`${p.title} ${p.summary ?? ''} ${p.description} ${p.sku} ${p.categories.join(' ')}`);
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
        // v0.1.429 — Con unidad: «Quedan 12,5 kg», «Queda 1 hora».
        if (p.unit) return `${p.stock === 1 ? 'Queda' : 'Quedan'} ${qtyText(p.stock, p.unit)}`;
        return p.stock === 1 ? 'Queda 1' : `Quedan ${qtyNum(p.stock)}`;
    }
    return null;
}

function priceNode(p: { price: number | null; compare_price: number | null; unit?: ShopUnit }, cls = 's-price', from = false): HTMLElement {
    const kids: HTMLElement[] = [];
    // v0.1.429 — El precio es por hora, por kg…: «$ 50.000 / hora».
    const per = p.price !== null && p.unit ? el('span', { cls: 's-per', 'data-testid': 'shop-per-unit', text: shopPerUnit(p.unit).trim() }) : null;
    if (p.price === null) kids.push(el('span', { cls: 's-was', text: 'Sin precio' }));
    else if (from) kids.push(el('span', { cls: 's-now', text: `Desde ${money(p.price)}` }));
    else {
        kids.push(el('span', { cls: 's-now', text: money(p.price) }));
        if (per) {
            kids.push(per);
        }
        if (p.compare_price !== null && p.compare_price > p.price) kids.push(el('span', { cls: 's-was', text: money(p.compare_price), 'aria-label': `Antes ${money(p.compare_price)}` }));
        return el('div', { cls }, kids);
    }
    if (per) kids.push(per);
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
    return el('div', { style: 'display:flex;flex-direction:column' }, [b, n > 0 ? el('span', { cls: 's-incart', style: 'margin-top:6px', text: `${p.unit ? qtyText(n, p.unit) : n} en el carrito` }) : null]);
}

function addControl(p: { id: number; title: string; price: number | null } & QtyItem): HTMLElement {
    const qty = cart.get(p.id) ?? 0;
    const m = meta!;
    if (qty === 0) {
        const unavailable = soldOut(p) || p.price === null || !!m.closed || maxFor(p) <= 0;
        const b = el('button', {
            type: 'button',
            cls: 's-add',
            disabled: unavailable,
            text: soldOut(p) || (p.price !== null && maxFor(p) <= 0) ? 'Agotado' : p.price === null ? 'No disponible' : m.texts.add_to_cart || 'Agregar al carrito',
            'data-testid': 'shop-add',
            // Al agregar, el foco pasa al «+» que aparece en su lugar.
            'data-k': `plus-${p.id}-p`,
        });
        b.addEventListener('click', () => addToCart(p.id));
        return b;
    }
    // v0.1.429 — Sube y baja de a lo que dice el producto (el mínimo, «de a cuánto»).
    return qtyStepper({
        value: qty,
        unit: p.unit,
        canMinus: true,
        canPlus: shopQtyNext(qty, p.qty, 1, p.stock) > qty,
        onMinus: () => setQty(p.id, shopQtyNext(qty, p.qty, -1, p.stock)),
        onPlus: () => setQty(p.id, shopQtyNext(qty, p.qty, 1, p.stock)),
        key: `plus-${p.id}`,
        testid: 'shop-step',
    });
}

/** v0.1.421 — Cuánto se eligió en la ficha antes de agregar (v0.1.429: con decimales y en la unidad del producto). */
function setPick(n: number): void {
    if (overlay?.kind !== 'product') return;
    overlay = { ...overlay, pick: Math.max(0.001, Math.min(SHOP_MAX_QTY, roundShopQty(n))) };
    renderOverlay();
}

/**
 * Agrega al carrito y hace lo que la tienda eligió para después. Sin `n`: el
 * mínimo del producto (o un «de a cuánto» más si ya estaba).
 */
function addToCart(id: number, n?: number): void {
    const item = buyable.get(id);
    if (!item) return;
    const before = cart.get(id) ?? 0;
    const add = n ?? (before > 0 ? (item.qty?.step ?? 1) : (item.qty?.min ?? 1));
    setQty(id, before + add);
    if ((cart.get(id) ?? 0) > before) afterAdded(id);
}

function bumpCart(): void {
    const els = [...cartButtons.map((b) => b.querySelector<HTMLElement>('.s-badge')), mbar?.querySelector<HTMLElement>('.s-btn') ?? null];
    for (const x of els) {
        if (!x) continue;
        x.classList.remove('s-bump');
        void x.offsetWidth;
        x.classList.add('s-bump');
    }
}

/**
 * v0.1.421 — Qué pasa al agregar al carrito (Diseño → Al agregar al carrito):
 * un aviso con «Ver carrito», el carrito al costado (con lo agregado
 * marcado), la página del carrito o directo al pago.
 */
function afterAdded(id: number): void {
    bumpCart();
    const title = buyable.get(id)?.title ?? '';
    switch (meta!.display.after_add) {
        case 'toast':
            toast(title ? `Agregaste «${title}» al carrito.` : 'Agregado al carrito.', { label: 'Ver carrito', run: () => openCart() });
            return;
        case 'cart':
            if (overlay) closeOverlay();
            goCart();
            return;
        case 'checkout':
            if (overlay) closeOverlay();
            goCheckout();
            return;
        default:
            if (overlay) {
                overlay = { kind: 'cart', flash: id };
                renderOverlay();
            } else openOverlay({ kind: 'cart', flash: id });
    }
}

/** El carrito: la página (si la tienda la usa) o el cajón al costado. */
function openCart(): void {
    if (meta?.display.after_add === 'cart') {
        if (overlay) closeOverlay();
        goCart();
        return;
    }
    openOverlay({ kind: 'cart' });
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
    const title = productLink(p, 's-title', p.title);
    const variable = hasVariants(p) && !service;
    const st = variable ? null : stockText(p);
    const actions = el('div', { cls: 's-act' }, [cardControl(p)]);
    const card = el('article', { cls: `s-card${soldOut(p) && !service ? ' s-out' : ''}`, 'data-testid': 'shop-card', 'data-id': String(p.id) }, [
        media,
        el('div', { cls: 's-body' }, [
            title,
            // v0.1.424 — La descripción corta (dos renglones).
            d.show_summary && p.summary ? el('p', { cls: 's-card-sum', 'data-testid': 'shop-card-summary', text: p.summary }) : null,
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
    gridEl.className = `s-grid s-ar-${d.image_ratio}${d.image_fit === 'contain' ? ' s-contain' : ''}`;
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

// ── v0.1.423: la tienda en su dominio — cada producto con su dirección ──
//
// Abrir un producto anota `/p/<nombre>-<id>` en la barra (atrás lo cierra y
// adelante lo vuelve a abrir) y cambia el título de la pestaña. Si se llegó
// directo a un producto, cerrarlo deja la barra en `/` sin salir del sitio.

/** Mientras se aplica lo que pidió la barra (atrás/adelante): no se vuelve a anotar. */
let siteFromHistory = false;

interface SiteState {
    imbP: number;
    pushed: boolean;
}

function siteState(): SiteState | null {
    const st = history.state as Partial<SiteState> | null;
    return st && typeof st.imbP === 'number' ? { imbP: st.imbP, pushed: st.pushed === true } : null;
}

function siteProductOpened(id: number): void {
    if (!SITE || siteFromHistory) return;
    const p = byId.get(id);
    if (!p) return;
    document.title = `${p.title} · ${SITE.home_title}`;
    const path = shopProductPath(p.title, p.id);
    const cur = siteState();
    if (location.pathname === path) {
        history.replaceState({ imbP: id, pushed: cur?.pushed === true }, '', location.pathname + location.search);
        return;
    }
    if (cur) history.replaceState({ imbP: id, pushed: cur.pushed }, '', path);
    else history.pushState({ imbP: id, pushed: true }, '', path);
}

function siteProductLeft(): void {
    if (!SITE) return;
    document.title = SITE.home_title;
    if (siteFromHistory) return;
    const cur = siteState();
    if (cur?.pushed) history.back();
    else if (location.pathname !== '/') history.replaceState(null, '', '/' + location.search);
}

if (SITE) {
    window.addEventListener('popstate', () => {
        const id = siteState()?.imbP ?? parseShopProductPath(location.pathname);
        siteFromHistory = true;
        try {
            if (id !== null && byId.has(id)) {
                if (!(overlay?.kind === 'product' && overlay.id === id)) openOverlay({ kind: 'product', id, image: 0 });
            } else if (overlay?.kind === 'product') closeOverlay();
            document.title = id !== null && byId.has(id) ? `${byId.get(id)!.title} · ${SITE.home_title}` : SITE.home_title;
        } finally {
            siteFromHistory = false;
        }
    });
}

/** El enlace de un producto: en su dominio es una dirección de verdad (la siguen los buscadores). */
function productLink(p: PublicShopProduct, cls: string, text: string): HTMLElement {
    if (!SITE) {
        const b = el('button', { cls, type: 'button', text });
        b.addEventListener('click', () => openOverlay({ kind: 'product', id: p.id, image: 0 }));
        return b;
    }
    const a = el('a', { cls, href: shopProductPath(p.title, p.id), text });
    a.addEventListener('click', (ev) => {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
        ev.preventDefault();
        openOverlay({ kind: 'product', id: p.id, image: 0 });
    });
    return a;
}

function openOverlay(o: NonNullable<Overlay>): void {
    if (!overlay) lastFocus = document.activeElement as HTMLElement | null;
    const wasProduct = overlay?.kind === 'product';
    overlay = o;
    if (o.kind === 'product') siteProductOpened(o.id);
    else if (wasProduct) siteProductLeft();
    if (o.kind === 'product') {
        trackProduct(o.id);
        const p = products.find((x) => x.id === o.id);
        if (p) ecommerce('view_item', { value: p.price, items: [{ item_id: String(p.id), item_name: p.title.slice(0, 120), price: p.price ?? 0, quantity: 1, ...(p.categories[0] ? { item_category: p.categories[0].slice(0, 80) } : {}) }] });
    }
    renderOverlay();
}

function closeOverlay(): void {
    const wasProduct = overlay?.kind === 'product';
    overlay = null;
    if (wasProduct) siteProductLeft();
    ovRoot.replaceChildren();
    document.body.style.overflow = '';
    paintCartButtons();
    lastFocus?.focus?.();
    lastFocus = null;
}

/**
 * Una capa (carrito, ficha, políticas). `bare`: sin barra de título —la X
 * flota arriba a la derecha— para la ficha del producto, que ya muestra el
 * nombre (v0.1.424). `cls`: clases extra (el diseño de la ficha).
 */
function sheet(
    kind: 'drawer' | 'modal' | 'narrow',
    title: string,
    body: Node[],
    foot: Node[] | null,
    testid: string,
    opts: { bare?: boolean; cls?: string; footCls?: string } = {},
): HTMLElement {
    const x = el('button', { type: 'button', cls: opts.bare ? 's-x s-x-float' : 's-x', 'aria-label': 'Cerrar' }, [icon('x')]);
    x.addEventListener('click', closeOverlay);
    const box = el(
        'div',
        {
            cls: `s-sheet ${kind === 'drawer' ? 's-drawer' : `s-modal${kind === 'narrow' ? ' s-narrow' : ''}`}${opts.cls ? ` ${opts.cls}` : ''}`,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': title,
            'data-testid': testid,
        },
        [
            opts.bare ? x : el('div', { cls: 's-sh' }, [el('h2', { text: title }), x]),
            el('div', { cls: 's-sb' }, body),
            foot ? el('div', { cls: `s-sf${opts.footCls ? ` ${opts.footCls}` : ''}` }, foot) : null,
        ],
    );
    return box;
}

function renderOverlay(): void {
    if (!overlay || !meta) return;
    const veil = el('div', { cls: 's-veil' });
    veil.addEventListener('click', closeOverlay);
    let box: HTMLElement;
    if (overlay.kind === 'product') box = productSheet(overlay.id, overlay.image, overlay.sel, overlay.pick);
    else if (overlay.kind === 'cart') box = cartSheet(overlay.flash);
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
        { cls: 's-vopts', 'data-testid': 'shop-options' },
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

// ─────────── v0.1.420 — Descripción con formato (el documento del registro) ───────────
// Llega como un árbol ya saneado por el servidor y se arma nodo por nodo con
// `createElement`/`textContent`: ningún texto del producto se interpreta como HTML.

const descCache = new Map<number, RichNode | null | 'loading'>();

function richMarks(text: string, marks: RichNode['marks']): Node {
    let node: Node = document.createTextNode(text);
    for (const m of marks ?? []) {
        let wrap: HTMLElement | null = null;
        if (m.type === 'bold') wrap = el('strong');
        else if (m.type === 'italic') wrap = el('em');
        else if (m.type === 'underline') wrap = el('u');
        else if (m.type === 'strike') wrap = el('s');
        else if (m.type === 'code') wrap = el('code');
        else if (m.type === 'link' && typeof m.attrs?.href === 'string' && /^(https?:\/\/|mailto:|tel:)/i.test(m.attrs.href)) {
            wrap = el('a', { href: m.attrs.href, target: '_blank', rel: 'noopener noreferrer nofollow' });
        } else if ((m.type === 'textStyle' || m.type === 'highlight') && typeof m.attrs?.color === 'string' && /^#[0-9a-f]{3,6}$/i.test(m.attrs.color)) {
            wrap = el(m.type === 'highlight' ? 'mark' : 'span');
            if (m.type === 'highlight') wrap.style.backgroundColor = m.attrs.color;
            else wrap.style.color = m.attrs.color;
        }
        if (wrap) {
            wrap.append(node);
            node = wrap;
        }
    }
    return node;
}

function richNode(n: RichNode): Node | null {
    const kids = (): Node[] => (n.content ?? []).map(richNode).filter((x): x is Node => x !== null);
    switch (n.type) {
        case 'text':
            return richMarks(n.text ?? '', n.marks);
        case 'hardBreak':
            return el('br');
        case 'paragraph':
            return el('p', {}, kids());
        case 'heading': {
            const level = Number(n.attrs?.level);
            return el(level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5', {}, kids());
        }
        case 'bulletList':
            return el('ul', {}, kids());
        case 'orderedList': {
            const start = Number(n.attrs?.start);
            return el('ol', Number.isInteger(start) && start > 1 ? { start } : {}, kids());
        }
        case 'taskList':
            return el('ul', { cls: 's-tasks' }, kids());
        case 'listItem':
            return el('li', {}, kids());
        case 'taskItem':
            return el('li', { cls: n.attrs?.checked === true ? 's-task s-done' : 's-task' }, [el('span', { cls: 's-task-box', 'aria-hidden': 'true', text: n.attrs?.checked === true ? '✓' : '' }), el('div', {}, kids())]);
        case 'blockquote':
            return el('blockquote', {}, kids());
        case 'codeBlock':
            return el('pre', {}, [el('code', {}, kids())]);
        case 'horizontalRule':
            return el('hr');
        case 'table':
            return el('div', { cls: 's-rich-table' }, [el('table', {}, [el('tbody', {}, kids())])]);
        case 'tableRow':
            return el('tr', {}, kids());
        case 'tableHeader':
        case 'tableCell': {
            const span = (k: string): number | null => (Number.isInteger(Number(n.attrs?.[k])) && Number(n.attrs?.[k]) > 1 ? Number(n.attrs?.[k]) : null);
            return el(n.type === 'tableHeader' ? 'th' : 'td', { colspan: span('colspan'), rowspan: span('rowspan') }, kids());
        }
        case 'columnsBlock':
            return el('div', { cls: 's-rich-cols' }, kids());
        case 'column':
            return el('div', {}, kids());
        case 'image': {
            const src = typeof n.attrs?.src === 'string' ? n.attrs.src : '';
            if (!src.startsWith('img/') && !(BOOT.preview && /^https:\/\//.test(src))) return null;
            return el('img', { src: imgUrl(src, 1200), alt: typeof n.attrs?.alt === 'string' ? n.attrs.alt : '', loading: 'lazy', decoding: 'async' });
        }
        default:
            return null;
    }
}

/** La descripción del producto: texto plano o, con formato, el documento (que se pide la primera vez). */
function descriptionBlock(p: PublicShopProduct): HTMLElement | null {
    if (!p.rich_description) return p.description ? el('p', { cls: 's-desc', text: p.description }) : null;
    const doc = p.description_doc !== undefined ? p.description_doc : descCache.get(p.id);
    if (doc === undefined) {
        descCache.set(p.id, 'loading');
        void fetch(`${PAGE}/desc/${p.id}`, { credentials: 'omit', headers: { Accept: 'application/json' } })
            .then((r) => (r.ok ? (r.json() as Promise<{ doc: RichNode | null }>) : { doc: null }))
            .catch(() => ({ doc: null }))
            .then((b) => {
                descCache.set(p.id, b.doc ?? null);
                // Sigue abierta la ficha de ESTE producto: se redibuja (sin animación).
                if (overlay?.kind === 'product' && overlay.id === p.id) renderOverlay();
            });
    }
    if (doc === undefined || doc === 'loading') return el('div', { cls: 's-rich s-rich-wait', 'aria-busy': 'true' }, [el('span'), el('span'), el('span')]);
    if (doc === null) return p.description ? el('p', { cls: 's-desc', text: p.description }) : null;
    return el('div', { cls: 's-rich', 'data-testid': 'shop-rich-desc' }, (doc.content ?? []).map(richNode).filter((x): x is Node => x !== null));
}

/** v0.1.417 — Lo que dice la ficha de una suscripción. */
function subscriptionNote(p: PublicShopProduct): string {
    const plan = p.subscription;
    if (!plan) return 'Esta suscripción todavía no está disponible. Escríbenos para contratarla.';
    return `Se cobra ${cadenceText(plan)} con débito automático. Autorizas tu tarjeta en ${providerName(plan.provider)} una sola vez y los cobros se hacen solos.`;
}

/** v0.1.424 — Cómo se arma la ficha (el diseño elegido en Estilo → Ficha del producto). */
function productLook(): NonNullable<NonNullable<PublicShopMeta['design']>['product']> {
    return (
        meta?.design?.product ?? {
            layout: 'classic',
            image_ratio: 'auto',
            image_fit: 'contain',
            show_delivery: true,
            sticky_bar: true,
        }
    );
}

/** v0.1.424 — Proporción (ancho/alto) de cada foto ya cargada. */
const photoRatio = new Map<string, number>();

/**
 * v0.1.424 — La galería de la ficha: la foto grande (con flechas si hay más
 * de una) y las miniaturas. La forma del recuadro la da el diseño.
 */
function productGallery(p: PublicShopProduct, imgs: string[], idx: number, sel: Array<string | null> | undefined, compact: boolean): HTMLElement {
    const go = (i: number): void => openOverlay({ kind: 'product', id: p.id, image: (i + imgs.length) % imgs.length, ...(sel ? { sel } : {}) });
    const src = imgs[idx];
    const url = src ? imgUrl(src, compact ? 320 : 1200) : '';
    const img = src ? el('img', { src: url, alt: p.title, decoding: 'async' }) : null;
    const main = el('div', { cls: 's-gal-main', 'data-testid': 'shop-gallery' }, [img ?? el('div', { cls: 's-noimg' }, [icon('image')])]);
    // Con «como es la foto», el recuadro toma la forma de la foto (las flechas
    // y la etiqueta quedan sobre la imagen, no flotando a los costados). La
    // proporción se recuerda para no saltar al pasar de una foto a otra.
    if (img && !compact) {
        const known = photoRatio.get(url);
        if (known) main.style.setProperty('--r', String(known));
        img.addEventListener('load', () => {
            if (!img.naturalWidth || !img.naturalHeight) return;
            const r = Math.round((img.naturalWidth / img.naturalHeight) * 1000) / 1000;
            photoRatio.set(url, r);
            main.style.setProperty('--r', String(r));
        });
    }
    if (!compact && imgs.length > 1) {
        const prev = el('button', { type: 'button', cls: 's-gal-nav s-gal-prev', 'aria-label': 'Foto anterior', 'data-k': `gprev-${p.id}` }, [icon('back')]);
        prev.addEventListener('click', () => go(idx - 1));
        const next = el('button', { type: 'button', cls: 's-gal-nav s-gal-next', 'aria-label': 'Foto siguiente', 'data-k': `gnext-${p.id}` }, [icon('back')]);
        next.addEventListener('click', () => go(idx + 1));
        main.append(prev, next, el('span', { cls: 's-gal-count', text: `${idx + 1} / ${imgs.length}` }));
    }
    const off = p.price !== null && p.compare_price !== null && p.compare_price > p.price ? Math.round((1 - p.price / p.compare_price) * 100) : 0;
    if (off >= 1 && !compact) main.append(el('span', { cls: 's-tag s-sale', text: `−${off}%` }));
    const gal = el('div', { cls: 's-gal' }, [main]);
    if (!compact && imgs.length > 1) {
        gal.append(
            el(
                'div',
                { cls: 's-thumbs' },
                imgs.map((t, i) => {
                    const b = el('button', { type: 'button', cls: 's-thumb', 'aria-label': `Foto ${i + 1}`, 'aria-pressed': i === idx ? 'true' : 'false' }, [el('img', { src: imgUrl(t, 160), alt: '' })]);
                    b.addEventListener('click', () => go(i));
                    return b;
                }),
            ),
        );
    }
    return gal;
}

/**
 * v0.1.424 — Comprar desde la ficha: se elige cuántos y «Agregar al carrito»
 * siempre está (aunque ya haya en el carrito: suma lo elegido). Abajo, lo
 * que ya hay en el carrito con «Ver carrito».
 */
function sheetBuy(item: { id: number; title: string; price: number | null } & QtyItem, pick: number | undefined): HTMLElement {
    const m = meta!;
    const inCartNow = cart.get(item.id) ?? 0;
    const cap = maxFor(item);
    const unavailable = soldOut(item) || item.price === null || !!m.closed || cap <= 0;
    // v0.1.429 — Cuánto se puede sumar: desde el mínimo (o un «de a cuánto» si ya está en el carrito) hasta lo que queda.
    const r = pickRule(item, inCartNow);
    const full = !unavailable && r === null;
    const n = pickedQty(r, pick);
    const b = el('button', {
        type: 'button',
        cls: 's-btn',
        disabled: unavailable || full,
        text: soldOut(item) || (item.price !== null && cap <= 0)
            ? 'Agotado'
            : item.price === null
              ? 'No disponible'
              : full
                ? item.unit
                    ? 'Ya tienes lo máximo en el carrito'
                    : 'Ya tienes todas las disponibles'
                : m.texts.add_to_cart || 'Agregar al carrito',
        'data-testid': 'shop-add',
        'data-k': `sadd-${item.id}`,
    });
    b.addEventListener('click', () => addToCart(item.id, n));
    const row: Node[] = [];
    let qtyLabel: HTMLElement | null = null;
    if (r && !unavailable && (r.max === null || r.max > r.min)) {
        const step = r.step;
        if (item.unit || item.qty) qtyLabel = el('div', { cls: 's-qty-l', text: shopQtyLabel(item.unit) });
        row.push(
            qtyStepper({
                value: n,
                unit: item.unit,
                canMinus: n > r.min,
                canPlus: r.max === null || roundShopQty(n + step) <= r.max,
                onMinus: () => setPick(Math.max(r.min, roundShopQty(n - step))),
                onPlus: () => setPick(roundShopQty(n + step)),
                onType: (v) => setPick(v),
                key: `pick-${item.id}`,
                cls: 's-step s-pick',
                testid: 'shop-pick',
                labels: ['Menos', 'Más'],
            }),
        );
    }
    row.push(b);
    const box = el('div', { cls: 's-buybox' }, [qtyLabel, el('div', { cls: 's-buyrow' }, row)]);
    if (inCartNow > 0) {
        const view = el('button', { type: 'button', cls: 's-link', text: 'Ver carrito', 'data-testid': 'shop-sheet-cart' });
        view.addEventListener('click', () => openCart());
        box.append(
            el('p', { cls: 's-incart-row', 'data-testid': 'shop-incart' }, [
                icon('check'),
                el('span', { text: item.unit ? `Tienes ${qtyText(inCartNow, item.unit)} en el carrito.` : inCartNow === 1 ? 'Tienes 1 en el carrito.' : `Tienes ${qtyNum(inCartNow)} en el carrito.` }),
                view,
            ]),
        );
    }
    return box;
}

/**
 * v0.1.429 — Lo que se puede sumar al carrito desde la ficha: la primera vez,
 * desde el mínimo del producto; si ya hay, de a lo que dice «de a cuánto».
 * Hasta lo que queda (máximo y stock). null = ya no entra más.
 */
function pickRule(item: QtyItem, inCartNow: number): { min: number; max: number | null; step: number } | null {
    const step = item.qty?.step ?? 1;
    const min = inCartNow > 0 ? step : (item.qty?.min ?? 1);
    const cap = maxFor(item);
    const room = roundShopQty(cap - inCartNow);
    if (room < min) return null;
    const k = Math.floor(roundShopQty((room - min) / step) + 1e-9);
    return { min, max: roundShopQty(min + k * step), step };
}

/** v0.1.429 — Lo elegido en la ficha: sin tocar, el mínimo (no 1: «de a 0,5 kg» arranca en 0,5). */
function pickedQty(r: { min: number; max: number | null; step: number } | null, pick: number | undefined): number {
    if (!r) return 0;
    return pick === undefined ? r.min : snapShopQty(pick, r);
}

/** v0.1.429 — La regla en una frase («Mínimo 2 horas · de a 1»), si no es la de siempre. */
function qtyRuleNode(item: QtyItem | undefined): HTMLElement | null {
    if (!item?.qty) return null;
    const text = shopQtyRuleText(item.qty, item.unit, meta?.number_format ?? 'dot_comma');
    return text ? el('div', { cls: 's-qty-rule', 'data-testid': 'shop-qty-rule', text }) : null;
}

/** v0.1.424 — Cómo se entrega lo físico (envío, recoger, envío gratis desde…). */
function deliveryHint(): HTMLElement | null {
    const list = meta?.delivery ?? [];
    if (list.length === 0) return null;
    const parts = list.slice(0, 3).map((d) => (d.eta ? `${d.name} (${d.eta})` : d.name));
    const free = list.map((d) => d.free_over).filter((x): x is number => typeof x === 'number' && x > 0);
    const kids: Node[] = [icon('truck'), el('span', {}, [parts.join(' · '), free.length > 0 ? el('span', { cls: 's-free', text: ` · Envío gratis desde ${money(Math.min(...free))}` }) : null])];
    return el('p', { cls: 's-kind-note', 'data-testid': 'shop-delivery-hint' }, kids);
}

function productSheet(id: number, imageIdx: number, selIn?: Array<string | null>, pick?: number): HTMLElement {
    const p = byId.get(id);
    if (!p) return sheet('narrow', 'Producto', [el('p', { cls: 's-empty', text: 'Este producto ya no está disponible.' })], null, 'shop-product');
    const look = productLook();
    const layout = look.layout;
    const compact = layout === 'compact';
    const service = isService(p);
    const variable = hasVariants(p) && !service;
    const sel = variable ? (selIn ?? initialSelection(p)) : [];
    const variant: PublicShopVariant | null = variable ? pickShopVariant(p, sel) : null;
    const imgs = variant && variant.images.length > 0 ? variant.images : p.images;
    const idx = Math.min(imageIdx, Math.max(0, imgs.length - 1));
    const gallery = productGallery(p, imgs, idx, variable ? sel : undefined, compact);
    let buy: HTMLElement;
    let priceEl: HTMLElement;
    let barPrice: { price: number | null; compare_price: number | null } | null = null;
    let st: string | null;
    let sku = p.sku;
    // Lo que se compra (null = no se compra desde aquí: servicio, suscripción o falta elegir).
    let buyItem: ({ id: number; title: string; price: number | null } & QtyItem) | undefined;
    if (service) {
        buy = bookControl(p, true);
        priceEl = priceNode(p, 's-price s-d-price', priceFrom(p));
        st = null;
    } else if (!variable && isSubscription(p)) {
        buy = subscribeControl(p, p, true);
        priceEl = priceNode(p, 's-price s-d-price');
        st = stockText(p);
    } else if (!variable) {
        buyItem = buyable.get(p.id) ?? p;
        buy = sheetBuy(buyItem, pick);
        priceEl = priceNode(p, 's-price s-d-price');
        barPrice = p;
        st = stockText(p);
    } else if (variant && isSubscription(p)) {
        // v0.1.417 — La variante elegida de una suscripción (con su precio).
        const item = subscribable.get(variant.id) ?? { id: variant.id, price: variant.price, stock: variant.stock };
        buy = subscribeControl(p, item, true);
        priceEl = priceNode(variant, 's-price s-d-price');
        st = stockText({ ...p, stock: variant.stock });
        sku = variant.sku || p.sku;
    } else if (variant) {
        buyItem = buyable.get(variant.id)!;
        buy = sheetBuy(buyItem, pick);
        priceEl = priceNode(variant, 's-price s-d-price');
        barPrice = variant;
        st = stockText({ ...p, stock: variant.stock });
        sku = variant.sku || p.sku;
    } else {
        const missing = (p.options ?? []).filter((_, i) => !sel[i]).map((o) => o.name.toLowerCase());
        buy = el('button', { type: 'button', cls: 's-btn', disabled: true, text: missing.length > 0 ? `Elige ${missing.join(' y ')}` : 'Esa combinación no está disponible', 'data-testid': 'shop-add' });
        priceEl = priceNode(p, 's-price s-d-price', priceFrom(p));
        st = null;
    }
    // v0.1.421 — «Comprar ahora»: lo agrega (si no está) y va directo al pago.
    const d = meta!.display;
    const canBuyNow = !!buyItem && d.buy_now && d.after_add !== 'checkout' && !meta!.closed && !soldOut(buyItem) && buyItem.price !== null;
    const buyNowRun = (): void => {
        if (!buyItem) return;
        // v0.1.429 — Lo elegido en la ficha (la cantidad válida más cercana).
        if ((cart.get(buyItem.id) ?? 0) === 0) setQty(buyItem.id, pickedQty(pickRule(buyItem, 0), pick));
        closeOverlay();
        goCheckout();
    };
    const buyNow = canBuyNow ? actionButton(meta!.texts.buy_now || 'Comprar ahora', buyNowRun, 's-btn s-btn-line s-buynow', 'shop-buy-now') : null;
    const n = variable ? inCart(p) : 0;
    const kindNote = service
        ? el('p', { cls: 's-kind-note', 'data-testid': 'shop-kind-note' }, [icon('calendar'), bookUrl(p) ? 'Eliges el día y la hora en la agenda.' : 'La agenda de este servicio todavía no está disponible.'])
        : p.kind === 'digital'
          ? el('p', { cls: 's-kind-note', 'data-testid': 'shop-kind-note' }, [icon('download'), downloadsText()])
          : isSubscription(p)
            ? el('p', { cls: 's-kind-note', 'data-testid': 'shop-kind-note' }, [icon('repeat'), subscriptionNote(p)])
            : look.show_delivery
              ? deliveryHint()
              : null;
    const desc = descriptionBlock(p);
    const descSection = desc ? el('section', { cls: 's-d-desc', 'data-testid': 'shop-desc' }, [el('h3', { cls: 's-d-desc-t', text: 'Descripción' }), desc]) : null;
    const head: Node[] = [
        p.categories.length > 0 ? el('div', { cls: 's-d-eyebrow' }, [p.categories.slice(0, 3).join(' · ')]) : null,
        el('h2', { cls: 's-d-title', text: p.title }),
        meta!.display.show_sku && sku ? el('div', { cls: 's-sku', text: `Ref. ${sku}` }) : null,
        priceEl,
        isSubscription(p) && p.subscription ? el('div', { cls: 's-cad', text: cadenceText(p.subscription) }) : null,
    ].filter((x): x is HTMLElement => x !== null);
    const info: Node[] = [
        ...(compact ? [] : head),
        p.summary ? el('p', { cls: 's-d-sum', 'data-testid': 'shop-product-summary', text: p.summary }) : null,
        variable ? variantOptions(p, sel, idx) : null,
        st ? el('div', { cls: 's-stock s-d-stock', text: st }) : null,
        // v0.1.429 — Mínimo, de a cuánto y máximo, si el producto los tiene.
        qtyRuleNode(buyItem),
        el('div', { cls: 's-d-buy' }, [buy, buyNow]),
        kindNote,
        n > 0 && !(variant && cart.has(variant.id))
            ? el('p', { cls: 's-incart', style: 'margin:8px 0 0', text: p.unit ? `Tienes ${qtyText(n, p.unit)} de este producto en el carrito.` : n === 1 ? 'Tienes 1 de este producto en el carrito.' : `Tienes ${qtyNum(n)} de este producto en el carrito.` })
            : null,
        layout === 'wide' ? null : descSection,
    ].filter((x): x is Node => x !== null);
    const body: Node[] = [];
    if (compact) {
        body.push(el('div', { cls: 's-d-top' }, [gallery, el('div', { cls: 's-d-topinfo' }, head)]), el('div', { cls: 's-d-info' }, info));
    } else if (layout === 'stacked') {
        body.push(gallery, el('div', { cls: 's-d-info' }, info));
    } else {
        body.push(el('div', { cls: 's-detail' }, [gallery, el('div', { cls: 's-d-info' }, info)]));
        if (layout === 'wide' && descSection) body.push(descSection);
    }
    // v0.1.424 — En el celular: el precio y el botón quedan fijos abajo.
    let foot: Node[] | null = null;
    if (look.sticky_bar && buyItem && barPrice && !meta!.closed && !soldOut(buyItem) && buyItem.price !== null) {
        const item = buyItem;
        const r = pickRule(item, cart.get(item.id) ?? 0);
        const barBtn =
            r
                ? actionButton(addLabel(), () => addToCart(item.id, pickedQty(r, pick)), 's-btn', 'shop-bar-add')
                : canBuyNow
                  ? actionButton(meta!.texts.buy_now || 'Comprar ahora', buyNowRun, 's-btn', 'shop-bar-buy')
                  : actionButton('Ver carrito', () => openCart(), 's-btn', 'shop-bar-cart');
        foot = [el('div', { cls: 's-pd-bar-in' }, [priceNode(barPrice, 's-price s-bar-price'), barBtn])];
    }
    return sheet(compact ? 'narrow' : 'modal', p.title, body, foot, 'shop-product', {
        bare: true,
        cls: `s-pd s-pd-${layout} s-pr-${look.image_ratio} s-pf-${look.image_fit}`,
        footCls: 's-pd-bar',
    });
}

/** El texto del botón de agregar (el de la tienda o el de siempre). */
function addLabel(): string {
    return meta?.texts.add_to_cart || 'Agregar al carrito';
}

function actionButton(label: string, onClick: () => void, cls = 's-btn', testid?: string): HTMLButtonElement {
    const b = el('button', { type: 'button', cls, text: label, 'data-testid': testid });
    b.addEventListener('click', onClick);
    return b;
}

function cartLine(line: ShopCartResult['lines'][number], flash?: number): HTMLElement {
    const p = buyable.get(line.product_id);
    const img = p?.images[0];
    const unit = line.unit ?? p?.unit;
    const rm = el('button', { type: 'button', cls: 's-rm', text: 'Quitar' });
    rm.addEventListener('click', () => setQty(line.product_id, 0));
    const problem = shopLineProblemText(line, meta?.number_format);
    // v0.1.429 — Sube y baja de a lo que dice el producto; la cantidad se puede escribir (2,5).
    const stepper = qtyStepper({
        value: line.qty,
        unit,
        canMinus: true,
        canPlus: !!p && shopQtyNext(line.qty, p.qty, 1, p.stock) > line.qty,
        onMinus: () => setQty(line.product_id, shopQtyNext(line.qty, p?.qty, -1, p?.stock ?? null)),
        onPlus: () => setQty(line.product_id, shopQtyNext(line.qty, p?.qty, 1, p?.stock ?? null)),
        onType: (n) => setQty(line.product_id, n),
        key: `c-${line.product_id}`,
    });
    return el('div', { cls: `s-line${flash === line.product_id ? ' s-flash' : ''}`, 'data-testid': 'shop-cart-line' }, [
        el('div', { cls: 's-line-img' }, [img ? el('img', { src: imgUrl(img, 160), alt: '' }) : el('div', { cls: 's-noimg' }, [icon('image')])]),
        el('div', {}, [
            el('div', { cls: 's-line-t', text: p?.title || line.title || 'Producto' }),
            el('div', { cls: 's-line-p', text: `${money(line.unit_price)}${shopPerUnit(unit)}` }),
            problem ? el('div', { cls: 's-line-err', text: problem }) : null,
            unit ? el('div', { cls: 's-step-row' }, [stepper, unitWord(line.qty, unit)]) : stepper,
        ]),
        el('div', {}, [el('div', { cls: 's-line-sub', text: money(line.subtotal) }), rm]),
    ]);
}

/** El total del carrito y el botón para seguir (el cajón y la página del carrito). */
function cartSummary(est: ShopCartResult): Node[] {
    const out: Node[] = [];
    out.push(el('div', { cls: 's-sum' }, [el('div', {}, [el('span', { text: 'Subtotal' }), el('strong', { text: money(est.subtotal), 'data-testid': 'shop-cart-subtotal' })])]));
    if (est.below_minimum !== null) out.push(el('div', { cls: 's-warn', text: `La compra mínima es de ${money(meta!.checkout.min_order ?? 0)}: te faltan ${money(est.below_minimum)}.` }));
    else if (est.blocked) out.push(el('div', { cls: 's-warn', text: 'Revisa los productos marcados antes de seguir.' }));
    const pendingCoupon = meta!.coupons ? sessionGet(COUPON_KEY) : null;
    if (pendingCoupon) out.push(el('div', { cls: 's-free-hint', 'data-testid': 'shop-cart-coupon' }, [icon('tag'), el('span', { text: `Tu cupón ${pendingCoupon} se aplica al finalizar la compra.` })]));
    out.push(el('p', { cls: 's-line-p', style: 'margin:0 0 10px', text: digitalCart() ? 'Todo se descarga: no hay envío.' : 'El envío se calcula en el siguiente paso.' }));
    const go = actionButton(meta!.texts.checkout || 'Finalizar compra', () => {
        if (overlay) closeOverlay();
        goCheckout();
    }, 's-btn', 'shop-checkout');
    go.disabled = est.blocked || est.below_minimum !== null || !!meta!.closed;
    out.push(go);
    return out;
}

function cartSheet(flash?: number): HTMLElement {
    const est = estimate(null);
    if (est.lines.length === 0) {
        return sheet('drawer', 'Tu carrito', [el('p', { cls: 's-empty', text: 'Tu carrito está vacío.' })], [actionButton('Ver productos', closeOverlay, 's-btn s-ghost')], 'shop-cart');
    }
    const added = flash !== undefined ? buyable.get(flash) : undefined;
    const body: Node[] = [];
    if (added) body.push(el('div', { cls: 's-added', role: 'status', 'data-testid': 'shop-added' }, [icon('check'), el('span', { text: `Agregaste «${added.title}» al carrito` })]));
    body.push(...est.lines.map((l) => cartLine(l, flash)));
    const keep = actionButton('Seguir comprando', closeOverlay, 's-link s-keep', 'shop-keep-shopping');
    return sheet('drawer', `Tu carrito (${cartCount()})`, body, [...cartSummary(est), keep], 'shop-cart');
}

// ───────────────────────────── La página del carrito (v0.1.421) ─────────────────────────────

let cartPageEl: HTMLElement | null = null;

function cartView(): HTMLElement[] {
    cartPageEl = el('section', { cls: 's-cartpage', 'data-testid': 'shop-cart-page' });
    paintCartPage();
    return [cartPageEl];
}

function paintCartPage(): void {
    if (!cartPageEl || view !== 'cart') return;
    const est = estimate(null);
    const back = el('button', { type: 'button', cls: 's-link s-back' }, [icon('back'), 'Seguir comprando']);
    back.addEventListener('click', () => goCatalog());
    const head = el('div', { cls: 's-cp-head' }, [el('h1', { text: est.lines.length > 0 ? `Tu carrito (${cartCount()})` : 'Tu carrito' }), back]);
    if (est.lines.length === 0) {
        cartPageEl.replaceChildren(head, el('div', { cls: 's-cp-empty' }, [el('p', { cls: 's-empty', text: 'Tu carrito está vacío.' }), actionButton('Ver productos', goCatalog, 's-btn s-ghost')]));
        return;
    }
    cartPageEl.replaceChildren(
        head,
        el('div', { cls: 's-cp' }, [el('div', { cls: 's-cp-lines' }, est.lines.map((l) => cartLine(l))), el('aside', { cls: 's-cp-sum' }, cartSummary(est))]),
    );
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

// ───────────────────────────── v0.1.425 — Estilos del pago ─────────────────────────────
//
// «Clásico» es el de siempre (no cambia nada). «Dos columnas», «Por pasos» y
// «Una columna» son páginas limpias: el formulario por un lado y el pedido con
// sus fotos por otro (en el celular, una barra que se despliega arriba).

const CO_DEFAULT: ShopDesignCheckout = { layout: 'classic', header: 'minimal', labels: 'above', thumbnails: true, summary_open: false, trust: true, summary_color: null };
function coCfg(): ShopDesignCheckout {
    return { ...CO_DEFAULT, ...(meta?.design?.checkout ?? {}) };
}

type CxStepId = 'you' | 'delivery' | 'pay';
interface CxStep {
    id: CxStepId;
    crumb: string;
    box: HTMLElement;
}
/** ¿El pago de ahora usa un estilo nuevo? (lo arma `cxFrame`; `paint` lo lee). */
let cxActive = false;
/** Sin el encabezado de la tienda (sólo el logo). */
let cxBare = false;
/** Las líneas del pedido con sus fotos (en los estilos nuevos). */
let cxItemsEl: HTMLElement | null = null;
/** El total en la barra del resumen (celular y «Una columna»). */
let cxToggleTotal: HTMLElement | null = null;
let cxSteps: CxStep[] = [];
let cxStep = 0;
let cxCrumbs: HTMLElement | null = null;
let cxReview: HTMLElement | null = null;
/** El anti-robots de «Por pasos» se monta al llegar al pago (en un paso oculto no se dibuja). */
let cxCaptchaPending = false;
/** Lo que valida cada paso antes de seguir. */
const CX_STEP_KEYS: Record<CxStepId, readonly string[]> = { you: ['name', 'email', 'phone', 'document'], delivery: ['zone', 'address', 'city'], pay: [] };

function cxReset(): void {
    cxActive = false;
    cxBare = false;
    cxItemsEl = null;
    cxToggleTotal = null;
    cxSteps = [];
    cxStep = 0;
    cxCrumbs = null;
    cxReview = null;
    cxCaptchaPending = false;
}

/** El encabezado del pago: el logo (lleva al inicio) y la bolsa (vuelve al carrito o a la tienda). */
function cxHead(home: { label: string; go: () => void }): HTMLElement {
    const m = meta!;
    const brand = el('button', { cls: 's-cx-brand', type: 'button', 'aria-label': 'Ir al inicio de la tienda' }, [
        m.logo_url ? el('img', { src: m.logo_url, alt: m.company || m.title }) : null,
        !m.logo_url || m.title ? el('span', { text: m.title || m.company }) : null,
    ]);
    brand.addEventListener('click', () => goCatalog());
    const bag = el('button', { cls: 's-cx-bag', type: 'button', 'aria-label': home.label, title: home.label, 'data-testid': 'shop-cx-bag' }, [icon('bag')]);
    bag.addEventListener('click', home.go);
    // Las dos mitades siguen a las columnas de abajo: el logo sobre el formulario y la bolsa sobre el resumen.
    return el('header', { cls: 's-cx-head' }, [el('div', { cls: 's-cx-head-in' }, [el('div', { cls: 's-cx-head-l' }, [brand]), el('div', { cls: 's-cx-head-r' }, [bag])])]);
}

/** Una línea del pedido: la foto con la cantidad encima, el nombre, la opción y el subtotal. */
function cxItem(p: ShopPurchasable | undefined, fallback: string, qty: number, amount: string, extra: string, problem: string | null, unit?: ShopUnit): HTMLElement {
    const thumbs = coCfg().thumbnails;
    const img = p?.images[0];
    const name = p?.variant ? p.product.title : p?.title || fallback;
    // v0.1.429 — Con unidad, la cantidad va en palabras («3 horas»).
    const variant = [p?.variant?.label ?? '', unit ? qtyText(qty, unit) : ''].filter(Boolean).join(' · ');
    return el('div', { cls: 's-cx-item', 'data-testid': 'shop-cx-item' }, [
        thumbs
            ? el('div', { cls: 's-cx-thumb' }, [
                  img ? el('img', { src: imgUrl(img, 160), alt: '' }) : el('div', { cls: 's-noimg' }, [icon('image')]),
                  unit ? null : el('span', { cls: 's-cx-qty', 'data-testid': 'shop-cx-qty', 'aria-label': `Cantidad: ${qtyNum(qty)}`, text: qtyNum(qty) }),
              ])
            : null,
        el('div', { cls: 's-cx-it' }, [
            el('div', { cls: 's-cx-it-n', text: thumbs || unit ? name : `${qtyNum(qty)} × ${name}` }),
            variant ? el('div', { cls: 's-cx-it-v', text: variant }) : null,
            extra ? el('div', { cls: 's-cx-it-v', text: extra }) : null,
            problem ? el('div', { cls: 's-line-err', text: problem }) : null,
        ]),
        el('div', { cls: 's-cx-it-p', text: amount }),
    ]);
}

/** Términos, cambios y quién vende, al pie del pago (sin el pie de la tienda). */
function cxFoot(): HTMLElement {
    const b = (label: string, focus: 'terms' | 'returns' | 'seller'): HTMLElement => {
        const x = el('button', { type: 'button', cls: 's-link', text: label });
        x.addEventListener('click', () => openOverlay({ kind: 'policies', focus }));
        return x;
    };
    return el('nav', { cls: 's-cx-foot', 'aria-label': 'Políticas de la tienda' }, [b('Términos y condiciones', 'terms'), b('Cambios y devoluciones', 'returns'), b('Quién vende', 'seller')]);
}

interface CxParts {
    testid: string;
    title: string;
    home: { label: string; go: () => void };
    /** Las secciones de cada paso (en «Dos columnas» y «Una columna» van todas seguidas). */
    steps: Array<{ id: CxStepId; crumb: string; nodes: Array<HTMLElement | null> }>;
    form: HTMLFormElement;
    /** Avisos, términos, el botón de pagar y quién vende: al final (en «Por pasos», en el último paso). */
    tail: Array<HTMLElement | null>;
    /** El pedido: las líneas con fotos, el cupón y los totales. */
    side: Array<HTMLElement | null>;
}

/** Arma el pago con el estilo elegido (no el clásico). */
function cxFrame(parts: CxParts): HTMLElement {
    const cfg = coCfg();
    const layout = cfg.layout;
    cxActive = true;
    cxBare = cfg.header === 'minimal';
    const closed = meta!.closed ? el('div', { cls: 's-closed', text: meta!.closed }) : null;

    // El resumen: en la computadora a un lado; en el celular (y en «Una columna»), una barra que se despliega.
    const wide = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1000px)').matches;
    const open = cfg.summary_open || (layout === 'single' && wide);
    cxToggleTotal = el('span', { cls: 's-cx-toggle-t', 'data-testid': 'shop-cx-toggle-total' });
    const lbl = el('span', { text: open ? 'Ocultar el resumen del pedido' : 'Ver el resumen del pedido' });
    const chev = icon('chev');
    chev.classList.add('s-cx-chev');
    const toggle = el('button', { type: 'button', cls: 's-cx-toggle', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'cx_sum', 'data-testid': 'shop-cx-toggle' }, [icon('cart'), lbl, chev, cxToggleTotal]);
    const side = el('aside', { cls: `s-cx-side${open ? ' s-cx-open' : ''}`, 'aria-label': 'Resumen del pedido', 'data-testid': 'shop-cx-side' }, [toggle, el('div', { cls: 's-cx-side-in', id: 'cx_sum' }, parts.side)]);
    toggle.addEventListener('click', () => {
        const now = !side.classList.contains('s-cx-open');
        side.classList.toggle('s-cx-open', now);
        toggle.setAttribute('aria-expanded', now ? 'true' : 'false');
        lbl.textContent = now ? 'Ocultar el resumen del pedido' : 'Ver el resumen del pedido';
    });

    const back = el('button', { type: 'button', cls: 's-link s-cx-back', 'data-testid': 'shop-cx-back' }, [icon('back'), parts.home.label]);
    back.addEventListener('click', parts.home.go);
    // «Compra segura» va justo debajo del botón de pagar.
    const trust = cfg.trust ? el('p', { cls: 's-cx-trust', 'data-testid': 'shop-cx-trust' }, [icon('lock'), el('span', { text: 'Compra segura: tus datos viajan cifrados.' })]) : null;
    const at = submitBtn ? parts.tail.indexOf(submitBtn) : -1;
    const tail = at >= 0 ? [...parts.tail.slice(0, at + 1), trust, ...parts.tail.slice(at + 1)] : [...parts.tail, trust];
    const pay = el('div', { cls: 's-cx-pay' }, tail);

    let mainNodes: Array<HTMLElement | null>;
    if (layout === 'steps') {
        cxCrumbs = el('nav', { cls: 's-cx-crumbs', 'aria-label': 'Pasos de la compra', 'data-testid': 'shop-cx-crumbs' });
        cxReview = el('div', { cls: 's-cx-review', 'data-testid': 'shop-cx-review', hidden: true });
        cxSteps = parts.steps.map((st, i) => {
            const last = i === parts.steps.length - 1;
            const box = el('div', { cls: 's-cx-stepbox', 'data-step': st.id, 'data-testid': `shop-cx-step-${st.id}` }, st.nodes);
            const prev = i === 0 ? null : parts.steps[i - 1]!;
            const backLbl = prev ? (prev.id === 'you' ? 'Volver a tus datos' : 'Volver a la entrega') : parts.home.label;
            const backBtn = el('button', { type: 'button', cls: 's-link s-cx-back', 'data-testid': `shop-cx-prev-${st.id}` }, [icon('back'), backLbl]);
            backBtn.addEventListener('click', () => (i === 0 ? parts.home.go() : cxGo(i - 1)));
            if (last) {
                box.append(pay, el('div', { cls: 's-cx-nav s-cx-nav-end' }, [backBtn]));
            } else {
                const next = parts.steps[i + 1]!;
                const go = actionButton(next.id === 'pay' ? 'Continuar con el pago' : 'Continuar con la entrega', () => cxNext(i), 's-btn', `shop-cx-next-${st.id}`);
                box.append(el('div', { cls: 's-cx-nav' }, [backBtn, go]));
            }
            parts.form.append(box);
            return { id: st.id, crumb: st.crumb, box };
        });
        mainNodes = [cxCrumbs, closed, cxReview, parts.form];
    } else {
        for (const st of parts.steps) for (const n of st.nodes) if (n) parts.form.append(n);
        mainNodes = layout === 'single' ? [closed, parts.form, pay] : [back, closed, parts.form, pay];
    }
    const foot = cxBare ? cxFoot() : null;
    const cls = `s-cx s-cx-${layout}${cfg.labels === 'inside' ? ' s-lbl-in' : ''}${cxBare ? '' : ' s-cx-hstore'}`;
    const head = cxBare ? cxHead(parts.home) : null;
    if (layout === 'single') {
        return el('div', { cls, 'data-testid': parts.testid }, [
            head,
            el('div', { cls: 's-cx-one' }, [el('div', { cls: 's-cx-one-top' }, [back, el('h1', { cls: 's-cx-title', text: parts.title })]), side, el('div', { cls: 's-cx-card' }, mainNodes), foot]),
        ]);
    }
    return el('div', { cls, 'data-testid': parts.testid }, [
        head,
        el('div', { cls: 's-cx-grid' }, [el('div', { cls: 's-cx-main' }, [el('div', { cls: 's-cx-main-in' }, [el('h1', { cls: 's-sr', text: parts.title }), ...mainNodes, foot])]), side]),
    ]);
}

/** «Por pasos»: mostrar un paso (y lo ya llenado arriba). */
function cxGo(i: number): void {
    if (cxSteps.length === 0) return;
    cxStep = Math.max(0, Math.min(i, cxSteps.length - 1));
    paintCxSteps();
    window.scrollTo({ top: 0 });
}

/** «Por pasos»: seguir si lo de este paso está bien (en la vista previa, siempre). */
function cxNext(i: number): void {
    const st = cxSteps[i];
    if (!st) return;
    if (!BOOT.preview && !validate(new Set(CX_STEP_KEYS[st.id]))) return;
    cxGo(i + 1);
}

/** Si lo que falta está en otro paso, ir ahí (al pagar se revisa todo). */
function cxReveal(node: Element | null): void {
    if (!node || cxSteps.length === 0) return;
    const i = cxSteps.findIndex((s) => s.box.contains(node));
    if (i >= 0 && i !== cxStep) {
        cxStep = i;
        paintCxSteps();
    }
}

function paintCxSteps(): void {
    if (cxSteps.length === 0) return;
    cxSteps.forEach((s, i) => {
        s.box.hidden = i !== cxStep;
    });
    if (cxCaptchaPending && captchaBox && cxSteps[cxStep]?.box.contains(captchaBox)) {
        cxCaptchaPending = false;
        mountCaptcha();
    }
    if (cxCrumbs) {
        const kids: Node[] = [];
        const first = el('button', { type: 'button', text: subscribingId !== null ? 'Tienda' : 'Carrito' });
        first.addEventListener('click', subscribingId !== null ? goCatalog : goCart);
        kids.push(first);
        cxSteps.forEach((s, i) => {
            kids.push(icon('next'));
            if (i < cxStep) {
                const b = el('button', { type: 'button', text: s.crumb, 'data-testid': `shop-cx-crumb-${s.id}` });
                b.addEventListener('click', () => cxGo(i));
                kids.push(b);
            } else kids.push(el('span', { text: s.crumb, 'aria-current': i === cxStep ? 'step' : undefined, 'data-testid': `shop-cx-crumb-${s.id}` }));
        });
        cxCrumbs.replaceChildren(...kids);
    }
    if (cxReview) {
        const rows: HTMLElement[] = [];
        const v = (k: string): string => (inputs[k]?.value ?? '').trim();
        cxSteps.forEach((s, i) => {
            if (i >= cxStep || s.id === 'pay') return;
            let label = '';
            let value = '';
            if (s.id === 'you') {
                label = 'Contacto';
                value = [v('name'), v('email'), v('phone')].filter(Boolean).join(' · ');
            } else if (subscribingId !== null) {
                label = 'Enviar a';
                value = [v('address'), v('city')].filter(Boolean).join(', ');
            } else {
                const d = meta?.delivery.find((x) => x.id === co.deliveryId);
                const z = d?.zones.find((x) => x.id === co.zoneId);
                label = 'Entrega';
                value = [d ? `${d.name}${z ? ` · ${z.name}` : ''}` : '', needsAddress() ? [v('address'), v('city')].filter(Boolean).join(', ') : ''].filter(Boolean).join(' — ');
            }
            const change = el('button', { type: 'button', cls: 's-link', text: 'Cambiar', 'data-testid': `shop-cx-change-${s.id}` });
            change.addEventListener('click', () => cxGo(i));
            rows.push(el('div', { cls: 's-cx-rv' }, [el('span', { cls: 's-cx-rv-l', text: label }), el('span', { cls: 's-cx-rv-v', text: value || '—' }), change]));
        });
        cxReview.replaceChildren(...rows);
        cxReview.hidden = rows.length === 0;
    }
}

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
    const wrap = el('div', { cls: `s-f${opts.wide ? ' s-wide' : ''}` }, [el('label', { for: id, text: opts.required ? `${label} *` : label }), input, err]);
    // v0.1.425 — Con los nombres adentro del campo, se achican cuando ya hay algo escrito.
    const sync = (): void => {
        wrap.classList.toggle('s-has', input.value !== '');
    };
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    sync();
    return wrap;
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
        legal.push(pv(el('label', { cls: 's-check', for: 'c_terms' }, [termsCb, el('span', {}, ['Acepto ', link, ' y la política de cambios y devoluciones.'])]), 'cx-terms'), errs.terms);
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
    if (m.captcha && !DRY) {
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
    cxReset();
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
    const you = pv(el('section', { cls: 's-sec' }, [
        el('h3', { text: 'Tus datos' }),
        el('div', { cls: 's-fields' }, [
            field('name', 'Nombre completo', { autocomplete: 'name', required: true, wide: true }),
            field('email', 'Correo', { type: 'email', autocomplete: 'email', required: true }),
            field('phone', 'Celular', { type: 'tel', autocomplete: 'tel', inputmode: 'tel' }),
            m.checkout.ask_document !== 'hidden' ? field('document', 'Cédula o NIT', { required: m.checkout.ask_document === 'required', inputmode: 'numeric' }) : null,
        ].filter((x): x is HTMLElement => x !== null)),
    ]), 'cx-you');
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
    submitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        void placeOrder();
    });
    const seller = el('p', { cls: 's-line-p', style: 'margin:10px 0 0;text-align:center', text: `Vende: ${m.seller.legal_name || m.company}` });
    let layout: HTMLElement;
    if (coCfg().layout !== 'classic') {
        cxItemsEl = el('div', { cls: 's-cx-items', 'data-testid': 'shop-cx-items' });
        const form = el('form', { novalidate: true, cls: 's-cx-form' }, [hp]);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            void placeOrder();
        });
        layout = cxFrame({
            testid: 'shop-subscribe-view',
            title: 'Suscribirme',
            home: { label: 'Volver a la tienda', go: goCatalog },
            steps: addrSec
                ? [
                      { id: 'you', crumb: 'Datos', nodes: [you] },
                      { id: 'delivery', crumb: 'Entrega', nodes: [addrSec] },
                      { id: 'pay', crumb: 'Pago', nodes: [paySec, notesSec] },
                  ]
                : [
                      { id: 'you', crumb: 'Datos', nodes: [you] },
                      { id: 'pay', crumb: 'Pago', nodes: [paySec, notesSec] },
                  ],
            form,
            tail: [alertEl, ...legal, submitBtn, seller],
            side: [cxItemsEl, summaryEl],
        });
    } else {
        const form = el('form', { novalidate: true }, [you, addrSec, paySec, notesSec, hp]);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            void placeOrder();
        });
        const aside = el('aside', { cls: 's-panel s-co-aside' }, [el('h3', { text: 'Resumen' }), summaryEl, alertEl, ...legal, submitBtn, seller]);
        layout = el('div', { cls: `s-checkout${coCfg().labels === 'inside' ? ' s-lbl-in' : ''}`, 'data-testid': 'shop-subscribe-view' }, [
            el('div', {}, [back, el('h1', { text: 'Suscribirme' }), m.closed ? el('div', { cls: 's-closed', text: m.closed }) : null, form]),
            aside,
        ]);
    }
    paintSubSummary();
    paintSubmit();
    ensureStamp();
    startCxCaptcha();
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
    const rows: HTMLElement[] = [];
    // v0.1.425 — En los estilos nuevos el producto va con su foto (arriba de los totales).
    if (cxItemsEl) cxItemsEl.replaceChildren(cxItem(item, item.title, 1, money(price), '', null));
    else rows.push(el('div', {}, [el('span', { text: item.title }), el('span', { text: money(price) })]));
    rows.push(el('div', {}, [el('span', { text: 'Se cobra' }), el('span', { 'data-testid': 'shop-sub-frequency', text: freq })]));
    if (plan.trial_days > 0) rows.push(el('div', {}, [el('span', { text: 'Prueba gratis' }), el('span', { text: plan.trial_days === 1 ? '1 día' : `${plan.trial_days} días` })]));
    if (plan.cycles !== null && plan.cycles > 0) rows.push(el('div', {}, [el('span', { text: 'Cobros' }), el('span', { text: String(plan.cycles) })]));
    rows.push(el('div', {}, [el('span', { text: 'Con' }), el('span', { text: providerName(plan.provider) })]));
    rows.push(el('div', { cls: 's-tot' }, [el('span', { text: `Total ${freq}` }), el('span', { 'data-testid': 'shop-total', text: money(price) })]));
    summaryEl.replaceChildren(...rows);
    if (cxToggleTotal) cxToggleTotal.textContent = money(price);
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
    cxReset();
    for (const k of Object.keys(inputs)) delete inputs[k];
    if (!co.deliveryId || !m.delivery.some((d) => d.id === co.deliveryId)) co.deliveryId = m.delivery[0]?.id ?? null;
    if (!co.payment || !m.payments.some((p) => p.method === co.payment)) co.payment = m.payments[0]?.method ?? null;

    const back = el('button', { type: 'button', cls: 's-back' }, [icon('back'), 'Seguir comprando']);
    back.addEventListener('click', goCatalog);

    const you = pv(el('section', { cls: 's-sec' }, [
        el('h3', { text: 'Tus datos' }),
        el('div', { cls: 's-fields' }, [
            field('name', 'Nombre completo', { autocomplete: 'name', required: true, wide: true }),
            field('email', 'Correo', { type: 'email', autocomplete: 'email', required: true }),
            field('phone', 'Celular', { type: 'tel', autocomplete: 'tel', inputmode: 'tel' }),
            m.checkout.ask_document !== 'hidden' ? field('document', 'Cédula o NIT', { required: m.checkout.ask_document === 'required', inputmode: 'numeric' }) : null,
        ].filter((x): x is HTMLElement => x !== null)),
    ]), 'cx-you');

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
    const deliverySec = pv(el('section', { cls: 's-sec' }, [el('h3', { text: 'Entrega' }), deliveryOpts, zoneBox, addressBox]), 'cx-delivery');
    deliverySecEl = deliverySec;
    // v0.1.416 — Todo para descargar: no se pide entrega ni dirección.
    digitalNoteEl = pv(el('section', { cls: 's-sec', 'data-testid': 'shop-digital-note' }, [
        el('h3', { text: 'Entrega' }),
        el('div', { cls: 's-kind-box' }, [icon('download'), el('span', { text: `Tu pedido se descarga: no hay envío. ${downloadsText()} Te mandamos los enlaces por correo.` })]),
    ]), 'cx-delivery');
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
    const paySec = pv(el('section', { cls: 's-sec' }, [el('h3', { text: 'Pago' }), payOpts]), 'cx-pay');
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
    couponBox = m.coupons ? el('div', { cls: 's-coupon', 'data-testid': 'shop-coupon-box' }) : null;
    submitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        void placeOrder();
    });
    const seller = el('p', { cls: 's-line-p', style: 'margin:10px 0 0;text-align:center', text: `Vende: ${m.seller.legal_name || m.company}` });

    let layout: HTMLElement;
    if (coCfg().layout !== 'classic') {
        // v0.1.425 — Los estilos nuevos: el pedido con sus fotos aparte y el cupón a la vista.
        cxItemsEl = el('div', { cls: 's-cx-items', 'data-testid': 'shop-cx-items' });
        if (couponBox) couponOpen = true;
        const form = el('form', { novalidate: true, cls: 's-cx-form' }, [hp]);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            void placeOrder();
        });
        const steps: CxParts['steps'] = digitalCart()
            ? [
                  { id: 'you', crumb: 'Datos', nodes: [you] },
                  { id: 'pay', crumb: 'Pago', nodes: [deliverySec, digitalNoteEl, paySec, freeNoteEl, notesSec] },
              ]
            : [
                  { id: 'you', crumb: 'Datos', nodes: [you] },
                  { id: 'delivery', crumb: 'Entrega', nodes: [deliverySec, digitalNoteEl] },
                  { id: 'pay', crumb: 'Pago', nodes: [paySec, freeNoteEl, notesSec] },
              ];
        layout = cxFrame({
            testid: 'shop-checkout-view',
            title: 'Finalizar compra',
            home: { label: 'Volver al carrito', go: goCart },
            steps,
            form,
            tail: [alertEl, ...legal, submitBtn, seller],
            side: [cxItemsEl, couponBox, summaryEl],
        });
        paintModes();
    } else {
        const form = el('form', { novalidate: true }, [you, deliverySec, digitalNoteEl, paySec, freeNoteEl, notesSec, hp]);
        paintModes();
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            void placeOrder();
        });
        const aside = el('aside', { cls: 's-panel s-co-aside' }, [el('h3', { text: 'Resumen' }), summaryEl, couponBox, alertEl, ...legal, submitBtn, seller]);
        layout = el('div', { cls: `s-checkout${coCfg().labels === 'inside' ? ' s-lbl-in' : ''}`, 'data-testid': 'shop-checkout-view' }, [
            el('div', {}, [back, el('h1', { text: 'Finalizar compra' }), m.closed ? el('div', { cls: 's-closed', text: m.closed }) : null, form]),
            aside,
        ]);
    }
    paintCoupon();
    paintSummary();
    paintSubmit();
    // v0.1.415 — Un cupón de la sesión (escrito antes o llegado por `?cupon=`) se aplica solo.
    const pending = sessionGet(COUPON_KEY);
    if (m.coupons && pending && !co.couponRule && !BOOT.preview) void applyCoupon(pending, true);
    else scheduleQuote(0);
    ensureStamp();
    startCxCaptcha();
    return [layout];
}

/** El anti-robots: ya, o (en «Por pasos») cuando se llega al paso del pago. */
function startCxCaptcha(): void {
    if (cxSteps.length > 0) {
        cxCaptchaPending = !!captchaBox;
        paintCxSteps();
    } else if (captchaBox) mountCaptcha();
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
    const items: HTMLElement[] = [];
    for (const l of est.lines) {
        const p = buyable.get(l.product_id);
        const problem = shopLineProblemText(l, meta.number_format);
        const unit = l.unit ?? p?.unit;
        // v0.1.425 — En los estilos nuevos cada línea va con su foto y la cantidad encima.
        if (cxItemsEl) {
            const each = unit ? `${money(l.unit_price)}${shopPerUnit(unit)}` : l.qty > 1 ? `${money(l.unit_price)} c/u` : '';
            items.push(cxItem(p, l.title || 'Producto', l.qty, money(l.subtotal), each, problem, unit));
            continue;
        }
        rows.push(
            el('div', {}, [
                el('span', {}, [shopLineText({ qty: l.qty, title: p?.title || l.title || 'Producto', unit }, meta.number_format), problem ? el('span', { cls: 's-line-err', style: 'display:block', text: problem }) : null]),
                el('span', { text: money(l.subtotal) }),
            ]),
        );
    }
    if (cxItemsEl) cxItemsEl.replaceChildren(...items);
    rows.push(el('div', cxItemsEl ? {} : { style: 'padding-top:6px;border-top:1px solid var(--s-line);margin-top:4px' }, [el('span', { text: 'Subtotal' }), el('span', { text: money(est.subtotal) })]));
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
    rows.push(
        el('div', { cls: 's-tot' }, [
            el('span', { text: 'Total' }),
            cxItemsEl
                ? el('span', { cls: 's-cx-total' }, [el('small', { text: meta.currency }), el('span', { 'data-testid': 'shop-total', text: money(est.total) })])
                : el('span', { 'data-testid': 'shop-total', text: money(est.total) }),
        ]),
    );
    summaryEl.replaceChildren(...rows);
    if (cxToggleTotal) cxToggleTotal.textContent = money(est.total);
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
    if (DRY || co.stamp) return;
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

/** Revisa lo escrito. `only` (v0.1.425, «Por pasos»): sólo esos campos (sin términos ni anti-robots). */
function validate(only?: ReadonlySet<string>): boolean {
    const m = meta!;
    let firstBad: HTMLElement | null = null;
    const want = (key: string): boolean => !only || only.has(key);
    const bad = (key: string, text: string): void => {
        if (!want(key)) return;
        setErr(key, text);
        if (!firstBad) firstBad = inputs[key] ?? errs[key] ?? null;
    };
    for (const k of Object.keys(errs)) if (want(k)) setErr(k, '');
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
        // v0.1.425 — Si lo que falta está en otro paso, se vuelve a ese paso.
        cxReveal(firstBad);
        (firstBad as HTMLElement).focus?.();
        (firstBad as HTMLElement).scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        return false;
    }
    if (only) return true;
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
    if (DEMO) {
        showServerAlert('Es una demostración: en tu sitio, aquí se hace el pedido. No se hizo ningún pedido.');
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
            origin: { page: location.href.slice(0, 2000), referrer: document.referrer.slice(0, 2000), src: sourceKey(), attribution: attributionNow() },
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
                const why = line ? shopLineProblemText(line, meta.number_format) : '';
                showServerAlert(why ? `${why} No se pudo hacer la suscripción.` : e.message || 'No se pudo hacer la suscripción. Vuelve a intentar.');
                return;
            }
            if (e.code === 'shop_cart_changed' && e.data?.cart) {
                co.serverCart = e.data.cart;
                for (const l of e.data.cart.lines) {
                    if (l.problem === 'unavailable' || l.problem === 'no_price' || l.problem === 'no_stock') cart.delete(l.product_id);
                    else if (l.problem === 'low_stock' && l.available !== null) cart.set(l.product_id, l.available);
                    // v0.1.429 — La cantidad que acepta el producto ahora (cambió el mínimo o el «de a cuánto»).
                    else if (l.adjusted && l.qty > 0) cart.set(l.product_id, l.qty);
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
    // v0.1.418 — La compra se mide al hacer el pedido o al volver de pagar (cuando ya cuenta).
    if (o.conversion && (opts.placed || opts.returned)) trackPurchase(o.conversion);
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
                el('div', { cls: 's-note s-good', 'data-testid': 'shop-paid', style: 'margin-top:18px' }, [
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
            el('span', { cls: 's-status s-neutral', text: `Pago: ${o.payment_status_label}` }),
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
              ...o.lines.map((l) => el('div', {}, [el('span', { text: shopLineText(l, m.number_format) }), el('span', { text: fmt(l.subtotal) })])),
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
    const box = (tone: string, title: string, text: string, extra: HTMLElement | null = null): HTMLElement =>
        el('div', { cls: `s-note${tone ? ` ${tone}` : ''}`, 'data-testid': 'shop-subscription', 'data-state': sub.state, style: 'margin-top:18px' }, [el('strong', { style: 'display:block;margin-bottom:2px', text: title }), text, extra]);
    if (sub.state === 'active') {
        const next = sub.next_charge ? longDate(`${sub.next_charge}T12:00:00`) : '';
        return box('s-good', '¡Tu suscripción está activa!', `Se cobra ${charge} con tu tarjeta en ${prov}.${next ? ` Próximo cobro: ${next}.` : ''}`);
    }
    if (sub.state === 'failed') {
        return box('s-caution', sub.label || 'Un cobro no pasó', `No pudimos hacer el último cobro de ${charge} con tu tarjeta. ${prov} lo vuelve a intentar; si cambiaste de tarjeta, escríbenos.`);
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
            el('p', { style: 'margin:0 0 14px;color:var(--s-text2)', text: 'Escribe el correo con el que compraste y te mandamos un enlace para ver tus pedidos, cómo van y tus descargas.' }),
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
    if (DRY) {
        myReq.error = BOOT.preview ? 'Es una vista previa: en la tienda publicada aquí llega el enlace al correo.' : 'Es una demostración: en tu sitio, aquí llega el enlace al correo.';
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
                        el('span', { cls: 's-status s-neutral', text: `Pago: ${o.payment_status_label}` }),
                        // v0.1.417 — «Suscripción cada mes · Al día».
                        o.subscription ? el('span', { cls: 's-status s-sub', 'data-testid': 'shop-my-subscription', text: o.subscription }) : null,
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
    // v0.1.425 — Un pago con estilo nuevo ocupa toda la página (y, con «sólo el logo», sin el encabezado de la tienda).
    const cx = view === 'checkout' && cxActive;
    if (cx && cxBare) {
        app.replaceChildren(el('main', {}, main));
        paintCartButtons();
        return;
    }
    const wrap = view === 'order' || view === 'my' || cx ? el('div', {}, main) : el('div', { cls: 's-wrap' }, main);
    const kids: HTMLElement[] = [header(), el('main', {}, [wrap]), footer()];
    if (view === 'catalog') {
        const b = actionButton('', () => openCart(), 's-btn');
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

/** v0.1.421 — La página del carrito. */
function goCart(): void {
    view = 'cart';
    subscribingId = null;
    paint(cartView());
    window.scrollTo({ top: 0 });
}

function goCheckout(): void {
    view = 'checkout';
    subscribingId = null;
    trackCheckout();
    {
        const items = [...cart].map(([id, qty]) => ecoItem(id, qty)).filter((x): x is EcommerceItem => x !== null);
        ecommerce('begin_checkout', { value: items.reduce((a, x) => a + x.price * x.quantity, 0), items });
    }
    co.serverCart = null;
    paint(checkoutView());
    window.scrollTo({ top: 0 });
}

/** v0.1.417 — Suscribirse a un producto (o a una de sus variantes). */
function goSubscribe(id: number): void {
    view = 'checkout';
    subscribingId = id;
    trackCheckout();
    {
        const eco = ecoItem(id, 1);
        if (eco) ecommerce('begin_checkout', { value: eco.price, items: [eco] });
    }
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
    if (myCode !== null && !DRY) {
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
    if (pedido && /^[A-Za-z0-9_-]{20,64}$/.test(pedido) && !DRY) {
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
    trackVisit();
    // v0.1.421 — `?comprar=12:2,15` (lo agrega y va al pago) o `?agregar=…`
    // (lo agrega y abre el carrito): un enlace desde un sitio, un anuncio o
    // un botón «Comprar». Se quitan de la dirección: recargar no lo repite.
    if ((qs.has('comprar') || qs.has('agregar')) && !BOOT.preview) {
        const buying = qs.has('comprar');
        const items = parseShopCartParam(qs.get(buying ? 'comprar' : 'agregar'), qs.get('cantidad'));
        const url = new URL(location.href);
        for (const k of ['comprar', 'agregar', 'cantidad']) url.searchParams.delete(k);
        history.replaceState(null, '', url.pathname + url.search);
        if (handleCartLink(items, buying)) return;
    }
    if (view === 'checkout' && subscribingId !== null && subscribable.has(subscribingId)) goSubscribe(subscribingId);
    else if (view === 'checkout') goCheckout();
    else if (view === 'cart') goCart();
    else goCatalog();
    // v0.1.419 — `?producto=<id>` (el botón «Comprar» de un producto, o su enlace):
    // la tienda abre ya en la ficha de ese producto. Se quita de la dirección
    // para que cerrar la ficha y recargar no la vuelva a abrir.
    // v0.1.423 — Llegó a la dirección de un producto (`/p/…`): abre en su ficha.
    if (SITE && SITE.product_id !== null && byId.has(SITE.product_id) && view === 'catalog') {
        openOverlay({ kind: 'product', id: SITE.product_id, image: 0 });
    }
    const wanted = Number(qs.get('producto'));
    if (qs.has('producto') && !BOOT.preview) {
        const url = new URL(location.href);
        url.searchParams.delete('producto');
        history.replaceState(null, '', url.pathname + url.search);
        if (Number.isInteger(wanted) && wanted > 0 && byId.has(wanted)) openOverlay({ kind: 'product', id: wanted, image: 0 });
    }
}

/**
 * v0.1.421 — Arma el carrito con un enlace. Lo que se compra directo (un
 * producto o una variante) queda con esa cantidad; un producto con opciones
 * o un servicio abre su ficha; una suscripción va a suscribirse. Devuelve
 * true si ya navegó.
 */
function handleCartLink(items: Array<{ id: number; qty: number }>, buying: boolean): boolean {
    if (!meta || items.length === 0) return false;
    let added = 0;
    let lastAdded: number | null = null;
    let open: number | null = null;
    let subscribe: number | null = null;
    const problems: string[] = [];
    for (const { id, qty } of items) {
        const item = buyable.get(id);
        if (item) {
            const cap = maxFor(item);
            if (item.price === null || cap === 0) {
                problems.push(`«${item.title}» está agotado.`);
                continue;
            }
            // v0.1.429 — La cantidad válida más cercana (mínimo, «de a cuánto», stock).
            setQty(id, Math.max(cart.get(id) ?? 0, Math.min(qty, cap)));
            added++;
            lastAdded = id;
            continue;
        }
        const p = byId.get(id);
        if (!p) {
            problems.push('Uno de los productos del enlace ya no está en la tienda.');
            continue;
        }
        if (isSubscription(p) && !hasVariants(p) && subscribable.has(p.id)) subscribe ??= p.id;
        else open ??= p.id;
    }
    if (meta.closed) {
        goCatalog();
        return true;
    }
    if (problems.length > 0) window.setTimeout(() => toast(problems[0]!), 400);
    if (added > 0 && buying) {
        goCheckout();
        return true;
    }
    if (subscribe !== null && added === 0 && buying) {
        goSubscribe(subscribe);
        return true;
    }
    goCatalog();
    if (added > 0) {
        bumpCart();
        if (meta.display.after_add === 'cart') goCart();
        else openOverlay({ kind: 'cart', ...(lastAdded !== null && added === 1 ? { flash: lastAdded } : {}) });
    } else if (open !== null || subscribe !== null) openOverlay({ kind: 'product', id: (open ?? subscribe)!, image: 0 });
    return true;
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

// v0.1.419 — En la ventana o el panel de un sitio (embed.js): Escape con nada
// abierto adentro cierra la ventana, igual que la X.
if (window.self !== window.top && window.name === 'imagina-popup') {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) parent.postMessage({ type: 'imb-popup-close' }, '*');
    });
}

// Otra pestaña cambió el carrito: se sigue el mismo.
window.addEventListener('storage', (e) => {
    if (e.key !== CART_KEY) return;
    loadCart();
    paintCartButtons();
    for (const id of cardEls.keys()) paintCard(id);
    if (overlay?.kind === 'cart') renderOverlay();
    if (view === 'cart') paintCartPage();
    if (view === 'checkout') paintSummary();
});

// ── v0.1.428 — Vista previa del editor: tocar una parte lleva a su ajuste ──

/** Marca una parte (sólo en la vista previa del editor). */
function pv<T extends HTMLElement | null>(node: T, id: ShopEditTargetId): T {
    if (BOOT.preview && node) node.dataset.pv = id;
    return node;
}

/**
 * Las partes que se reconocen por su clase (lo más específico primero: una
 * parte ya marcada no se vuelve a marcar). Lo que no está aquí lo marca `pv()`
 * al crearlo.
 */
const PV_MARKS: ReadonlyArray<readonly [string, ShopEditTargetId]> = [
    ['.s-top .s-brand', 'logo'],
    ['.s-top .s-cart-btn', 'cart'],
    ['.s-top', 'header'],
    ['.s-hero', 'hero'],
    ['.s-tools', 'browse'],
    ['.s-cats', 'categories'],
    ['.s-card .s-media', 'image'],
    ['.s-card .s-title', 'name'],
    ['.s-card .s-price', 'price'],
    ['.s-card .s-card-sum', 'summary'],
    ['.s-card .s-stock', 'stock'],
    ['.s-card .s-act', 'button'],
    ['.s-card', 'card'],
    ['.s-grid', 'grid'],
    ['.s-foot .s-links', 'policies'],
    ['.s-foot', 'footer'],
    ['.s-pd .s-gal', 'gallery'],
    ['.s-pd .s-d-title', 'name'],
    ['.s-pd .s-d-price', 'price'],
    ['.s-pd .s-d-sum', 'summary'],
    ['.s-pd .s-d-stock', 'stock'],
    ['.s-pd .s-d-desc', 'description'],
    ['.s-pd .s-vopts', 'variants'],
    ['.s-pd .s-qty-rule', 'units'],
    ['.s-pd .s-qty-l', 'units'],
    ['.s-pd .s-d-buy', 'buy'],
    ['.s-pd .s-kind-note', 'delivery'],
    ['.s-sheet.s-pd', 'product'],
    ['.s-drawer', 'cart'],
    ['.s-cartpage', 'cart'],
    ['.s-coupon', 'cx-coupon'],
    ['.s-cx-side', 'cx-summary'],
    ['.s-co-aside .s-sum', 'cx-summary'],
    ['[data-testid="shop-checkout-view"]', 'checkout'],
];

/**
 * Lo que sigue funcionando normal aunque esté dentro de una parte: escribir en
 * los campos, elegir una opción, cerrar, pasar las fotos, la cantidad y los
 * pasos del pago (así se puede recorrer la tienda mientras se edita).
 */
const PV_PASS = 'input,select,textarea,option,label,.s-x,.s-gal-nav,.s-thumb,.s-step,.s-vopts button,.s-chip,.s-cx-nav,.s-cx-crumbs,.s-back,.s-cx-back,.s-cx-toggle,.s-pv-chip';

let pvOn = true;
let pvCur: HTMLElement | null = null;
const pvBox = el('div', { cls: 's-pv-box', 'aria-hidden': 'true' });
const pvChipText = el('span', { text: '' });
const pvChip = el('button', { type: 'button', cls: 's-pv-chip', 'data-testid': 'shop-pv-chip' }, [icon('edit'), pvChipText]);

function pvMark(): void {
    for (const [sel, id] of PV_MARKS) {
        for (const n of document.querySelectorAll<HTMLElement>(sel)) if (!n.dataset.pv) n.dataset.pv = id;
    }
}

function pvHide(): void {
    pvCur = null;
    pvBox.style.display = 'none';
    pvChip.style.display = 'none';
}

function pvPlace(): void {
    if (!pvCur || !pvCur.isConnected) return pvHide();
    const r = pvCur.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return pvHide();
    pvBox.style.display = 'block';
    pvBox.style.top = `${r.top - 2}px`;
    pvBox.style.left = `${r.left - 2}px`;
    pvBox.style.width = `${r.width + 4}px`;
    pvBox.style.height = `${r.height + 4}px`;
    pvChip.style.display = 'inline-flex';
    // La etiqueta arriba a la izquierda, por dentro si arriba no hay lugar.
    const top = r.top >= 30 ? r.top - 28 : Math.max(4, r.top + 4);
    pvChip.style.top = `${top}px`;
    pvChip.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - pvChip.offsetWidth - 4))}px`;
}

function pvShow(node: HTMLElement): void {
    const id = node.dataset.pv;
    if (!isShopEditTarget(id)) return pvHide();
    if (pvCur !== node) {
        pvCur = node;
        pvChipText.textContent = shopEditTargetText(id);
        pvChip.title = 'Ir a este ajuste';
    }
    pvPlace();
}

function pvSend(node: HTMLElement | null): void {
    const id = node?.dataset.pv;
    if (!isShopEditTarget(id)) return;
    window.parent?.postMessage({ type: 'imb-shop-edit', target: id }, location.origin);
}

function pvSetOn(on: boolean): void {
    pvOn = on;
    document.body.classList.toggle('s-pv-on', on);
    if (!on) pvHide();
}

if (BOOT.preview) {
    document.body.append(pvBox, pvChip);
    new MutationObserver(() => pvMark()).observe(document.body, { childList: true, subtree: true });
    pvSetOn(true);
    document.addEventListener('pointermove', (e) => {
        if (!pvOn || e.pointerType === 'touch') return;
        const t = e.target as Element | null;
        if (!t || pvChip.contains(t)) return;
        const part = t.closest<HTMLElement>('[data-pv]');
        if (part) pvShow(part);
        else pvHide();
    });
    document.documentElement.addEventListener('mouseleave', () => pvHide());
    window.addEventListener('scroll', () => pvPlace(), true);
    window.addEventListener('resize', () => pvPlace());
    pvChip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pvSend(pvCur);
    });
    // En la fase de captura: el clic en una parte no hace lo de siempre (abrir
    // el producto, agregar al carrito…): lleva a su ajuste.
    document.addEventListener(
        'click',
        (e) => {
            if (!pvOn) return;
            const t = e.target as Element | null;
            if (!t || pvChip.contains(t) || t.closest(PV_PASS)) return;
            const part = t.closest<HTMLElement>('[data-pv]');
            if (!part) return;
            e.preventDefault();
            e.stopPropagation();
            pvSend(part);
        },
        true,
    );
}

// Vista previa del editor: lo que se está editando llega por postMessage.
if (BOOT.preview) {
    window.addEventListener('message', (e) => {
        if (e.origin !== location.origin || e.source !== window.parent) return;
        const d = e.data as { type?: string; meta?: PublicShopMeta; products?: PublicShopProduct[]; view?: View | 'product'; scheme?: 'light' | 'dark' | null; edit?: boolean } | null;
        // v0.1.428 — «Tocar para editar» se prende y se apaga desde el editor.
        if (d && d.type === 'imb-shop-edit-mode') return pvSetOn(d.edit !== false);
        if (!d || d.type !== 'imb-shop-preview' || !d.meta) return;
        if (typeof d.edit === 'boolean') pvSetOn(d.edit);
        // v0.1.422 — «Automático»: la vista previa muestra claro u oscuro a pedido.
        if (d.scheme) document.documentElement.dataset.scheme = d.scheme;
        else delete document.documentElement.dataset.scheme;
        meta = d.meta;
        products = d.products ?? [];
        const first = [...shopPurchasables(products).keys()][0];
        if (d.view === 'checkout' && cart.size === 0 && first !== undefined) cart.set(first, 1);
        // v0.1.424 — «Producto»: el catálogo con la ficha abierta (la que se está viendo o el primero, mejor con foto).
        const showProduct = d.view === 'product';
        const keep = showProduct && overlay?.kind === 'product' && byIdOf(products).has(overlay.id) ? overlay : null;
        if (d.view) view = d.view === 'product' ? 'catalog' : d.view;
        if (keep) {
            // La misma ficha sigue abierta: se redibuja sin la animación de entrada.
            overlay = null;
            render();
            overlay = keep;
            renderOverlay();
            return;
        }
        overlay = null;
        ovRoot.replaceChildren();
        document.body.style.overflow = '';
        render();
        if (showProduct) {
            const pick = keep ?? (() => {
                const p = products.find((x) => x.images.length > 0 && x.price !== null) ?? products[0];
                return p ? ({ kind: 'product', id: p.id, image: 0 } as const) : null;
            })();
            if (pick) openOverlay(pick);
        }
    });
    window.parent?.postMessage({ type: 'imb-shop-ready' }, location.origin);
} else {
    loadCart();
}
render();
