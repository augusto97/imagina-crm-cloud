import { describe, expect, it } from 'vitest';
import { foldSearchText, matchesSearchTokens, searchTokenPattern, searchTokens } from './search';

describe('búsqueda de registros — plegado y palabras', () => {
    it('pliega acentos y mayúsculas', () => {
        expect(foldSearchText('Álvaro MUÑOZ Gonçalves')).toBe('alvaro munoz goncalves');
    });

    it('parte por palabras, sin repetir, y tolera puntuación', () => {
        expect(searchTokens('  Álvaro  muñoz ')).toEqual(['alvaro', 'munoz']);
        expect(searchTokens('ana@acme.co')).toEqual(['ana', 'acme', 'co']);
        expect(searchTokens('(300) 111-2233')).toEqual(['300', '111', '2233']);
        expect(searchTokens('a a a')).toEqual(['a']);
        expect(searchTokens('@@@ ---')).toEqual([]);
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
    });

    it('AND de palabras sobre el texto plegado', () => {
        const blob = foldSearchText('Álvaro Pérez · Bogotá');
        expect(matchesSearchTokens(blob, searchTokens('perez alvaro'))).toBe(true);
        expect(matchesSearchTokens(blob, searchTokens('perez medellin'))).toBe(false);
    });
});
