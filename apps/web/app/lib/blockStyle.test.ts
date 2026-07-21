import { describe, expect, it } from 'vitest';

import { blockStyleCss, hasBlockStyle, readBlockStyle, wrapperStyleCss } from './blockStyle';

describe('blockStyle', () => {
    it('readBlockStyle tolera basura y acepta claves válidas', () => {
        expect(readBlockStyle(undefined)).toEqual({});
        expect(readBlockStyle({})).toEqual({});
        expect(readBlockStyle({ style: 'nope' })).toEqual({});
        expect(
            readBlockStyle({
                style: {
                    bg: '#ffffff',
                    text: '#111827',
                    border: 'red',      // no-hex → fuera
                    pad: 'lg',
                    radius: 'gigante',  // inválido → fuera
                    shadow: 'md',
                    align: 'center',
                    extra: 1,
                },
            }),
        ).toEqual({ bg: '#ffffff', text: '#111827', pad: 'lg', shadow: 'md', align: 'center' });
    });

    it('blockStyleCss aplica defaults amables cuando hay fondo', () => {
        const css = blockStyleCss({ bg: '#0ea5e9' });
        expect(css.backgroundColor).toBe('#0ea5e9');
        expect(css.padding).toBe('16px');
        expect(css.borderRadius).toBe('10px');

        // pad explícito none gana sobre el default
        const flat = blockStyleCss({ bg: '#0ea5e9', pad: 'none', radius: 'none' });
        expect(flat.padding).toBeUndefined();
        expect(flat.borderRadius).toBeUndefined();
    });

    it('blockStyleCss sin fondo no inventa caja', () => {
        const css = blockStyleCss({ align: 'right', text: '#333333' });
        expect(css.backgroundColor).toBeUndefined();
        expect(css.padding).toBeUndefined();
        expect(css.textAlign).toBe('right');
        expect(css.color).toBe('#333333');
        expect(hasBlockStyle({})).toBe(false);
        expect(hasBlockStyle({ align: 'right' })).toBe(true);
    });

    it('wrapperStyleCss: fondo de sección con padding default y override', () => {
        const css = wrapperStyleCss({ bg: '#f1f5f9' });
        expect(css.backgroundColor).toBe('#f1f5f9');
        expect(css.padding).toBe('16px');
        const withPad = wrapperStyleCss({ bg: '#f1f5f9', padding: '32px 8px' });
        expect(withPad.padding).toBe('32px 8px');
        const noBg = wrapperStyleCss({ padding: '8px', margin: '0 0 12px' });
        expect(noBg.backgroundColor).toBeUndefined();
        expect(noBg.margin).toBe('0 0 12px');
    });
});
