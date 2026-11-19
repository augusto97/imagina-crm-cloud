import { describe, expect, it } from 'vitest';
import { agencyMonthlyTotal, agencyPlatformPricing, effectiveAgencyPricing } from './agency-platform';
import { readAgencySettings } from './agency';

const plan = { price_usd: 99, price_cop: 390_000, agency_included_clients: 5, agency_extra_usd: 12, agency_extra_cop: 45_000 };
const none = { included_clients: null, extra_usd: null, extra_cop: null };

describe('v0.1.454 — lo que la plataforma le cobra a la agencia', () => {
    it('plan base + empresas extra', () => {
        expect(agencyPlatformPricing(plan, none, 3)).toMatchObject({ extras: 0, total_usd: 99, total_cop: 390_000, custom: false });
        expect(agencyPlatformPricing(plan, none, 8)).toMatchObject({ extras: 3, total_usd: 99 + 36, total_cop: 390_000 + 135_000 });
    });

    it('sin «incluidas» en el plan no se cobran extras', () => {
        const p = { ...plan, agency_included_clients: null };
        expect(agencyPlatformPricing(p, none, 40)).toMatchObject({ included: null, extras: 0, total_usd: 99 });
    });

    it('con extras y sin valor en una moneda, no se vende en esa moneda', () => {
        const p = { ...plan, agency_extra_usd: null };
        const r = agencyPlatformPricing(p, none, 7);
        expect(r.total_usd).toBeNull();
        expect(r.total_cop).toBe(390_000 + 2 * 45_000);
        // Sin extras se vende igual.
        expect(agencyMonthlyTotal(99, effectiveAgencyPricing(p, none), 4, 'USD')).toBe(99);
        // Sin precio base no se vende.
        expect(agencyMonthlyTotal(null, effectiveAgencyPricing(p, none), 1, 'USD')).toBeNull();
    });

    it('el trato propio de una agencia pisa lo del plan', () => {
        const r = agencyPlatformPricing(plan, { included_clients: 10, extra_usd: 8, extra_cop: null }, 12);
        expect(r).toMatchObject({ included: 10, extras: 2, extra_usd: 8, extra_cop: 45_000, total_usd: 115, custom: true });
    });

    it('lee los ajustes guardados con tolerancia', () => {
        expect(readAgencySettings({ included_clients: 3, extra_usd: -1, extra_cop: 'x' })).toMatchObject({
            included_clients: 3,
            extra_usd: null,
            extra_cop: null,
        });
        expect(readAgencySettings(null)).toMatchObject({ included_clients: null, extra_usd: null, extra_cop: null });
    });
});
