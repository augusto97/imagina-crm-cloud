import { describe, expect, it } from 'vitest';

import {
    chargeLogTitle,
    chargeLogValue,
    dayInZone,
    missingChargeStatusOptions,
    periodLabel,
    readSubscriptionChargeLog,
    setSubscriptionChargeLogSchema,
    suggestChargeLogFields,
    SUBSCRIPTION_CHARGE_STATUS_OPTIONS,
    type ChargeLogFacts,
} from './subscription-charge-log';

const facts: ChargeLogFacts = {
    recordId: 42,
    amount: 150000,
    status: 'approved',
    // Las 9 p. m. del 31 de octubre en Bogotá ya es 1.º de noviembre en UTC.
    date: '2026-11-01T02:00:00.000Z',
    period: '2026-11-01T02:00:00.000Z',
    plan: 'Mensual',
    method: 'Tarjeta de crédito',
    reason: null,
    paymentId: '123456789',
};

describe('v0.1.371 — registro de cobros de las suscripciones', () => {
    it('lee la configuración con tolerancia', () => {
        expect(readSubscriptionChargeLog(null)).toBeNull();
        expect(readSubscriptionChargeLog({ subscription_charges: { list_id: 'x' } })).toBeNull();
        const ok = readSubscriptionChargeLog({ subscription_charges: { list_id: 7, fields: { amount: 3 } } });
        expect(ok?.list_id).toBe(7);
        expect(ok?.fields.amount).toBe(3);
        expect(ok?.fields.record).toBeNull();
        expect(ok?.dashboard_id).toBeNull();
    });

    it('el pedido elige un modo', () => {
        expect(setSubscriptionChargeLogSchema.safeParse({ mode: 'off' }).success).toBe(true);
        expect(setSubscriptionChargeLogSchema.safeParse({ mode: 'create', dashboard: true }).success).toBe(true);
        expect(setSubscriptionChargeLogSchema.safeParse({ mode: 'existing', list_id: 4, fields: { record: 'create', amount: 9 } }).success).toBe(true);
        expect(setSubscriptionChargeLogSchema.safeParse({ mode: 'existing', fields: {} }).success).toBe(false);
    });

    it('sugiere sólo la relación que apunta a los suscriptores, y lo demás por nombre y tipo', () => {
        const fields = [
            { id: 1, label: 'Proveedor', type: 'relation', config: { target_list_id: 99 } },
            { id: 2, label: 'Cliente', type: 'relation', config: { target_list_id: 5 } },
            { id: 3, label: 'Valor', type: 'currency' },
            { id: 4, label: 'Estado', type: 'select' },
            { id: 5, label: 'Fecha de pago', type: 'date' },
            { id: 6, label: 'Fecha', type: 'text' },
            { id: 7, label: 'Motivo del rechazo', type: 'long_text' },
        ];
        const s = suggestChargeLogFields(fields, 5);
        expect(s.record).toBe(2);
        expect(s.amount).toBe(3);
        expect(s.status).toBe(4);
        expect(s.date).toBe(5);
        expect(s.reason).toBe(7);
        expect(s.plan).toBeNull();
        expect(suggestChargeLogFields(fields, 77).record).toBeNull();
    });

    it('la fecha sin hora es la de la empresa', () => {
        expect(dayInZone(facts.date, 'America/Bogota')).toBe('2026-10-31');
        expect(dayInZone(facts.date, 'UTC')).toBe('2026-11-01');
        expect(chargeLogValue('date', facts, 'date', {}, 'America/Bogota')).toBe('2026-10-31');
        expect(chargeLogValue('date', facts, 'datetime', {}, 'America/Bogota')).toBe('2026-11-01T02:00:00Z');
        expect(periodLabel(facts.period, 'America/Bogota')).toBe('octubre de 2026');
        expect(chargeLogValue('period', facts, 'text', {}, 'UTC')).toBe('noviembre de 2026');
    });

    it('el estado va a la opción de la lista (por valor o por etiqueta) o en texto', () => {
        const own = { options: [{ value: 'ok', label: 'Pagado' }, { value: 'no', label: 'Rechazado' }] };
        expect(chargeLogValue('status', facts, 'select', own, 'UTC')).toBe('ok');
        expect(chargeLogValue('status', { ...facts, status: 'rejected' }, 'select', own, 'UTC')).toBe('no');
        expect(chargeLogValue('status', { ...facts, status: 'refunded' }, 'select', own, 'UTC')).toBeNull();
        expect(chargeLogValue('status', facts, 'text', {}, 'UTC')).toBe('Pagado');
        const ours = { options: Object.values(SUBSCRIPTION_CHARGE_STATUS_OPTIONS) };
        expect(chargeLogValue('status', facts, 'select', ours, 'UTC')).toBe('pagado');
        expect(missingChargeStatusOptions(own).map((o) => o.value)).toEqual(['procesando', 'reembolsado']);
        expect(missingChargeStatusOptions(ours)).toEqual([]);
    });

    it('el suscriptor es un vínculo y el título nombra la cuota', () => {
        expect(chargeLogValue('record', facts, 'relation', {}, 'UTC')).toEqual([42]);
        expect(chargeLogValue('record', { ...facts, recordId: null }, 'relation', {}, 'UTC')).toBeNull();
        expect(chargeLogValue('reason', facts, 'text', {}, 'UTC')).toBeNull();
        expect(chargeLogTitle(facts, 'America/Bogota')).toBe('Mensual · octubre de 2026');
        expect(chargeLogTitle({ ...facts, plan: ' ' }, 'UTC')).toBe('Cuota · noviembre de 2026');
    });
});
