import { describe, expect, it } from 'vitest';

import { parseThemeMode, resolveTheme } from '@/lib/theme';
import { brandVars } from '@/hooks/useBranding';

describe('theme (v0.1.112)', () => {
    it('parseThemeMode: sólo acepta los 3 modos; cualquier otra cosa cae en system', () => {
        expect(parseThemeMode('light')).toBe('light');
        expect(parseThemeMode('dark')).toBe('dark');
        expect(parseThemeMode('system')).toBe('system');
        expect(parseThemeMode(null)).toBe('system');
        expect(parseThemeMode('')).toBe('system');
        expect(parseThemeMode('DARK')).toBe('system');
    });

    it('resolveTheme: la elección explícita ignora al SO; system lo sigue', () => {
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
        expect(resolveTheme('system', true)).toBe('dark');
        expect(resolveTheme('system', false)).toBe('light');
    });
});

describe('brandVars — marca adaptada al tema (v0.1.112)', () => {
    it('en claro usa el color del tenant tal cual y enciende el riel', () => {
        const vars = brandVars('192 55% 26%', 'light');
        expect(vars['--imcrm-primary']).toBe('192 55% 26%');
        expect(vars['--imcrm-sidebar']).toBe('192 55% 30%');
    });

    it('en oscuro sube un primary hondo a la banda legible (el fg del tema es tinta)', () => {
        const vars = brandVars('192 55% 22%', 'dark');
        expect(vars['--imcrm-primary']).toBe('192 55% 52%');
        // El riel se HUNDE en vez de encenderse.
        expect(vars['--imcrm-sidebar']).toBe('192 55% 13%');
    });

    it('en oscuro respeta un color ya claro (sin pasarse de 70%)', () => {
        expect(brandVars('40 90% 62%', 'dark')['--imcrm-primary']).toBe('40 85% 62%');
        expect(brandVars('40 90% 92%', 'dark')['--imcrm-primary']).toBe('40 85% 70%');
    });

    it('tripleta inválida → sin variables (el CSS del tema manda)', () => {
        expect(brandVars('no-es-hsl', 'dark')).toEqual({});
    });
});
