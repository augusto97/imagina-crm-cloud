import { z } from 'zod';
import { GOOGLE_ADS_SEND_TO_RE, GOOGLE_TAG_ID_RE, META_PIXEL_ID_RE } from './conversion-logic';
import { SHOP_STAT_DEVICES } from './shop-stats-logic';
import {
    SHOP_COUPON_CODE_RE,
    SHOP_COUPON_KINDS,
    SHOP_ITEM_ID_RE,
    SHOP_MAX_DELIVERY_METHODS,
    SHOP_DOWNLOAD_DAYS_DEFAULT,
    SHOP_MAX_DELIVERY_ZONES,
    SHOP_MAX_DOWNLOADS_DEFAULT,
    SHOP_MAX_LINES,
    SHOP_MAX_QTY,
    SHOP_MAX_VARIANT_ATTRIBUTES,
    SHOP_PAYMENT_METHODS,
    SHOP_WHATSAPP_DEFAULT_INTRO,
    shopWhatsappPhoneOk,
} from './shop-logic';

/**
 * v0.1.412 (ADR-S103) — Tienda desde una lista.
 *
 * El CATÁLOGO es una lista de la empresa: cada registro es un producto y se
 * eligen los campos por su papel (nombre, precio, fotos, stock…), igual que
 * en formularios y agenda. La tienda arma su propio pack de listas vinculadas
 * —Pedidos, Líneas de pedido y Clientes— donde cae cada compra, con las
 * columnas que escribe la tienda protegidas.
 *
 * Todo lo de aquí es PURO: lo usan el servidor (la página pública, el
 * checkout, el pedido) y el editor. El precio, el stock y el total los
 * decide SIEMPRE el servidor con estas mismas funciones: el navegador sólo
 * muestra una estimación.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const refId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nullableRef = refId.nullable().catch(null).default(null);
const text = (max: number, def = '') => z.string().trim().max(max).catch(def).default(def);

// ── Configuración ───────────────────────────────────────────────────────

/** Los campos del catálogo, por su papel. Todos por ID (regla de oro nº 1). */
export const shopCatalogFieldsSchema = z.object({
    /** null = el campo de título de la lista. */
    name: nullableRef,
    price: nullableRef,
    /** «Antes»: si es mayor que el precio, se muestra tachado. */
    compare_price: nullableRef,
    /** Archivo (fotos subidas) o enlace mostrado como imagen. */
    images: nullableRef,
    description: nullableRef,
    /** Selección, varias opciones o texto: arma las categorías de la tienda. */
    category: nullableRef,
    /** Número: vacío en un producto = sin límite. null = la tienda no controla stock. */
    stock: nullableRef,
    sku: nullableRef,
    /** Casilla «se vende»: null = se venden todos. */
    active: nullableRef,
});
export type ShopCatalogFields = z.infer<typeof shopCatalogFieldsSchema>;

/**
 * v0.1.414 — Productos con variantes (talla, color…). Cada variante es una
 * SUBTAREA del producto en la misma lista: tiene su propio precio (vacío = el
 * del producto), su stock, su referencia y sus fotos (vacías = las del
 * producto). Los atributos son campos de la lista (selección o texto) que
 * distinguen una variante de otra; sin atributos, la opción es el nombre de
 * la subtarea.
 */
export const shopVariantsSchema = z.object({
    enabled: z.boolean().catch(false).default(false),
    /** Hasta 3 campos por ID, en el orden en que se eligen (Talla, Color…). */
    attributes: z.array(refId).max(SHOP_MAX_VARIANT_ATTRIBUTES).catch([]).default([]),
});
export type ShopVariantsConfig = z.infer<typeof shopVariantsSchema>;

/**
 * v0.1.416 — Productos digitales y servicios. Un producto es digital si su
 * «Tipo» lo dice o, sin columna «Tipo», si trae archivos para descargar; los
 * digitales no piden entrega y, al pagar, quien compró recibe los enlaces de
 * descarga. Un servicio no va al carrito: el botón lleva a la agenda.
 * v0.1.417 — Una suscripción tampoco va al carrito: «Suscribirme» la contrata
 * con un plan de débito automático (Mercado Pago o PayPal de la empresa).
 */
const BOOKING_SERVICE_ID_RE = /^[a-z0-9]{4,24}$/;
export const SHOP_MAX_SERVICE_LINKS = 300;
export const shopKindsSchema = z.object({
    /** Selección o texto «Tipo de producto» (Físico, Digital, Servicio). null = sin columna. */
    kind_field: nullableRef,
    /** Archivo: lo que se descarga al pagar. */
    download_field: nullableRef,
    /** Cuántos días después del pago sirven las descargas. */
    download_days: z.number().int().min(1).max(365).catch(SHOP_DOWNLOAD_DAYS_DEFAULT).default(SHOP_DOWNLOAD_DAYS_DEFAULT),
    /** Cuántas veces se puede bajar cada archivo (null = sin límite). */
    max_downloads: z.number().int().min(1).max(100).nullable().catch(SHOP_MAX_DOWNLOADS_DEFAULT).default(SHOP_MAX_DOWNLOADS_DEFAULT),
    /** La agenda donde se reservan los servicios. */
    booking_page_id: nullableRef,
    /** Producto (id) → servicio de esa agenda. Sin elección: el servicio con el mismo nombre. */
    service_links: z
        .record(z.string(), z.unknown())
        .catch({})
        .default({})
        .transform((raw) => {
            const out: Record<string, string> = {};
            let n = 0;
            for (const [k, v] of Object.entries(raw)) {
                if (!/^[1-9]\d{0,14}$/.test(k) || typeof v !== 'string' || !BOOKING_SERVICE_ID_RE.test(v)) continue;
                out[k] = v;
                if (++n >= SHOP_MAX_SERVICE_LINKS) break;
            }
            return out;
        }),
    /** v0.1.417 — Producto (id) → plan de suscripción (id). Sin elección: el plan con el mismo nombre. */
    subscription_links: z
        .record(z.string(), z.unknown())
        .catch({})
        .default({})
        .transform((raw) => {
            const out: Record<string, number> = {};
            let n = 0;
            for (const [k, v] of Object.entries(raw)) {
                if (!/^[1-9]\d{0,14}$/.test(k) || typeof v !== 'number' || !Number.isInteger(v) || v <= 0) continue;
                out[k] = v;
                if (++n >= SHOP_MAX_SERVICE_LINKS) break;
            }
            return out;
        }),
    /** v0.1.417 — Pedir dirección y ciudad al suscribirse (una caja que llega cada mes). */
    subscription_address: z.boolean().catch(false).default(false),
});
export type ShopKindsConfig = z.infer<typeof shopKindsSchema>;

/** Los tipos de campo de las columnas de los tipos de producto. */
export const SHOP_KIND_FIELD_TYPES = ['select', 'text'] as const;
export const SHOP_DOWNLOAD_FIELD_TYPES = ['file'] as const;

const money = (def = 0) => z.number().min(0).max(1_000_000_000).catch(def).default(def);
const nullableMoney = z.number().min(0).max(1_000_000_000).nullable().catch(null).default(null);

/** v0.1.415 — Una zona de envío: «Bogotá», «Área metropolitana», «Resto del país». */
export const shopDeliveryZoneSchema = z.object({
    id: z.string().regex(SHOP_ITEM_ID_RE),
    name: text(80),
    price: money(),
    /** Envío gratis desde este monto en productos (null = el de la forma de entrega). */
    free_over: nullableMoney,
    eta: text(80),
    active: z.boolean().catch(true).default(true),
});
export type ShopDeliveryZone = z.infer<typeof shopDeliveryZoneSchema>;

export const shopDeliveryMethodSchema = z.object({
    id: z.string().regex(SHOP_ITEM_ID_RE),
    name: text(80),
    description: text(240),
    price: money(),
    /** Pide dirección y ciudad (envío a domicilio); si no, es retiro o digital. */
    needs_address: z.boolean().catch(true).default(true),
    active: z.boolean().catch(true).default(true),
    /** v0.1.415 — «2 a 4 días hábiles». */
    eta: text(80),
    /** v0.1.415 — Envío gratis desde este monto en productos (null = nunca). */
    free_over: nullableMoney,
    /** v0.1.415 — Con zonas, la persona elige a dónde y cada zona tiene su precio. */
    zones: z
        .array(z.unknown())
        .catch([])
        .default([])
        .transform((raw) => {
            const out: ShopDeliveryZone[] = [];
            const seen = new Set<string>();
            for (const z0 of raw) {
                const p = shopDeliveryZoneSchema.safeParse(z0);
                if (!p.success || seen.has(p.data.id)) continue;
                seen.add(p.data.id);
                out.push(p.data);
                if (out.length >= SHOP_MAX_DELIVERY_ZONES) break;
            }
            return out;
        }),
});
export type ShopDeliveryMethod = z.infer<typeof shopDeliveryMethodSchema>;

export const SHOP_TRANSFER_DEFAULT = 'Transfiere el total a nuestra cuenta y envíanos el comprobante por WhatsApp o correo. Despachamos apenas confirmemos el pago.';
export const SHOP_COD_DEFAULT = 'Pagas cuando recibes el pedido.';

export const shopPaymentsSchema = z.object({
    whatsapp: z
        .object({
            enabled: z.boolean().catch(false).default(false),
            /** E.164: `+573001112233`. Nunca viaja a la página. */
            phone: text(20),
            intro: text(200, SHOP_WHATSAPP_DEFAULT_INTRO),
        })
        .catch({ enabled: false, phone: '', intro: SHOP_WHATSAPP_DEFAULT_INTRO })
        .default({}),
    transfer: z
        .object({
            enabled: z.boolean().catch(false).default(false),
            instructions: text(1500, SHOP_TRANSFER_DEFAULT),
        })
        .catch({ enabled: false, instructions: SHOP_TRANSFER_DEFAULT })
        .default({}),
    cod: z
        .object({
            enabled: z.boolean().catch(false).default(false),
            instructions: text(600, SHOP_COD_DEFAULT),
        })
        .catch({ enabled: false, instructions: SHOP_COD_DEFAULT })
        .default({}),
    /** v0.1.413 — Pago en línea con la cuenta de cobro del equipo (ADR-S31). */
    online: z
        .object({
            enabled: z.boolean().catch(false).default(false),
            connection_id: nullableRef,
            /** Cuánto se aparta el stock mientras la persona paga. */
            hold_minutes: z.number().int().min(10).max(240).catch(30).default(30),
        })
        .catch({ enabled: false, connection_id: null, hold_minutes: 30 })
        .default({}),
});
export type ShopPayments = z.infer<typeof shopPaymentsSchema>;

export const shopCheckoutSchema = z.object({
    /** Cédula / NIT de quien compra. */
    ask_document: z.enum(['hidden', 'optional', 'required']).catch('optional').default('optional'),
    ask_notes: z.boolean().catch(true).default(true),
    /** Casilla «Acepto los términos». */
    require_terms: z.boolean().catch(true).default(true),
    captcha: z.boolean().catch(false).default(false),
    /** Compra mínima (null = sin mínimo). */
    min_order: z.number().min(0).max(1_000_000_000).nullable().catch(null).default(null),
    /** Correo de confirmación a quien compra (por el correo de la empresa). */
    send_confirmation: z.boolean().catch(true).default(true),
    /** A quién del equipo le llega el aviso de cada pedido (vacío = quien creó la tienda). */
    notify_user_ids: z.array(refId).max(20).catch([]).default([]),
});
export type ShopCheckout = z.infer<typeof shopCheckoutSchema>;

/** Quién vende: el Estatuto del Consumidor pide mostrarlo antes de comprar. */
export const shopSellerSchema = z.object({
    legal_name: text(160),
    document: text(40),
    address: text(200),
    city: text(80),
    email: text(200),
    phone: text(40),
});
export type ShopSeller = z.infer<typeof shopSellerSchema>;

export const SHOP_DEFAULT_DELIVERY_TIME = 'Despachamos en 1 a 3 días hábiles después de confirmar el pago.';
export const SHOP_DEFAULT_RETURNS =
    'Si compraste a distancia, tienes derecho a retractarte dentro de los 5 días hábiles siguientes a la entrega del producto, salvo las excepciones de ley. Escríbenos y te devolvemos el dinero en un plazo máximo de 30 días calendario.';
export const SHOP_DEFAULT_REVERSAL =
    'Si pagaste con tarjeta, PSE u otro medio electrónico, puedes pedir la reversión del pago si fuiste víctima de fraude, si no hiciste la compra, si el producto no llegó o si no corresponde a lo que pediste o está defectuoso. Escríbenos dentro de los 5 días hábiles siguientes a que te enteres.';

export const shopPoliciesSchema = z.object({
    delivery_time: text(600, SHOP_DEFAULT_DELIVERY_TIME),
    returns: text(3000, SHOP_DEFAULT_RETURNS),
    reversal: text(3000, SHOP_DEFAULT_REVERSAL),
    /** Términos propios (vacío = sólo los de arriba). */
    terms: text(8000),
});
export type ShopPolicies = z.infer<typeof shopPoliciesSchema>;

export const SHOP_SORTS = ['manual', 'name', 'price_asc', 'price_desc', 'newest'] as const;
export type ShopSort = (typeof SHOP_SORTS)[number];
export const SHOP_SORT_LABELS: Record<ShopSort, string> = {
    manual: 'Como están en la lista',
    name: 'Nombre (A-Z)',
    price_asc: 'Precio: menor a mayor',
    price_desc: 'Precio: mayor a menor',
    newest: 'Lo más nuevo primero',
};

export const shopDisplaySchema = z.object({
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).catch(3).default(3),
    /** Cómo se ven las fotos en la tarjeta. */
    image_fit: z.enum(['cover', 'contain']).catch('cover').default('cover'),
    image_ratio: z.enum(['square', 'portrait', 'landscape']).catch('square').default('square'),
    /** Cuándo se dice cuántas quedan. */
    show_stock: z.enum(['never', 'low', 'always']).catch('low').default('low'),
    low_stock_at: z.number().int().min(1).max(1000).catch(5).default(5),
    show_categories: z.boolean().catch(true).default(true),
    show_search: z.boolean().catch(true).default(true),
    sort: z.enum(SHOP_SORTS).catch('manual').default('manual'),
    show_sku: z.boolean().catch(false).default(false),
    /** Los agotados: se muestran apagados o no se muestran. */
    hide_sold_out: z.boolean().catch(false).default(false),
});
export type ShopDisplay = z.infer<typeof shopDisplaySchema>;

export const shopTextsSchema = z.object({
    title: text(120),
    description: text(600),
    add_to_cart: text(40, 'Agregar al carrito'),
    checkout: text(40, 'Finalizar compra'),
    success_title: text(120, '¡Recibimos tu pedido!'),
    success_message: text(600, 'Te enviamos el detalle a tu correo. Si tienes dudas, escríbenos.'),
});
export type ShopTexts = z.infer<typeof shopTextsSchema>;

/** Las listas donde cae cada compra y sus columnas. Lo fija el servidor al crear la tienda. */
export const shopOrdersMapSchema = z.object({
    list_id: nullableRef,
    lines_list_id: nullableRef,
    customers_list_id: nullableRef,
    fields: z.record(z.string(), refId).catch({}).default({}),
    line_fields: z.record(z.string(), refId).catch({}).default({}),
    customer_fields: z.record(z.string(), refId).catch({}).default({}),
});
export type ShopOrdersMap = z.infer<typeof shopOrdersMapSchema>;

/**
 * v0.1.418 — Medir conversiones de la tienda. Insertada en el sitio con su
 * script, la tienda le avisa al sitio cada paso de la compra con los eventos
 * de comercio electrónico de Google (`view_item`, `add_to_cart`,
 * `begin_checkout`, `purchase`), para Tag Manager sin configurar nada; aquí se
 * suma la etiqueta de Google Ads (la compra) y el píxel de Meta. El valor es
 * SIEMPRE el total del pedido. En el enlace directo se pueden cargar las
 * etiquetas de la empresa por su ID (como formularios y agenda, ADR-S97).
 */
export const shopConversionSchema = z.object({
    google_ads: z.string().regex(GOOGLE_ADS_SEND_TO_RE).nullable().catch(null).default(null),
    /** ViewContent, AddToCart, InitiateCheckout y Purchase en el píxel de Meta. */
    meta_event: z.boolean().catch(false).default(false),
    /** Conversiones mejoradas: el correo y el teléfono de quien compra (apagado por defecto). */
    share_contact: z.boolean().catch(false).default(false),
    direct_tags: z.boolean().catch(false).default(false),
    google_tag_id: z.string().regex(GOOGLE_TAG_ID_RE).nullable().catch(null).default(null),
    meta_pixel_id: z.string().regex(META_PIXEL_ID_RE).nullable().catch(null).default(null),
    cookie_notice: z.boolean().catch(true).default(true),
});
export type ShopConversion = z.infer<typeof shopConversionSchema>;

export const shopConfigSchema = z.object({
    currency: z
        .string()
        .trim()
        .regex(/^[A-Z]{3}$/)
        .catch('COP')
        .default('COP'),
    catalog: shopCatalogFieldsSchema.catch(() => shopCatalogFieldsSchema.parse({})).default({}),
    variants: shopVariantsSchema.catch(() => shopVariantsSchema.parse({})).default({}),
    /** v0.1.416 — Productos digitales y servicios. */
    kinds: shopKindsSchema.catch(() => shopKindsSchema.parse({})).default({}),
    delivery: z.array(shopDeliveryMethodSchema).max(SHOP_MAX_DELIVERY_METHODS).catch([]).default([]),
    payments: shopPaymentsSchema.catch(() => shopPaymentsSchema.parse({})).default({}),
    checkout: shopCheckoutSchema.catch(() => shopCheckoutSchema.parse({})).default({}),
    seller: shopSellerSchema.catch(() => shopSellerSchema.parse({})).default({}),
    policies: shopPoliciesSchema.catch(() => shopPoliciesSchema.parse({})).default({}),
    display: shopDisplaySchema.catch(() => shopDisplaySchema.parse({})).default({}),
    texts: shopTextsSchema.catch(() => shopTextsSchema.parse({})).default({}),
    /** null = el color de la marca (el tema completo vive en `settings.theme`). */
    color: z.string().regex(HEX_RE).nullable().catch(null).default(null),
    show_logo: z.boolean().catch(true).default(true),
    /** Los sitios que pueden insertarla (vacío = cualquiera). */
    allowed_domains: z.array(z.string().trim().max(200)).max(20).catch([]).default([]),
    orders: shopOrdersMapSchema.catch(() => shopOrdersMapSchema.parse({})).default({}),
    /** v0.1.418 — Medir conversiones. */
    conversion: shopConversionSchema.catch(() => shopConversionSchema.parse({})).default({}),
});
export type ShopConfig = z.infer<typeof shopConfigSchema>;

function asObject(raw: unknown): Record<string, unknown> {
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/**
 * Lectura TOLERANTE de lo guardado: lo que no se entiende toma su valor por
 * defecto y una forma de entrega rota se descarta, en vez de tirar la tienda.
 */
export function readShopConfig(raw: unknown): ShopConfig {
    const obj = asObject(raw);
    const delivery: ShopDeliveryMethod[] = [];
    const seen = new Set<string>();
    for (const d of Array.isArray(obj.delivery) ? obj.delivery : []) {
        const p = shopDeliveryMethodSchema.safeParse(d);
        if (!p.success || seen.has(p.data.id)) continue;
        seen.add(p.data.id);
        delivery.push(p.data);
        if (delivery.length >= SHOP_MAX_DELIVERY_METHODS) break;
    }
    const base = shopConfigSchema.safeParse({ ...obj, delivery: [] });
    const config = base.success ? base.data : shopConfigSchema.parse({});
    return { ...config, delivery };
}

export function defaultShopConfig(): ShopConfig {
    const c = shopConfigSchema.parse({});
    return {
        ...c,
        delivery: [
            { id: 'domicilio', name: 'Envío a domicilio', description: '', price: 0, needs_address: true, active: true, eta: '', free_over: null, zones: [] },
            { id: 'retiro', name: 'Recoger en el local', description: '', price: 0, needs_address: false, active: true, eta: '', free_over: null, zones: [] },
        ],
    };
}

export function newShopItemId(taken: Iterable<string> = []): string {
    const used = new Set(taken);
    for (let i = 0; i < 50; i++) {
        const id = Math.random().toString(36).slice(2, 8);
        if (!used.has(id) && SHOP_ITEM_ID_RE.test(id)) return id;
    }
    return `m${Date.now().toString(36)}`.slice(0, 16);
}

/** Lo que el cliente del editor puede mandar: `orders` lo fija el servidor. */
export const updateShopSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    theme: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type UpdateShopInput = z.infer<typeof updateShopSchema>;

export const createShopSchema = z.object({
    list_id: refId,
    name: z.string().trim().min(1).max(120),
    /** Usar las listas de pedidos de otra tienda de la misma empresa. */
    reuse_orders_from: refId.nullable().optional(),
});
export type CreateShopInput = z.infer<typeof createShopSchema>;

// ── Lo que ve el equipo ─────────────────────────────────────────────────

export interface ShopOrdersLists {
    list_id: number;
    list_name: string;
    list_slug: string;
    lines_list_id: number | null;
    customers_list_id: number | null;
}

export interface ShopDto {
    id: number;
    list_id: number;
    name: string;
    enabled: boolean;
    /** La plataforma la apagó (no se vuelve a encender desde la empresa). */
    suspended: boolean;
    suspended_reason: string | null;
    config: ShopConfig;
    /** `/api/v1/public/s/<token>` */
    public_path: string;
    problems: ShopProblem[];
    orders: ShopOrdersLists | null;
    orders_count: number;
    /** v0.1.409 — De dónde sale el código para pegar (null = el dominio de la app). */
    embed_origin?: string | null;
    created_at: string;
    updated_at: string;
}

export interface ShopFieldOption {
    id: number;
    label: string;
    slug: string;
    type: string;
    is_primary: boolean;
}

/** Lo que el editor necesita en un pedido (regla de oro nº 8). */
export interface ShopOptions {
    list: { id: number; name: string; slug: string };
    /** El color de la marca (lo que usa la tienda si no elige otro). */
    brand_color: string | null;
    fields: ShopFieldOption[];
    suggested: ShopCatalogFields;
    members: Array<{ id: number; name: string }>;
    products_count: number;
    /** Otras tiendas de la empresa cuyas listas de pedidos se pueden reusar. */
    other_shops: Array<{ id: number; name: string; orders_list_name: string | null }>;
    /** v0.1.413 — Las cuentas de cobro del equipo (Mercado Pago, Wompi, PayPal) para el pago en línea. */
    payment_connections: Array<{ id: number; name: string; provider: 'mercadopago' | 'wompi' | 'paypal'; test_mode: boolean }>;
    /** v0.1.415 — Las categorías del catálogo (para limitar un cupón a algunas). */
    categories: string[];
    /** v0.1.416 — Las agendas de la empresa (para los servicios), con sus servicios. */
    booking_pages: ShopBookingPageOption[];
    /** v0.1.416 — Los productos de tipo servicio, con el servicio de la agenda que les toca. */
    service_products: ShopServiceProductDto[];
    /** v0.1.416 — Cuántos productos de cada tipo hay (con la configuración guardada). */
    kind_counts: { physical: number; digital: number; service: number; subscription: number; downloadable: number };
    /** v0.1.417 — Los planes de suscripción que se pueden vender (activos y con una cuenta del equipo). */
    subscription_plans: ShopSubscriptionPlanOption[];
    /** v0.1.417 — Los productos de tipo suscripción, con el plan que les toca. */
    subscription_products: ShopSubscriptionProductDto[];
}

/** v0.1.417 — Un plan de suscripción para los productos de la tienda. */
export interface ShopSubscriptionPlanOption {
    id: number;
    name: string;
    currency: string;
    amount: number;
    frequency: number;
    frequency_type: 'months' | 'days';
    trial_days: number;
    cycles: number | null;
    provider: 'mercadopago' | 'paypal';
}

/** v0.1.417 — Un producto de tipo suscripción y el plan que le toca. */
export interface ShopSubscriptionProductDto {
    id: number;
    title: string;
    price: number | null;
    /** El plan elegido a mano (null = se busca por el nombre). */
    linked: number | null;
    /** El plan que se usa (elegido o por el nombre, en la moneda de la tienda; null = ninguno). */
    resolved: number | null;
}

/** v0.1.416 — Una agenda de la empresa para los servicios de la tienda. */
export interface ShopBookingPageOption {
    id: number;
    name: string;
    enabled: boolean;
    services: Array<{ id: string; name: string; active: boolean; price: number | null }>;
}

/** v0.1.416 — Un producto de tipo servicio y el servicio de la agenda que le toca. */
export interface ShopServiceProductDto {
    id: number;
    title: string;
    /** El servicio elegido a mano (null = se busca por el nombre). */
    linked: string | null;
    /** El servicio que se usa (elegido o por el nombre; null = ninguno). */
    resolved: string | null;
}

/** v0.1.416 — «Agregar la columna»: Tipo de producto o Archivo para descargar en el catálogo. */
export const createShopKindColumnSchema = z.object({ role: z.enum(['kind', 'download']) });
export type CreateShopKindColumnInput = z.infer<typeof createShopKindColumnSchema>;

// ── v0.1.414: el generador de variantes del editor ─────────────────────

/** Un producto del catálogo para elegir a cuál crearle variantes. */
export interface ShopVariantProductDto {
    id: number;
    title: string;
    price: number | null;
    /** Cuántas variantes (subtareas) tiene hoy. */
    variants: number;
}

export interface ShopVariantAttributeDto {
    field_id: number;
    label: string;
    type: 'select' | 'text';
    /** Las opciones del campo (selección) o los valores ya usados en las variantes (texto). */
    values: string[];
}

export interface ShopProductVariantsDto {
    product: { id: number; title: string; price: number | null; stock: number | null; sku: string };
    attributes: ShopVariantAttributeDto[];
    variants: Array<{ id: number; label: string; values: string[]; price: number | null; stock: number | null; sku: string }>;
}

export const generateShopVariantsSchema = z.object({
    /** Los atributos (en el orden del editor, aunque todavía no se hayan guardado). */
    attributes: z.array(refId).min(1).max(SHOP_MAX_VARIANT_ATTRIBUTES),
    /** Los valores elegidos para cada atributo (por etiqueta). */
    values: z.array(z.array(z.string().trim().min(1).max(80)).min(1).max(40)).min(1).max(SHOP_MAX_VARIANT_ATTRIBUTES),
    /** Precio de las variantes nuevas (vacío = el del producto). */
    price: z.number().min(0).max(1_000_000_000).nullable().optional(),
    /** Stock inicial (vacío = sin límite o lo cargas después). */
    stock: z.number().int().min(0).max(10_000_000).nullable().optional(),
});
export type GenerateShopVariantsInput = z.infer<typeof generateShopVariantsSchema>;

export interface GenerateShopVariantsResult {
    created: number;
    /** Combinaciones que el producto ya tenía. */
    existing: number;
    /** Había más combinaciones que el tope de una vez. */
    truncated: boolean;
    /** Si algo cortó la creación a la mitad (límite del plan, permisos). */
    error: string | null;
}

/** El pedido de un registro de «Pedidos», para el panel de la ficha. */
export interface ShopOrderPanelDto {
    shop_id: number | null;
    shop_name: string;
    number: string;
    payment_method: string;
    payment_label: string;
    payment_status: string;
    payment_status_label: string;
    total: number;
    currency: string;
    stock_state: 'none' | 'taken' | 'returned';
    paid_at: string | null;
    cancelled: boolean;
    public_url: string | null;
    created_at: string;
    /** v0.1.413 — El pago en línea: el link, hasta cuándo y con quién. */
    pay_url: string | null;
    pay_until: string | null;
    pay_provider: string | null;
    /** v0.1.416 — Las descargas del pedido (null = no trae descargables). */
    downloads: {
        files: number;
        /** Descargas hechas, sumando todos los archivos. */
        used: number;
        /** Por archivo (null = sin límite). */
        max: number | null;
        /** Hasta cuándo sirven (null = todavía no: falta el pago). */
        until: string | null;
    } | null;
    /** v0.1.416 — Se puede reenviar el correo con las descargas (está pagado y no venció). */
    can_resend: boolean;
    /**
     * v0.1.418 — De dónde llegó quien compró: la campaña o el sitio (en
     * palabras), el nombre de la campaña y si vino de un anuncio de Google o
     * Meta. null = un pedido de antes de esta versión.
     */
    origin?: { source: string; campaign: string | null; ad: 'google' | 'meta' | null; page: string | null } | null;
}

/** Plataforma → Empresas: las tiendas de una empresa, para suspender una que se usa mal. */
export interface PlatformShopDto {
    id: number;
    tenant_id: number;
    name: string;
    enabled: boolean;
    suspended: boolean;
    suspended_reason: string | null;
    public_path: string;
    orders_count: number;
    created_at: string;
}

export const suspendShopSchema = z.object({
    suspended: z.boolean(),
    reason: z.string().trim().max(500).nullable().optional(),
});
export type SuspendShopInput = z.infer<typeof suspendShopSchema>;

// ── Pedido público ──────────────────────────────────────────────────────

export const shopCustomerSchema = z.object({
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z.string().trim().max(40).default(''),
    document: z.string().trim().max(40).default(''),
    address: z.string().trim().max(240).default(''),
    city: z.string().trim().max(80).default(''),
    notes: z.string().trim().max(1000).default(''),
});
export type ShopCustomer = z.infer<typeof shopCustomerSchema>;

export const publicShopOrderSchema = z.object({
    lines: z
        .array(z.object({ product_id: refId, qty: z.number().int().min(1).max(SHOP_MAX_QTY) }))
        .min(1)
        .max(SHOP_MAX_LINES),
    customer: shopCustomerSchema,
    /** v0.1.416 — null con un carrito que sólo se descarga (no pide entrega). */
    delivery_id: z.string().regex(SHOP_ITEM_ID_RE).nullable().optional(),
    /** v0.1.415 — La zona de envío (con zonas en la forma de entrega). */
    zone_id: z.string().regex(SHOP_ITEM_ID_RE).nullable().optional(),
    /** v0.1.415 — El código del cupón (se valida en el servidor). */
    coupon: z.string().trim().max(40).optional(),
    payment_method: z.enum(SHOP_PAYMENT_METHODS),
    terms: z.boolean().default(false),
    consent: z.boolean().default(false),
    stamp: z.string().max(400),
    captcha: z.string().max(4096).optional(),
    /** Campo trampa: una persona nunca lo llena. */
    website: z.string().max(200).optional(),
    origin: z
        .object({
            page: z.string().max(2000).optional(),
            referrer: z.string().max(2000).optional(),
            /** v0.1.418 — De dónde llegó la visita (`formStatSource`: `d`, `u:<campaña>`, `h:<sitio>`). */
            src: z.string().max(130).optional(),
            /** v0.1.418 — Campaña y clics del anuncio (lo limpia el servidor con `cleanAttribution`). */
            attribution: z.record(z.string().max(40), z.string().max(1200)).optional(),
        })
        .partial()
        .optional(),
});
export type PublicShopOrderInput = z.infer<typeof publicShopOrderSchema>;

/** v0.1.416 — «Mis pedidos»: el correo al que se manda el enlace. */
export const publicShopMyOrdersRequestSchema = z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    /** Campo trampa. */
    website: z.string().max(200).optional(),
});

export const publicShopQuoteSchema = z.object({
    lines: z
        .array(z.object({ product_id: refId, qty: z.number().int().min(1).max(SHOP_MAX_QTY) }))
        .max(SHOP_MAX_LINES),
    delivery_id: z.string().regex(SHOP_ITEM_ID_RE).nullable().optional(),
    zone_id: z.string().regex(SHOP_ITEM_ID_RE).nullable().optional(),
    coupon: z.string().trim().max(40).optional(),
});

// ── Lo que falta para publicar ──────────────────────────────────────────

export type ShopSection = 'catalog' | 'orders' | 'payment' | 'coupons' | 'checkout' | 'seller' | 'design' | 'publish' | 'measure';

export interface ShopProblem {
    section: ShopSection;
    text: string;
}

/**
 * Lo que impide publicar. El Estatuto del Consumidor (Ley 1480) pide mostrar
 * quién vende, el precio total y las condiciones antes de comprar: sin eso la
 * tienda no sale.
 */
export function shopProblems(
    config: ShopConfig,
    ctx: { hasOrdersLists: boolean; priceFieldOk: boolean; onlineConnectionOk?: boolean; onlineCurrencyError?: string | null },
): ShopProblem[] {
    const out: ShopProblem[] = [];
    if (!config.catalog.price || !ctx.priceFieldOk) out.push({ section: 'catalog', text: 'Elige el campo del precio de los productos.' });
    if (!ctx.hasOrdersLists) out.push({ section: 'orders', text: 'Faltan las listas donde caen los pedidos.' });
    const p = config.payments;
    const anyPayment = p.whatsapp.enabled || p.transfer.enabled || p.cod.enabled || p.online.enabled;
    if (!anyPayment) out.push({ section: 'payment', text: 'Activa al menos una forma de pago.' });
    if (p.whatsapp.enabled && !shopWhatsappPhoneOk(p.whatsapp.phone)) {
        out.push({ section: 'payment', text: 'Escribe el número de WhatsApp con el indicativo (ej.: +57 300 111 2233).' });
    }
    if (p.transfer.enabled && p.transfer.instructions.trim() === '') {
        out.push({ section: 'payment', text: 'Escribe los datos para la transferencia.' });
    }
    if (p.online.enabled && (!p.online.connection_id || ctx.onlineConnectionOk === false)) {
        out.push({ section: 'payment', text: 'Elige la cuenta de cobro para el pago en línea.' });
    } else if (p.online.enabled && ctx.onlineCurrencyError) {
        out.push({ section: 'payment', text: ctx.onlineCurrencyError });
    }
    if (!config.delivery.some((d) => d.active && d.name.trim() !== '')) {
        out.push({ section: 'payment', text: 'Agrega al menos una forma de entrega.' });
    }
    const s = config.seller;
    if (!s.legal_name) out.push({ section: 'seller', text: 'Escribe el nombre o la razón social de quien vende.' });
    if (!s.document) out.push({ section: 'seller', text: 'Escribe el NIT o la cédula de quien vende.' });
    if (!s.email && !s.phone) out.push({ section: 'seller', text: 'Escribe un correo o un teléfono de contacto.' });
    if (!s.address || !s.city) out.push({ section: 'seller', text: 'Escribe la dirección y la ciudad de quien vende.' });
    if (!config.policies.returns.trim()) out.push({ section: 'seller', text: 'Escribe la política de devoluciones y retracto.' });
    return out;
}


export * from './shop-logic';
export * from './shop-stats-logic';

// ── v0.1.418 — Estadísticas de la tienda ──────────────────────────────────

/** Lo que manda la página pública (ver `shop-stats-logic.ts`). */
export const shopStatEventSchema = z.object({
    kind: z.enum(['view', 'product', 'add', 'checkout']),
    item: z.number().int().positive().max(999_999_999_999_999).optional(),
    first: z.boolean().optional(),
    src: z.string().max(130).optional(),
    dev: z.enum(SHOP_STAT_DEVICES).optional(),
});

export const shopStatEventsSchema = z.object({
    events: z.array(shopStatEventSchema).min(1).max(20),
});
export type ShopStatEventsInput = z.infer<typeof shopStatEventsSchema>;

// ── v0.1.415 — Cupones ──────────────────────────────────────────────────

const isoDate = z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional();

/** Lo que manda el editor al crear o cambiar un cupón. */
export const shopCouponInputSchema = z
    .object({
        code: z
            .string()
            .trim()
            .transform((v) => v.toUpperCase().replace(/\s+/g, ''))
            .pipe(z.string().regex(SHOP_COUPON_CODE_RE, 'El código usa letras, números, guion o guion bajo (2 a 40).')),
        description: z.string().trim().max(200).default(''),
        kind: z.enum(SHOP_COUPON_KINDS),
        value: z.number().min(0).max(1_000_000_000).default(0),
        /** Compra mínima (en productos, antes del descuento) para usarlo. */
        min_subtotal: z.number().min(0).max(1_000_000_000).nullable().default(null),
        /** Cuántas veces se puede usar en total (null = sin límite). */
        max_uses: z.number().int().min(1).max(1_000_000).nullable().default(null),
        /** Una vez por cliente (por su correo). */
        once_per_customer: z.boolean().default(false),
        /** Fechas en la zona de la empresa, AAAA-MM-DD (null = sin límite). */
        starts_on: isoDate.default(null),
        ends_on: isoDate.default(null),
        /** Sólo estos productos (por ID; un producto con variantes cubre todas). Vacío = todos. */
        product_ids: z.array(refId).max(200).default([]),
        /** Sólo estas categorías (el valor de la categoría). Vacío = todas. */
        categories: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
        active: z.boolean().default(true),
    })
    .superRefine((c, ctx) => {
        if (c.kind === 'percent' && (c.value <= 0 || c.value > 100)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'El porcentaje va de 1 a 100.' });
        if (c.kind === 'fixed' && c.value <= 0) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Escribe el monto del descuento.' });
        if (c.starts_on && c.ends_on && c.ends_on < c.starts_on) ctx.addIssue({ code: 'custom', path: ['ends_on'], message: 'La fecha final es antes de la inicial.' });
    });
export type ShopCouponInput = z.infer<typeof shopCouponInputSchema>;

export interface ShopCouponDto extends Omit<ShopCouponInput, 'starts_on' | 'ends_on'> {
    id: number;
    shop_id: number;
    starts_on: string | null;
    ends_on: string | null;
    /** Pedidos que lo usan (sin los cancelados). */
    uses: number;
    /** Lo que se descontó con él (sin los cancelados). */
    discounted: number;
    created_at: string;
}

