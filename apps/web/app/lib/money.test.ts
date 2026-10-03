import { describe, expect, it } from 'vitest';

import { parseLocalAmount } from './money';

describe('parseLocalAmount (v0.1.251)', () => {
    it('lee los montos como se escriben en Latinoamérica', () => {
        expect(parseLocalAmount('150000')).toBe(150000);
        expect(parseLocalAmount('150.000')).toBe(150000);
        expect(parseLocalAmount('1.500.000')).toBe(1500000);
        expect(parseLocalAmount('$ 1.234,50')).toBe(1234.5);
        expect(parseLocalAmount('1,234.50')).toBe(1234.5);
        expect(parseLocalAmount('99.90')).toBe(99.9);
        expect(parseLocalAmount('150,000')).toBe(150000);
        expect(parseLocalAmount('1,5')).toBe(1.5);
    });

    it('lo que no es un número da 0', () => {
        expect(parseLocalAmount('')).toBe(0);
        expect(parseLocalAmount('abc')).toBe(0);
    });
});
