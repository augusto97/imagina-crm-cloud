import { describe, expect, it } from 'vitest';

import {
    blockStyleClass,
    blockStyleCss,
    hasBlockStyle,
    hexToHslTriplet,
    readBlockStyle,
    readPageSettings,
    wrapperStyleCss,
} from './blockStyle';

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

    it('v0.1.94 — tipografía por bloque (size + weight)', () => {
        const style = readBlockStyle({ style: { size: '2xl', weight: 'bold', align: 'center' } });
        expect(style).toEqual({ size: '2xl', weight: 'bold', align: 'center' });
        const css = blockStyleCss(style);
        expect(css.fontSize).toBe('28px');
        expect(css.fontWeight).toBe(700);
        // valores inválidos se descartan
        expect(readBlockStyle({ style: { size: 'gigante', weight: 900 } })).toEqual({});
    });

    it('v0.1.94 — readPageSettings valida fondo/ancho/tipografía de página', () => {
        expect(readPageSettings(undefined)).toEqual({});
        expect(readPageSettings({ bg: '#f1f5f9', max_width: 1100, font: 'serif' })).toEqual({
            bg: '#f1f5f9',
            max_width: 1100,
            font: 'serif',
        });
        // ancho mínimo 480 y font desconocida → fuera
        expect(readPageSettings({ bg: 'blue', max_width: 100, font: 'comic' })).toEqual({});
    });

    it('v0.1.95 — el fondo re-tiñe los tokens del tema (tarjetas internas)', () => {
        expect(hexToHslTriplet('#ffffff')).toBe('0 0% 100%');
        expect(hexToHslTriplet('#2563eb')).toBe('221 83% 53%');
        expect(hexToHslTriplet('azul')).toBeNull();

        const css = blockStyleCss({ bg: '#2563eb', text: '#ffffff' }) as Record<string, unknown>;
        // La tarjeta propia del bloque adopta el color (nada de tarjeta blanca)
        expect(css['--imcrm-card']).toBe('221 83% 53%');
        expect(css['--imcrm-muted']).toBe('221 83% 53%');
        // Sin borde elegido, los hairlines internos se funden con el fondo
        expect(css['--imcrm-border']).toBe('221 83% 53%');
        // El texto re-tiñe los foregrounds (labels incluidos)
        expect(css['--imcrm-card-foreground']).toBe('0 0% 100%');
        expect(css['--imcrm-muted-foreground']).toBe('0 0% 100%');

        // Borde explícito gana sobre el melt
        const bordered = blockStyleCss({ bg: '#2563eb', border: '#ffffff' }) as Record<string, unknown>;
        expect(bordered['--imcrm-border']).toBe('0 0% 100%');
    });

    it('v0.1.95 — blockStyleClass activa la herencia tipográfica', () => {
        expect(blockStyleClass({})).toBe('');
        expect(blockStyleClass({ size: 'xl' })).toBe('imcrm-style-fs');
        expect(blockStyleClass({ weight: 'bold' })).toBe('imcrm-style-fw');
        expect(blockStyleClass({ size: 'sm', weight: 'medium' })).toBe('imcrm-style-fs imcrm-style-fw');
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
