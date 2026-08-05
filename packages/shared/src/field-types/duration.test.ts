import { describe, expect, it } from 'vitest';

import { formatDuration, parseDuration } from './duration';
import { validateFieldValue } from './validate';

/**
 * v0.1.158 — la duración se guarda en MINUTOS (un número), así filtra,
 * ordena y suma con el motor numérico que ya existe. El parser tiene que
 * aceptar lo que la gente escribe de verdad.
 */
describe('parseDuration', () => {
    it('acepta minutos pelados, reloj y unidades', () => {
        expect(parseDuration('90')).toEqual({ ok: true, value: 90 });
        expect(parseDuration('1:30')).toEqual({ ok: true, value: 90 });
        expect(parseDuration('1h 30m')).toEqual({ ok: true, value: 90 });
        expect(parseDuration('2h')).toEqual({ ok: true, value: 120 });
        expect(parseDuration('45m')).toEqual({ ok: true, value: 45 });
        expect(parseDuration('1d 2h')).toEqual({ ok: true, value: 1560 });
        expect(parseDuration('1,5h')).toEqual({ ok: true, value: 90 });
    });

    it('rechaza lo que no es una duración', () => {
        expect(parseDuration('mañana').ok).toBe(false);
        expect(parseDuration('2h y pico').ok).toBe(false);
        expect(parseDuration(-5).ok).toBe(false);
        expect(parseDuration('99999d').ok).toBe(false);
    });
});

describe('formatDuration', () => {
    it('muestra según el formato del campo', () => {
        expect(formatDuration(90)).toBe('1h 30m');
        expect(formatDuration(120)).toBe('2h');
        expect(formatDuration(45)).toBe('45m');
        expect(formatDuration(90, 'clock')).toBe('1:30');
        expect(formatDuration(605, 'clock')).toBe('10:05');
    });
});

describe('validateFieldValue de los tipos numéricos nuevos', () => {
    const f = (type: 'rating' | 'percent' | 'duration', config: Record<string, unknown> = {}) =>
        ({ type, config, is_required: false }) as const;

    it('duration guarda minutos aunque se escriba "1h 30m"', () => {
        expect(validateFieldValue(f('duration'), '1h 30m')).toEqual({ ok: true, value: 90 });
    });

    it('rating respeta el máximo configurado y redondea', () => {
        expect(validateFieldValue(f('rating'), 4)).toEqual({ ok: true, value: 4 });
        expect(validateFieldValue(f('rating', { max: 3 }), 4).ok).toBe(false);
        expect(validateFieldValue(f('rating'), '3.4')).toEqual({ ok: true, value: 3 });
    });

    it('percent acepta el signo y corta fuera de 0-100', () => {
        expect(validateFieldValue(f('percent'), '45%')).toEqual({ ok: true, value: 45 });
        expect(validateFieldValue(f('percent'), 140).ok).toBe(false);
        expect(validateFieldValue(f('percent'), -1).ok).toBe(false);
    });
});
