import { describe, expect, it } from 'vitest';

import {
    blockStyleClass,
    blockStyleCss,
    hasBlockStyle,
    hexToHslTriplet,
    readBlockStyle,
    pageStyleCss,
    readPageSettings,
    surfaceInkCss,
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

    // v0.1.122 — los colores se eligen en UN tema y se ven en los DOS: la
    // tinta tiene que resolverse contra la superficie real, no heredarse.
    it('v0.1.122 — un fondo claro sin texto elegido lleva tinta oscura (y al revés)', () => {
        const claro = blockStyleCss({ bg: '#e0f2fe' }) as Record<string, unknown>;
        expect(claro.color).toBe('hsl(224 45% 12%)');
        expect(claro['--imcrm-foreground']).toBe('224 45% 12%');
        expect(claro['--imcrm-muted-foreground']).toBe('224 18% 38%');

        const oscuro = blockStyleCss({ bg: '#0b1220' }) as Record<string, unknown>;
        expect(oscuro.color).toBe('hsl(210 40% 96%)');
        expect(oscuro['--imcrm-muted-foreground']).toBe('215 20% 75%');

        // Y da igual el tema del admin: manda el fondo elegido.
        expect((blockStyleCss({ bg: '#e0f2fe' }, { dark: true }) as Record<string, unknown>).color).toBe(
            'hsl(224 45% 12%)',
        );
    });

    it('v0.1.122 — una tinta sin fondo se adapta a la superficie del tema', () => {
        // Tinta oscura elegida en claro: en claro queda intacta…
        expect(blockStyleCss({ text: '#111827' }).color).toBe('#111827');
        // …y en oscuro se lleva a una franja legible conservando el tono.
        expect(blockStyleCss({ text: '#111827' }, { dark: true }).color).toBe('hsl(221 39% 82%)');
        // Una tinta que ya contrasta no se toca.
        expect(blockStyleCss({ text: '#38bdf8' }, { dark: true }).color).toBe('#38bdf8');
        // Y al revés: blanco sobre superficie clara se baja.
        expect(blockStyleCss({ text: '#ffffff' }).color).toBe('hsl(0 0% 28%)');
    });

    it('v0.1.122 — el fondo también re-tiñe las superficies de página del bloque', () => {
        const css = blockStyleCss({ bg: '#fefce8' }) as Record<string, unknown>;
        // El header sticky de una tabla (bg-canvas) adopta el color del card.
        expect(css['--imcrm-canvas']).toBe(css['--imcrm-card']);
        expect(css['--imcrm-background']).toBe(css['--imcrm-card']);
        // El hover de fila se separa del fondo (no queda invisible).
        expect(css['--imcrm-accent']).not.toBe(css['--imcrm-card']);
    });

    // v0.1.123 — regresión: la tinta de una superficie NO puede aplicarse al
    // contenedor. Se filtraba a los controles y tarjetas que pintan su propio
    // fondo con los tokens del tema (fondo de página oscuro en modo claro →
    // botones con texto claro sobre su propio fondo claro).
    it('v0.1.123 — pageStyleCss pinta la superficie, no la tinta', () => {
        const css = pageStyleCss({ bg: '#0b1220', max_width: 900 }) as Record<string, unknown>;
        expect(css.backgroundColor).toBe('#0b1220');
        expect(css.maxWidth).toBe('900px');
        expect(css.color).toBeUndefined();
        expect(css['--imcrm-foreground']).toBeUndefined();

        // La tinta se aplica por elemento, a lo que se apoya en esa superficie.
        const ink = surfaceInkCss(true) as Record<string, unknown>;
        expect(ink.color).toBe('hsl(210 40% 96%)');
        expect(ink['--imcrm-muted-foreground']).toBe('215 20% 75%');
        expect((surfaceInkCss(false) as Record<string, unknown>).color).toBe('hsl(224 45% 12%)');
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
