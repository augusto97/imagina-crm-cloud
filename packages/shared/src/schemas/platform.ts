import { z } from 'zod';
import { emailSchema } from './auth';
import { billingStatusSchema, planSchema, usageSchema, type BillingStatus, type Plan } from './billing';
import { idSchema } from './common';

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

/** Alta de una empresa nueva + su admin, en un paso (onboarding por el operador). */
export const createTenantSchema = z.object({
    workspace_name: z.string().trim().min(1).max(120),
    admin_email: emailSchema,
    admin_name: z.string().trim().min(1).max(120),
    plan: planSchema.optional(),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

/** Un miembro de una empresa (para el detalle). */
export interface PlatformTenantMember {
    user_id: number;
    name: string;
    email: string;
    role: string;
    disabled: boolean;
}

/** Detalle de una empresa: sus datos + miembros + límites del plan. */
export interface PlatformTenantDetail {
    tenant: PlatformTenant;
    members: PlatformTenantMember[];
    limits: {
        max_records: number | null;
        max_users: number | null;
        max_automations: number | null;
    };
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

// ─────────────────────────── Planes (F3) ───────────────────────────

/**
 * Un plan editable por el operador. `null` en un límite = ilimitado; `null` en
 * un precio = no se vende self-serve en esa moneda (checkout, ADR-S12).
 */
export const platformPlanSchema = z.object({
    slug: z.string(),
    name: z.string(),
    max_records: z.number().int().nullable(),
    max_users: z.number().int().nullable(),
    max_automations: z.number().int().nullable(),
    price_usd: z.number().int().nullable(),
    price_cop: z.number().int().nullable(),
    is_active: z.boolean(),
    position: z.number().int(),
});
export type PlatformPlan = z.infer<typeof platformPlanSchema>;

export interface PlatformPlansResponse {
    data: PlatformPlan[];
}

/** Slug de plan: minúsculas/números/guion-bajo (URL-safe, estable). */
export const planSlugSchema = z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9_]+$/, 'Sólo minúsculas, números y guion bajo');

const nullableLimit = z.number().int().nonnegative().nullable();
/** Precio de checkout (entero: USD sin centavos, COP sin decimales). `null` = no vendible. */
const nullablePrice = z.number().int().nonnegative().nullable();

/** Alta de un plan nuevo. */
export const createPlanSchema = z.object({
    slug: planSlugSchema,
    name: z.string().trim().min(1).max(60),
    max_records: nullableLimit.default(null),
    max_users: nullableLimit.default(null),
    max_automations: nullableLimit.default(null),
    price_usd: nullablePrice.default(null),
    price_cop: nullablePrice.default(null),
    is_active: z.boolean().default(true),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

/** Edición de un plan (nombre / límites / precios / activo). El slug no cambia. */
export const updatePlanSchema = z
    .object({
        name: z.string().trim().min(1).max(60),
        max_records: nullableLimit,
        max_users: nullableLimit,
        max_automations: nullableLimit,
        price_usd: nullablePrice,
        price_cop: nullablePrice,
        is_active: z.boolean(),
    })
    .partial();
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

// ─────────────── Impersonación de soporte (F5) ───────────────

/** Body para impersonar a un usuario (por su id). */
export const impersonateSchema = z.object({ user_id: idSchema });
export type ImpersonateInput = z.infer<typeof impersonateSchema>;

/** Resultado del alta de impersonación (el token va por cookie, no acá). */
export interface ImpersonateResult {
    target: { id: number; name: string; email: string };
}

/** Una fila del log de auditoría de impersonación. */
export interface ImpersonationLogEntry {
    id: number;
    actor_name: string;
    actor_email: string;
    target_name: string;
    target_email: string;
    started_at: string;
    expires_at: string;
    ended_at: string | null;
}
export interface ImpersonationLogResponse {
    data: ImpersonationLogEntry[];
}

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
