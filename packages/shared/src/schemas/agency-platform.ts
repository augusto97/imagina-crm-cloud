import { z } from 'zod';

/**
 * v0.1.454 (I3, ADR-S108) — Lo que la PLATAFORMA le cobra a una agencia.
 *
 * Decisión del usuario (2026-11-18): «las dos» — un plan base que incluye N
 * empresas cliente y un valor por cada empresa extra. El plan de la agencia es
 * un plan común de la plataforma (`plans`, con su precio en USD y COP); el
 * plan dice cuántas empresas cliente incluye y cuánto vale cada extra, y el
 * operador puede pisar esos tres datos para una agencia puntual (un trato
 * aparte) en `tenants.settings.agency`.
 *
 * Qué cuenta como empresa cliente: las de la agencia que no están archivadas
 * NI pausadas por la agencia (una pausada queda en solo lectura: es la forma
 * de dejar de pagar por un cliente que se fue). Se cobra lo que hay al pagar;
 * con la renovación automática el monto se ajusta solo cuando cambian.
 */

/** Lo que dice un plan de la plataforma sobre agencias (`null` = no aplica). */
export interface AgencyPlanPricing {
    /** Empresas cliente que incluye el precio base. `null` = todas (sin extras). */
    agency_included_clients: number | null;
    /** Precio por empresa extra al mes. `null` = no se vende con extras en esa moneda. */
    agency_extra_usd: number | null;
    agency_extra_cop: number | null;
}

/** Lo que el operador puede pisar para UNA agencia (`null` = lo del plan). */
export interface AgencyPricingOverride {
    included_clients: number | null;
    extra_usd: number | null;
    extra_cop: number | null;
}

/** Lo que rige para una agencia: el plan con lo que pisó el operador. */
export interface EffectiveAgencyPricing {
    included: number | null;
    extra_usd: number | null;
    extra_cop: number | null;
    /** De dónde sale cada dato: el plan o un trato propio de la agencia. */
    custom: boolean;
}

export function effectiveAgencyPricing(plan: AgencyPlanPricing | null, override: AgencyPricingOverride | null): EffectiveAgencyPricing {
    const o = override ?? { included_clients: null, extra_usd: null, extra_cop: null };
    return {
        included: o.included_clients ?? plan?.agency_included_clients ?? null,
        extra_usd: o.extra_usd ?? plan?.agency_extra_usd ?? null,
        extra_cop: o.extra_cop ?? plan?.agency_extra_cop ?? null,
        custom: o.included_clients !== null || o.extra_usd !== null || o.extra_cop !== null,
    };
}

/** Empresas que se cobran aparte (0 si el plan las incluye todas). */
export function agencyExtraClients(pricing: EffectiveAgencyPricing, clients: number): number {
    if (pricing.included === null) return 0;
    return Math.max(0, Math.floor(clients) - pricing.included);
}

/**
 * El total al mes en una moneda: base + extras × valor por extra. `null` = no
 * se puede cobrar en esa moneda (el plan no tiene precio, o hay extras y no hay
 * valor por extra en esa moneda: cobrar sólo la base regalaría las extras).
 */
export function agencyMonthlyTotal(
    base: number | null,
    pricing: EffectiveAgencyPricing,
    clients: number,
    currency: 'USD' | 'COP',
): number | null {
    if (base === null) return null;
    const extras = agencyExtraClients(pricing, clients);
    if (extras === 0) return base;
    const each = currency === 'USD' ? pricing.extra_usd : pricing.extra_cop;
    if (each === null) return null;
    return base + extras * each;
}

/** Lo que la agencia ve de su plan con la plataforma (y lo que se usa para cobrarle). */
export const agencyPlatformPricingSchema = z.object({
    /** Empresas cliente que cuentan hoy (sin archivadas ni pausadas). */
    clients: z.number().int(),
    /** Empresas que incluye el plan (`null` = todas). */
    included: z.number().int().nullable(),
    /** Cuántas se cobran aparte. */
    extras: z.number().int(),
    extra_usd: z.number().nullable(),
    extra_cop: z.number().nullable(),
    /** El precio del plan sin extras. */
    base_usd: z.number().nullable(),
    base_cop: z.number().nullable(),
    /** Lo que se cobra al mes (base + extras). `null` = no se vende en esa moneda. */
    total_usd: z.number().nullable(),
    total_cop: z.number().nullable(),
    /** El operador le puso un trato propio a esta agencia. */
    custom: z.boolean(),
});
export type AgencyPlatformPricing = z.infer<typeof agencyPlatformPricingSchema>;

/** Arma el resumen para un plan y una cantidad de empresas. */
export function agencyPlatformPricing(
    plan: (AgencyPlanPricing & { price_usd: number | null; price_cop: number | null }) | null,
    override: AgencyPricingOverride | null,
    clients: number,
): AgencyPlatformPricing {
    const pricing = effectiveAgencyPricing(plan, override);
    const base_usd = plan?.price_usd ?? null;
    const base_cop = plan?.price_cop ?? null;
    return {
        clients: Math.max(0, Math.floor(clients)),
        included: pricing.included,
        extras: agencyExtraClients(pricing, clients),
        extra_usd: pricing.extra_usd,
        extra_cop: pricing.extra_cop,
        base_usd,
        base_cop,
        total_usd: agencyMonthlyTotal(base_usd, pricing, clients, 'USD'),
        total_cop: agencyMonthlyTotal(base_cop, pricing, clients, 'COP'),
        custom: pricing.custom,
    };
}
