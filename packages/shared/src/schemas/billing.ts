import { z } from 'zod';

/**
 * Planes y límites (STANDALONE §11). Los límites se aplican por un
 * PlanService central. Impago (status != activo) → workspace solo-lectura +
 * export (ADR-S09): los datos NUNCA se secuestran.
 */
export const PLANS = ['trial', 'starter', 'pro', 'enterprise'] as const;
export const planSchema = z.enum(PLANS);
export type Plan = z.infer<typeof planSchema>;

export const BILLING_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;
export const billingStatusSchema = z.enum(BILLING_STATUSES);
export type BillingStatus = z.infer<typeof billingStatusSchema>;

/** `null` = ilimitado. */
export interface PlanLimits {
    max_records: number | null;
    max_users: number | null;
    max_automations: number | null;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
    trial: { max_records: 500, max_users: 3, max_automations: 3 },
    starter: { max_records: 10_000, max_users: 10, max_automations: 20 },
    pro: { max_records: 200_000, max_users: 50, max_automations: 200 },
    enterprise: { max_records: null, max_users: null, max_automations: null },
};

/** Un status con acceso de escritura (los demás → solo-lectura). */
export const WRITABLE_STATUSES: readonly BillingStatus[] = ['trialing', 'active'];
export function isReadOnly(status: BillingStatus): boolean {
    return !WRITABLE_STATUSES.includes(status);
}

export const usageSchema = z.object({
    records: z.number().int().nonnegative(),
    users: z.number().int().nonnegative(),
    automations: z.number().int().nonnegative(),
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
