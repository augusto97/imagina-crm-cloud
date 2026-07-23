import { afterEach, describe, expect, it } from 'vitest';

import {
    formatDateStr,
    formatDateTimeStr,
    formatNumber,
    formatTimeOfDay,
    numberFormatLocale,
    setTenantFormat,
    type TenantFormat,
} from './tenantFormat';

const DOT_COMMA: TenantFormat = { number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24' };

afterEach(() => setTenantFormat(null));

describe('formatNumber (v0.1.104)', () => {
    it('comma_dot (default) — comportamiento histórico', () => {
        expect(formatNumber(1234567.89, { minFrac: 2, maxFrac: 2 })).toBe('1,234,567.89');
        expect(formatNumber(1032000, { maxFrac: 0 })).toBe('1,032,000');
    });

    it('dot_comma — punto para miles, coma decimal (Latinoamérica)', () => {
        setTenantFormat({ number_format: 'dot_comma' });
        expect(formatNumber(1234567.89, { minFrac: 2, maxFrac: 2 })).toBe('1.234.567,89');
        expect(formatNumber(1032000, { maxFrac: 0 })).toBe('1.032.000');
        // Negativos y números chicos sin miles.
        expect(formatNumber(-4500.5, { maxFrac: 2 })).toBe('-4.500,5');
        expect(formatNumber(42, { maxFrac: 0 })).toBe('42');
    });

    it('space_comma — espacio para miles, coma decimal', () => {
        setTenantFormat({ number_format: 'space_comma' });
        expect(formatNumber(1234567.89, { minFrac: 2, maxFrac: 2 })).toBe('1\u00a0234\u00a0567,89');
    });

    it('acepta un formato explícito sin tocar el estado de módulo', () => {
        expect(formatNumber(1000, { maxFrac: 0 }, DOT_COMMA)).toBe('1.000');
        expect(formatNumber(1000, { maxFrac: 0 })).toBe('1,000');
    });
});

describe('formatDateStr', () => {
    it('respeta el orden configurado; no parsea Date (cero shift de zona)', () => {
        expect(formatDateStr('2026-12-31')).toBe('2026-12-31');
        expect(formatDateStr('2026-12-31', { ...DOT_COMMA, date_format: 'dmy' })).toBe('31/12/2026');
        expect(formatDateStr('2026-12-31', { ...DOT_COMMA, date_format: 'mdy' })).toBe('12/31/2026');
    });

    it('valores no-fecha se devuelven tal cual', () => {
        setTenantFormat({ date_format: 'dmy' });
        expect(formatDateStr('hola')).toBe('hola');
        expect(formatDateStr('')).toBe('');
    });
});

describe('formatTimeOfDay / formatDateTimeStr', () => {
    it('h24 y h12', () => {
        const d = new Date(2026, 6, 23, 14, 30);
        expect(formatTimeOfDay(d)).toBe('14:30');
        expect(formatTimeOfDay(d, { ...DOT_COMMA, time_format: 'h12' })).toBe('2:30 p. m.');
        const am = new Date(2026, 6, 23, 0, 5);
        expect(formatTimeOfDay(am, { ...DOT_COMMA, time_format: 'h12' })).toBe('12:05 a. m.');
    });

    it('datetime naive-UTC → local con el formato configurado', () => {
        // El test corre con TZ del entorno — verificamos estructura, no la
        // hora exacta (la conversión UTC→local depende del runner).
        setTenantFormat({ date_format: 'dmy', time_format: 'h24' });
        expect(formatDateTimeStr('2026-12-31 14:30:00')).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
        expect(formatDateTimeStr('no-fecha')).toBe('no-fecha');
    });
});

describe('numberFormatLocale', () => {
    it('mapea el formato a un locale de Intl coherente', () => {
        expect(numberFormatLocale()).toBe('en-US');
        expect(numberFormatLocale(DOT_COMMA)).toBe('es-CO');
        expect(numberFormatLocale({ ...DOT_COMMA, number_format: 'space_comma' })).toBe('fr-FR');
    });
});
