import { z } from 'zod';
import { idSchema } from './common';
import { SUBSCRIPTION_CHARGE_STATUSES, type SubscriptionChargeStatus } from './subscriptions';

/**
 * v0.1.371 (ADR-S96) — El REGISTRO DE COBROS de las suscripciones: cada cobro
 * (pagado, rechazado, en proceso o reembolsado) queda como un registro en la
 * lista que elija la empresa —una «Cobros de suscripciones» que arma la app
 * con su tablero, o una lista de Facturas que ya tenga—, vinculado al
 * registro suscrito. Con eso se arman los reportes («cuánto se cobró en
 * octubre», «quién rechazó la tarjeta») con las vistas, filtros y tableros de
 * siempre.
 *
 * La configuración vive en la lista de los SUSCRIPTORES
 * (`lists.settings.subscription_charges`), porque las suscripciones son de
 * sus registros; apunta a la lista destino y dice en qué columna va cada dato.
 */

export const SUBSCRIPTION_CHARGE_LOG_ROLES = ['record', 'amount', 'status', 'date', 'period', 'plan', 'method', 'reason', 'payment_id'] as const;
export type SubscriptionChargeLogRole = (typeof SUBSCRIPTION_CHARGE_LOG_ROLES)[number];

const roleIds = z.object({
    record: idSchema.nullable().default(null),
    amount: idSchema.nullable().default(null),
    status: idSchema.nullable().default(null),
    date: idSchema.nullable().default(null),
    period: idSchema.nullable().default(null),
    plan: idSchema.nullable().default(null),
    method: idSchema.nullable().default(null),
    reason: idSchema.nullable().default(null),
    payment_id: idSchema.nullable().default(null),
});
export type SubscriptionChargeLogFields = z.infer<typeof roleIds>;

export const EMPTY_CHARGE_LOG_FIELDS: SubscriptionChargeLogFields = {
    record: null,
    amount: null,
    status: null,
    date: null,
    period: null,
    plan: null,
    method: null,
    reason: null,
    payment_id: null,
};

export const subscriptionChargeLogSchema = z.object({
    /** La lista donde queda cada cobro. */
    list_id: idSchema,
    fields: roleIds,
    /** El tablero que se armó con la lista (sólo si la creó la app). */
    dashboard_id: idSchema.nullable().default(null),
});
export type SubscriptionChargeLog = z.infer<typeof subscriptionChargeLogSchema>;

/** Cómo se lee `lists.settings.subscription_charges` (tolerante: nunca lanza). */
export function readSubscriptionChargeLog(settings: unknown): SubscriptionChargeLog | null {
    const raw = (settings as { subscription_charges?: unknown } | null | undefined)?.subscription_charges;
    if (!raw || typeof raw !== 'object') return null;
    const parsed = subscriptionChargeLogSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

export const SUBSCRIPTION_CHARGE_LOG_TYPES: Record<SubscriptionChargeLogRole, readonly string[]> = {
    record: ['relation'],
    amount: ['currency', 'number'],
    status: ['select', 'text'],
    date: ['datetime', 'date'],
    period: ['date', 'datetime', 'text'],
    plan: ['text', 'select'],
    method: ['text', 'select'],
    reason: ['text', 'long_text'],
    payment_id: ['text'],
};

export const SUBSCRIPTION_CHARGE_LOG_LABELS: Record<SubscriptionChargeLogRole, string> = {
    record: 'Suscriptor',
    amount: 'Valor cobrado',
    status: 'Estado del cobro',
    date: 'Fecha del cobro',
    period: 'Período',
    plan: 'Plan',
    method: 'Medio de pago',
    reason: 'Motivo del rechazo',
    payment_id: 'Id del pago',
};

export const SUBSCRIPTION_CHARGE_LOG_HINTS: Record<SubscriptionChargeLogRole, string> = {
    record: 'Vincula el cobro al registro suscrito.',
    amount: 'Lo que se cobró (o se intentó cobrar).',
    status: 'Pagado, rechazado, procesando o reembolsado.',
    date: 'Cuándo se pagó o se intentó.',
    period: 'La cuota que cubre (el mes que tocaba cobrar).',
    plan: 'El nombre del plan.',
    method: 'Tarjeta, débito…',
    reason: 'Por qué Mercado Pago lo rechazó.',
    payment_id: 'El número del pago en Mercado Pago (para buscarlo allá).',
};

/** Las opciones del estado del cobro en una columna de selección. */
export const SUBSCRIPTION_CHARGE_STATUS_OPTIONS: Record<SubscriptionChargeStatus, { value: string; label: string; color: string }> = {
    approved: { value: 'pagado', label: 'Pagado', color: '#10B981' },
    rejected: { value: 'rechazado', label: 'Rechazado', color: '#E11D48' },
    pending: { value: 'procesando', label: 'Procesando', color: '#F59E0B' },
    refunded: { value: 'reembolsado', label: 'Reembolsado', color: '#64748B' },
};

/** El nombre de la lista que arma la app. */
export const CHARGE_LOG_LIST_NAME = 'Cobros de suscripciones';

const choice = z
    .union([idSchema, z.literal('create')])
    .nullable()
    .optional();

/**
 * Lo que se elige en la pantalla: no registrar, crear la lista (con su
 * tablero) o usar una que ya existe eligiendo la columna de cada dato.
 */
export const setSubscriptionChargeLogSchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('off') }),
    z.object({ mode: z.literal('create'), dashboard: z.boolean().optional() }),
    z.object({
        mode: z.literal('existing'),
        list_id: idSchema,
        fields: z.object({
            record: choice,
            amount: choice,
            status: choice,
            date: choice,
            period: choice,
            plan: choice,
            method: choice,
            reason: choice,
            payment_id: choice,
        }),
    }),
]);
export type SetSubscriptionChargeLogInput = z.infer<typeof setSubscriptionChargeLogSchema>;

/** Lo que muestra la pantalla: a dónde van los cobros y cuántos hay registrados. */
export const subscriptionChargeLogStatusSchema = z.object({
    config: z
        .object({
            list_id: idSchema,
            list_name: z.string(),
            list_slug: z.string(),
            fields: z.record(z.string(), z.object({ id: idSchema, label: z.string() }).nullable()),
            dashboard_id: idSchema.nullable(),
        })
        .nullable(),
    /** Cobros de las suscripciones de la lista. */
    charges: z.number(),
    /** Cuántos ya quedaron como registro en la lista elegida. */
    logged: z.number(),
    can_setup: z.boolean(),
    warnings: z.array(z.string()).optional(),
});
export type SubscriptionChargeLogStatus = z.infer<typeof subscriptionChargeLogStatusSchema>;

// ── Lógica pura (servidor, pantalla y tests) ─────────────────────────────

const SUGGEST_LABELS: Record<SubscriptionChargeLogRole, readonly string[]> = {
    record: ['cliente', 'suscriptor', 'suscripcion', 'contrato', 'servicio'],
    amount: ['valor', 'valor cobrado', 'monto', 'total', 'valor pagado', 'monto cobrado', 'importe'],
    status: ['estado', 'estado del cobro', 'estado del pago', 'estado de pago'],
    date: ['fecha', 'fecha del cobro', 'fecha de pago', 'fecha del pago', 'pagado el'],
    period: ['periodo', 'mes', 'cuota', 'periodo cobrado'],
    plan: ['plan', 'producto', 'concepto'],
    method: ['medio de pago', 'metodo de pago', 'forma de pago', 'medio'],
    reason: ['motivo', 'motivo del rechazo', 'razon', 'detalle'],
    payment_id: ['id del pago', 'id de pago', 'referencia', 'numero de pago', 'id mercado pago'],
};

function norm(label: string): string {
    return label
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

interface FieldLike {
    id: number;
    label: string;
    type: string;
    config?: unknown;
}

/** El id de la lista a la que apunta una relación (o null). */
export function relationTargetListId(config: unknown): number | null {
    const raw = (config as { target_list_id?: unknown } | null | undefined)?.target_list_id;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Las columnas de la lista destino que YA sirven para cada dato (puro). El
 * suscriptor sólo puede ser una relación que apunte a la lista de los
 * suscriptores; lo demás se reconoce por el nombre y el tipo.
 */
export function suggestChargeLogFields(fields: ReadonlyArray<FieldLike>, subscribersListId: number): SubscriptionChargeLogFields {
    const out: SubscriptionChargeLogFields = { ...EMPTY_CHARGE_LOG_FIELDS };
    const taken = new Set<number>();
    const rel = fields.find((f) => f.type === 'relation' && relationTargetListId(f.config) === subscribersListId);
    if (rel) {
        out.record = rel.id;
        taken.add(rel.id);
    }
    for (const role of SUBSCRIPTION_CHARGE_LOG_ROLES) {
        if (role === 'record' || out[role] !== null) continue;
        const names = SUGGEST_LABELS[role];
        const hit = fields.find((f) => !taken.has(f.id) && SUBSCRIPTION_CHARGE_LOG_TYPES[role].includes(f.type) && names.includes(norm(f.label)));
        if (hit) {
            out[role] = hit.id;
            taken.add(hit.id);
        }
    }
    return out;
}

/** Lo que se sabe de un cobro para escribirlo en la lista. */
export interface ChargeLogFacts {
    recordId: number | null;
    amount: number;
    status: SubscriptionChargeStatus;
    /** Cuándo se pagó o se intentó (ISO). */
    date: string;
    /** El inicio de la cuota (ISO) o null. */
    period: string | null;
    plan: string;
    method: string | null;
    reason: string | null;
    paymentId: string;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «2026-11-05» en la zona de la empresa (sin depender del navegador). */
export function dayInZone(iso: string, timeZone: string): string | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    try {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
        const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
        return `${get('year')}-${get('month')}-${get('day')}`;
    } catch {
        return d.toISOString().slice(0, 10);
    }
}

/** «noviembre de 2026»: la cuota que cubre, en la zona de la empresa. */
export function periodLabel(iso: string | null, timeZone: string): string | null {
    if (!iso) return null;
    const day = dayInZone(iso, timeZone);
    if (!day) return null;
    const [y, m] = day.split('-').map(Number);
    return `${MONTHS[(m ?? 1) - 1]} de ${y}`;
}

/** El título del registro cuando la lista no lo usa para otro dato: «Mensual · noviembre de 2026». */
export function chargeLogTitle(facts: Pick<ChargeLogFacts, 'plan' | 'period' | 'date'>, timeZone: string): string {
    const when = periodLabel(facts.period ?? facts.date, timeZone);
    const plan = facts.plan.trim() || 'Cuota';
    return (when ? `${plan} · ${when}` : plan).slice(0, 250);
}

function optionFor(config: unknown, wanted: { value: string; label: string }): string | null {
    const opts = (config as { options?: unknown } | null | undefined)?.options;
    if (!Array.isArray(opts)) return null;
    const list = opts.filter((o): o is { value: unknown; label?: unknown } => !!o && typeof o === 'object');
    const byValue = list.find((o) => String(o.value) === wanted.value);
    if (byValue) return String(byValue.value);
    const byLabel = list.find((o) => typeof o.label === 'string' && norm(o.label) === norm(wanted.label));
    return byLabel ? String(byLabel.value) : null;
}

/**
 * El valor de un dato del cobro para una columna de un tipo (puro). null =
 * dejar la columna vacía. Las fechas sin hora se toman en la zona de la
 * empresa (un pago a las 9 p. m. en Bogotá es de ese día, no del siguiente).
 */
export function chargeLogValue(role: SubscriptionChargeLogRole, facts: ChargeLogFacts, type: string, config: unknown, timeZone: string): unknown {
    switch (role) {
        case 'record':
            return facts.recordId ? [facts.recordId] : null;
        case 'amount':
            return Number.isFinite(facts.amount) ? facts.amount : null;
        case 'status': {
            const opt = SUBSCRIPTION_CHARGE_STATUS_OPTIONS[facts.status];
            if (type === 'select') return optionFor(config, opt);
            return opt.label;
        }
        case 'date':
            if (type === 'date') return dayInZone(facts.date, timeZone);
            return new Date(facts.date).toISOString().replace(/\.\d{3}Z$/, 'Z');
        case 'period': {
            const iso = facts.period ?? facts.date;
            if (type === 'text') return periodLabel(iso, timeZone);
            if (type === 'date') return dayInZone(iso, timeZone);
            return new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
        }
        case 'plan':
            if (!facts.plan) return null;
            if (type === 'select') return optionFor(config, { value: facts.plan, label: facts.plan });
            return facts.plan.slice(0, 250);
        case 'method':
            if (!facts.method) return null;
            if (type === 'select') return optionFor(config, { value: facts.method, label: facts.method });
            return facts.method.slice(0, 250);
        case 'reason':
            return facts.reason ? facts.reason.slice(0, 2000) : null;
        case 'payment_id':
            return facts.paymentId.slice(0, 250);
    }
}

/** Las opciones de estado que le faltan a una columna de selección. */
export function missingChargeStatusOptions(config: unknown): Array<{ value: string; label: string; color: string }> {
    const opts = (config as { options?: unknown } | null | undefined)?.options;
    const list = Array.isArray(opts) ? opts : [];
    const values = new Set(list.map((o) => (o && typeof o === 'object' ? String((o as { value?: unknown }).value) : '')));
    const labels = new Set(list.map((o) => (o && typeof o === 'object' && typeof (o as { label?: unknown }).label === 'string' ? norm((o as { label: string }).label) : '')));
    return SUBSCRIPTION_CHARGE_STATUSES.map((s) => SUBSCRIPTION_CHARGE_STATUS_OPTIONS[s]).filter((o) => !values.has(o.value) && !labels.has(norm(o.label)));
}
