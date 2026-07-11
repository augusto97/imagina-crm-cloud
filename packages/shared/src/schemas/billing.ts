import { z } from 'zod';

/**
 * Planes y límites (STANDALONE §11). Los límites se aplican por un
 * PlanService central. Impago (status != activo) → workspace solo-lectura +
 * export (ADR-S09): los datos NUNCA se secuestran.
 */
/** Los 4 planes built-in (semilla de la tabla `plans` + fallback de límites). */
export const PLANS = ['trial', 'starter', 'pro', 'enterprise'] as const;
export type BuiltinPlan = (typeof PLANS)[number];
/**
 * Un plan es un **slug** (ADR-S15 F3): los 4 built-in o uno creado por el
 * operador. La validación de existencia se hace contra la tabla `plans`.
 */
export const planSchema = z.string().trim().min(1).max(32);
export type Plan = z.infer<typeof planSchema>;

export const BILLING_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;
export const billingStatusSchema = z.enum(BILLING_STATUSES);
export type BillingStatus = z.infer<typeof billingStatusSchema>;

/** `null` = ilimitado. */
export interface PlanLimits {
    max_records: number | null;
    max_users: number | null;
    max_automations: number | null;
    /** Cuota de archivos subidos (ADR-S16), en MB. */
    max_storage_mb: number | null;
}

/** Semilla + fallback de límites de los planes built-in (la fuente viva es la DB). */
export const PLAN_LIMITS: Record<BuiltinPlan, PlanLimits> = {
    trial: { max_records: 500, max_users: 3, max_automations: 3, max_storage_mb: 100 },
    starter: { max_records: 10_000, max_users: 10, max_automations: 20, max_storage_mb: 1_024 },
    pro: { max_records: 200_000, max_users: 50, max_automations: 200, max_storage_mb: 10_240 },
    enterprise: { max_records: null, max_users: null, max_automations: null, max_storage_mb: null },
};

/** Un status con acceso de escritura (los demás → solo-lectura). */
export const WRITABLE_STATUSES: readonly BillingStatus[] = ['trialing', 'active'];
export function isReadOnly(status: BillingStatus): boolean {
    return !WRITABLE_STATUSES.includes(status);
}

/**
 * Solo-lectura EFECTIVO de una empresa (ADR-S09). Además del estado de
 * facturación, cae a solo-lectura si está archivada o si su suscripción
 * ('paga hasta') venció. Una sola fuente de verdad para el guard, el billing
 * y la consola de operador.
 */
export function isEffectivelyReadOnly(opts: {
    status: BillingStatus;
    archived_at?: string | Date | null;
    subscription_ends_at?: string | Date | null;
    now?: Date;
}): boolean {
    if (isReadOnly(opts.status)) return true;
    if (opts.archived_at) return true;
    if (opts.subscription_ends_at) {
        const ends = opts.subscription_ends_at instanceof Date ? opts.subscription_ends_at : new Date(opts.subscription_ends_at);
        if (!Number.isNaN(ends.getTime()) && ends.getTime() <= (opts.now ?? new Date()).getTime()) return true;
    }
    return false;
}

export const usageSchema = z.object({
    records: z.number().int().nonnegative(),
    users: z.number().int().nonnegative(),
    automations: z.number().int().nonnegative(),
    /** Bytes subidos (ADR-S16). La UI lo muestra contra max_storage_mb. */
    storage_bytes: z.number().int().nonnegative().default(0),
});
export type Usage = z.infer<typeof usageSchema>;

export const billingSummarySchema = z.object({
    plan: planSchema,
    status: billingStatusSchema,
    read_only: z.boolean(),
    limits: z.object({
        max_records: z.number().int().nullable(),
        max_users: z.number().int().nullable(),
        max_automations: z.number().int().nullable(),
        max_storage_mb: z.number().int().nullable(),
    }),
    usage: usageSchema,
});
export type BillingSummary = z.infer<typeof billingSummarySchema>;

/** Endpoint interno (stand-in de webhook Stripe) para cambiar plan/estado. */
export const setBillingSchema = z.object({
    plan: planSchema.optional(),
    status: billingStatusSchema.optional(),
});
export type SetBillingInput = z.infer<typeof setBillingSchema>;
