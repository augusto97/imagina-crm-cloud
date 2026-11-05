import { z } from 'zod';
import { idSchema } from './common';

/**
 * Cobros de las EMPRESAS a sus clientes (v0.1.251–252, ADR-S31).
 *
 * Distinto del cobro de los planes (ADR-S30): aquí el dinero va a la cuenta de
 * Mercado Pago o Wompi de CADA empresa (sin comisión de la plataforma). Una
 * empresa conecta su cuenta en Integraciones, crea un link de pago desde un
 * registro o desde una automatización, y cuando el cliente paga la app se
 * entera sola —por el aviso del proveedor, verificado volviendo a leer el
 * pago con la credencial de la empresa— y lo escribe en el registro.
 */

// v0.1.372 — PayPal: cobros en dólares (u otra moneda que acepte PayPal) con
// la cuenta de la empresa. Ver `paypal-gateway.ts` en la API.
export const COLLECTION_PROVIDERS = ['mercadopago', 'wompi', 'paypal'] as const;
export const collectionProviderSchema = z.enum(COLLECTION_PROVIDERS);
export type CollectionProvider = z.infer<typeof collectionProviderSchema>;

export function isCollectionProvider(value: unknown): value is CollectionProvider {
    return typeof value === 'string' && (COLLECTION_PROVIDERS as readonly string[]).includes(value);
}

export const COLLECTION_PROVIDER_LABEL: Record<CollectionProvider, string> = {
    mercadopago: 'Mercado Pago',
    wompi: 'Wompi',
    paypal: 'PayPal',
};

/**
 * v0.1.372 — Monedas en que cobra PayPal (las de su API REST). PayPal NO cobra
 * en pesos colombianos: una empresa de Colombia cobra con PayPal en dólares.
 * Las tres sin decimales (JPY, HUF, TWD) se mandan sin centavos.
 */
export const PAYPAL_CURRENCIES = [
    'USD',
    'EUR',
    'MXN',
    'CAD',
    'GBP',
    'AUD',
    'BRL',
    'CHF',
    'JPY',
    'SEK',
    'NOK',
    'DKK',
    'PLN',
    'CZK',
    'HUF',
    'ILS',
    'NZD',
    'SGD',
    'HKD',
    'PHP',
    'THB',
    'TWD',
    'MYR',
    'CNY',
] as const;
export const PAYPAL_ZERO_DECIMAL_CURRENCIES: readonly string[] = ['JPY', 'HUF', 'TWD'];

/** Las monedas que se ofrecen al cobrar, por proveedor (la primera es la sugerida). */
export const COLLECTION_CURRENCY_OPTIONS: Record<CollectionProvider, ReadonlyArray<{ value: string; label: string }>> = {
    mercadopago: [
        { value: 'COP', label: 'Peso colombiano (COP)' },
        { value: 'MXN', label: 'Peso mexicano (MXN)' },
        { value: 'ARS', label: 'Peso argentino (ARS)' },
        { value: 'CLP', label: 'Peso chileno (CLP)' },
        { value: 'PEN', label: 'Sol peruano (PEN)' },
        { value: 'UYU', label: 'Peso uruguayo (UYU)' },
        { value: 'BRL', label: 'Real (BRL)' },
    ],
    wompi: [{ value: 'COP', label: 'Peso colombiano (COP)' }],
    paypal: [
        { value: 'USD', label: 'Dólar estadounidense (USD)' },
        { value: 'EUR', label: 'Euro (EUR)' },
        { value: 'MXN', label: 'Peso mexicano (MXN)' },
        { value: 'CAD', label: 'Dólar canadiense (CAD)' },
        { value: 'GBP', label: 'Libra esterlina (GBP)' },
        { value: 'AUD', label: 'Dólar australiano (AUD)' },
        { value: 'BRL', label: 'Real (BRL)' },
        { value: 'CHF', label: 'Franco suizo (CHF)' },
        { value: 'JPY', label: 'Yen (JPY)' },
    ],
};

/** La moneda con la que arranca un cobro de ese proveedor. */
export function defaultCollectionCurrency(provider: CollectionProvider): string {
    return COLLECTION_CURRENCY_OPTIONS[provider][0]!.value;
}

/**
 * v0.1.372 — ¿Ese proveedor cobra en esa moneda? (null = sí). Mercado Pago
 * cobra en la moneda de la cuenta (la valida él); Wompi sólo en pesos; PayPal,
 * en las de su lista.
 */
export function collectionCurrencyError(provider: CollectionProvider, currency: string): string | null {
    const c = currency.trim().toUpperCase();
    if (provider === 'wompi') return c === 'COP' ? null : 'Wompi sólo cobra en pesos colombianos (COP).';
    if (provider === 'paypal') {
        if ((PAYPAL_CURRENCIES as readonly string[]).includes(c)) return null;
        return c === 'COP'
            ? 'PayPal no cobra en pesos colombianos (COP): cobra en dólares (USD) u otra moneda que acepte PayPal.'
            : `PayPal no cobra en ${c}: usa dólares (USD) u otra moneda que acepte PayPal.`;
    }
    return null;
}

/** La moneda que se usa de verdad: la pedida si el proveedor la acepta; si no, la suya. */
export function collectionCurrencyFor(provider: CollectionProvider, currency: string | null | undefined): string {
    const c = (currency ?? '').trim().toUpperCase();
    if (c !== '' && collectionCurrencyError(provider, c) === null) return c;
    return defaultCollectionCurrency(provider);
}

/**
 * Estado de un link. `mismatch` = el proveedor dice «aprobado» pero por otro
 * monto o moneda: se marca para revisar en vez de darlo por pagado.
 */
export const PAYMENT_LINK_STATUSES = [
    'pending',
    'approved',
    'rejected',
    'expired',
    'cancelled',
    'refunded',
    'mismatch',
] as const;
export const paymentLinkStatusSchema = z.enum(PAYMENT_LINK_STATUSES);
export type PaymentLinkStatus = z.infer<typeof paymentLinkStatusSchema>;

/**
 * Cómo se ve cada estado en la columna «Estado del pago» de la lista: es un
 * select común (se filtra, se agrupa y dispara automatizaciones), con estos
 * values estables y estas etiquetas/colores.
 */
export const PAYMENT_STATUS_OPTIONS: Record<PaymentLinkStatus, { value: string; label: string; color: string }> = {
    pending: { value: 'pendiente', label: 'Pendiente', color: '#F59E0B' },
    approved: { value: 'pagado', label: 'Pagado', color: '#10B981' },
    rejected: { value: 'rechazado', label: 'Rechazado', color: '#EF4444' },
    expired: { value: 'vencido', label: 'Vencido', color: '#6B7280' },
    cancelled: { value: 'anulado', label: 'Anulado', color: '#9CA3AF' },
    refunded: { value: 'reembolsado', label: 'Reembolsado', color: '#8B5CF6' },
    mismatch: { value: 'monto_distinto', label: 'Monto distinto', color: '#F97316' },
};

/** Un estado "cerrado" ya no cambia solo (salvo un reembolso de lo pagado). */
export function isFinalPaymentStatus(status: PaymentLinkStatus): boolean {
    return status !== 'pending';
}

export const paymentLinkSchema = z.object({
    id: idSchema,
    provider: collectionProviderSchema,
    connection_id: idSchema.nullable(),
    connection_name: z.string().nullable(),
    list_id: idSchema,
    record_id: idSchema,
    title: z.string(),
    amount: z.number(),
    currency: z.string(),
    status: paymentLinkStatusSchema,
    url: z.string(),
    payer_email: z.string().nullable(),
    expires_at: z.string().nullable(),
    /** Lo que efectivamente se pagó (puede diferir del monto pedido). */
    paid_amount: z.number().nullable(),
    paid_at: z.string().nullable(),
    /** «PSE», «Nequi», «Tarjeta de crédito»… */
    method: z.string().nullable(),
    /** Id del pago/transacción en el proveedor. */
    payment_id: z.string().nullable(),
    /** Motivo legible de un rechazo o de un monto distinto. */
    note: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    last_checked_at: z.string().nullable(),
});
export type PaymentLink = z.infer<typeof paymentLinkSchema>;

/** Un link con el contexto para el listado de la conexión. */
export const paymentLinkRowSchema = paymentLinkSchema.extend({
    list_name: z.string(),
    list_slug: z.string(),
    record_title: z.string(),
});
export type PaymentLinkRow = z.infer<typeof paymentLinkRowSchema>;

export const createPaymentLinkSchema = z.object({
    connection_id: idSchema,
    title: z.string().trim().min(1, 'Escribe el concepto').max(200),
    amount: z.coerce.number().positive('El monto tiene que ser mayor a cero').max(1_000_000_000),
    currency: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{3}$/, 'Moneda inválida')
        .default('COP'),
    payer_email: z.string().trim().email('Correo inválido').max(254).nullish(),
    expires_days: z.coerce.number().int().min(1).max(365).nullish(),
});
export type CreatePaymentLinkInput = z.infer<typeof createPaymentLinkSchema>;

/** Una conexión que sirve para cobrar (Mercado Pago, Wompi o PayPal). */
export const collectionConnectionSchema = z.object({
    id: idSchema,
    name: z.string(),
    provider: collectionProviderSchema,
    account_label: z.string().nullable(),
    /** Credencial de prueba (sandbox): los pagos no son dinero real. */
    test_mode: z.boolean(),
    /**
     * v0.1.289 — conexión del EQUIPO (no privada de una persona): la única
     * que puede usar el botón «Pagar» del portal del cliente.
     */
    shared: z.boolean().default(true),
});
export type CollectionConnection = z.infer<typeof collectionConnectionSchema>;

/**
 * Las columnas de la lista donde se escribe el cobro. Cualquiera puede faltar
 * (la persona las borró o eligió no usarlas): el link igual queda guardado.
 */
export const COLLECTION_FIELD_ROLES = ['link', 'status', 'paid_at', 'paid_amount', 'method'] as const;
export type CollectionFieldRole = (typeof COLLECTION_FIELD_ROLES)[number];

export const collectionFieldsSchema = z.object({
    link: idSchema.nullable().default(null),
    status: idSchema.nullable().default(null),
    paid_at: idSchema.nullable().default(null),
    paid_amount: idSchema.nullable().default(null),
    method: idSchema.nullable().default(null),
});
export type CollectionFields = z.infer<typeof collectionFieldsSchema>;

/** Cómo se lee `lists.settings.collections` (tolerante: nunca lanza). */
export function readCollectionFields(settings: unknown): CollectionFields | null {
    const raw = (settings as { collections?: { fields?: unknown } } | null | undefined)?.collections?.fields;
    if (!raw || typeof raw !== 'object') return null;
    const parsed = collectionFieldsSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

/**
 * v0.1.365 — Qué tipos de columna sirven para cada dato del cobro. Elegir una
 * columna que ya existe (el «Link de pago» que la empresa creó a mano, o
 * «Pagos recientes» como fecha de pago para que dispare su automatización de
 * renovación) es tan válido como crear las nuevas.
 */
export const COLLECTION_FIELD_TYPES: Record<CollectionFieldRole, readonly string[]> = {
    link: ['url', 'text'],
    status: ['select', 'text'],
    paid_at: ['datetime', 'date'],
    paid_amount: ['currency', 'number'],
    method: ['text', 'select'],
};

/** Lo que se manda para elegir las columnas: un id, `'create'` (columna nueva) o null (no se guarda). */
const collectionFieldChoice = z.union([idSchema, z.literal('create')]).nullable().optional();
export const setCollectionFieldsSchema = z.object({
    link: collectionFieldChoice,
    status: collectionFieldChoice,
    paid_at: collectionFieldChoice,
    paid_amount: collectionFieldChoice,
    method: collectionFieldChoice,
});
export type SetCollectionFieldsInput = z.infer<typeof setCollectionFieldsSchema>;

/** Nombres que se reconocen como esa columna al sugerir (sin acentos ni mayúsculas). */
const SUGGEST_LABELS: Record<CollectionFieldRole, readonly string[]> = {
    link: ['link de pago', 'enlace de pago', 'link del pago', 'url de pago', 'link pago', 'link para pagar'],
    status: ['estado del pago', 'estado de pago', 'estado pago'],
    paid_at: ['fecha de pago', 'fecha del pago', 'pagado el', 'fecha pago'],
    paid_amount: ['monto pagado', 'valor pagado', 'pagado'],
    method: ['medio de pago', 'metodo de pago usado', 'medio del pago'],
};

function normLabel(label: string): string {
    return label
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/** ¿Un select ya tiene los estados del pago como opciones? */
function hasPaymentOptions(config: unknown): boolean {
    const opts = (config as { options?: unknown } | null | undefined)?.options;
    if (!Array.isArray(opts)) return false;
    const values = new Set(opts.map((o) => (o && typeof o === 'object' ? (o as { value?: unknown }).value : null)));
    return values.has(PAYMENT_STATUS_OPTIONS.pending.value) && values.has(PAYMENT_STATUS_OPTIONS.approved.value);
}

/**
 * v0.1.365 — Las columnas que YA tiene la lista y sirven para el cobro, por su
 * nombre y tipo (puro: lo usan el servidor al «Agregar columnas» y la pantalla
 * para proponer). Lo que ya está elegido se respeta; un estado sólo se adopta
 * si es texto o una lista de opciones que ya tiene los estados del pago.
 */
export function suggestCollectionFields(
    fields: ReadonlyArray<{ id: number; label: string; type: string; config?: unknown }>,
    current: CollectionFields | null,
): CollectionFields {
    const out: CollectionFields = current ? { ...current } : { link: null, status: null, paid_at: null, paid_amount: null, method: null };
    const alive = new Set(fields.map((f) => f.id));
    for (const role of COLLECTION_FIELD_ROLES) if (out[role] !== null && !alive.has(out[role]!)) out[role] = null;
    const taken = new Set(COLLECTION_FIELD_ROLES.map((r) => out[r]).filter((id): id is number => id !== null));
    for (const role of COLLECTION_FIELD_ROLES) {
        if (out[role] !== null) continue;
        const names = SUGGEST_LABELS[role];
        const hit = fields.find(
            (f) =>
                !taken.has(f.id) &&
                COLLECTION_FIELD_TYPES[role].includes(f.type) &&
                names.includes(normLabel(f.label)) &&
                (role !== 'status' || f.type === 'text' || hasPaymentOptions(f.config)),
        );
        if (hit) {
            out[role] = hit.id;
            taken.add(hit.id);
        }
    }
    return out;
}

export const COLLECTION_FIELD_LABELS: Record<CollectionFieldRole, string> = {
    link: 'Link de pago',
    status: 'Estado del pago',
    paid_at: 'Fecha de pago',
    paid_amount: 'Monto pagado',
    method: 'Medio de pago',
};

/** Lo que muestra el panel «Cobros» de un registro. */
export const recordPaymentsSchema = z.object({
    links: z.array(paymentLinkSchema),
    connections: z.array(collectionConnectionSchema),
    /** Columnas de cobro de la lista (null = la lista todavía no las tiene). */
    fields: z
        .object({
            link: z.string().nullable(),
            status: z.string().nullable(),
            paid_at: z.string().nullable(),
            paid_amount: z.string().nullable(),
            method: z.string().nullable(),
        })
        .nullable(),
    /** Puede crear las columnas de cobro (manage_fields). */
    can_setup: z.boolean(),
    /** Sugerencias para el formulario: el título del registro y un monto/correo de sus campos. */
    suggested: z.object({
        title: z.string(),
        amount: z.number().nullable(),
        currency: z.string().nullable(),
        payer_email: z.string().nullable(),
    }),
});
export type RecordPayments = z.infer<typeof recordPaymentsSchema>;

/** El detalle de una conexión de cobro (página «Cobros» de la integración). */
export const collectionConnectionDetailSchema = z.object({
    connection: collectionConnectionSchema,
    /** URL a la que el proveedor manda los avisos de pago. */
    hook_url: z.string(),
    /** Wompi necesita que la URL se pegue en su panel; Mercado Pago no. */
    hook_needs_setup: z.boolean(),
    /** Wompi: si se cargó el secreto de eventos (sin él, sólo se valida releyendo). */
    events_secret_set: z.boolean(),
    /** Último aviso recibido (para saber si la URL quedó bien pegada). */
    last_hook_at: z.string().nullable(),
    /**
     * v0.1.372 — PayPal: la app registró sola la URL de avisos en la cuenta
     * (`true`), o no pudo (`hook_error` dice por qué y la URL se pega a mano).
     */
    hook_auto: z.boolean().default(false),
    hook_error: z.string().nullable().default(null),
    links: z.array(paymentLinkRowSchema),
    totals: z.object({
        pending: z.number(),
        approved: z.number(),
        approved_amount: z.number(),
    }),
});
export type CollectionConnectionDetail = z.infer<typeof collectionConnectionDetailSchema>;

/** Merge tags que deja disponibles una acción de cobro y el trigger de pago. */
export const PAYMENT_MERGE_TAGS: Array<{ tag: string; label: string }> = [
    { tag: 'pago.link', label: 'Link de pago' },
    { tag: 'pago.monto', label: 'Monto del link' },
    { tag: 'pago.estado', label: 'Estado del pago' },
    { tag: 'pago.monto_pagado', label: 'Monto pagado' },
    { tag: 'pago.metodo', label: 'Medio de pago' },
    { tag: 'pago.fecha', label: 'Fecha de pago' },
    { tag: 'pago.concepto', label: 'Concepto' },
    { tag: 'pago.id', label: 'Id del pago en el proveedor' },
];
