import { describe, expect, it } from 'vitest';
import {
    amountToSpanishWords,
    applyWordModifiers,
    integerToSpanishWords,
    longSpanishDate,
    numberToSpanishWords,
    parseLooseAmount,
} from './spanish-words';

describe('números en palabras (v0.1.266)', () => {
    it.each([
        [0, 'cero'],
        [1, 'un'],
        [15, 'quince'],
        [21, 'veintiún'],
        [31, 'treinta y un'],
        [100, 'cien'],
        [101, 'ciento un'],
        [555, 'quinientos cincuenta y cinco'],
        [1000, 'mil'],
        [21000, 'veintiún mil'],
        [1_000_000, 'un millón'],
        [1_500_000, 'un millón quinientos mil'],
        [2_350_750, 'dos millones trescientos cincuenta mil setecientos cincuenta'],
        [1_000_000_000, 'mil millones'],
        [3_000_000_000_000, 'tres billones'],
    ])('%d → %s', (n, words) => {
        expect(integerToSpanishWords(n)).toBe(words);
    });

    it('decimales como fracción', () => {
        expect(numberToSpanishWords(1234.5)).toBe('mil doscientos treinta y cuatro con 50/100');
        expect(numberToSpanishWords(-7)).toBe('menos siete');
    });

    it('montos en pesos con "de" en los millones redondos y centavos', () => {
        expect(amountToSpanishWords(1)).toBe('un peso');
        expect(amountToSpanishWords(1_000_000)).toBe('un millón de pesos');
        expect(amountToSpanishWords(2_000_000)).toBe('dos millones de pesos');
        expect(amountToSpanishWords(1_500_000)).toBe('un millón quinientos mil pesos');
        expect(amountToSpanishWords(1500.5)).toBe('mil quinientos pesos con cincuenta centavos');
    });

    it('fecha larga', () => {
        expect(longSpanishDate('2026-10-08')).toBe('8 de octubre de 2026');
        expect(longSpanishDate('2026-01-31 14:00:00')).toBe('31 de enero de 2026');
        expect(longSpanishDate('mañana')).toBe('mañana');
    });

    it('lee montos escritos por personas', () => {
        expect(parseLooseAmount('1.500.000')).toBe(1_500_000);
        expect(parseLooseAmount('$ 1.234,56')).toBe(1234.56);
        expect(parseLooseAmount('99.90')).toBe(99.9);
        expect(parseLooseAmount('hola')).toBeNull();
    });

    it('modificadores encadenados', () => {
        expect(applyWordModifiers('1500000', 1_500_000, ['pesos', 'mayusculas'])).toBe('UN MILLÓN QUINIENTOS MIL PESOS');
        expect(applyWordModifiers('2026-10-08', '2026-10-08', ['larga'])).toBe('8 de octubre de 2026');
        // Un texto que no es número pasa intacto por `letras`.
        expect(applyWordModifiers('[Valor]', '[Valor]', ['letras'])).toBe('[Valor]');
    });
});
