import { z } from 'zod';
import { emailSchema } from './auth';
import { billingStatusSchema, planSchema, usageSchema, type BillingStatus, type Plan } from './billing';

/**
 * Consola de PLATAFORMA (operador SaaS / superadmin). A diferencia del resto
 * del API —acotado a un tenant por RLS— estos endpoints ven TODAS las empresas
 * (tenants) para gestionarlas: plan, estado (suspensión/impago), uso y alta.
 * Gateado por `SuperadminGuard` (allowlist `PLATFORM_SUPERADMINS`), nunca por
 * la matriz de capabilities por workspace.
 */

/** Owner de un tenant (primer admin) — para identificar al cliente. */
export const platformOwnerSchema = z.object({
    id: z.number().int(),
    name: z.string(),
    email: z.string(),
});
export type PlatformOwner = z.infer<typeof platformOwnerSchema>;

/** Una empresa (tenant) vista por el operador. */
export const platformTenantSchema = z.object({
    id: z.number().int(),
    slug: z.string(),
    name: z.string(),
    plan: planSchema,
    status: billingStatusSchema,
    read_only: z.boolean(),
    created_at: z.string(),
    owner: platformOwnerSchema.nullable(),
    usage: usageSchema,
});
export type PlatformTenant = z.infer<typeof platformTenantSchema>;

export interface PlatformTenantsResponse {
    data: PlatformTenant[];
}

/** Cambio de plan/estado de una empresa desde la consola (mínimo un campo). */
export const updateTenantSchema = z
    .object({
        plan: planSchema.optional(),
        status: billingStatusSchema.optional(),
    })
    .refine((v) => v.plan !== undefined || v.status !== undefined, {
        message: 'Indicá al menos plan o estado',
    });
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

// ─────────────────────────── Usuarios (F2) ───────────────────────────

/** Un usuario de la plataforma visto por el operador. */
export const platformUserSchema = z.object({
    id: z.number().int(),
    email: z.string(),
    name: z.string(),
    created_at: z.string(),
    /** Cuenta desactivada (login bloqueado + sesiones revocadas). */
    disabled: z.boolean(),
    /** Es superadmin de plataforma (allowlist) — no se puede desactivar. */
    is_superadmin: z.boolean(),
    /** Cantidad de workspaces (memberships) a los que pertenece. */
    workspaces: z.number().int(),
});
export type PlatformUser = z.infer<typeof platformUserSchema>;

export interface PlatformUsersResponse {
    data: PlatformUser[];
}

/** Alta de usuario por el operador (crea la cuenta + email de invitación). */
export const createPlatformUserSchema = z.object({
    email: emailSchema,
    name: z.string().trim().min(1).max(120),
});
export type CreatePlatformUserInput = z.infer<typeof createPlatformUserSchema>;

/** Desactivar/reactivar una cuenta. */
export const updatePlatformUserSchema = z.object({
    disabled: z.boolean(),
});
export type UpdatePlatformUserInput = z.infer<typeof updatePlatformUserSchema>;

/** Dashboard del operador: la foto de todo el negocio. */
export interface PlatformStats {
    tenants_total: number;
    /** Cuenta de tenants por estado de facturación. */
    by_status: Record<BillingStatus, number>;
    /** Cuenta de tenants por plan. */
    by_plan: Record<Plan, number>;
    /** Tenants en solo-lectura (impago: past_due/canceled). */
    read_only_tenants: number;
    users_total: number;
    records_total: number;
    /** Altas de empresas en los últimos 30 días. */
    signups_last_30d: number;
}
