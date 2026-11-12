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
import type { PublicShopMeta, PublicShopOrder, PublicShopProduct, PublicShopVariant, ShopCartResult, ShopPaymentMethod, ShopPurchasable } from '@imagina-base/shared';
import {
    SHOP_MAX_QTY,
    computeShopCart,
    formatShopMoney,
    pickShopVariant,
    shopLineProblemText,
    shopOptionValueState,
    shopPurchasables,
    shopVariantPriceRange,
} from '@imagina-base/shared/src/schemas/shop-logic';

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

let meta: PublicShopMeta | null = BOOT.meta;
let products: PublicShopProduct[] = BOOT.products ?? [];
let byId = new Map<number, PublicShopProduct>();
/** v0.1.414 — Lo que se pone en el carrito: productos simples y variantes. */
let buyable = new Map<number, ShopPurchasable>();

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

function estimate(deliveryId: string | null): ShopCartResult {
    const d = meta?.delivery.find((x) => x.id === deliveryId);
    return computeShopCart(
        [...cart].map(([product_id, qty]) => ({ product_id, qty })),
        buyable,
        { shipping: d?.price ?? 0, minOrder: meta?.checkout.min_order ?? null },
    );
}

// ───────────────────────────── Estado de la página ─────────────────────────────

type View = 'catalog' | 'checkout' | 'order';
type Overlay = { kind: 'product'; id: number; image: number; sel?: Array<string | null> } | { kind: 'cart' } | { kind: 'policies'; focus: 'terms' | 'returns' | 'seller' } | null;

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
    return el('header', { cls: 's-top' }, [el('div', { cls: 's-top-in' }, [brand, btn])]);
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
        if (m.display.hide_sold_out && p.stock !== null && p.stock <= 0) return false;
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
    if (p.stock === null) return null;
    if (p.stock <= 0) return 'Agotado';
    if (d.show_stock === 'always' || (d.show_stock === 'low' && p.stock <= d.low_stock_at)) {
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
        disabled: soldOut(p) || p.price === null || !!m.closed,
        text: soldOut(p) ? 'Agotado' : p.price === null ? 'No disponible' : 'Elegir opción',
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
    if (soldOut(p)) media.append(el('span', { cls: 's-tag', text: 'Agotado' }));
    else if (p.price !== null && p.compare_price !== null && p.compare_price > p.price) {
        const off = Math.round((1 - p.price / p.compare_price) * 100);
        if (off >= 1) media.append(el('span', { cls: 's-tag s-sale', text: `−${off}%` }));
    }
    media.addEventListener('click', () => openOverlay({ kind: 'product', id: p.id, image: 0 }));
    const title = el('button', { cls: 's-title', type: 'button', text: p.title });
    title.addEventListener('click', () => openOverlay({ kind: 'product', id: p.id, image: 0 }));
    const variable = hasVariants(p);
    const st = variable ? null : stockText(p);
    const actions = el('div', {}, [variable ? chooseControl(p) : addControl(p)]);
    const card = el('article', { cls: `s-card${soldOut(p) ? ' s-out' : ''}`, 'data-testid': 'shop-card', 'data-id': String(p.id) }, [
        media,
        el('div', { cls: 's-body' }, [title, d.show_sku && p.sku ? el('div', { cls: 's-sku', text: `Ref. ${p.sku}` }) : null, st && !soldOut(p) ? el('div', { cls: 's-stock', text: st }) : null, priceNode(p, 's-price', variable && priceFrom(p)), actions]),
    ]);
    cardEls.set(p.id, { card, actions });
    return card;
}

function paintCard(id: number): void {
    const c = cardEls.get(id);
    const p = byId.get(id);
    if (!c || !p) return;
    c.actions.replaceChildren(hasVariants(p) ? chooseControl(p) : addControl(p));
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

function productSheet(id: number, imageIdx: number, selIn?: Array<string | null>): HTMLElement {
    const p = byId.get(id);
    if (!p) return sheet('narrow', 'Producto', [el('p', { cls: 's-empty', text: 'Este producto ya no está disponible.' })], null, 'shop-product');
    const variable = hasVariants(p);
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
    if (!variable) {
        buy = addControl(p, true);
        priceEl = priceNode(p, 's-price s-d-price');
        st = stockText(p);
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
        variable ? variantOptions(p, sel, idx) : null,
        st ? el('div', { cls: 's-stock', style: 'margin-top:10px', text: st }) : null,
        el('div', { style: 'margin-top:14px' }, [buy]),
        n > 0 && !(variant && cart.has(variant.id)) ? el('p', { cls: 's-incart', style: 'margin:8px 0 0', text: n === 1 ? 'Tienes 1 de este producto en el carrito.' : `Tienes ${n} de este producto en el carrito.` }) : null,
        p.description ? el('p', { cls: 's-desc', text: p.description }) : null,
        p.categories.length > 0 ? el('div', { cls: 's-d-cats' }, p.categories.map((c) => el('span', { text: c }))) : null,
    ]);
    const qty = variable ? n : (cart.get(p.id) ?? 0);
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
    foot.push(el('p', { cls: 's-line-p', style: 'margin:0 0 10px', text: 'El envío se calcula en el siguiente paso.' }));
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
    payment: ShopPaymentMethod | null;
    stamp: string | null;
    stampAt: number;
    sending: boolean;
    serverCart: ShopCartResult | null;
}

const co: CheckoutState = { deliveryId: null, payment: null, stamp: null, stampAt: 0, sending: false, serverCart: null };
const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
const errs: Record<string, HTMLElement> = {};
let summaryEl: HTMLElement | null = null;
let alertEl: HTMLElement | null = null;
let submitBtn: HTMLButtonElement | null = null;
let addressBox: HTMLElement | null = null;
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
    const d = meta?.delivery.find((x) => x.id === co.deliveryId);
    return d?.needs_address ?? false;
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
            if (addressBox) addressBox.hidden = !needsAddress();
            paintSummary();
            scheduleQuote();
        });
        deliveryOpts.append(
            el('label', { cls: 's-opt', 'data-testid': 'shop-delivery' }, [
                radio,
                el('span', { cls: 's-opt-t' }, [el('span', { cls: 's-opt-n', text: d.name }), d.description ? el('span', { cls: 's-opt-d', style: 'display:block', text: d.description }) : null]),
                el('span', { cls: 's-opt-p', text: d.price > 0 ? money(d.price) : 'Gratis' }),
            ]),
        );
    }
    addressBox = el('div', { cls: 's-fields', style: 'margin-top:12px', hidden: !needsAddress() }, [
        field('address', 'Dirección', { autocomplete: 'street-address', required: true, wide: true }),
        field('city', 'Ciudad', { autocomplete: 'address-level2', required: true, wide: true }),
    ]);
    const deliverySec = el('section', { cls: 's-sec' }, [el('h3', { text: 'Entrega' }), deliveryOpts, addressBox]);

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

    const notesSec = m.checkout.ask_notes ? el('section', { cls: 's-sec' }, [el('div', { cls: 's-fields' }, [field('notes', 'Notas para el pedido (opcional)', { textarea: true, wide: true })])]) : null;

    summaryEl = el('div', { cls: 's-sum', 'data-testid': 'shop-summary' });
    alertEl = el('div', { cls: 's-warn', role: 'alert', hidden: true });
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
    hpInput = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    const hp = el('div', { cls: 's-hp', 'aria-hidden': 'true' }, [hpInput]);
    submitBtn = el('button', { type: 'submit', cls: 's-btn', 'data-testid': 'shop-place' });

    const form = el('form', { novalidate: true }, [you, deliverySec, paySec, notesSec, hp]);
    form.addEventListener('submit', (e) => {
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
    submitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        void placeOrder();
    });

    const layout = el('div', { cls: 's-checkout', 'data-testid': 'shop-checkout-view' }, [
        el('div', {}, [back, el('h1', { text: 'Finalizar compra' }), m.closed ? el('div', { cls: 's-closed', text: m.closed }) : null, form]),
        aside,
    ]);
    paintSummary();
    paintSubmit();
    scheduleQuote(0);
    ensureStamp();
    if (captchaBox) mountCaptcha();
    return [layout];
}

function paintSummary(): void {
    if (!summaryEl || !meta) return;
    const est = co.serverCart && sameCart(co.serverCart) ? co.serverCart : estimate(co.deliveryId);
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
    const d = meta.delivery.find((x) => x.id === co.deliveryId);
    rows.push(el('div', {}, [el('span', { text: d ? `Entrega · ${d.name}` : 'Entrega' }), el('span', { text: est.shipping > 0 ? money(est.shipping) : 'Gratis' })]));
    rows.push(el('div', { cls: 's-tot' }, [el('span', { text: 'Total' }), el('span', { 'data-testid': 'shop-total', text: money(est.total) })]));
    summaryEl.replaceChildren(...rows);
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
    const est = estimate(co.deliveryId);
    const label =
        co.payment === 'whatsapp' ? 'Confirmar y enviar por WhatsApp' : co.payment === 'online' ? `Ir a pagar · ${money(est.total)}` : `Hacer el pedido · ${money(est.total)}`;
    submitBtn.replaceChildren(co.sending ? el('span', { cls: 's-spin', 'aria-hidden': 'true' }) : '', co.sending ? (co.payment === 'online' ? 'Preparando el pago…' : 'Enviando…') : label);
    submitBtn.disabled = co.sending || est.blocked || est.below_minimum !== null || !co.payment || !co.deliveryId || !!meta.closed;
}

function scheduleQuote(delay = 400): void {
    if (BOOT.preview) return;
    window.clearTimeout(quoteTimer);
    quoteTimer = window.setTimeout(async () => {
        if (cart.size === 0) return;
        const res = await api<ShopCartResult>('/quote', {
            method: 'POST',
            body: JSON.stringify({ lines: [...cart].map(([product_id, qty]) => ({ product_id, qty })), delivery_id: co.deliveryId }),
        });
        if (res.ok) {
            co.serverCart = res.data;
            paintSummary();
        }
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
            lines: [...cart].map(([product_id, qty]) => ({ product_id, qty })),
            customer,
            delivery_id: co.deliveryId,
            payment_method: co.payment,
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
            if (e.code === 'shop_stale') co.stamp = null;
            if (e.code === 'shop_too_fast') co.stampAt = Date.now();
            const key = { shop_address: needsAddress() ? 'address' : '', shop_document: 'document', shop_terms: 'terms', shop_consent: 'consent' }[e.code ?? ''];
            if (key && errs[key]) setErr(key, e.message ?? '');
            showServerAlert(e.message || (res.status === 429 ? 'Hiciste muchos pedidos seguidos. Espera unos minutos y vuelve a intentar.' : 'No pudimos hacer el pedido. Vuelve a intentar.'));
            return;
        }
        cart.clear();
        saveCart();
        paintCartButtons();
        const url = new URL(location.href);
        url.searchParams.set('pedido', res.data.order_token);
        history.replaceState(null, '', url.pathname + url.search);
        // v0.1.413 — Pago en línea: directo a pagar (al volver, la página muestra cómo quedó).
        const payUrl = safePayUrl(res.data.pay_url);
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
            el('h2', { text: opts.placed ? m.texts.success_title || '¡Recibimos tu pedido!' : `Pedido ${o.number}` }),
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
                    o.pay_provider ? `Pagaste en línea con ${o.pay_provider}. Te avisamos cuando enviemos tu pedido.` : 'Te avisamos cuando enviemos tu pedido.',
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
    if (o.payment_status !== 'pagado' && o.payment_method !== 'online' && o.payment_instructions) {
        kids.push(el('div', { cls: 's-note' }, [el('strong', { style: 'display:block;margin-bottom:4px', text: o.payment_label }), o.payment_instructions]));
    }
    const sum = el('div', { cls: 's-sum' }, [
        ...o.lines.map((l) => el('div', {}, [el('span', { text: `${l.qty} × ${l.title}` }), el('span', { text: fmt(l.subtotal) })])),
        el('div', { style: 'padding-top:6px;border-top:1px solid var(--s-line);margin-top:4px' }, [el('span', { text: 'Subtotal' }), el('span', { text: fmt(o.subtotal) })]),
        el('div', {}, [el('span', { text: `Entrega · ${o.delivery}` }), el('span', { text: o.shipping > 0 ? fmt(o.shipping) : 'Gratis' })]),
        el('div', { cls: 's-tot' }, [el('span', { text: 'Total' }), el('span', { text: fmt(o.total) })]),
    ]);
    kids.push(el('div', { cls: 's-panel' }, [sum]));
    const where = [o.customer.address, o.customer.city].filter(Boolean).join(', ');
    kids.push(el('p', { cls: 's-line-p', style: 'margin:14px 0 0', text: `A nombre de ${o.customer.name}${where ? ` · ${where}` : ''}. Te enviamos el detalle a ${o.customer.email}.` }));
    kids.push(el('div', { style: 'margin-top:20px' }, [actionButton('Seguir comprando', goCatalog, 's-btn s-ghost')]));
    box.replaceChildren(...kids);
    window.scrollTo({ top: 0 });
}

// ───────────────────────────── Navegación ─────────────────────────────

function paint(main: HTMLElement[]): void {
    cartButtons.length = 0;
    mbar = null;
    const wrap = view === 'order' ? el('div', {}, main) : el('div', { cls: 's-wrap' }, main);
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
    co.serverCart = null;
    paint(checkoutView());
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
    const pedido = qs.get('pedido');
    if (pedido && /^[A-Za-z0-9_-]{20,64}$/.test(pedido) && !BOOT.preview) {
        // v0.1.413 — `?pago=1`: volvió de pagar en línea (se quita para que recargar no vuelva a esperar).
        const returned = qs.has('pago');
        if (returned) {
            const url = new URL(location.href);
            url.searchParams.delete('pago');
            history.replaceState(null, '', url.pathname + url.search);
        }
        void showOrder(pedido, { returned });
        return;
    }
    if (view === 'checkout') goCheckout();
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
