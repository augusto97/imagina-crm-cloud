import { describe, expect, it } from 'vitest';

import { cleanStyle, parseNum } from './DesignStyleControls';

describe('controles de diseño', () => {
    it('lee números con coma o punto y deja vacío como automático', () => {
        expect(parseNum('12')).toBe(12);
        expect(parseNum('1,5')).toBe(1.5);
        expect(parseNum(' 0.8 ')).toBe(0.8);
        expect(parseNum('-2')).toBe(-2);
        expect(parseNum('')).toBeNull();
        expect(parseNum('abc')).toBe('invalid');
        expect(parseNum('1,2,3')).toBe('invalid');
    });

    it('un estilo sin valores vuelve a undefined (el bloque sale como antes)', () => {
        expect(cleanStyle({ font_size: null, border_sides: [], text_transform: undefined })).toBeUndefined();
        expect(cleanStyle({ font_size: 18, padding_top: 0, radius: null })).toEqual({ font_size: 18, padding_top: 0 });
    });
});
