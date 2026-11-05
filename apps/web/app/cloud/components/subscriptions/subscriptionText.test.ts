import { describe, expect, it } from 'vitest';
import { SUBSCRIPTION_STATUS_OPTIONS } from '@imagina-base/shared';

import { cyclesText, frequencyText, proposeSubscriptionChoices, statusOption, statusSentence } from './subscriptionText';

describe('textos de suscripciones', () => {
    it('frecuencia y cuotas en palabras', () => {
        expect(frequencyText(1, 'months')).toBe('cada mes');
        expect(frequencyText(3, 'months')).toBe('cada 3 meses');
        expect(frequencyText(12, 'months')).toBe('cada año');
        expect(frequencyText(15, 'days')).toBe('cada 15 días');
        expect(cyclesText(null)).toBe('hasta que se cancele');
        expect(cyclesText(12)).toBe('12 cuotas');
    });

    it('el estado usa el mismo color que la columna y una frase clara', () => {
        expect(statusOption('past_due').color).toBe(SUBSCRIPTION_STATUS_OPTIONS.past_due.color);
        expect(statusSentence({ status: 'retrying', last_failure_reason: 'Fondos insuficientes', consecutive_failed: 1, cancel_reason: null })).toContain('Fondos insuficientes');
        expect(statusSentence({ status: 'expired', last_failure_reason: null, consecutive_failed: 3, cancel_reason: null })).toContain('suspender');
    });

    it('propone las columnas que ya hay y crea las básicas', () => {
        const fields = [
            { id: 1, label: 'Cliente', type: 'text' },
            { id: 2, label: 'Valor mensual', type: 'currency' },
            { id: 3, label: 'Próximo cobro', type: 'date' },
        ];
        const out = proposeSubscriptionChoices(fields, null);
        expect(out.amount).toBe(2);
        expect(out.next_charge).toBe(3);
        expect(out.status).toBe('create');
        expect(out.link).toBe('create');
        expect(out.failed).toBeNull();
    });

    it('lo ya elegido se respeta, también «No guardar»', () => {
        const fields = [{ id: 7, label: 'Estado', type: 'select' }];
        const out = proposeSubscriptionChoices(fields, { status: 7, plan: null, amount: null, next_charge: null, paid_until: null, failed: null, link: 99 });
        expect(out.status).toBe(7);
        expect(out.link).toBeNull();
        expect(out.next_charge).toBeNull();
    });
});
