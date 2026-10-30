import { describe, expect, it } from 'vitest';
import {
    DEFAULT_BILLING_POLICY,
    PLAN_MODULE_CATALOG,
    PLAN_MODULES,
    daysLeft,
    moduleForIntegration,
    paidCutAt,
    readBillingPolicy,
    readDisabledModules,
    tenantAccess,
} from './plan-access';

const NOW = new Date('2026-10-30T12:00:00Z');
const lock = { on_end: 'lock' as const, grace_days: 5 };
const ro = { on_end: 'read_only' as const, grace_days: 5 };

describe('tenantAccess (ADR-S87)', () => {
    it('prueba sin fin: acceso completo', () => {
        expect(tenantAccess({ plan: 'trial', status: 'trialing', now: NOW }, lock)).toEqual({
            state: 'full',
            reason: null,
            ends_at: null,
            trial: true,
        });
    });

    it('prueba vigente y terminada, con las dos políticas', () => {
        const soon = { plan: 'trial', status: 'trialing', trial_ends_at: '2026-11-02T00:00:00Z', now: NOW };
        expect(tenantAccess(soon, lock).state).toBe('full');
        const ended = { ...soon, trial_ends_at: '2026-10-29T00:00:00Z' };
        expect(tenantAccess(ended, lock)).toMatchObject({ state: 'locked', reason: 'trial_ended', trial: true });
        expect(tenantAccess(ended, ro)).toMatchObject({ state: 'read_only', reason: 'trial_ended' });
    });

    it('la fecha manual del operador corta antes que el fin de la prueba', () => {
        const a = tenantAccess(
            { plan: 'trial', status: 'trialing', trial_ends_at: '2026-12-01T00:00:00Z', subscription_ends_at: '2026-10-01T00:00:00Z', now: NOW },
            lock,
        );
        expect(a).toMatchObject({ state: 'locked', ends_at: '2026-10-01T00:00:00.000Z' });
    });

    it('plan pagado: vencimiento + gracia', () => {
        const base = { plan: 'pro', status: 'active', now: NOW };
        expect(tenantAccess({ ...base, paid_until: '2026-10-27T12:00:00Z' }, lock).state).toBe('full'); // dentro de la gracia
        expect(tenantAccess({ ...base, paid_until: '2026-10-20T12:00:00Z' }, lock)).toMatchObject({
            state: 'locked',
            reason: 'plan_expired',
            trial: false,
        });
        // sin período pagado y sin fecha manual: no vence
        expect(tenantAccess(base, lock).ends_at).toBeNull();
    });

    it('la prueba ignora el período pagado; el plan pagado ignora el fin de prueba', () => {
        expect(tenantAccess({ plan: 'trial', status: 'trialing', paid_until: '2020-01-01T00:00:00Z', now: NOW }, lock).state).toBe('full');
        expect(tenantAccess({ plan: 'pro', status: 'active', trial_ends_at: '2020-01-01T00:00:00Z', now: NOW }, lock).state).toBe('full');
    });

    it('archivada o con cobro no habilitado: sólo lectura, nunca pausada', () => {
        const ended = { trial_ends_at: '2020-01-01T00:00:00Z', now: NOW };
        expect(tenantAccess({ plan: 'trial', status: 'trialing', archived_at: '2026-01-01', ...ended }, lock)).toMatchObject({
            state: 'read_only',
            reason: 'archived',
        });
        expect(tenantAccess({ plan: 'pro', status: 'past_due', now: NOW }, lock)).toMatchObject({ state: 'read_only', reason: 'suspended' });
    });

    it('paidCutAt y daysLeft', () => {
        expect(paidCutAt('2026-10-01T00:00:00Z', 5).toISOString()).toBe('2026-10-06T00:00:00.000Z');
        expect(daysLeft('2026-11-01T11:00:00Z', NOW)).toBe(2);
        expect(daysLeft('2026-10-01T00:00:00Z', NOW)).toBe(0);
        expect(daysLeft(null, NOW)).toBeNull();
    });
});

describe('política de cobro', () => {
    it('lectura tolerante campo por campo', () => {
        expect(readBillingPolicy(null)).toEqual(DEFAULT_BILLING_POLICY);
        expect(readBillingPolicy({ trial_days: 30, on_end: 'nope', grace_days: -1, lapse_to_trial: false })).toEqual({
            ...DEFAULT_BILLING_POLICY,
            trial_days: 30,
            lapse_to_trial: false,
        });
        expect(readBillingPolicy({ trial_days: null }).trial_days).toBeNull();
    });
});

describe('módulos por plan', () => {
    it('el catálogo cubre cada módulo una vez', () => {
        expect(PLAN_MODULE_CATALOG.map((m) => m.key).sort()).toEqual([...PLAN_MODULES].sort());
    });

    it('lectura tolerante de los desactivados', () => {
        expect(readDisabledModules(['ai', 'ai', 'nada', 3, 'forms'])).toEqual(['ai', 'forms']);
        expect(readDisabledModules('ai')).toEqual([]);
    });

    it('el módulo de cada app conectada', () => {
        expect(moduleForIntegration('woocommerce')).toBe('woocommerce');
        expect(moduleForIntegration('wordpress')).toBe('wordpress');
        expect(moduleForIntegration('sqlserver')).toBe('sql');
        expect(moduleForIntegration('slack')).toBe('integrations');
        expect(moduleForIntegration(null)).toBe('integrations');
    });
});
