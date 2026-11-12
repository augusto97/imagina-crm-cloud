import { z } from 'zod';
import {
    SHOP_ITEM_ID_RE,
    SHOP_MAX_DELIVERY_METHODS,
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

export const shopDeliveryMethodSchema = z.object({
    id: z.string().regex(SHOP_ITEM_ID_RE),
    name: text(80),
    description: text(240),
    price: z.number().min(0).max(1_000_000_000).catch(0).default(0),
    /** Pide dirección y ciudad (envío a domicilio); si no, es retiro o digital. */
    needs_address: z.boolean().catch(true).default(true),
    active: z.boolean().catch(true).default(true),
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

export const shopConfigSchema = z.object({
    currency: z
        .string()
        .trim()
        .regex(/^[A-Z]{3}$/)
        .catch('COP')
        .default('COP'),
    catalog: shopCatalogFieldsSchema.catch(() => shopCatalogFieldsSchema.parse({})).default({}),
    variants: shopVariantsSchema.catch(() => shopVariantsSchema.parse({})).default({}),
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
            { id: 'domicilio', name: 'Envío a domicilio', description: '', price: 0, needs_address: true, active: true },
            { id: 'retiro', name: 'Recoger en el local', description: '', price: 0, needs_address: false, active: true },
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
}

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
    delivery_id: z.string().regex(SHOP_ITEM_ID_RE),
    payment_method: z.enum(SHOP_PAYMENT_METHODS),
    terms: z.boolean().default(false),
    consent: z.boolean().default(false),
    stamp: z.string().max(400),
    captcha: z.string().max(4096).optional(),
    /** Campo trampa: una persona nunca lo llena. */
    website: z.string().max(200).optional(),
    origin: z
        .object({ page: z.string().max(2000).optional(), referrer: z.string().max(2000).optional() })
        .partial()
        .optional(),
});
export type PublicShopOrderInput = z.infer<typeof publicShopOrderSchema>;

export const publicShopQuoteSchema = z.object({
    lines: z
        .array(z.object({ product_id: refId, qty: z.number().int().min(1).max(SHOP_MAX_QTY) }))
        .max(SHOP_MAX_LINES),
    delivery_id: z.string().regex(SHOP_ITEM_ID_RE).nullable().optional(),
});

// ── Lo que falta para publicar ──────────────────────────────────────────

export type ShopSection = 'catalog' | 'orders' | 'payment' | 'checkout' | 'seller' | 'design' | 'publish';

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
