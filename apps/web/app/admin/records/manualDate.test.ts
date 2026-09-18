import { describe, expect, it } from 'vitest';

import { formatManualDate, manualDatePlaceholder, parseManualDate, toIsoDay } from './manualDate';

const d = new Date(2026, 6, 30); // 30 de julio de 2026

describe('manualDate (v0.1.192) — el cuadro del picker habla el formato de la empresa', () => {
    it('formatea según el formato regional', () => {
        expect(formatManualDate(d, 'dmy')).toBe('30/07/2026');
        expect(formatManualDate(d, 'mdy')).toBe('07/30/2026');
        expect(formatManualDate(d, 'ymd')).toBe('2026-07-30');
        expect(manualDatePlaceholder('dmy')).toBe('DD/MM/AAAA');
        expect(manualDatePlaceholder('mdy')).toBe('MM/DD/AAAA');
        expect(manualDatePlaceholder('ymd')).toBe('AAAA-MM-DD');
    });

    it('parsea en el orden del formato (dmy vs mdy) y el ISO siempre', () => {
        expect(toIsoDay(parseManualDate('30/07/2026', 'dmy')!)).toBe('2026-07-30');
        expect(toIsoDay(parseManualDate('07/30/2026', 'mdy')!)).toBe('2026-07-30');
        expect(toIsoDay(parseManualDate('2026-07-30', 'mdy')!)).toBe('2026-07-30');
        expect(toIsoDay(parseManualDate('2026-07-30', 'dmy')!)).toBe('2026-07-30');
        // Con el orden equivocado, 30 no es un mes: inválida, no silenciosa.
        expect(parseManualDate('30/07/2026', 'mdy')).toBeUndefined();
        expect(parseManualDate('07/30/2026', 'dmy')).toBeUndefined();
    });

    it('round-trip: lo que muestra se puede volver a escribir', () => {
        for (const f of ['dmy', 'mdy', 'ymd'] as const) {
            expect(toIsoDay(parseManualDate(formatManualDate(d, f), f)!)).toBe('2026-07-30');
        }
    });

    it('año corto, separadores y fechas imposibles', () => {
        expect(toIsoDay(parseManualDate('5.8.26', 'dmy')!)).toBe('2026-08-05');
        expect(toIsoDay(parseManualDate('5-8-26', 'dmy')!)).toBe('2026-08-05');
        expect(parseManualDate('31/02/2026', 'dmy')).toBeUndefined();
        expect(parseManualDate('hola', 'dmy')).toBeUndefined();
        expect(parseManualDate('', 'dmy')).toBeUndefined();
    });
});
