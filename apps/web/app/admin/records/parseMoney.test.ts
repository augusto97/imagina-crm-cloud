import { describe, expect, it } from 'vitest';

import { parseMoney } from './parseMoney';

describe('parseMoney', () => {
    it('lee el punto de miles latinoamericano', () => {
        expect(parseMoney('12.500')).toBe(12500);
        expect(parseMoney('1.250.000')).toBe(1250000);
        expect(parseMoney('12.500,50')).toBe(12500.5);
    });
    it('lee la coma de miles y el punto decimal', () => {
        expect(parseMoney('12,500')).toBe(12500);
        expect(parseMoney('12,500.75')).toBe(12500.75);
        expect(parseMoney('12500.5')).toBe(12500.5);
    });
    it('una coma con 1-2 decimales es decimal', () => {
        expect(parseMoney('12,5')).toBe(12.5);
        expect(parseMoney('0,99')).toBe(0.99);
    });
    it('vacío o inválido → null', () => {
        expect(parseMoney('')).toBeNull();
        expect(parseMoney('  ')).toBeNull();
        expect(parseMoney('abc')).toBeNull();
        expect(parseMoney('-5')).toBeNull();
    });
});
