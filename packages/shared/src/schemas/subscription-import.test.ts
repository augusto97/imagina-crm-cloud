import { describe, expect, it } from 'vitest';
import { decideImport, isProvisionalSubscriberTitle, subscriberTitle } from './subscription-import';

/** v0.1.380 — Cómo se llama al suscriptor y qué se deja afuera al importar. */
describe('suscripciones importadas de Mercado Pago (v0.1.380)', () => {
    it('el suscriptor se llama por su nombre, su correo o su número de cliente', () => {
        expect(subscriberTitle({ name: 'Ana Gómez', email: 'ana@x.co', payerId: '1', externalId: 'e' })).toBe('Ana Gómez');
        expect(subscriberTitle({ name: null, email: 'ana@x.co', payerId: '1', externalId: 'e' })).toBe('ana@x.co');
        expect(subscriberTitle({ name: null, email: null, payerId: '261317178', externalId: 'e' })).toBe('Cliente de Mercado Pago #261317178');
        expect(subscriberTitle({ name: null, email: null, payerId: null, externalId: 'ab12' })).toBe('Suscripción ab12');
    });

    it('sólo se reemplaza el título provisorio (nunca lo que alguien escribió)', () => {
        expect(isProvisionalSubscriberTitle('Cliente de Mercado Pago #261317178')).toBe(true);
        expect(isProvisionalSubscriberTitle('Suscripción d193617707ff4742bc82615081aad18b')).toBe(true);
        expect(isProvisionalSubscriberTitle('')).toBe(true);
        expect(isProvisionalSubscriberTitle(undefined)).toBe(true);
        expect(isProvisionalSubscriberTitle('Ana@X.co', 'ana@x.co')).toBe(true);
        expect(isProvisionalSubscriberTitle('Ana Gómez', 'ana@x.co')).toBe(false);
        expect(isProvisionalSubscriberTitle('Cliente de Mercado Pago #12 (VIP)')).toBe(false);
    });

    it('las «Por autorizar» se dejan afuera si no se piden; sin decir, se traen como antes', () => {
        const base = { known: false, status: 'pending' as const, includeCancelled: false, ours: false, mode: 'create' as const, email: null, match: null, createMissing: true };
        expect(decideImport({ ...base, includePending: false }).action).toBe('skip');
        expect(decideImport({ ...base, includePending: true }).action).toBe('create_record');
        expect(decideImport(base).action).toBe('create_record');
        expect(decideImport({ ...base, status: 'authorized', includePending: false }).action).toBe('create_record');
    });
});
