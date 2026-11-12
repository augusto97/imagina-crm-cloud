/**
 * v0.1.418 (addendum ADR-S103) — Estadísticas de la tienda, SIN Zod (la
 * importa la página pública, que tiene que ser chica). El esquema de los
 * eventos vive en `shop.ts`.
 *
 * Dos fuentes:
 * - lo que pasa en la página (visitas, productos abiertos, «agregar al
 *   carrito», «empezar la compra»): la página manda eventos sueltos y el
 *   servidor sólo SUMA contadores por día (Redis → `shop_stats`), igual que
 *   los formularios y el widget. Nunca la IP ni nada de la persona;
 * - lo que ya está en la base (pedidos, pagados, ingresos, unidades vendidas
 *   y de dónde llegó cada pedido): se cuenta de `shop_orders` al pedir el
 *   resumen. Así un pedido nunca se cuenta dos veces y los números de antes de
 *   esta versión también aparecen.
 */

export const SHOP_STATS_RANGES = [7, 30, 90] as const;
export type ShopStatsRange = (typeof SHOP_STATS_RANGES)[number];

export const SHOP_STAT_DEVICES = ['mobile', 'tablet', 'desktop'] as const;
export type ShopStatDevice = (typeof SHOP_STAT_DEVICES)[number];

/** Lo que manda la página. `first` = la primera vez en esta visita (para el embudo). */
export interface ShopStatEvent {
    /**
     * - `view`: una visita a la tienda (una vez por visita).
     * - `product`: abrió la ficha de un producto (una vez por producto y visita).
     * - `add`: agregó un producto al carrito (una vez por producto y visita).
     * - `checkout`: empezó la compra o la suscripción (una vez por visita).
     */
    kind: 'view' | 'product' | 'add' | 'checkout';
    /** `product` / `add` — el producto (el de la ficha, nunca la variante). */
    item?: number;
    /** `product` / `add` — la primera de su tipo en la visita. */
    first?: boolean;
    /** `view` — de dónde vino (`formStatSource`: `d`, `u:<campaña>`, `h:<sitio>`). */
    src?: string;
    /** `view` — desde qué dispositivo. */
    dev?: ShopStatDevice;
}

/** Contadores de un día: `v`, `src:<k>`, `dev:<m|t|d>`, `pvv`, `p:<id>`, `av`, `a:<id>`, `c`. */
export type ShopStatCounts = Record<string, number>;

export const SHOP_STAT_SOURCE_RE = /^(d|u:[a-z0-9._-]{1,40}|h:[a-z0-9.-]{1,80})$/;
const DEV_KEY: Record<ShopStatDevice, string> = { mobile: 'm', tablet: 't', desktop: 'd' };

/** Qué contadores suma un evento (lo que no tiene la forma esperada no suma nada). */
export function shopStatFields(e: ShopStatEvent): string[] {
    const item = typeof e.item === 'number' && Number.isInteger(e.item) && e.item > 0 && e.item < 1e15 ? e.item : null;
    switch (e.kind) {
        case 'view': {
            const src = typeof e.src === 'string' && SHOP_STAT_SOURCE_RE.test(e.src) ? e.src : 'd';
            const dev = e.dev && DEV_KEY[e.dev] ? DEV_KEY[e.dev] : 'd';
            return ['v', `src:${src}`, `dev:${dev}`];
        }
        case 'product':
            return item === null ? [] : [`p:${item}`, ...(e.first ? ['pvv'] : [])];
        case 'add':
            return item === null ? [] : [`a:${item}`, ...(e.first ? ['av'] : [])];
        case 'checkout':
            return ['c'];
        default:
            return [];
    }
}

/** Suma dos juegos de contadores. */
export function mergeShopStatCounts(a: ShopStatCounts, b: ShopStatCounts): ShopStatCounts {
    const out: ShopStatCounts = { ...a };
    for (const [k, v] of Object.entries(b)) {
        const n = Number(v);
        if (!Number.isFinite(n) || n === 0) continue;
        out[k] = (out[k] ?? 0) + n;
    }
    return out;
}

/** Lo que sale de `shop_orders` para un día (en la zona de la empresa). */
export interface ShopOrderDayRow {
    day: string;
    /** Pedidos hechos (sin contar los que se cancelaron por no pagar a tiempo). */
    orders: number;
    /** De esos, los que quedaron pagados. */
    paid: number;
    /** Lo cobrado en los pagados (en la moneda de la tienda). */
    revenue: number;
}

/** Un producto vendido en el período (de las líneas de los pedidos pagados). */
export interface ShopSoldRow {
    product_id: number;
    units: number;
    revenue: number;
}

/** Pedidos por origen (la clave de `formStatSource` guardada en el pedido). */
export interface ShopOrderSourceRow {
    key: string;
    orders: number;
    paid: number;
    revenue: number;
}

export interface ShopStatsDay {
    day: string;
    visits: number;
    orders: number;
    paid: number;
    revenue: number;
}

export interface ShopStatsFunnelStep {
    key: 'visits' | 'product' | 'cart' | 'checkout' | 'orders' | 'paid';
    label: string;
    count: number;
}

export interface ShopStatsProduct {
    id: number;
    /** El nombre de HOY (lo pone el servidor; vacío si el producto ya no existe). */
    title: string;
    views: number;
    adds: number;
    units: number;
    revenue: number;
}

export interface ShopStatsSource {
    key: string;
    visits: number;
    orders: number;
    paid: number;
    revenue: number;
}

export interface ShopStatsDto {
    range: { from: string; to: string; days: number };
    currency: string;
    days: ShopStatsDay[];
    totals: {
        visits: number;
        orders: number;
        paid: number;
        revenue: number;
        /** Lo que deja en promedio cada pedido pagado (null sin pagados). */
        average_order: number | null;
        /** Pedidos pagados / visitas (null sin visitas). */
        conversion_rate: number | null;
    };
    funnel: ShopStatsFunnelStep[];
    products: ShopStatsProduct[];
    sources: ShopStatsSource[];
    devices: Record<ShopStatDevice, number>;
}

function addDays(day: string, n: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/** Los días de `from` a `to` (inclusive), en orden. */
export function shopStatsDayRange(from: string, to: string): string[] {
    const out: string[] = [];
    for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
    return out;
}

const MAX_PRODUCTS = 10;
const MAX_SOURCES = 10;

/** Redondea a centavos (los ingresos se suman como números). */
function cents(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * El resumen que ve el equipo: los contadores de la página más lo que sale de
 * los pedidos. Puro: lo usa el servidor y lo prueban los tests.
 */
export function summarizeShopStats(input: {
    counts: ReadonlyArray<{ day: string; counts: ShopStatCounts }>;
    orders: readonly ShopOrderDayRow[];
    sold: readonly ShopSoldRow[];
    orderSources: readonly ShopOrderSourceRow[];
    range: { from: string; to: string };
    currency: string;
    titles?: ReadonlyMap<number, string>;
}): ShopStatsDto {
    const { range } = input;
    const byDay = new Map<string, ShopStatCounts>();
    for (const r of input.counts) {
        if (r.day < range.from || r.day > range.to) continue;
        byDay.set(r.day, mergeShopStatCounts(byDay.get(r.day) ?? {}, r.counts));
    }
    const all = [...byDay.values()].reduce<ShopStatCounts>((acc, c) => mergeShopStatCounts(acc, c), {});
    const n = (k: string): number => Math.max(0, Math.round(all[k] ?? 0));
    const ordersByDay = new Map<string, ShopOrderDayRow>();
    for (const o of input.orders) {
        if (o.day < range.from || o.day > range.to) continue;
        const prev = ordersByDay.get(o.day);
        ordersByDay.set(o.day, prev ? { day: o.day, orders: prev.orders + o.orders, paid: prev.paid + o.paid, revenue: prev.revenue + o.revenue } : { ...o });
    }
    const list = shopStatsDayRange(range.from, range.to);
    const days: ShopStatsDay[] = list.map((day) => {
        const c = byDay.get(day) ?? {};
        const o = ordersByDay.get(day);
        return { day, visits: Math.round(c.v ?? 0), orders: o?.orders ?? 0, paid: o?.paid ?? 0, revenue: cents(o?.revenue ?? 0) };
    });
    const visits = n('v');
    const orders = days.reduce((a, d) => a + d.orders, 0);
    const paid = days.reduce((a, d) => a + d.paid, 0);
    const revenue = cents(days.reduce((a, d) => a + d.revenue, 0));

    // Productos: los abiertos y agregados (contadores) más los vendidos (pedidos pagados).
    const prod = new Map<number, ShopStatsProduct>();
    const touch = (id: number): ShopStatsProduct => {
        let p = prod.get(id);
        if (!p) {
            p = { id, title: input.titles?.get(id) ?? '', views: 0, adds: 0, units: 0, revenue: 0 };
            prod.set(id, p);
        }
        return p;
    };
    for (const [k, v] of Object.entries(all)) {
        const m = /^(p|a):(\d{1,15})$/.exec(k);
        if (!m || !(v > 0)) continue;
        const p = touch(Number(m[2]));
        if (m[1] === 'p') p.views += Math.round(v);
        else p.adds += Math.round(v);
    }
    for (const s of input.sold) {
        if (!(s.units > 0)) continue;
        const p = touch(s.product_id);
        p.units += s.units;
        p.revenue = cents(p.revenue + s.revenue);
    }
    const products = [...prod.values()]
        .sort((a, b) => b.revenue - a.revenue || b.units - a.units || b.adds - a.adds || b.views - a.views || a.id - b.id)
        .slice(0, MAX_PRODUCTS);

    // Orígenes: visitas (contadores) y pedidos (de `shop_orders`).
    const src = new Map<string, ShopStatsSource>();
    const touchSrc = (key: string): ShopStatsSource => {
        let s = src.get(key);
        if (!s) {
            s = { key, visits: 0, orders: 0, paid: 0, revenue: 0 };
            src.set(key, s);
        }
        return s;
    };
    for (const [k, v] of Object.entries(all)) {
        if (!k.startsWith('src:') || !(v > 0)) continue;
        touchSrc(k.slice(4)).visits += Math.round(v);
    }
    for (const o of input.orderSources) {
        const key = SHOP_STAT_SOURCE_RE.test(o.key) ? o.key : 'd';
        const s = touchSrc(key);
        s.orders += o.orders;
        s.paid += o.paid;
        s.revenue = cents(s.revenue + o.revenue);
    }
    const sourcesAll = [...src.values()].sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || b.visits - a.visits || a.key.localeCompare(b.key));
    const sources = sourcesAll.slice(0, MAX_SOURCES);
    const rest = sourcesAll.slice(MAX_SOURCES);
    if (rest.length > 0) {
        const other = rest.reduce<ShopStatsSource>(
            (acc, s) => ({ key: 'o', visits: acc.visits + s.visits, orders: acc.orders + s.orders, paid: acc.paid + s.paid, revenue: cents(acc.revenue + s.revenue) }),
            { key: 'o', visits: 0, orders: 0, paid: 0, revenue: 0 },
        );
        sources.push(other);
    }

    return {
        range: { from: range.from, to: range.to, days: list.length },
        currency: input.currency,
        days,
        totals: {
            visits,
            orders,
            paid,
            revenue,
            average_order: paid > 0 ? cents(revenue / paid) : null,
            conversion_rate: visits > 0 ? Math.min(1, paid / visits) : null,
        },
        funnel: [
            { key: 'visits', label: 'Visitas', count: visits },
            { key: 'product', label: 'Vieron un producto', count: n('pvv') },
            { key: 'cart', label: 'Agregaron al carrito', count: n('av') },
            { key: 'checkout', label: 'Empezaron la compra', count: n('c') },
            { key: 'orders', label: 'Hicieron el pedido', count: orders },
            { key: 'paid', label: 'Pagaron', count: paid },
        ],
        products,
        sources,
        devices: { mobile: n('dev:m'), tablet: n('dev:t'), desktop: n('dev:d') },
    };
}
