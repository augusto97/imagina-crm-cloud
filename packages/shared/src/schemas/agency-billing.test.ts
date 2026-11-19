import { describe, expect, it } from 'vitest';
import {
    agencyBillingSettingsSchema,
    agencyBillingState,
    agencyMonthlyAmount,
    agencyPeriodText,
    agencyPlanIdFor,
    readAgencyBilling,
    readAgencyClientPlan,
} from './agency-billing';

const DAY = 86_400_000;
const NOW = new Date('2026-11-19T15:00:00Z');

describe('agencyBillingState', () => {
    const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
    const base = { has_plan: true, grace_days: 5, remind_days: 3, now: NOW };

    it('sin plan no hay cobro', () => {
        expect(agencyBillingState({ ...base, has_plan: false, paid_until: at(-30) }).state).toBe('none');
    });

    it('al día, por vencer, en gracia y vencido', () => {
        expect(agencyBillingState({ ...base, paid_until: at(10) })).toMatchObject({ state: 'ok', days_left: 10 });
        expect(agencyBillingState({ ...base, paid_until: at(2) })).toMatchObject({ state: 'due_soon', days_left: 2 });
        const grace = agencyBillingState({ ...base, paid_until: at(-1) });
        expect(grace).toMatchObject({ state: 'grace', days_left: 4 });
        expect(grace.cut_at).toBe(at(4));
        expect(agencyBillingState({ ...base, paid_until: at(-6) })).toMatchObject({ state: 'unpaid', days_left: null });
    });

    it('sin días de gracia, vence y corta el mismo día', () => {
        expect(agencyBillingState({ ...base, grace_days: 0, paid_until: at(-0.01) }).state).toBe('unpaid');
    });
});

describe('ajustes y planes de la agencia', () => {
    it('la lectura tolerante descarta lo inválido y lo repetido', () => {
        const s = readAgencyBilling({
            plans: [
                { id: 'basico', name: 'Básico', price: 100000, currency: 'cop', period_months: 1 },
                { id: 'basico', name: 'Otro', price: 1, period_months: 1 },
                { id: 'MAL ID', name: 'x', price: 1 },
                { id: 'anual', name: 'Anual', price: -5 },
                'cualquier cosa',
            ],
            grace_days: 999,
            remind_days: 2,
            notify_client: false,
        });
        expect(s.plans.map((p) => p.id)).toEqual(['basico']);
        expect(s.plans[0]?.currency).toBe('COP');
        expect(s.grace_days).toBe(5);
        expect(s.remind_days).toBe(2);
        expect(s.notify_client).toBe(false);
        expect(readAgencyBilling(null).plans).toEqual([]);
    });

    it('el esquema estricto rechaza dos planes con el mismo identificador', () => {
        const plan = { id: 'pro', name: 'Pro', price: 1, currency: 'USD', period_months: 12 };
        expect(agencyBillingSettingsSchema.safeParse({ plans: [plan, plan] }).success).toBe(false);
        expect(agencyBillingSettingsSchema.safeParse({ plans: [plan] }).success).toBe(true);
    });

    it('identificadores, períodos, valor mensual y plan de un cliente', () => {
        expect(agencyPlanIdFor('Plan Básico', [])).toBe('plan-basico');
        expect(agencyPlanIdFor('Plan Básico', ['plan-basico'])).toBe('plan-basico-2');
        expect(agencyPlanIdFor('¿?', [])).toBe('plan');
        expect(agencyPeriodText(1)).toBe('cada mes');
        expect(agencyPeriodText(6)).toBe('cada 6 meses');
        expect(agencyPeriodText(12)).toBe('cada año');
        expect(agencyMonthlyAmount({ price: 1_200_000, period_months: 12 })).toBe(100_000);
        expect(readAgencyClientPlan({ plan_id: 'pro', name: 'Pro', price: 50, currency: 'USD', period_months: 3 })).toMatchObject({ plan_id: 'pro' });
        expect(readAgencyClientPlan({ plan_id: 'pro' })).toBeNull();
    });
});
