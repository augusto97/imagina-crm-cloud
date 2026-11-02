import { describe, expect, it } from 'vitest';
import { iconDesignBackground, iconDesignSchema, type IconDesign } from '@imagina-base/shared';

import { ANDROID_DARK_SPLASH, chooseBgKind, chooseSplash, iconBgKind, lightSplashColor, studioSummary, type BgKindContext } from './iconStudioState';

const design = (p: Partial<IconDesign> = {}): IconDesign => iconDesignSchema.parse({ bg_from: '#00a7cd', ...p });
const ctx = (p: Partial<BgKindContext> = {}): BgKindContext => ({
    suggestion: design({ bg_to: '#0dd8dd' }),
    lastDesign: null,
    lastGradientTo: null,
    fallbackGradientTo: () => '#003344',
    ...p,
});

describe('v0.1.345 — estudio del ícono: lo elegido es lo que se dibuja', () => {
    it('el tipo de fondo sale de lo que se dibuja: con la apertura en tu color, un degradado guardado cuenta como un color', () => {
        expect(iconBgKind({ icon_design: null })).toBe('none');
        expect(iconBgKind({ icon_design: design() })).toBe('color');
        expect(iconBgKind({ icon_design: design({ bg_to: '#0dd8dd' }) })).toBe('gradient');
        // Es el caso real del usuario: degradado guardado + «abrir con el color del ícono».
        const real = design({ bg_to: '#0dd8dd', splash: 'icon' });
        expect(iconBgKind({ icon_design: real })).toBe('color');
        expect(iconDesignBackground(real).to).toBeNull();
    });

    it('elegir «Degradado» con la apertura en tu color pasa la apertura al fondo de la app y lo avisa', () => {
        const change = chooseBgKind({ icon_design: design({ splash: 'icon' }) }, 'gradient', ctx({ lastGradientTo: '#0dd8dd' }));
        expect(change.notice).toBe('splash-to-app');
        expect(change.patch.icon_design).toMatchObject({ bg_to: '#0dd8dd', splash: 'app' });
        expect(iconBgKind({ icon_design: change.patch.icon_design! })).toBe('gradient');
    });

    it('elegir abrir con tu color deja el fondo de un color y lo avisa; sin degradado no avisa', () => {
        const withGradient = chooseSplash(design({ bg_to: '#0dd8dd' }), 'icon');
        expect(withGradient.notice).toBe('bg-to-solid');
        expect(withGradient.design.bg_to).toBeNull();
        expect(withGradient.design.bg_from).toBe('#00a7cd');
        expect(chooseSplash(design(), 'icon').notice).toBeNull();
        expect(chooseSplash(design({ bg_to: '#0dd8dd', splash: 'icon' }), 'app').design.splash).toBe('app');
    });

    it('volver a «Degradado» recupera el segundo color usado, y si no hay ninguno usa uno de respaldo', () => {
        expect(chooseBgKind({ icon_design: design() }, 'gradient', ctx({ lastGradientTo: '#123456' })).patch.icon_design?.bg_to).toBe('#123456');
        expect(chooseBgKind({ icon_design: design() }, 'gradient', ctx()).patch.icon_design?.bg_to).toBe('#003344');
    });

    it('«Sin fondo» vuelve al logo sobre el fondo de la app, y salir de ahí retoma el último diseño', () => {
        expect(chooseBgKind({ icon_design: design() }, 'none', ctx()).patch).toEqual({ icon_design: null, icon_background_auto: true });
        const last = design({ art: 'mark', bg_from: '#112233' });
        const back = chooseBgKind({ icon_design: null }, 'color', ctx({ lastDesign: last }));
        expect(back.patch.icon_design).toMatchObject({ art: 'mark', bg_from: '#112233', bg_to: null });
        // Sin diseño previo, la sugerencia.
        expect(chooseBgKind({ icon_design: null }, 'color', ctx()).patch.icon_design?.bg_from).toBe('#00a7cd');
    });

    it('la apertura en claro es tu color o blanco; en oscuro Android usa siempre su propio fondo', () => {
        expect(lightSplashColor({ icon_design: design({ splash: 'icon' }) })).toBe('#00a7cd');
        expect(lightSplashColor({ icon_design: design() })).toBe('#ffffff');
        expect(lightSplashColor({ icon_design: null })).toBe('#ffffff');
        expect(ANDROID_DARK_SPLASH).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('el resumen dice en palabras lo que está elegido', () => {
        expect(studioSummary({ icon_design: design({ bg_to: '#0dd8dd', splash: 'icon' }), icon_background_auto: true, icon_background: '#ffffff' })).toEqual([
            'El logo completo',
            'Un color #00a7cd',
            'Abre con el color de tu ícono',
        ]);
        expect(studioSummary({ icon_design: null, icon_background_auto: true, icon_background: '#ffffff' })[1]).toBe('Sin fondo (el de la app)');
    });
});
