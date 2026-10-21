import { describe, expect, it } from 'vitest';
import { formatTimerClock, formatTrackedSeconds, timeDurationInputSchema } from '../schemas/time-tracking';
import { isUserWritableType, NON_DATA_FIELD_TYPES } from '../schemas/field';
import { checkRestoreValue, sameFieldValue } from './restore';

const estado = {
    type: 'select' as const,
    config: { options: [{ value: 'en_curso', label: 'En curso' }, { value: 'cerrado', label: 'Cerrado' }] },
    is_required: false,
};

describe('v0.1.288 — restaurar un valor del historial', () => {
    it('un valor que sigue siendo válido se restaura (normalizado como al guardar)', () => {
        expect(checkRestoreValue(estado, 'cerrado')).toEqual({ ok: true, value: 'cerrado' });
        expect(checkRestoreValue({ type: 'number', config: {}, is_required: false }, '12')).toMatchObject({ ok: true });
        expect(checkRestoreValue({ type: 'text', config: {}, is_required: false }, null)).toEqual({ ok: true, value: null });
    });

    it('una opción borrada se nombra en el motivo', () => {
        const r = checkRestoreValue(estado, 'nuevo');
        expect(r).toEqual({ ok: false, reason: 'La opción «nuevo» ya no existe en el campo.' });
        const multi = checkRestoreValue({ ...estado, type: 'multi_select' }, ['nuevo', 'viejo', 'cerrado']);
        expect(multi.ok).toBe(false);
        if (!multi.ok) expect(multi.reason).toContain('«nuevo», «viejo»');
    });

    it('cambio de tipo, campo calculado u obligatorio vacío: se explica por qué no', () => {
        const r = checkRestoreValue({ type: 'number', config: {}, is_required: false }, 'Acme');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/ya no es válido/);
        expect(checkRestoreValue({ type: 'time_tracked', config: {}, is_required: false }, 90)).toEqual({
            ok: false,
            reason: 'Este campo se calcula solo: su valor no se escribe a mano.',
        });
        expect(checkRestoreValue({ type: 'text', config: {}, is_required: true }, null).ok).toBe(false);
    });

    it('«ya es el valor actual» ignora el orden de un multi_select y los vacíos', () => {
        expect(sameFieldValue(['b', 'a'], ['a', 'b'])).toBe(true);
        expect(sameFieldValue(null, '')).toBe(true);
        expect(sameFieldValue('a', 'b')).toBe(false);
    });
});

describe('v0.1.288 — «Tiempo registrado»', () => {
    it('es un derivado: no vive en data ni se escribe a mano', () => {
        expect(isUserWritableType('time_tracked')).toBe(false);
        expect(NON_DATA_FIELD_TYPES).toContain('time_tracked');
    });

    it('duraciones y relojes', () => {
        expect(timeDurationInputSchema.parse('2h')).toBe(120);
        expect(timeDurationInputSchema.safeParse('').success).toBe(false);
        expect(formatTrackedSeconds(3725)).toBe('1h 2m');
        expect(formatTrackedSeconds(7200)).toBe('2h');
        expect(formatTimerClock(3725)).toBe('1:02:05');
        expect(formatTimerClock(-5)).toBe('0:00:00');
    });
});
