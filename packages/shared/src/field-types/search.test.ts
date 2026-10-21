import { describe, expect, it } from 'vitest';
import { foldSearchText, matchesSearchTokens, searchTokenPattern, searchTokens } from './search';

describe('búsqueda de registros — plegado y palabras', () => {
    it('pliega acentos y mayúsculas', () => {
        expect(foldSearchText('Álvaro MUÑOZ Gonçalves')).toBe('alvaro munoz goncalves');
    });

    it('parte por ESPACIOS (un código o un email es una sola palabra), sin repetir', () => {
        expect(searchTokens('  Álvaro  muñoz ')).toEqual(['alvaro', 'munoz']);
        expect(searchTokens('ana@acme.co')).toEqual(['ana@acme.co']);
        expect(searchTokens('N-001 fac')).toEqual(['n-001', 'fac']);
        expect(searchTokens('(300) 111-2233')).toEqual(['(300)', '111-2233']);
        expect(searchTokens('a a a')).toEqual(['a']);
        expect(searchTokens('   ')).toEqual([]);
    });

    it('el patrón encuentra la palabra con cualquier acento o mayúscula', () => {
        const re = new RegExp(searchTokenPattern('alvaro'));
        expect(re.test('Álvaro Pérez')).toBe(true);
        expect(re.test('ALVARO')).toBe(true);
        expect(re.test('alvaro')).toBe(true);
        expect(re.test('Albaro')).toBe(false);
        const n = new RegExp(searchTokenPattern('munoz'));
        expect(n.test('Muñoz')).toBe(true);
        expect(searchTokenPattern('300')).toBe('300');
        // Signos: literales; con dígitos, también la forma sólo-dígitos.
        const code = new RegExp(searchTokenPattern('n-1'));
        expect(code.test('Factura N-1')).toBe(true);
        expect(code.test('F-1 nueva')).toBe(false);
        const tel = new RegExp(searchTokenPattern('111-2233'));
        expect(tel.test('+573001112233')).toBe(true);
        expect(new RegExp(searchTokenPattern('a.b')).test('axb')).toBe(false);
    });

    it('AND de palabras sobre el texto plegado', () => {
        const blob = foldSearchText('Álvaro Pérez · Bogotá');
        expect(matchesSearchTokens(blob, searchTokens('perez alvaro'))).toBe(true);
        expect(matchesSearchTokens(blob, searchTokens('perez medellin'))).toBe(false);
        // Teléfono: la palabra con signos encuentra los dígitos.
        expect(matchesSearchTokens('pedro +573001112233 573001112233', searchTokens('(300) 111-2233'))).toBe(true);
    });
});
