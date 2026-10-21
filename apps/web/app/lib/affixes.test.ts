import { describe, expect, it } from 'vitest';

import { effectiveAffixes, withAffixes } from './affixes';

describe('prefijo y sufijo sobre un valor ya formateado', () => {
    it('no repite el «%» que el porcentaje ya trae', () => {
        expect(withAffixes('37,5%', '', '%')).toBe('37,5%');
        expect(withAffixes('70 %', '', ' %')).toBe('70 %');
    });

    it('no repite el símbolo de la moneda', () => {
        expect(withAffixes('$ 1.200', '$', '')).toBe('$ 1.200');
        expect(withAffixes('US$1.200', 'US$', '')).toBe('US$1.200');
    });

    it('agrega lo que el valor no trae', () => {
        expect(withAffixes('1.200', '$', '')).toBe('$1.200');
        expect(withAffixes('12', '', ' h')).toBe('12 h');
        expect(withAffixes('12', '', '')).toBe('12');
    });

    it('devuelve los afijos a usar (para pintarlos con su propio estilo)', () => {
        expect(effectiveAffixes('40%', '', '%')).toEqual({ prefix: '', suffix: '' });
        expect(effectiveAffixes('40', '', '%')).toEqual({ prefix: '', suffix: '%' });
    });
});
