import { describe, expect, it } from 'vitest';

import {
    BLUEPRINT_EXCLUDED_SETTINGS,
    CHARGE_LOG_MARKER_KEY,
    chargeLogMarkerFor,
    isPaymentSyncList,
    managedFieldIds,
    managedFieldLocks,
    readChargeLogMarker,
} from '../index';

describe('managedFieldLocks (v0.1.383)', () => {
    it('sin nada sincronizado no hay candados', () => {
        expect(managedFieldLocks(null)).toEqual([]);
        expect(managedFieldLocks({})).toEqual([]);
        expect(managedFieldLocks({ collections: { fields: { link: null } } })).toEqual([]);
    });

    it('las columnas de la suscripción y de los cobros quedan protegidas, con su motivo', () => {
        const settings = {
            subscriptions: { fields: { status: 10, amount: 11, plan: 12, next_charge: 13, paid_until: 14, failed: 15, link: 16 } },
            collections: { fields: { link: 20, status: 21, paid_at: 22, paid_amount: 23, method: null } },
        };
        const locks = managedFieldLocks(settings);
        expect(locks.map((l) => l.field_id).sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 14, 15, 16, 20, 21, 22, 23]);
        const amount = locks.find((l) => l.field_id === 11)!;
        expect(amount.source).toBe('subscriptions');
        expect(amount.reason).toMatch(/Cambiar el valor/);
        expect(amount.deletable).toBe(false);
        expect(amount.free_hint).toMatch(/Suscripción/);
        expect(locks.find((l) => l.field_id === 21)!.reason).toMatch(/pago/);
        expect(locks.find((l) => l.field_id === 20)!.reason).toMatch(/link de pago/);
    });

    it('una columna usada por dos reglas aparece una vez (gana la primera)', () => {
        const locks = managedFieldLocks({
            subscriptions: { fields: { status: 5 } },
            collections: { fields: { status: 5 } },
        });
        expect(locks).toHaveLength(1);
        expect(locks[0]!.source).toBe('subscriptions');
    });

    it('lo que trae la importación de Mercado Pago se protege y se puede borrar', () => {
        const locks = managedFieldLocks({ subscription_import_fields: { external_id_field_id: 30, since_field_id: 31, bogus: 'x' } });
        expect(locks.map((l) => [l.field_id, l.source, l.deletable])).toEqual([
            [30, 'subscription_import', true],
            [31, 'subscription_import', true],
        ]);
    });

    it('el SLA sólo cuenta encendido', () => {
        const sla = { first_due_field_id: 40, resolution_due_field_id: 41, sla_status_field_id: 42 };
        expect(managedFieldIds({ helpdesk: { sla: { ...sla, enabled: false } } })).toEqual([]);
        expect(managedFieldIds({ helpdesk: { sla: { ...sla, enabled: true } } })).toEqual([40, 41, 42]);
    });

    it('la lista del registro de cobros protege las columnas que escribe', () => {
        const marker = chargeLogMarkerFor(7, { record: 50, amount: 51, status: 52, date: null, plan: 51 });
        expect(marker).toEqual({ list_id: 7, record_field_id: 50, field_ids: [51, 52] });
        const settings = { [CHARGE_LOG_MARKER_KEY]: marker };
        expect(readChargeLogMarker(settings)).toEqual(marker);
        const locks = managedFieldLocks(settings);
        expect(locks.map((l) => l.field_id)).toEqual([50, 51, 52]);
        expect(locks[0]!.reason).toMatch(/suscriptor/);
        expect(isPaymentSyncList(settings)).toBe(true);
    });

    it('sin columnas el registro de cobros no deja marca; una marca rota se ignora', () => {
        expect(chargeLogMarkerFor(7, { record: null, amount: null })).toBeNull();
        expect(readChargeLogMarker({ [CHARGE_LOG_MARKER_KEY]: { list_id: 'x' } })).toBeNull();
        expect(readChargeLogMarker({ [CHARGE_LOG_MARKER_KEY]: [1] })).toBeNull();
        expect(readChargeLogMarker({ [CHARGE_LOG_MARKER_KEY]: { list_id: 3, field_ids: [1, -2, 'a', 4] } })).toEqual({
            list_id: 3,
            record_field_id: null,
            field_ids: [1, 4],
        });
    });

    it('la lista importada de Mercado Pago es una lista de cobros; una lista con un link de pago, no', () => {
        expect(isPaymentSyncList({ subscription_import_fields: { external_id_field_id: 1 }, subscriptions: { fields: { status: 2 } } })).toBe(true);
        expect(isPaymentSyncList({ collections: { fields: { link: 1 } } })).toBe(false);
        expect(isPaymentSyncList({})).toBe(false);
    });

    it('la marca y lo de la importación no viajan en una plantilla ni al duplicar', () => {
        expect(BLUEPRINT_EXCLUDED_SETTINGS).toContain(CHARGE_LOG_MARKER_KEY);
        expect(BLUEPRINT_EXCLUDED_SETTINGS).toContain('subscription_import_fields');
    });
});
