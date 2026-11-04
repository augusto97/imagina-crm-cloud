import { describe, expect, it } from 'vitest';

import { formCalcIsLive, formConfigSchema, formPaymentActive } from './form';
import { formPaymentAmount } from './form-logic';

/** v0.1.361 — Cobrar al enviar: de dónde sale el monto y cuándo se cobra. */
describe('cobrar al enviar', () => {
    const base = (payment: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
        formConfigSchema.parse({
            items: [
                { id: 'qplan001', type: 'field', field_id: 7 },
                { id: 'qmonto01', type: 'field', field_id: 8 },
            ],
            settings: {
                calcs: [{ id: 'cprecio1', name: 'Precio', key: 'precio', start: 0, parts: [{ field_id: 7, points: { a: 10, b: 20 }, multiplier: null }], save_field_id: null }],
                payment: { enabled: true, connection_id: 3, ...payment },
                ...extra,
            },
        });

    it('sólo está activo con conexión y un monto que sale de algo que existe', () => {
        expect(formPaymentActive(base({ source: 'fixed', amount: 1000 }))).toBe(true);
        expect(formPaymentActive(base({ source: 'fixed', amount: 0 }))).toBe(false);
        expect(formPaymentActive(base({ source: 'fixed', amount: 1000, connection_id: null }))).toBe(false);
        expect(formPaymentActive(base({ source: 'fixed', amount: 1000, enabled: false }))).toBe(false);
        expect(formPaymentActive(base({ source: 'calc', calc_key: 'precio' }))).toBe(true);
        expect(formPaymentActive(base({ source: 'calc', calc_key: 'otro' }))).toBe(false);
        expect(formPaymentActive(base({ source: 'field', field_id: 8 }))).toBe(true);
        expect(formPaymentActive(base({ source: 'field', field_id: 99 }))).toBe(false);
    });

    it('el monto: fijo, del cálculo o lo escrito (con mínimo y máximo), redondeado a centavos', () => {
        expect(formPaymentAmount({ source: 'fixed', amount: 1500.555, calc_key: null, min: null, max: null }, { calcs: {}, fieldValue: undefined })).toEqual({ amount: 1500.56 });
        expect(formPaymentAmount({ source: 'calc', amount: null, calc_key: 'precio', min: null, max: null }, { calcs: { precio: 80000 }, fieldValue: undefined })).toEqual({ amount: 80000 });
        // Un cálculo negativo o sin respuesta no cobra nada.
        expect(formPaymentAmount({ source: 'calc', amount: null, calc_key: 'precio', min: null, max: null }, { calcs: { precio: -5 }, fieldValue: undefined })).toEqual({ amount: 0 });
        expect(formPaymentAmount({ source: 'calc', amount: null, calc_key: 'precio', min: null, max: null }, { calcs: {}, fieldValue: undefined })).toEqual({ amount: 0 });
        const field = { source: 'field' as const, amount: null, calc_key: null, min: 10000, max: 500000 };
        expect(formPaymentAmount(field, { calcs: {}, fieldValue: 75000 })).toEqual({ amount: 75000 });
        expect(formPaymentAmount(field, { calcs: {}, fieldValue: '75000' })).toEqual({ amount: 75000 });
        expect(formPaymentAmount(field, { calcs: {}, fieldValue: 5000 })).toEqual({ error: 'below_min' });
        expect(formPaymentAmount(field, { calcs: {}, fieldValue: 900000 })).toEqual({ error: 'above_max' });
        // Vacío: no se cobra (si la pregunta es obligatoria, la valida el formulario).
        expect(formPaymentAmount(field, { calcs: {}, fieldValue: undefined })).toEqual({ amount: 0 });
        expect(formPaymentAmount(field, { calcs: {}, fieldValue: 'abc' })).toEqual({ amount: 0 });
    });

    it('el cálculo del monto viaja a la página (para mostrar el total antes de enviar)', () => {
        expect(formCalcIsLive(base({ source: 'calc', calc_key: 'precio' }), 'precio')).toBe(true);
        expect(formCalcIsLive(base({ source: 'fixed', amount: 1000 }), 'precio')).toBe(false);
        expect(formCalcIsLive(base({ source: 'calc', calc_key: 'precio', enabled: false }), 'precio')).toBe(false);
    });

    it('lo raro guardado cae al valor por defecto sin romper el formulario', () => {
        const c = formConfigSchema.parse({ items: [], settings: { payment: { enabled: true, source: 'cripto', currency: 'pesos', expires_days: 900, amount: -3 } } });
        expect(c.settings.payment).toMatchObject({ enabled: true, source: 'fixed', currency: 'COP', expires_days: 3, amount: null, after: 'redirect' });
        const old = formConfigSchema.parse({ items: [], settings: {} });
        expect(old.settings.payment.enabled).toBe(false);
    });
});
