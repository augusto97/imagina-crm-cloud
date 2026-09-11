import { describe, expect, it } from 'vitest';

import { parseThemeMode, resolveTheme } from '@/lib/theme';
import { brandVars, sidebarVars } from '@/hooks/useBranding';

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

describe('brandVars + sidebarVars — riel con color propio (v0.1.176)', () => {
    it('el riel elegido MANDA sobre el derivado del primario, en los dos temas', () => {
        // Primario verde, riel gris carbón.
        const light = brandVars('142 71% 37%', 'light', '0 0% 20%');
        expect(light['--imcrm-primary']).toBe('142 71% 37%');
        expect(light['--imcrm-sidebar']).toBe('0 0% 20%');
        const dark = brandVars('142 71% 37%', 'dark', '0 0% 20%');
        expect(dark['--imcrm-primary']).toBe('142 71% 52%');
        // En oscuro el riel derivado se hunde a 13%, pero el ELEGIDO se respeta.
        expect(dark['--imcrm-sidebar']).toBe('0 0% 20%');
    });

    it('riel OSCURO → tinta clara; borde y velo un escalón más claros', () => {
        const vars = sidebarVars('0 0% 20%');
        expect(vars['--imcrm-sidebar-foreground']).toBe('0 0% 88%');
        expect(vars['--imcrm-sidebar-accent-foreground']).toBe('0 0% 100%');
        expect(vars['--imcrm-sidebar-border']).toBe('0 0% 27%');
        expect(vars['--imcrm-sidebar-accent']).toBe('0 0% 28%');
    });

    it('riel CLARO (el gris del pedido) → tinta oscura; borde y velo más oscuros', () => {
        // #e5e7eb ≈ 220 14% 91%
        const vars = sidebarVars('220 14% 91%');
        expect(vars['--imcrm-sidebar']).toBe('220 14% 91%');
        expect(vars['--imcrm-sidebar-foreground']).toBe('220 14% 24%');
        expect(vars['--imcrm-sidebar-accent-foreground']).toBe('220 14% 8%');
        expect(vars['--imcrm-sidebar-border']).toBe('220 14% 82%');
        expect(vars['--imcrm-sidebar-accent']).toBe('220 14% 84%');
    });

    it('decide por LUMINANCIA, no por la L a secas: un amarillo al 50% es claro, un azul al 50% es oscuro', () => {
        expect(sidebarVars('55 100% 50%')['--imcrm-sidebar-accent-foreground']).toBe('55 40% 8%');
        expect(sidebarVars('230 100% 50%')['--imcrm-sidebar-accent-foreground']).toBe('0 0% 100%');
    });

    it('riel propio SIN primario → sólo variables del riel (el primario del tema queda)', () => {
        const vars = brandVars(null, 'light', '0 0% 20%');
        expect(vars['--imcrm-primary']).toBeUndefined();
        expect(vars['--imcrm-sidebar']).toBe('0 0% 20%');
        // Sin nada → nada.
        expect(brandVars(null, 'light', null)).toEqual({});
    });
});
