import { describe, expect, it } from 'vitest';

import { fieldPrecision, formatFieldNumber } from './fieldNumberFormat';

const currency = (config: Record<string, unknown>) => ({ type: 'currency' as const, config });
const number = (config: Record<string, unknown>) => ({ type: 'number' as const, config });

describe('fieldPrecision', () => {
    it('lee config.precision', () => {
        expect(fieldPrecision(currency({ precision: 0 }))).toBe(0);
        expect(fieldPrecision(currency({ precision: 3 }))).toBe(3);
        expect(fieldPrecision(number({ precision: 4 }))).toBe(4);
    });

    it('defaults por tipo cuando no hay precision: currency 2, number 0', () => {
        expect(fieldPrecision(currency({}))).toBe(2);
        expect(fieldPrecision(number({}))).toBe(0);
    });

    it('ignora valores inválidos (string, negativo, NaN) y cae al default', () => {
        expect(fieldPrecision(currency({ precision: 'x' }))).toBe(2);
        expect(fieldPrecision(number({ precision: -1 }))).toBe(0);
        expect(fieldPrecision(number({ precision: Number.NaN }))).toBe(0);
    });
});

describe('formatFieldNumber', () => {
    it('currency con precision 0 → sin decimales (el reporte del usuario)', () => {
        expect(formatFieldNumber(currency({ precision: 0 }), 1032000)).toBe('1,032,000');
        // Y no contiene separador decimal con dígitos tras él.
        expect(formatFieldNumber(currency({ precision: 0 }), 450000)).not.toMatch(/[.,]00$/);
    });

    it('currency sin precision configurada conserva 2 decimales fijos', () => {
        expect(formatFieldNumber(currency({}), 50)).toBe('50.00');
    });

    it('number no rellena ceros: hasta precision decimales', () => {
        expect(formatFieldNumber(number({ precision: 2 }), 10)).toBe('10');
        expect(formatFieldNumber(number({ precision: 2 }), 10.5)).toBe('10.5');
        // precision 0 redondea la fracción.
        expect(formatFieldNumber(number({ precision: 0 }), 10.6)).toBe('11');
    });
});
