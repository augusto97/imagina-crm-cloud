import { describe, expect, it } from 'vitest';

import { validateFieldValue } from './validate';
import { formatPhone, normalizePhone, splitPhone } from './phone';

/**
 * v0.1.158 — el teléfono se guarda en UNA cadena canónica. Estos tests
 * fijan las tres reglas que hacen que eso funcione: qué se acepta al
 * escribir, cómo se recupera el indicativo y cómo se muestra.
 */
describe('normalizePhone', () => {
    it('limpia la puntuación humana y conserva el indicativo escrito', () => {
        expect(normalizePhone('+57 (300) 111-2233')).toEqual({ ok: true, value: '+573001112233' });
        expect(normalizePhone('+1 202.555.1234')).toEqual({ ok: true, value: '+12025551234' });
    });

    it('traduce el prefijo internacional 00 a +', () => {
        expect(normalizePhone('0057 3001112233')).toEqual({ ok: true, value: '+573001112233' });
    });

    it('un número local toma el indicativo del país configurado, sin el 0 de tronco', () => {
        expect(normalizePhone('3001112233', 'CO')).toEqual({ ok: true, value: '+573001112233' });
        // España escribe el fijo con 0 de tronco: no va en formato internacional.
        expect(normalizePhone('0912345678', 'ES')).toEqual({ ok: true, value: '+34912345678' });
    });

    it('sin país configurado NO inventa un indicativo: guarda los dígitos tal cual', () => {
        expect(normalizePhone('3001112233')).toEqual({ ok: true, value: '3001112233' });
    });

    it('rechaza lo que no es un teléfono', () => {
        expect(normalizePhone('').ok).toBe(false);
        expect(normalizePhone('hola').ok).toBe(false);
        expect(normalizePhone('+12').ok).toBe(false);
        expect(normalizePhone('+123456789012345678').ok).toBe(false);
    });
});

describe('splitPhone', () => {
    it('gana el indicativo MÁS LARGO (Dominicana vs. EE.UU. comparten el +1)', () => {
        expect(splitPhone('+18095551234').country?.iso2).toBe('DO');
        expect(splitPhone('+12025551234').country?.iso2).toBe('US');
    });

    it('un valor sin + no tiene país', () => {
        expect(splitPhone('3001112233')).toEqual({ country: null, dial: '', national: '3001112233' });
    });
});

describe('formatPhone', () => {
    it('agrupa 10 dígitos como 3-3-4 detrás del indicativo', () => {
        expect(formatPhone('+573001112233')).toBe('+57 300 111 2233');
        expect(formatPhone('+12025551234')).toBe('+1 202 555 1234');
    });

    it('vacío para valores que no son teléfono', () => {
        expect(formatPhone(null)).toBe('');
        expect(formatPhone('')).toBe('');
    });
});

describe('validateFieldValue(phone)', () => {
    const field = (config: Record<string, unknown> = {}) =>
        ({ type: 'phone', config, is_required: false }) as const;

    it('normaliza al guardar usando el país del campo', () => {
        expect(validateFieldValue(field({ default_country: 'CO' }), '300 111 2233')).toEqual({
            ok: true,
            value: '+573001112233',
        });
    });

    it('vacío queda en null si el campo no es obligatorio', () => {
        expect(validateFieldValue(field(), '')).toEqual({ ok: true, value: null });
    });
});
