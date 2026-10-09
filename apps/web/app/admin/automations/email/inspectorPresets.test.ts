import { describe, expect, it } from 'vitest';
import type { BlockStyle, EmailBlock } from '@imagina-base/shared';

import { styleEditor, styleHasAny, STYLE_KEYS } from '@/components/design/DesignStyleControls';

import { levelPreset, spacingDefaults, spacingPreset } from './inspectorPresets';

/**
 * v0.1.273 — Cada ajuste vive en UN solo lugar: el atajo (Grande / Mediano /
 * Chico, Poco / Medio / Mucho) y el valor exacto comparten fila, y elegir el
 * atajo borra el exacto en el MISMO cambio (si no, quedarían dos controles
 * diciendo cosas distintas).
 */
function heading(style?: BlockStyle, extra: Partial<EmailBlock> = {}): Extract<EmailBlock, { type: 'heading' }> {
    return { id: 'h', type: 'heading', text: 'Hola', level: 2, align: 'left', ...(style ? { style } : {}), ...extra } as Extract<EmailBlock, { type: 'heading' }>;
}

describe('editor de estilo', () => {
    it('set mezcla y limpia; without quita claves y vuelve a undefined si no queda nada', () => {
        let out: BlockStyle | undefined = { font_size: 20 };
        const ed = styleEditor('email', { font_size: 20, margin_top: 4 }, (n) => (out = n));
        ed.set({ font_size: null });
        expect(out).toEqual({ margin_top: 4 });
        expect(ed.without(['font_size'])).toEqual({ margin_top: 4 });
        expect(styleEditor('email', { font_size: 20 }, () => undefined).without(['font_size'])).toBeUndefined();
    });

    it('styleHasAny ignora los valores que significan «automático»', () => {
        expect(styleHasAny({ text_transform: 'none', shadow: 'none', italic: false }, STYLE_KEYS.typography)).toBe(false);
        expect(styleHasAny({ letter_spacing: 0 }, STYLE_KEYS.typography)).toBe(true);
        expect(styleHasAny(undefined, STYLE_KEYS.spacing)).toBe(false);
    });
});

describe('atajo de tamaño del título', () => {
    it('marca el nivel sólo si no hay un tamaño exacto', () => {
        const b = heading();
        expect(levelPreset(styleEditor('email', b.style, () => undefined), b.level, () => undefined).current).toBe('2');
        const exact = heading({ font_size: 31 });
        expect(levelPreset(styleEditor('email', exact.style, () => undefined), exact.level, () => undefined).current).toBeNull();
    });

    it('elegir un nivel borra el tamaño exacto en el mismo cambio', () => {
        const b = heading({ font_size: 31, font_weight: 800 });
        const patches: Array<Record<string, unknown>> = [];
        levelPreset(styleEditor('email', b.style, () => undefined), b.level, (p) => patches.push(p)).onPick('1');
        expect(patches).toEqual([{ level: 1, style: { font_weight: 800 } }]);
    });
});

describe('espacio arriba y abajo', () => {
    it('el atajo vale lo que el bloque usa por defecto (más con fondo)', () => {
        expect(spacingPreset(styleEditor('email', undefined, () => undefined), heading(), () => undefined).current).toBe('sm');
        expect(spacingPreset(styleEditor('email', undefined, () => undefined), heading(undefined, { background: '#eeeeee' }), () => undefined).current).toBe('lg');
    });

    it('un margen o relleno vertical exacto apaga el atajo; elegirlo los borra', () => {
        const b = heading({ margin_top: 30, padding_bottom: 2, padding_left: 10 });
        const ed = styleEditor('email', b.style, () => undefined);
        const patches: Array<Record<string, unknown>> = [];
        const preset = spacingPreset(ed, b, (p) => patches.push(p));
        expect(preset.current).toBeNull();
        preset.onPick('md');
        // El relleno lateral no es «arriba y abajo»: se conserva.
        expect(patches).toEqual([{ padding: 'md', style: { padding_left: 10 } }]);
    });

    it('las pistas siguen a la forma: banda (relleno) o recuadro (margen)', () => {
        expect(spacingDefaults(heading(undefined, { padding: 'md' }))).toEqual({ margin: 0 });
        expect(spacingDefaults(heading({ bg_mode: 'box' }, { background: '#fff000' }))).toEqual({ margin: 6, padding: 16 });
    });
});
