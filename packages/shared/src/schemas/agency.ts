import { z } from 'zod';
import { emailSchema } from './auth';
import { billingStatusSchema } from './billing';
import { idSchema } from './common';
import { agencyBillingSettingsSchema, agencyBillingTotalsSchema, agencyClientBillingSchema } from './agency-billing';
import { tenantAccessSchema } from './plan-access';

/**
 * v0.1.449 (I3, ADR-S108) — Modo agencia.
 *
 * Una AGENCIA es una empresa que administra otras empresas (sus clientes):
 * las crea, entra a trabajar en ellas como administradora —con rastro en la
 * bitácora de cada cliente— y las pausa. El operador marca qué empresa es
 * agencia y le pone sus ajustes; un cliente pertenece a UNA agencia.
 */

/** Ajustes de una agencia (los pone el operador de la plataforma). */
export const agencySettingsSchema = z.object({
    /**
     * El plan con el que nace cada empresa cliente. `null` = el mismo plan de
     * la agencia.
     */
    client_plan: z.string().trim().min(1).max(32).nullable().default(null),
    /** Cuántas empresas cliente puede tener. `null` = sin tope. */
    max_clients: z.number().int().min(0).max(100_000).nullable().default(null),
    /**
     * v0.1.451 — Otros planes de la plataforma que la agencia puede darles a
     * sus clientes (en sus propios planes). Siempre puede usar el de arriba.
     */
    client_plans: z.array(z.string().trim().min(1).max(32)).max(20).default([]),
});
export type AgencySettings = z.infer<typeof agencySettingsSchema>;

export const DEFAULT_AGENCY_SETTINGS: AgencySettings = { client_plan: null, max_clients: null, client_plans: [] };

/** Lectura tolerante de `tenants.settings.agency` (nunca falla). */
export function readAgencySettings(raw: unknown): AgencySettings {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_AGENCY_SETTINGS };
    const r = raw as Record<string, unknown>;
    const plan = typeof r.client_plan === 'string' && r.client_plan.trim() ? r.client_plan.trim().slice(0, 32) : null;
    const max =
        typeof r.max_clients === 'number' && Number.isInteger(r.max_clients) && r.max_clients >= 0
            ? Math.min(r.max_clients, 100_000)
            : null;
    const extra: string[] = [];
    if (Array.isArray(r.client_plans)) {
        for (const v of r.client_plans) {
            if (typeof v !== 'string') continue;
            const slug = v.trim().slice(0, 32);
            if (slug && !extra.includes(slug)) extra.push(slug);
            if (extra.length >= 20) break;
        }
    }
    return { client_plan: plan, max_clients: max, client_plans: extra };
}

/** Una empresa cliente vista desde su agencia. */
export const agencyClientSchema = z.object({
    id: idSchema,
    slug: z.string(),
    name: z.string(),
    plan: z.string(),
    plan_name: z.string().nullable().default(null),
    status: billingStatusSchema,
    access: tenantAccessSchema,
    /** La agencia la pausó (queda en sólo lectura). */
    paused: z.boolean(),
    archived: z.boolean(),
    created_at: z.string(),
    /** Personas del equipo del cliente (sin contar a la agencia ni invitados). */
    users: z.number().int(),
    records: z.number().int(),
    /** Administradores propios del cliente (para saber a quién llamar). */
    admins: z.array(z.object({ name: z.string(), email: z.string(), pending: z.boolean() })),
    /** Quien pregunta ya entró alguna vez (tiene acceso de agencia). */
    entered: z.boolean(),
    /** Última vez que alguien de la agencia entró (bitácora del cliente). */
    last_agency_access_at: z.string().nullable(),
    /** v0.1.451 — su plan con la agencia y cómo va el pago. */
    billing: agencyClientBillingSchema,
});
export type AgencyClient = z.infer<typeof agencyClientSchema>;

/** La consola de la agencia: quién es, sus ajustes y cuántos clientes tiene. */
export const agencyOverviewSchema = z.object({
    agency: z.object({ id: idSchema, name: z.string() }),
    settings: agencySettingsSchema,
    client_plan: z.object({ slug: z.string(), name: z.string() }).nullable(),
    clients: z.number().int(),
    /** Puede crear otra empresa cliente (no llegó al tope). */
    can_create: z.boolean(),
    /** v0.1.451 — los planes de la agencia y sus reglas de cobro. */
    billing: agencyBillingSettingsSchema,
    /** Los planes de la plataforma que puede usar como límites de sus planes. */
    limit_plans: z.array(z.object({ slug: z.string(), name: z.string() })),
    totals: agencyBillingTotalsSchema,
});
export type AgencyOverview = z.infer<typeof agencyOverviewSchema>;

/**
 * Alta de una empresa cliente. Con `admin_email` la persona queda como su
 * administradora (si no tiene cuenta, le llega una invitación); sin él, la
 * empresa nace sin equipo propio y la agencia la arma.
 */
export const createAgencyClientSchema = z.object({
    name: z.string().trim().min(1).max(120),
    admin_email: emailSchema.optional(),
    admin_name: z.string().trim().max(120).optional(),
});
export type CreateAgencyClientInput = z.infer<typeof createAgencyClientSchema>;

export const updateAgencyClientSchema = z
    .object({
        name: z.string().trim().min(1).max(120).optional(),
        /** Pausar (sólo lectura) o reactivar. */
        paused: z.boolean().optional(),
    })
    .refine((v) => v.name !== undefined || v.paused !== undefined, { message: 'Indica al menos un campo a cambiar' });
export type UpdateAgencyClientInput = z.infer<typeof updateAgencyClientSchema>;

/** Lo que devuelve «Entrar»: la empresa a la que pasar. */
export const agencyEnterResultSchema = z.object({ tenant_id: idSchema, tenant_slug: z.string() });
export type AgencyEnterResult = z.infer<typeof agencyEnterResultSchema>;

