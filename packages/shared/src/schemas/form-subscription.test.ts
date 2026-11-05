import { describe, expect, it } from 'vitest';

import { formConfigSchema, formPaymentActive, formSubscriptionActive } from './form';
import { subscriptionFrequencyText, subscriptionPlanExtras } from './form-logic';
import { commentSchema } from './comment';
import { portalPaymentsBlockDataSchema, readPortalPaymentsConfig } from './portal';
import { recordSchema } from './record';

/** v0.1.368 — Suscribir al enviar: cuándo suscribe un formulario y cómo se dice cada cuánto cobra. */
describe('suscribir al enviar', () => {
    const base = (subscription: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
        formConfigSchema.parse({
            items: [
                { id: 'qnombre1', type: 'field', field_id: 7 },
                { id: 'qcorreo1', type: 'field', field_id: 8 },
            ],
            settings: {
                respondent_email_field_id: 8,
                subscription: { enabled: true, plan_ids: [4], ...subscription },
                ...extra,
            },
        });

    it('suscribe con un plan elegido y la pregunta del correo en el formulario', () => {
        expect(formSubscriptionActive(base({}))).toBe(true);
        expect(formSubscriptionActive(base({ enabled: false }))).toBe(false);
        expect(formSubscriptionActive(base({ plan_ids: [] }))).toBe(false);
        // Mercado Pago pide el correo: sin la pregunta (o sin elegirla) no suscribe.
        expect(formSubscriptionActive(base({}, { respondent_email_field_id: null }))).toBe(false);
        expect(formSubscriptionActive(base({}, { respondent_email_field_id: 99 }))).toBe(false);
    });

    it('excluye «Cobrar al enviar»: un formulario cobra una vez O suscribe', () => {
        const both = base({}, { payment: { enabled: true, connection_id: 3, source: 'fixed', amount: 1000 } });
        expect(formSubscriptionActive(both)).toBe(true);
        expect(formPaymentActive(both)).toBe(false);
        const onlyPay = base({ enabled: false }, { payment: { enabled: true, connection_id: 3, source: 'fixed', amount: 1000 } });
        expect(formPaymentActive(onlyPay)).toBe(true);
    });

    it('una config vieja o rota cae a «no suscribe» sin romper el formulario', () => {
        const old = formConfigSchema.parse({ items: [], settings: {} });
        expect(old.settings.subscription).toEqual({ enabled: false, plan_ids: [], plan_label: '', after: 'redirect', button_label: '' });
        const broken = formConfigSchema.parse({ items: [], settings: { subscription: { enabled: true, plan_ids: 'nada', after: 'volar' } } });
        expect(broken.settings.subscription).toMatchObject({ enabled: true, plan_ids: [], after: 'redirect' });
    });

    it('cada cuánto cobra y lo que se ve debajo del plan', () => {
        expect(subscriptionFrequencyText(1, 'months')).toBe('cada mes');
        expect(subscriptionFrequencyText(3, 'months')).toBe('cada 3 meses');
        expect(subscriptionFrequencyText(12, 'months')).toBe('cada año');
        expect(subscriptionFrequencyText(1, 'days')).toBe('cada día');
        expect(subscriptionFrequencyText(15, 'days')).toBe('cada 15 días');
        expect(subscriptionFrequencyText(0, 'months')).toBe('cada mes');
        expect(subscriptionPlanExtras({ trial_days: 7, cycles: 12 })).toBe('7 días gratis · 12 cobros');
        expect(subscriptionPlanExtras({ trial_days: 1, cycles: null })).toBe('1 día gratis');
        expect(subscriptionPlanExtras({ trial_days: 0, cycles: null })).toBe('');
    });

    it('el bloque «Pagos» del portal muestra las suscripciones salvo que se apague', () => {
        expect(readPortalPaymentsConfig({}).show_subscriptions).toBe(true);
        expect(readPortalPaymentsConfig({ show_subscriptions: false }).show_subscriptions).toBe(false);
        // Datos de antes (sin la clave) siguen leyéndose.
        expect(portalPaymentsBlockDataSchema.parse({ links: [], pay: null }).subscriptions).toEqual([]);
    });

    it('un registro que llegó por un formulario (creado por el sistema, id 0) se acepta', () => {
        // Antes el portal rechazaba su propio registro y mostraba «Entrar a tu portal».
        const record = { id: 9, list_id: 3, data: {}, created_by: 0, created_at: '2026-11-05T05:32:33.000Z', updated_at: '2026-11-05T05:32:33.000Z' };
        expect(recordSchema.safeParse(record).success).toBe(true);
        expect(recordSchema.safeParse({ ...record, created_by: -1 }).success).toBe(false);
        const comment = { id: 1, list_id: 3, record_id: 9, user_id: 0, body: 'Hola', created_at: record.created_at, updated_at: record.updated_at };
        expect(commentSchema.safeParse(comment).error?.issues.find((i) => i.path[0] === 'user_id')).toBeUndefined();
    });
});
