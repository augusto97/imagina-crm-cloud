import { describe, expect, it } from 'vitest';
import {
    addSubscriptionPeriod,
    createSubscriptionPlanSchema,
    deriveSubscriptionStatus,
    monthlySubscriptionAmount,
    readSubscriptionFields,
    subscriptionExpiresAt,
    subscriptionStatusEvents,
    subscriptionTriggerMatches,
    suggestSubscriptionFields,
    SUBSCRIPTION_STATUS_OPTIONS,
    type SubscriptionFacts,
} from './subscriptions';

const d = (iso: string) => new Date(iso);

function facts(over: Partial<SubscriptionFacts>): SubscriptionFacts {
    return {
        providerStatus: 'authorized',
        startAt: d('2026-01-10T12:00:00Z'),
        paidUntil: null,
        graceDays: 10,
        retrying: false,
        failedFinal: false,
        chargesPaid: 0,
        cycles: null,
        now: d('2026-01-10T13:00:00Z'),
        ...over,
    };
}

describe('v0.1.367 — suscripciones (puro)', () => {
    it('los meses se recortan al último día y los días suman exacto', () => {
        expect(addSubscriptionPeriod(d('2026-01-31T15:00:00Z'), 1, 'months').toISOString()).toBe('2026-02-28T15:00:00.000Z');
        expect(addSubscriptionPeriod(d('2024-01-31T00:00:00Z'), 1, 'months').toISOString()).toBe('2024-02-29T00:00:00.000Z');
        expect(addSubscriptionPeriod(d('2026-11-15T00:00:00Z'), 3, 'months').toISOString()).toBe('2027-02-15T00:00:00.000Z');
        expect(addSubscriptionPeriod(d('2026-12-01T00:00:00Z'), 12, 'months').toISOString()).toBe('2027-12-01T00:00:00.000Z');
        expect(addSubscriptionPeriod(d('2026-01-01T00:00:00Z'), 15, 'days').toISOString()).toBe('2026-01-16T00:00:00.000Z');
        expect(addSubscriptionPeriod(d('2026-01-10T00:00:00Z'), 1, 'months', 3).toISOString()).toBe('2026-04-10T00:00:00.000Z');
    });

    it('el ingreso mensual de planes distintos', () => {
        expect(monthlySubscriptionAmount(120_000, 12, 'months')).toBe(10_000);
        expect(monthlySubscriptionAmount(50_000, 1, 'months')).toBe(50_000);
        expect(monthlySubscriptionAmount(15_000, 15, 'days')).toBe(30_000);
    });

    it('el estado: por autorizar, al día, reintentando, en mora y vencida', () => {
        expect(deriveSubscriptionStatus(facts({ providerStatus: 'pending' }))).toBe('pending');
        expect(deriveSubscriptionStatus(facts({ providerStatus: null }))).toBe('pending');
        expect(deriveSubscriptionStatus(facts({ providerStatus: 'paused' }))).toBe('paused');
        expect(deriveSubscriptionStatus(facts({ providerStatus: 'cancelled' }))).toBe('cancelled');
        // Recién autorizada, esperando el primer cobro: al día.
        expect(deriveSubscriptionStatus(facts({}))).toBe('active');
        // Pagó enero → cubierto hasta el 10 de febrero.
        const paid = { paidUntil: d('2026-02-10T12:00:00Z'), chargesPaid: 1 };
        expect(deriveSubscriptionStatus(facts({ ...paid, now: d('2026-02-01T00:00:00Z') }))).toBe('active');
        // El 12 de febrero el cobro se está reintentando.
        expect(deriveSubscriptionStatus(facts({ ...paid, retrying: true, now: d('2026-02-12T00:00:00Z') }))).toBe('retrying');
        // Se agotaron los reintentos, todavía en la gracia.
        expect(deriveSubscriptionStatus(facts({ ...paid, failedFinal: true, now: d('2026-02-18T00:00:00Z') }))).toBe('past_due');
        // Pasaron los 10 días de gracia sin pago: vencida (aunque Mercado Pago siga reintentando).
        expect(deriveSubscriptionStatus(facts({ ...paid, retrying: true, now: d('2026-02-21T00:00:00Z') }))).toBe('expired');
        // El período empezó y todavía no hay resultado: sigue al día.
        expect(deriveSubscriptionStatus(facts({ ...paid, now: d('2026-02-11T00:00:00Z') }))).toBe('active');
    });

    it('la prueba gratis cubre hasta que empieza a cobrar; las cuotas del plan lo terminan', () => {
        const trial = { startAt: d('2026-01-25T00:00:00Z'), now: d('2026-01-20T00:00:00Z') };
        expect(deriveSubscriptionStatus(facts(trial))).toBe('active');
        expect(deriveSubscriptionStatus(facts({ ...trial, now: d('2026-02-06T00:00:00Z') }))).toBe('expired');
        expect(deriveSubscriptionStatus(facts({ cycles: 3, chargesPaid: 3, providerStatus: 'cancelled' }))).toBe('finished');
        expect(deriveSubscriptionStatus(facts({ cycles: 3, chargesPaid: 2 }))).toBe('active');
        expect(subscriptionExpiresAt(d('2026-01-10T00:00:00Z'), d('2026-02-10T00:00:00Z'), 5)?.toISOString()).toBe('2026-02-15T00:00:00.000Z');
    });

    it('los eventos de cada cambio de estado', () => {
        expect(subscriptionStatusEvents('pending', 'active')).toEqual(['activated']);
        expect(subscriptionStatusEvents('active', 'retrying')).toEqual([]);
        expect(subscriptionStatusEvents('retrying', 'past_due')).toEqual(['past_due']);
        expect(subscriptionStatusEvents('past_due', 'expired')).toEqual(['expired']);
        expect(subscriptionStatusEvents('expired', 'active')).toEqual([]);
        expect(subscriptionStatusEvents('active', 'paused')).toEqual(['paused']);
        expect(subscriptionStatusEvents('paused', 'active')).toEqual(['resumed']);
        expect(subscriptionStatusEvents('active', 'cancelled')).toEqual(['cancelled']);
        expect(subscriptionStatusEvents('active', 'finished')).toEqual(['finished']);
        expect(subscriptionStatusEvents('active', 'active')).toEqual([]);
    });

    it('el disparador filtra por evento y por plan', () => {
        const info = { evento: 'expired' as const, plan_id: 7 };
        expect(subscriptionTriggerMatches({}, info)).toBe(true);
        expect(subscriptionTriggerMatches({ subscription_events: ['expired', 'past_due'] }, info)).toBe(true);
        expect(subscriptionTriggerMatches({ subscription_events: ['charged'] }, info)).toBe(false);
        expect(subscriptionTriggerMatches({ plan_ids: [7] }, info)).toBe(true);
        expect(subscriptionTriggerMatches({ plan_ids: [8] }, info)).toBe(false);
        expect(subscriptionTriggerMatches({ plan_ids: [8] }, { evento: 'charged', plan_id: null })).toBe(false);
    });

    it('columnas: lectura tolerante y sugerencias por nombre y tipo', () => {
        expect(readSubscriptionFields(null)).toBeNull();
        expect(readSubscriptionFields({ subscriptions: { fields: { status: 'x' } } })).toBeNull();
        expect(readSubscriptionFields({ subscriptions: { fields: { status: 4 } } })?.status).toBe(4);
        const options = Object.values(SUBSCRIPTION_STATUS_OPTIONS).map((o) => ({ value: o.value, label: o.label }));
        const fields = [
            { id: 1, label: 'Próximo cobro', type: 'date' },
            { id: 2, label: 'Plan', type: 'text' },
            { id: 3, label: 'Estado de la suscripción', type: 'select', config: { options: [{ value: 'a' }] } },
            { id: 4, label: 'Mensualidad', type: 'currency' },
            { id: 5, label: 'Pagado hasta', type: 'text' },
        ];
        const s = suggestSubscriptionFields(fields, null);
        expect(s.next_charge).toBe(1);
        expect(s.plan).toBe(2);
        // Un select de estado sin las opciones de la suscripción no se adopta.
        expect(s.status).toBeNull();
        expect(s.amount).toBe(4);
        // Tipo equivocado (texto para una fecha): no.
        expect(s.paid_until).toBeNull();
        const withOptions = [{ id: 9, label: 'Estado suscripción', type: 'select', config: { options } }];
        expect(suggestSubscriptionFields(withOptions, null).status).toBe(9);
    });

    it('un plan: valores por defecto y frecuencias permitidas', () => {
        const ok = createSubscriptionPlanSchema.parse({ connection_id: 1, name: 'Hosting', amount: '50000' });
        expect(ok).toMatchObject({ currency: 'COP', frequency: 1, frequency_type: 'months', trial_days: 0, grace_days: 10, on_expire: 'mark' });
        expect(createSubscriptionPlanSchema.safeParse({ connection_id: 1, name: 'X', amount: 1, frequency: 13 }).success).toBe(false);
        expect(createSubscriptionPlanSchema.safeParse({ connection_id: 1, name: 'X', amount: 1, frequency: 30, frequency_type: 'days' }).success).toBe(true);
        expect(createSubscriptionPlanSchema.safeParse({ connection_id: 1, name: 'X', amount: 1, grace_days: 0 }).success).toBe(false);
    });
});
