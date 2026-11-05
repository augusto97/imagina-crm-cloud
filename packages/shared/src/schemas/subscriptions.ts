import { z } from 'zod';
import { idSchema } from './common';

/**
 * Suscripciones de las EMPRESAS a sus clientes (v0.1.367, ADR-S96).
 *
 * Distinto de la renovación automática de los planes de la plataforma
 * (ADR-S30): aquí la empresa le cobra a SUS clientes todos los meses con SU
 * cuenta de Mercado Pago. La empresa arma sus planes («Hosting mensual»,
 * «Soporte anual»), le manda al cliente un link, el cliente pone su tarjeta en
 * la página de Mercado Pago (nunca la vemos) y desde ahí Mercado Pago cobra
 * solo cada período.
 *
 * Una suscripción vive en UN registro (el cliente, o mejor el servicio o el
 * contrato si un cliente tiene varios). La app lleva SU propio estado —al
 * día, reintentando, en mora, vencida…— a partir de lo que dice Mercado Pago
 * y de los días de gracia del plan: es lo que permite saber qué se pagó, qué
 * no y a quién hay que cortarle el servicio.
 */

export const SUBSCRIPTION_PROVIDERS = ['mercadopago', 'paypal'] as const;
export const subscriptionProviderSchema = z.enum(SUBSCRIPTION_PROVIDERS);
export type SubscriptionProvider = z.infer<typeof subscriptionProviderSchema>;

export function isSubscriptionProvider(value: unknown): value is SubscriptionProvider {
    return typeof value === 'string' && (SUBSCRIPTION_PROVIDERS as readonly string[]).includes(value);
}

export const SUBSCRIPTION_FREQUENCY_TYPES = ['months', 'days'] as const;
export type SubscriptionFrequencyType = (typeof SUBSCRIPTION_FREQUENCY_TYPES)[number];

/**
 * Qué pasa cuando una suscripción VENCE (pasaron los días de gracia sin
 * pago): `mark` = queda «Vencida» y avisa (lo recomendado: si el cliente paga
 * tarde, vuelve sola a «Al día»); `cancel` = además se cancela en Mercado
 * Pago (no vuelve a cobrar; para retomarla hay que mandar un link nuevo).
 */
export const SUBSCRIPTION_EXPIRE_ACTIONS = ['mark', 'cancel'] as const;
export type SubscriptionExpireAction = (typeof SUBSCRIPTION_EXPIRE_ACTIONS)[number];

const currencySchema = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Moneda inválida');

const planFields = {
    name: z.string().trim().min(1, 'Ponle un nombre al plan').max(120),
    description: z.string().trim().max(500).nullish(),
    amount: z.coerce.number().positive('El valor tiene que ser mayor a cero').max(1_000_000_000),
    currency: currencySchema,
    /** Cada cuánto se cobra: `frequency` × `frequency_type` (1 mes, 3 meses, 15 días). */
    frequency: z.coerce.number().int().min(1).max(365),
    frequency_type: z.enum(SUBSCRIPTION_FREQUENCY_TYPES),
    /** Cuántos cobros en total (12 = un año de mensualidades). Vacío = hasta que se cancele. */
    cycles: z.coerce.number().int().min(1).max(120).nullish(),
    /** Días gratis antes del primer cobro. */
    trial_days: z.coerce.number().int().min(0).max(365),
    /**
     * Días después del vencimiento en los que el servicio sigue sin pago antes
     * de quedar «Vencida». Mercado Pago reintenta una cuota rechazada hasta 4
     * veces en unos 10 días: con 10 días de gracia, termina de reintentar antes.
     */
    grace_days: z.coerce.number().int().min(1).max(60),
    on_expire: z.enum(SUBSCRIPTION_EXPIRE_ACTIONS),
};

function frequencyOk(v: { frequency?: number; frequency_type?: SubscriptionFrequencyType }): boolean {
    if (v.frequency === undefined || v.frequency_type === undefined) return true;
    return v.frequency_type === 'days' ? v.frequency <= 365 : v.frequency <= 12;
}
const FREQUENCY_MESSAGE = { message: 'Cada cuánto se cobra: hasta 12 meses o 365 días.', path: ['frequency'] };

export const createSubscriptionPlanSchema = z
    .object({
        connection_id: idSchema,
        ...planFields,
        currency: currencySchema.default('COP'),
        frequency: planFields.frequency.default(1),
        frequency_type: planFields.frequency_type.default('months'),
        trial_days: planFields.trial_days.default(0),
        grace_days: planFields.grace_days.default(10),
        on_expire: planFields.on_expire.default('mark'),
    })
    .refine(frequencyOk, FREQUENCY_MESSAGE);
export type CreateSubscriptionPlanInput = z.infer<typeof createSubscriptionPlanSchema>;

/**
 * Cambiar un plan vale para las suscripciones NUEVAS: las que ya existen
 * conservan el valor y la frecuencia que el cliente autorizó (cambiarle el
 * monto a una suscripción puntual es «Cambiar el valor» en su ficha).
 */
export const updateSubscriptionPlanSchema = z
    .object(planFields)
    .partial()
    .extend({ active: z.boolean().optional() })
    .refine(frequencyOk, FREQUENCY_MESSAGE);
export type UpdateSubscriptionPlanInput = z.infer<typeof updateSubscriptionPlanSchema>;

export const subscriptionPlanSchema = z.object({
    id: idSchema,
    connection_id: idSchema.nullable(),
    connection_name: z.string().nullable(),
    provider: subscriptionProviderSchema,
    name: z.string(),
    description: z.string().nullable(),
    amount: z.number(),
    currency: z.string(),
    frequency: z.number(),
    frequency_type: z.enum(SUBSCRIPTION_FREQUENCY_TYPES),
    cycles: z.number().nullable(),
    trial_days: z.number(),
    grace_days: z.number(),
    on_expire: z.enum(SUBSCRIPTION_EXPIRE_ACTIONS),
    active: z.boolean(),
    /** Suscripciones vivas (no canceladas ni terminadas) y en total. */
    subscribers: z.object({ live: z.number(), total: z.number() }),
    created_at: z.string(),
    updated_at: z.string(),
});
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;

/**
 * El estado que lleva la APP (no el de Mercado Pago, que sólo dice
 * pendiente / autorizada / pausada / cancelada):
 *
 * - `pending`   Por autorizar: se mandó el link y el cliente no puso la tarjeta.
 * - `active`    Al día: el período actual está pagado (o está en la prueba gratis).
 * - `retrying`  Reintentando: falló el cobro del período y Mercado Pago reintenta.
 * - `past_due`  En mora: se agotaron los reintentos; sigue en los días de gracia.
 * - `expired`   Vencida: pasaron los días de gracia sin pago (cortar el servicio).
 * - `paused`    Pausada (la empresa o el cliente).
 * - `cancelled` Cancelada (el cliente, la empresa o Mercado Pago tras 3 cuotas rechazadas).
 * - `finished`  Terminada: se cobraron todas las cuotas del plan.
 */
export const SUBSCRIPTION_STATUSES = ['pending', 'active', 'retrying', 'past_due', 'expired', 'paused', 'cancelled', 'finished'] as const;
export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

/** Cómo se ve cada estado en la columna «Estado de la suscripción» (un select con values estables). */
export const SUBSCRIPTION_STATUS_OPTIONS: Record<SubscriptionStatus, { value: string; label: string; color: string }> = {
    pending: { value: 'por_autorizar', label: 'Por autorizar', color: '#F59E0B' },
    active: { value: 'al_dia', label: 'Al día', color: '#10B981' },
    retrying: { value: 'reintentando', label: 'Reintentando', color: '#F97316' },
    past_due: { value: 'en_mora', label: 'En mora', color: '#E11D48' },
    expired: { value: 'vencida', label: 'Vencida', color: '#B91C1C' },
    paused: { value: 'pausada', label: 'Pausada', color: '#64748B' },
    cancelled: { value: 'cancelada', label: 'Cancelada', color: '#9CA3AF' },
    finished: { value: 'terminada', label: 'Terminada', color: '#8B5CF6' },
};

/** Estados en los que la suscripción sigue viva (puede volver a cobrar). */
export function isLiveSubscriptionStatus(status: SubscriptionStatus): boolean {
    return status !== 'cancelled' && status !== 'finished';
}

/** Lo que dice Mercado Pago de la suscripción (lo leemos, no lo decidimos). */
export const SUBSCRIPTION_PROVIDER_STATUSES = ['pending', 'authorized', 'paused', 'cancelled'] as const;
export type SubscriptionProviderStatus = (typeof SUBSCRIPTION_PROVIDER_STATUSES)[number];

export const SUBSCRIPTION_CHARGE_STATUSES = ['approved', 'rejected', 'pending', 'refunded'] as const;
export type SubscriptionChargeStatus = (typeof SUBSCRIPTION_CHARGE_STATUSES)[number];

export const SUBSCRIPTION_CHARGE_STATUS_LABELS: Record<SubscriptionChargeStatus, string> = {
    approved: 'Pagado',
    rejected: 'Rechazado',
    pending: 'Procesando',
    refunded: 'Reembolsado',
};

/** Un cobro (cada intento de cobrar una cuota es una fila: el historial muestra los reintentos). */
export const subscriptionChargeSchema = z.object({
    id: idSchema,
    subscription_id: idSchema,
    provider_payment_id: z.string(),
    amount: z.number(),
    currency: z.string(),
    status: z.enum(SUBSCRIPTION_CHARGE_STATUSES),
    /** Número de reintento de esa cuota (null = el primer intento o no se sabe). */
    attempt: z.number().nullable(),
    failure_reason: z.string().nullable(),
    method: z.string().nullable(),
    /** El período que cubre (la fecha en que tocaba cobrar). */
    period_start: z.string().nullable(),
    paid_at: z.string().nullable(),
    created_at: z.string(),
});
export type SubscriptionCharge = z.infer<typeof subscriptionChargeSchema>;

export const subscriptionSchema = z.object({
    id: idSchema,
    provider: subscriptionProviderSchema,
    connection_id: idSchema.nullable(),
    connection_name: z.string().nullable(),
    plan_id: idSchema.nullable(),
    plan_name: z.string().nullable(),
    /** null = el registro se borró (la suscripción sigue: se puede cancelar desde la conexión). */
    list_id: idSchema.nullable(),
    record_id: idSchema.nullable(),
    title: z.string(),
    amount: z.number(),
    currency: z.string(),
    frequency: z.number(),
    frequency_type: z.enum(SUBSCRIPTION_FREQUENCY_TYPES),
    cycles: z.number().nullable(),
    grace_days: z.number(),
    on_expire: z.enum(SUBSCRIPTION_EXPIRE_ACTIONS),
    status: subscriptionStatusSchema,
    provider_status: z.string().nullable(),
    /** El link para que el cliente autorice la tarjeta (sólo mientras está «Por autorizar»). */
    url: z.string().nullable(),
    payer_email: z.string().nullable(),
    start_at: z.string().nullable(),
    next_charge_at: z.string().nullable(),
    paid_until: z.string().nullable(),
    charges_paid: z.number(),
    charges_failed: z.number(),
    consecutive_failed: z.number(),
    last_charge_at: z.string().nullable(),
    last_charge_status: z.enum(SUBSCRIPTION_CHARGE_STATUSES).nullable(),
    last_failure_reason: z.string().nullable(),
    cancelled_at: z.string().nullable(),
    cancel_reason: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    last_checked_at: z.string().nullable(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const subscriptionWithChargesSchema = subscriptionSchema.extend({ charges: z.array(subscriptionChargeSchema) });
export type SubscriptionWithCharges = z.infer<typeof subscriptionWithChargesSchema>;

/** Una suscripción con el contexto para la página de la conexión. */
export const subscriptionRowSchema = subscriptionSchema.extend({
    list_name: z.string().nullable(),
    list_slug: z.string().nullable(),
    record_title: z.string().nullable(),
});
export type SubscriptionRow = z.infer<typeof subscriptionRowSchema>;

/** «Suscribir» desde un registro. El correo es obligatorio: Mercado Pago lo pide. */
export const createSubscriptionSchema = z.object({
    plan_id: idSchema,
    payer_email: z.string().trim().email('Escribe el correo del cliente: Mercado Pago lo pide').max(254),
    /** Otro valor para ESTE cliente (un descuento). Vacío = el del plan. */
    amount: z.coerce.number().positive('El valor tiene que ser mayor a cero').max(1_000_000_000).nullish(),
    /** Desde qué día cobra (AAAA-MM-DD). Vacío = hoy, después de la prueba gratis del plan. */
    start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
        .nullish(),
    /** Lo que ve el cliente en Mercado Pago. Vacío = el nombre del plan. */
    title: z.string().trim().max(200).nullish(),
});
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

export const changeSubscriptionAmountSchema = z.object({
    amount: z.coerce.number().positive('El valor tiene que ser mayor a cero').max(1_000_000_000),
});
export type ChangeSubscriptionAmountInput = z.infer<typeof changeSubscriptionAmountSchema>;

export const cancelSubscriptionSchema = z.object({
    reason: z.string().trim().max(300).nullish(),
});
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;

// ── Columnas de la suscripción en la lista ───────────────────────────────

/**
 * Las columnas de la lista donde se escribe la suscripción (como las de cobro
 * de v0.1.365): con ellas se filtra «quién está en mora», se agrupa por estado
 * y se suma el ingreso de la lista. Cualquiera puede faltar.
 */
export const SUBSCRIPTION_FIELD_ROLES = ['status', 'plan', 'amount', 'next_charge', 'paid_until', 'failed', 'link'] as const;
export type SubscriptionFieldRole = (typeof SUBSCRIPTION_FIELD_ROLES)[number];

export const subscriptionFieldsSchema = z.object({
    status: idSchema.nullable().default(null),
    plan: idSchema.nullable().default(null),
    amount: idSchema.nullable().default(null),
    next_charge: idSchema.nullable().default(null),
    paid_until: idSchema.nullable().default(null),
    failed: idSchema.nullable().default(null),
    link: idSchema.nullable().default(null),
});
export type SubscriptionFields = z.infer<typeof subscriptionFieldsSchema>;

export const EMPTY_SUBSCRIPTION_FIELDS: SubscriptionFields = {
    status: null,
    plan: null,
    amount: null,
    next_charge: null,
    paid_until: null,
    failed: null,
    link: null,
};

/** Cómo se lee `lists.settings.subscriptions.fields` (tolerante: nunca lanza). */
export function readSubscriptionFields(settings: unknown): SubscriptionFields | null {
    const raw = (settings as { subscriptions?: { fields?: unknown } } | null | undefined)?.subscriptions?.fields;
    if (!raw || typeof raw !== 'object') return null;
    const parsed = subscriptionFieldsSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

export const SUBSCRIPTION_FIELD_TYPES: Record<SubscriptionFieldRole, readonly string[]> = {
    status: ['select', 'text'],
    plan: ['text', 'select'],
    amount: ['currency', 'number'],
    next_charge: ['date', 'datetime'],
    paid_until: ['date', 'datetime'],
    failed: ['number'],
    link: ['url', 'text'],
};

export const SUBSCRIPTION_FIELD_LABELS: Record<SubscriptionFieldRole, string> = {
    status: 'Estado de la suscripción',
    plan: 'Plan',
    amount: 'Valor de la suscripción',
    next_charge: 'Próximo cobro',
    paid_until: 'Pagado hasta',
    failed: 'Cobros fallidos',
    link: 'Link de la suscripción',
};

const choice = z.union([idSchema, z.literal('create')]).nullable().optional();
export const setSubscriptionFieldsSchema = z.object({
    status: choice,
    plan: choice,
    amount: choice,
    next_charge: choice,
    paid_until: choice,
    failed: choice,
    link: choice,
});
export type SetSubscriptionFieldsInput = z.infer<typeof setSubscriptionFieldsSchema>;

const SUGGEST_LABELS: Record<SubscriptionFieldRole, readonly string[]> = {
    status: ['estado de la suscripcion', 'estado suscripcion', 'estado de suscripcion'],
    plan: ['plan', 'plan de suscripcion', 'plan contratado'],
    amount: ['valor de la suscripcion', 'valor mensual', 'mensualidad', 'valor del plan', 'cuota mensual'],
    next_charge: ['proximo cobro', 'proximo pago', 'fecha del proximo cobro'],
    paid_until: ['pagado hasta', 'vigente hasta', 'al dia hasta'],
    failed: ['cobros fallidos', 'pagos fallidos', 'cuotas fallidas'],
    link: ['link de la suscripcion', 'link de suscripcion', 'enlace de suscripcion'],
};

function norm(label: string): string {
    return label
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function hasStatusOptions(config: unknown): boolean {
    const opts = (config as { options?: unknown } | null | undefined)?.options;
    if (!Array.isArray(opts)) return false;
    const values = new Set(opts.map((o) => (o && typeof o === 'object' ? (o as { value?: unknown }).value : null)));
    return values.has(SUBSCRIPTION_STATUS_OPTIONS.active.value) && values.has(SUBSCRIPTION_STATUS_OPTIONS.expired.value);
}

/** Las columnas que YA tiene la lista y sirven (puro: servidor y pantalla). */
export function suggestSubscriptionFields(
    fields: ReadonlyArray<{ id: number; label: string; type: string; config?: unknown }>,
    current: SubscriptionFields | null,
): SubscriptionFields {
    const out: SubscriptionFields = current ? { ...current } : { ...EMPTY_SUBSCRIPTION_FIELDS };
    const alive = new Set(fields.map((f) => f.id));
    for (const role of SUBSCRIPTION_FIELD_ROLES) if (out[role] !== null && !alive.has(out[role]!)) out[role] = null;
    const taken = new Set(SUBSCRIPTION_FIELD_ROLES.map((r) => out[r]).filter((id): id is number => id !== null));
    for (const role of SUBSCRIPTION_FIELD_ROLES) {
        if (out[role] !== null) continue;
        const names = SUGGEST_LABELS[role];
        const hit = fields.find(
            (f) =>
                !taken.has(f.id) &&
                SUBSCRIPTION_FIELD_TYPES[role].includes(f.type) &&
                names.includes(norm(f.label)) &&
                (role !== 'status' || f.type === 'text' || hasStatusOptions(f.config)),
        );
        if (hit) {
            out[role] = hit.id;
            taken.add(hit.id);
        }
    }
    return out;
}

/** Lo que muestra el panel «Suscripción» de un registro. */
export const recordSubscriptionsSchema = z.object({
    subscriptions: z.array(subscriptionWithChargesSchema),
    /** Planes activos de las conexiones que la persona puede usar. */
    plans: z.array(subscriptionPlanSchema),
    fields: z.record(z.string(), z.string().nullable()).nullable(),
    can_setup: z.boolean(),
    can_edit: z.boolean(),
    suggested: z.object({ title: z.string(), payer_email: z.string().nullable() }),
});
export type RecordSubscriptions = z.infer<typeof recordSubscriptionsSchema>;

/** El resumen de suscripciones de una conexión (página «Cobros»). */
/**
 * v0.1.380 — La última vez que la app le pidió a Mercado Pago las cuotas de
 * una suscripción de una conexión: si las entregó o qué respondió.
 */
export const subscriptionInvoiceReadSchema = z.object({
    at: z.string(),
    ok: z.boolean(),
    /** El código HTTP (0 = no respondió). */
    status: z.number(),
    message: z.string().nullable(),
    count: z.number(),
    subscription_id: z.number(),
});
export type SubscriptionInvoiceRead = z.infer<typeof subscriptionInvoiceReadSchema>;

export const subscriptionsOverviewSchema = z.object({
    plans: z.array(subscriptionPlanSchema),
    totals: z.object({
        live: z.number(),
        active: z.number(),
        retrying: z.number(),
        past_due: z.number(),
        expired: z.number(),
        pending: z.number(),
        cancelled_30d: z.number(),
        /** Ingreso mensual de las vivas (cada plan llevado a un mes), en la moneda más usada. */
        monthly: z.number(),
        currency: z.string(),
        /** Cobrado y fallido en los últimos 30 días. */
        charged_30d: z.number(),
        failed_30d: z.number(),
    }),
    subscriptions: z.array(subscriptionRowSchema),
    charges: z.array(
        subscriptionChargeSchema.extend({
            record_title: z.string().nullable(),
            list_slug: z.string().nullable(),
            record_id: idSchema.nullable(),
            plan_name: z.string().nullable(),
        }),
    ),
    /**
     * v0.1.380 — La última vez que la app le pidió a Mercado Pago las cuotas
     * de una suscripción de esta conexión: si las entregó o qué respondió
     * (null = todavía no se pidió, o es PayPal).
     */
    invoice_read: subscriptionInvoiceReadSchema.nullable().default(null),
});
export type SubscriptionsOverview = z.infer<typeof subscriptionsOverviewSchema>;

// ── Disparador «Cuando cambia una suscripción» ───────────────────────────

export const SUBSCRIPTION_EVENTS = [
    'activated',
    'charged',
    'charge_failed',
    'past_due',
    'expired',
    'paused',
    'resumed',
    'cancelled',
    'finished',
] as const;
export type SubscriptionEvent = (typeof SUBSCRIPTION_EVENTS)[number];

export const SUBSCRIPTION_EVENT_LABELS: Record<SubscriptionEvent, string> = {
    activated: 'Se activó (el cliente autorizó la tarjeta)',
    charged: 'Se cobró una cuota',
    charge_failed: 'Falló un cobro (Mercado Pago reintenta)',
    past_due: 'Entró en mora (se agotaron los reintentos)',
    expired: 'Venció sin pago (pasaron los días de gracia)',
    paused: 'Se pausó',
    resumed: 'Se reanudó',
    cancelled: 'Se canceló',
    finished: 'Terminó (se cobraron todas las cuotas)',
};

/** Lo que el disparador le pasa a las acciones como `{{suscripcion.x}}`. */
export interface SubscriptionEventInfo {
    subscription_id: number;
    plan_id: number | null;
    evento: SubscriptionEvent;
    /** Etiqueta del estado («Al día», «Vencida»). */
    estado: string;
    plan: string;
    monto: number;
    moneda: string;
    link: string | null;
    proximo_cobro: string | null;
    pagado_hasta: string | null;
    cobros_pagados: number;
    cobros_fallidos: number;
    /** El motivo del rechazo o de la cancelación. */
    motivo: string | null;
    /** El cobro que generó el evento (se cobró / falló). */
    monto_cobrado: number | null;
    fecha_cobro: string | null;
    /** Id de la suscripción en Mercado Pago. */
    id: string | null;
}

/** ¿El disparador reacciona a este evento? (sin eventos elegidos = todos). */
export function subscriptionTriggerMatches(cfg: Record<string, unknown>, info: Pick<SubscriptionEventInfo, 'evento' | 'plan_id'>): boolean {
    const events = Array.isArray(cfg.subscription_events) ? (cfg.subscription_events as unknown[]).map(String) : [];
    if (events.length > 0 && !events.includes(info.evento)) return false;
    const plans = Array.isArray(cfg.plan_ids) ? (cfg.plan_ids as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
    if (plans.length > 0 && (info.plan_id === null || !plans.includes(info.plan_id))) return false;
    return true;
}

export const SUBSCRIPTION_MERGE_TAGS: Array<{ tag: string; label: string }> = [
    { tag: 'suscripcion.evento', label: 'Qué pasó' },
    { tag: 'suscripcion.estado', label: 'Estado de la suscripción' },
    { tag: 'suscripcion.plan', label: 'Plan' },
    { tag: 'suscripcion.monto', label: 'Valor de la suscripción' },
    { tag: 'suscripcion.link', label: 'Link para autorizar la tarjeta' },
    { tag: 'suscripcion.proximo_cobro', label: 'Próximo cobro' },
    { tag: 'suscripcion.pagado_hasta', label: 'Pagado hasta' },
    { tag: 'suscripcion.cobros_pagados', label: 'Cuotas pagadas' },
    { tag: 'suscripcion.cobros_fallidos', label: 'Cuotas fallidas' },
    { tag: 'suscripcion.motivo', label: 'Motivo del rechazo o la cancelación' },
    { tag: 'suscripcion.monto_cobrado', label: 'Monto del cobro' },
    { tag: 'suscripcion.fecha_cobro', label: 'Fecha del cobro' },
];

// ── Lógica pura (servidor, pantalla y tests) ─────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function daysInMonthUtc(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Suma un período a una fecha. Los meses se recortan al último día (31 de
 * enero + 1 mes = 28 de febrero), como cobra la tarjeta.
 */
export function addSubscriptionPeriod(date: Date, frequency: number, type: SubscriptionFrequencyType, times = 1): Date {
    if (type === 'days') return new Date(date.getTime() + frequency * times * DAY_MS);
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + frequency * times;
    const targetYear = y + Math.floor(m / 12);
    const targetMonth = ((m % 12) + 12) % 12;
    const day = Math.min(date.getUTCDate(), daysInMonthUtc(targetYear, targetMonth));
    return new Date(
        Date.UTC(targetYear, targetMonth, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()),
    );
}

/** El valor llevado a un mes (para sumar el ingreso mensual de planes distintos). */
export function monthlySubscriptionAmount(amount: number, frequency: number, type: SubscriptionFrequencyType): number {
    if (frequency <= 0) return 0;
    const monthly = type === 'months' ? amount / frequency : (amount * 30) / frequency;
    return Math.round(monthly * 100) / 100;
}

/** Hasta cuándo está cubierto el servicio: lo pagado o, antes del primer cobro, la prueba gratis. */
export function subscriptionCoveredUntil(startAt: Date | null, paidUntil: Date | null): Date | null {
    if (startAt && paidUntil) return startAt.getTime() > paidUntil.getTime() ? startAt : paidUntil;
    return paidUntil ?? startAt;
}

export interface SubscriptionFacts {
    providerStatus: SubscriptionProviderStatus | null;
    startAt: Date | null;
    paidUntil: Date | null;
    graceDays: number;
    /** La cuota del período está siendo reintentada por Mercado Pago. */
    retrying: boolean;
    /** La última cuota quedó rechazada después de todos los reintentos. */
    failedFinal: boolean;
    chargesPaid: number;
    cycles: number | null;
    now: Date;
}

/**
 * El estado de la app a partir de lo que dice Mercado Pago y del calendario
 * (puro). El orden importa: lo terminado y lo que Mercado Pago dice que no
 * cobra (pendiente, pausada, cancelada) manda sobre el calendario.
 */
export function deriveSubscriptionStatus(f: SubscriptionFacts): SubscriptionStatus {
    if (f.cycles !== null && f.cycles > 0 && f.chargesPaid >= f.cycles) return 'finished';
    switch (f.providerStatus) {
        case 'cancelled':
            return 'cancelled';
        case 'paused':
            return 'paused';
        case 'authorized':
            break;
        default:
            return 'pending';
    }
    const covered = subscriptionCoveredUntil(f.startAt, f.paidUntil);
    if (!covered || f.now.getTime() <= covered.getTime()) return 'active';
    const graceEnd = covered.getTime() + Math.max(1, f.graceDays) * DAY_MS;
    if (f.now.getTime() > graceEnd) return 'expired';
    if (f.retrying) return 'retrying';
    if (f.failedFinal) return 'past_due';
    // El período empezó y todavía no hay resultado del cobro (Mercado Pago
    // cobra durante el día): sigue al día mientras dure la gracia.
    return 'active';
}

/** Cuándo pasaría a «Vencida» si no paga (null = no aplica). */
export function subscriptionExpiresAt(startAt: Date | null, paidUntil: Date | null, graceDays: number): Date | null {
    const covered = subscriptionCoveredUntil(startAt, paidUntil);
    return covered ? new Date(covered.getTime() + Math.max(1, graceDays) * DAY_MS) : null;
}

/**
 * Qué eventos produce un cambio de estado (puro). Los cobros nuevos se
 * agregan aparte (`charged` / `charge_failed`, uno por cobro).
 */
export function subscriptionStatusEvents(prev: SubscriptionStatus, next: SubscriptionStatus): SubscriptionEvent[] {
    if (prev === next) return [];
    const live = (s: SubscriptionStatus) => s === 'active' || s === 'retrying' || s === 'past_due';
    switch (next) {
        case 'finished':
            return ['finished'];
        case 'cancelled':
            return ['cancelled'];
        case 'paused':
            return ['paused'];
        case 'expired':
            return ['expired'];
        case 'past_due':
            return prev === 'pending' ? ['activated', 'past_due'] : prev === 'paused' ? ['resumed', 'past_due'] : ['past_due'];
        default:
            if (live(next)) {
                if (prev === 'pending') return ['activated'];
                if (prev === 'paused') return ['resumed'];
            }
            return [];
    }
}
