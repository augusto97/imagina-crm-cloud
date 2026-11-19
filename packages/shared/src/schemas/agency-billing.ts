import { z } from 'zod';
import { idSchema } from './common';
import { helpSupportSchema } from './help';
import { SUBSCRIPTION_STATUSES, isSubscriptionProvider } from './subscriptions';

/**
 * v0.1.451 (I3, ADR-S108) — La agencia le cobra a sus clientes.
 *
 * La agencia arma sus PLANES (nombre, valor, cada cuánto y con qué límites de
 * la plataforma), le asigna uno a cada empresa cliente y lleva su «pagado
 * hasta». Los pagos se registran a mano (transferencia, efectivo…) y quedan en
 * un historial; pasada la fecha + los días de gracia de la agencia, el cliente
 * queda en sólo lectura (`agency_unpaid`) hasta que se registre el pago. El
 * cobro en línea con la cuenta de la agencia llega después; aquí está la base
 * que ese cobro va a usar.
 *
 * Todo lo de la agencia vive en `tenants.settings.agency_billing` de la
 * AGENCIA; el plan de cada cliente, en `tenants.settings.agency_plan` del
 * CLIENTE, y su fecha en `tenants.agency_paid_until` (columna: la lee el
 * cálculo del acceso en cada pedido).
 */

export const AGENCY_PLAN_PERIODS = [1, 3, 6, 12] as const;
export type AgencyPlanPeriod = (typeof AGENCY_PLAN_PERIODS)[number];

const periodSchema = z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]);

/** «cada mes», «cada 3 meses», «cada año». */
export function agencyPeriodText(months: number): string {
    if (months === 1) return 'cada mes';
    if (months === 12) return 'cada año';
    return `cada ${months} meses`;
}

const currencySchema = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'La moneda es un código de 3 letras (COP, USD, MXN…)');

/** El precio más alto que se acepta (evita errores de tipeo con ceros de más). */
export const AGENCY_MAX_PRICE = 1_000_000_000_000;

export const AGENCY_PLAN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;

export const agencyPlanSchema = z.object({
    /** Identificador estable (no cambia al renombrar el plan). */
    id: z.string().regex(AGENCY_PLAN_ID_RE, 'Identificador de plan inválido'),
    name: z.string().trim().min(1, 'Ponle un nombre al plan').max(60),
    description: z.string().trim().max(200).nullable().default(null),
    price: z.number().min(0, 'El valor no puede ser negativo').max(AGENCY_MAX_PRICE),
    currency: currencySchema.prefault('COP'),
    period_months: periodSchema.prefault(1),
    /**
     * El plan de la PLATAFORMA que le da sus límites (registros, usuarios,
     * módulos). `null` = el plan con el que nacen los clientes de la agencia.
     * Sólo entre los que el operador le permite usar.
     */
    limits_plan: z.string().trim().min(1).max(32).nullable().default(null),
    /** Un plan apagado no se asigna a clientes nuevos (los que lo tienen, lo conservan). */
    active: z.boolean().default(true),
});
export type AgencyPlan = z.infer<typeof agencyPlanSchema>;

export const AGENCY_MAX_PLANS = 20;

export const agencyBillingSettingsSchema = z
    .object({
        plans: z.array(agencyPlanSchema).max(AGENCY_MAX_PLANS, `Hasta ${AGENCY_MAX_PLANS} planes`).default([]),
        /** Días después del «pagado hasta» antes de pasar a sólo lectura. */
        grace_days: z.number().int().min(0).max(60).default(5),
        /** Avisar estos días antes del vencimiento. */
        remind_days: z.number().int().min(0).max(30).default(3),
        /** Mandarles los avisos de pago también a los administradores del cliente. */
        notify_client: z.boolean().default(true),
        /** v0.1.452 — Cobrar en línea con la cuenta de cobro de la agencia. */
        online: z
            .object({
                /** La conexión de cobro (Mercado Pago, Wompi o PayPal) del EQUIPO de la agencia. `null` = no cobra en línea. */
                connection_id: idSchema.nullable().default(null),
                /** Los clientes pueden pagar desde su app (Ajustes → Suscripción). */
                client_can_pay: z.boolean().default(true),
                /** Antes de vencer, crear el link solo y mandarlo en los avisos de pago. */
                auto_link: z.boolean().default(true),
                /**
                 * v0.1.453 — Ofrecer débito automático (sólo Mercado Pago o PayPal):
                 * el cliente autoriza su tarjeta una vez y cada período se paga solo.
                 */
                debit: z.boolean().default(false),
            })
            .prefault({ connection_id: null, client_can_pay: true, auto_link: true, debit: false }),
    })
    .superRefine((v, ctx) => {
        const seen = new Set<string>();
        v.plans.forEach((p, i) => {
            if (seen.has(p.id)) ctx.addIssue({ code: 'custom', path: ['plans', i, 'id'], message: 'Hay dos planes con el mismo identificador' });
            seen.add(p.id);
        });
    });
export type AgencyBillingSettings = z.infer<typeof agencyBillingSettingsSchema>;

export type AgencyOnlineBilling = AgencyBillingSettings['online'];

export const DEFAULT_AGENCY_ONLINE: AgencyOnlineBilling = { connection_id: null, client_can_pay: true, auto_link: true, debit: false };

export const DEFAULT_AGENCY_BILLING: AgencyBillingSettings = {
    plans: [],
    grace_days: 5,
    remind_days: 3,
    notify_client: true,
    online: { ...DEFAULT_AGENCY_ONLINE },
};

function readOnline(raw: unknown): AgencyOnlineBilling {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_AGENCY_ONLINE };
    const r = raw as Record<string, unknown>;
    const id = r.connection_id;
    return {
        connection_id: typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null,
        client_can_pay: typeof r.client_can_pay === 'boolean' ? r.client_can_pay : DEFAULT_AGENCY_ONLINE.client_can_pay,
        auto_link: typeof r.auto_link === 'boolean' ? r.auto_link : DEFAULT_AGENCY_ONLINE.auto_link,
        debit: typeof r.debit === 'boolean' ? r.debit : DEFAULT_AGENCY_ONLINE.debit,
    };
}

function intIn(v: unknown, min: number, max: number, fallback: number): number {
    return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** Lectura tolerante de `tenants.settings.agency_billing` (nunca falla: lo inválido se descarta). */
export function readAgencyBilling(raw: unknown): AgencyBillingSettings {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_AGENCY_BILLING, plans: [], online: { ...DEFAULT_AGENCY_ONLINE } };
    const r = raw as Record<string, unknown>;
    const plans: AgencyPlan[] = [];
    const seen = new Set<string>();
    if (Array.isArray(r.plans)) {
        for (const p of r.plans) {
            const parsed = agencyPlanSchema.safeParse(p);
            if (!parsed.success || seen.has(parsed.data.id)) continue;
            seen.add(parsed.data.id);
            plans.push(parsed.data);
            if (plans.length >= AGENCY_MAX_PLANS) break;
        }
    }
    return {
        plans,
        grace_days: intIn(r.grace_days, 0, 60, DEFAULT_AGENCY_BILLING.grace_days),
        remind_days: intIn(r.remind_days, 0, 30, DEFAULT_AGENCY_BILLING.remind_days),
        notify_client: typeof r.notify_client === 'boolean' ? r.notify_client : DEFAULT_AGENCY_BILLING.notify_client,
        online: readOnline(r.online),
    };
}

/** Un identificador nuevo para un plan («basico», «basico-2»…), sin repetir. */
export function agencyPlanIdFor(name: string, taken: Iterable<string>): string {
    const used = new Set(taken);
    const base =
        name
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 18) || 'plan';
    if (!used.has(base)) return base;
    for (let i = 2; i < 1000; i++) {
        const id = `${base}-${i}`;
        if (!used.has(id)) return id;
    }
    return `${base}-${Date.now().toString(36).slice(-4)}`;
}

/**
 * El plan de UN cliente: una copia del plan de la agencia al asignarlo (si la
 * agencia cambia el precio del plan, los clientes que ya lo tienen no cambian;
 * el valor de cada cliente se puede ajustar a mano).
 */
export const agencyClientPlanSchema = z.object({
    plan_id: z.string().regex(AGENCY_PLAN_ID_RE),
    name: z.string().trim().min(1).max(60),
    price: z.number().min(0).max(AGENCY_MAX_PRICE),
    currency: currencySchema,
    period_months: periodSchema,
});
export type AgencyClientPlan = z.infer<typeof agencyClientPlanSchema>;

/** Lectura tolerante de `tenants.settings.agency_plan` del cliente. */
export function readAgencyClientPlan(raw: unknown): AgencyClientPlan | null {
    const parsed = agencyClientPlanSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

/** Cuánto vale un mes del plan (para el «ingreso mensual» de la agencia). */
export function agencyMonthlyAmount(plan: Pick<AgencyClientPlan, 'price' | 'period_months'>): number {
    return Math.round((plan.price / plan.period_months) * 100) / 100;
}

// ─────────────────────────── Estado del pago ───────────────────────────

/**
 * - `none`: sin plan (la agencia no le cobra por la app).
 * - `ok`: al día.
 * - `due_soon`: vence en los próximos días (los del aviso de la agencia).
 * - `grace`: ya venció pero está en los días de gracia (sigue con acceso).
 * - `unpaid`: pasó la gracia: el cliente está en sólo lectura.
 */
export const AGENCY_BILLING_STATES = ['none', 'ok', 'due_soon', 'grace', 'unpaid'] as const;
export type AgencyBillingState = (typeof AGENCY_BILLING_STATES)[number];

const DAY = 24 * 60 * 60 * 1000;

export interface AgencyBillingStateResult {
    state: AgencyBillingState;
    /** Hasta cuándo está pagado. */
    due_at: string | null;
    /** Desde cuándo queda en sólo lectura (vencimiento + gracia). */
    cut_at: string | null;
    /**
     * Días hasta el vencimiento (`ok`, `due_soon`) o hasta el corte (`grace`);
     * 0 = hoy. `null` sin fecha o en `unpaid`/`none`.
     */
    days_left: number | null;
}

function toTime(v: string | Date | null | undefined): number | null {
    if (!v) return null;
    const t = (v instanceof Date ? v : new Date(v)).getTime();
    return Number.isNaN(t) ? null : t;
}

/** El estado del pago de un cliente. Una sola regla para el servidor, la consola y la app del cliente. */
export function agencyBillingState(input: {
    has_plan: boolean;
    paid_until: string | Date | null | undefined;
    grace_days: number;
    remind_days: number;
    now?: Date;
}): AgencyBillingStateResult {
    const now = (input.now ?? new Date()).getTime();
    const due = toTime(input.paid_until);
    if (!input.has_plan) return { state: 'none', due_at: due === null ? null : new Date(due).toISOString(), cut_at: null, days_left: null };
    if (due === null) return { state: 'ok', due_at: null, cut_at: null, days_left: null };
    const cut = due + Math.max(0, input.grace_days) * DAY;
    const out = { due_at: new Date(due).toISOString(), cut_at: new Date(cut).toISOString() };
    if (now >= cut) return { state: 'unpaid', ...out, days_left: null };
    if (now >= due) return { state: 'grace', ...out, days_left: Math.max(0, Math.ceil((cut - now) / DAY)) };
    const left = Math.max(0, Math.ceil((due - now) / DAY));
    return { state: left <= Math.max(0, input.remind_days) ? 'due_soon' : 'ok', ...out, days_left: left };
}

// ─────────────────────────── Pagos ───────────────────────────

/**
 * Cómo pagó el cliente. Los que registra la agencia a mano; el cobro en línea
 * (próxima versión) suma los de las pasarelas.
 */
export const AGENCY_MANUAL_PAYMENT_METHODS = ['transfer', 'cash', 'card', 'check', 'other'] as const;
export const AGENCY_PAYMENT_METHODS = [...AGENCY_MANUAL_PAYMENT_METHODS, 'mercadopago', 'wompi', 'paypal'] as const;
export type AgencyPaymentMethod = (typeof AGENCY_PAYMENT_METHODS)[number];

export const AGENCY_PAYMENT_METHOD_LABELS: Record<AgencyPaymentMethod, string> = {
    transfer: 'Transferencia',
    cash: 'Efectivo',
    card: 'Tarjeta',
    check: 'Cheque',
    other: 'Otro',
    mercadopago: 'Mercado Pago',
    wompi: 'Wompi',
    paypal: 'PayPal',
};

export const agencyPaymentSchema = z.object({
    id: idSchema,
    client_id: idSchema,
    amount: z.number(),
    currency: z.string(),
    months: z.number().int(),
    method: z.enum(AGENCY_PAYMENT_METHODS),
    note: z.string().nullable(),
    /** El día en que entró el pago (lo dice la agencia). */
    paid_on: z.string(),
    /** El período que cubre. */
    period_from: z.string(),
    period_to: z.string(),
    created_at: z.string(),
    created_by_name: z.string().nullable(),
    /** Se deshizo (el «pagado hasta» volvió al anterior). */
    undone_at: z.string().nullable(),
    /** Es el último pago y todavía se puede deshacer. */
    can_undo: z.boolean(),
});
export type AgencyPayment = z.infer<typeof agencyPaymentSchema>;

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');

export const registerAgencyPaymentSchema = z.object({
    /** Cuántos meses cubre (por defecto, el período del plan). */
    months: z.number().int().min(1).max(36),
    /** Cuánto pagó (por defecto, el valor del plan por esos meses). */
    amount: z.number().min(0).max(AGENCY_MAX_PRICE).optional(),
    method: z.enum(AGENCY_MANUAL_PAYMENT_METHODS).default('transfer'),
    note: z.string().trim().max(240).optional(),
    /** El día en que entró el pago (no puede ser futuro). Por defecto, hoy. */
    paid_on: ymdSchema.optional(),
});
export type RegisterAgencyPaymentInput = z.infer<typeof registerAgencyPaymentSchema>;

/** Asignar (o quitar) el plan de un cliente, ajustar su valor y su «pagado hasta». */
export const setAgencyClientBillingSchema = z
    .object({
        /** `null` = «Sin cobro». */
        plan_id: z.string().regex(AGENCY_PLAN_ID_RE).nullable().optional(),
        price: z.number().min(0).max(AGENCY_MAX_PRICE).optional(),
        /** Pagado hasta ese día (incluido, en la zona horaria de la agencia). */
        paid_until: ymdSchema.nullable().optional(),
    })
    .refine((v) => v.plan_id !== undefined || v.price !== undefined || v.paid_until !== undefined, {
        message: 'Indica al menos un cambio',
    });
export type SetAgencyClientBillingInput = z.infer<typeof setAgencyClientBillingSchema>;

/** El cobro de un cliente, como lo ven la agencia y el propio cliente. */
export const agencyClientBillingSchema = z.object({
    plan: agencyClientPlanSchema.nullable(),
    paid_until: z.string().nullable(),
    state: z.enum(AGENCY_BILLING_STATES),
    due_at: z.string().nullable(),
    cut_at: z.string().nullable(),
    days_left: z.number().int().nullable(),
    grace_days: z.number().int(),
});
export type AgencyClientBilling = z.infer<typeof agencyClientBillingSchema>;

/** Totales del cobro de la agencia (para la consola). */
export const agencyBillingTotalsSchema = z.object({
    ok: z.number().int(),
    due_soon: z.number().int(),
    grace: z.number().int(),
    unpaid: z.number().int(),
    none: z.number().int(),
    /** Ingreso mensual estimado por moneda (sólo clientes con plan que no están vencidos). */
    monthly: z.array(z.object({ currency: z.string(), amount: z.number() })),
});
export type AgencyBillingTotals = z.infer<typeof agencyBillingTotalsSchema>;

// ─────────────────────────── Cobro en línea (v0.1.452) ───────────────────────────

/**
 * v0.1.452 (I3, ADR-S108) — La agencia cobra en línea con SU cuenta de cobro
 * (Mercado Pago, Wompi o PayPal; ADR-S31). Cada cobro es un link de pago
 * colgado del registro del cliente en la lista «Empresas cliente» de la
 * agencia; cuando entra el pago se registra solo y corre el «pagado hasta».
 *
 * - `pending`: el link está esperando el pago.
 * - `paid`: entró el pago (ya se registró).
 * - `expired`: el link venció o falló sin pagarse.
 * - `cancelled`: la agencia lo anuló.
 */
export const AGENCY_CHARGE_STATUSES = ['pending', 'paid', 'expired', 'cancelled'] as const;
export type AgencyChargeStatus = (typeof AGENCY_CHARGE_STATUSES)[number];

/** Quién lo pidió: la agencia (consola), el cliente (su app) o el aviso automático antes de vencer. */
export const AGENCY_CHARGE_VIAS = ['agency', 'client', 'auto'] as const;
export type AgencyChargeVia = (typeof AGENCY_CHARGE_VIAS)[number];

export const agencyChargeSchema = z.object({
    id: idSchema,
    client_id: idSchema,
    months: z.number().int(),
    amount: z.number(),
    currency: z.string(),
    status: z.enum(AGENCY_CHARGE_STATUSES),
    via: z.enum(AGENCY_CHARGE_VIAS),
    provider: z.string().nullable(),
    /** El link para pagar (sólo mientras está pendiente). */
    url: z.string().nullable(),
    expires_at: z.string().nullable(),
    created_at: z.string(),
    paid_at: z.string().nullable(),
});
export type AgencyCharge = z.infer<typeof agencyChargeSchema>;

/** La agencia crea un link para un cliente: los meses (múltiplo del período del plan) y, si quiere, otro valor. */
export const createAgencyChargeSchema = z.object({
    months: z.number().int().min(1).max(36),
    amount: z.number().positive().max(AGENCY_MAX_PRICE).optional(),
    /** Mandarles el link por correo a los administradores del cliente. */
    send_email: z.boolean().default(false),
});
export type CreateAgencyChargeInput = z.infer<typeof createAgencyChargeSchema>;

/** El cliente paga desde su app: cuántos períodos del plan. El valor lo decide el servidor. */
export const payAgencyPlanSchema = z.object({
    periods: z.number().int().min(1).max(12),
});
export type PayAgencyPlanInput = z.infer<typeof payAgencyPlanSchema>;

/** Cuántos períodos se pueden pagar de una vez (sin pasar de 36 meses). */
export function agencyPayablePeriods(periodMonths: number): number[] {
    const out: number[] = [];
    for (const n of [1, 2, 3, 6, 12]) {
        if (n * periodMonths <= 36) out.push(n);
    }
    return out;
}

/** El valor de N meses del plan, redondeado a centavos. */
export function agencyChargeAmount(plan: Pick<AgencyClientPlan, 'price' | 'period_months'>, months: number): number {
    return Math.round((plan.price * months * 100) / plan.period_months) / 100;
}

/** «1 mes», «3 meses», «1 año», «2 años». */
export function agencyMonthsText(months: number): string {
    if (months % 12 === 0) {
        const y = months / 12;
        return y === 1 ? '1 año' : `${y} años`;
    }
    return months === 1 ? '1 mes' : `${months} meses`;
}

// ─────────────────────────── Débito automático (v0.1.453) ───────────────────────────

/**
 * v0.1.453 (I3, ADR-S108) — El débito automático de un cliente de la agencia:
 * una suscripción (ADR-S96) en la cuenta de Mercado Pago o PayPal de la
 * agencia, colgada del registro del cliente en «Empresas cliente». Cada cuota
 * cobrada se registra sola como pago y corre el «pagado hasta».
 */
export const agencyDebitSchema = z.object({
    subscription_id: idSchema,
    status: z.enum(SUBSCRIPTION_STATUSES),
    /** «Mercado Pago» / «PayPal». */
    provider: z.string().nullable(),
    amount: z.number(),
    currency: z.string(),
    /** Cada cuántos meses se cobra (el período del plan). */
    months: z.number().int(),
    payer_email: z.string().nullable(),
    /** El link para autorizar la tarjeta (sólo mientras está por autorizar). */
    url: z.string().nullable(),
    next_charge_at: z.string().nullable(),
    last_failure_reason: z.string().nullable(),
    created_at: z.string(),
});
export type AgencyDebit = z.infer<typeof agencyDebitSchema>;

/** Estados en los que el débito sigue vivo (uno por cliente). */
export const AGENCY_DEBIT_LIVE_STATUSES = ['pending', 'active', 'retrying', 'past_due', 'paused'] as const;

export function isLiveAgencyDebit(d: Pick<AgencyDebit, 'status'> | null | undefined): boolean {
    return !!d && (AGENCY_DEBIT_LIVE_STATUSES as readonly string[]).includes(d.status);
}

/** El débito ya cobra solo (autorizado y sin problemas graves): no hace falta mandar links. */
export function agencyDebitCharges(d: Pick<AgencyDebit, 'status'> | null | undefined): boolean {
    return !!d && (d.status === 'active' || d.status === 'retrying');
}

/** El débito automático sólo existe con Mercado Pago o PayPal (Wompi no tiene suscripciones). */
export function agencyDebitProviderOk(provider: string | null | undefined): boolean {
    return isSubscriptionProvider(provider);
}

const debitEmailSchema = z.string().trim().toLowerCase().email('Escribe un correo válido').max(254);

/** La agencia arma el débito de un cliente (el link para que autorice su tarjeta). */
export const startAgencyDebitSchema = z.object({
    /** El correo de quien paga (el de su cuenta de Mercado Pago o PayPal). Por defecto, el del administrador del cliente. */
    email: debitEmailSchema.optional(),
    /** Mandarles el link por correo a los administradores del cliente. */
    send_email: z.boolean().default(true),
});
export type StartAgencyDebitInput = z.infer<typeof startAgencyDebitSchema>;

/** El cliente activa el débito desde su app. */
export const startMyAgencyDebitSchema = z.object({
    email: debitEmailSchema,
});
export type StartMyAgencyDebitInput = z.infer<typeof startMyAgencyDebitSchema>;

/** Lo que el cliente ve del débito automático en su app. */
export const myAgencyDebitSchema = z.object({
    /** La agencia lo ofrece y su cuenta lo permite (Mercado Pago o PayPal, en la moneda del plan). */
    available: z.boolean(),
    current: agencyDebitSchema.nullable(),
});
export type MyAgencyDebit = z.infer<typeof myAgencyDebitSchema>;

/** Lo que el cliente ve del cobro en línea en su app. */
export const myAgencyOnlineSchema = z.object({
    /** La agencia cobra en línea y deja que el cliente pague desde la app. */
    enabled: z.boolean(),
    provider: z.string().nullable(),
    /** Cuántos períodos puede pagar de una vez. */
    periods: z.array(z.number().int()),
    /** Un link que ya está esperando el pago (para no crear otro). */
    pending: agencyChargeSchema.nullable(),
    /** v0.1.453 — El débito automático. */
    debit: myAgencyDebitSchema.prefault({ available: false, current: null }),
});
export type MyAgencyOnline = z.infer<typeof myAgencyOnlineSchema>;

/** La lista «Empresas cliente» de la agencia (donde cuelgan los links de pago). */
export const agencyClientsListSchema = z.object({
    id: idSchema,
    name: z.string(),
    slug: z.string(),
});
export type AgencyClientsList = z.infer<typeof agencyClientsListSchema>;

/** Las cuentas de cobro del equipo de la agencia que se pueden elegir. */
export const agencyCollectionConnectionSchema = z.object({
    id: idSchema,
    name: z.string(),
    provider: z.string(),
});
export type AgencyCollectionConnection = z.infer<typeof agencyCollectionConnectionSchema>;

/** Lo que ve el cliente en Ajustes → Suscripción. */
export const myAgencyBillingSchema = z.object({
    agency: z.object({ name: z.string() }),
    billing: agencyClientBillingSchema,
    payments: z.array(agencyPaymentSchema),
    support: helpSupportSchema.nullable(),
    /** v0.1.452 */
    online: myAgencyOnlineSchema,
});
export type MyAgencyBilling = z.infer<typeof myAgencyBillingSchema>;
