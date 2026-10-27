// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';

import { brandInitials } from '@/hooks/useAppIdentity';
import { fitRect, iconPadding, logoCanvasSize } from '@/lib/brandAssets';
import {
    bootSplashVisible,
    hideBootSplash,
    readSplash,
    rememberShell,
    rememberSplashColors,
    safeColor,
    SPLASH_KEY,
} from '@/lib/bootSplash';
import { applyFavicon } from '@/lib/favicon';

describe('v0.1.327 — marca: geometría de los íconos', () => {
    it('encaja centrado y sin deformar, respetando el margen', () => {
        expect(fitRect(1000, 500, 512, 512, 0)).toEqual({ x: 0, y: 128, w: 512, h: 256 });
        const r = fitRect(512, 512, 512, 512, 0.2);
        expect(r.w).toBe(307);
        expect(r.x).toBe(r.y);
        expect(fitRect(100, 100, 192, 192, 0).w).toBe(192);
    });

    it('margen por tamaño: los maskable caen en la zona segura, la pestaña sin margen', () => {
        expect(iconPadding('maskable_512')).toBeGreaterThanOrEqual(0.1);
        expect(iconPadding('favicon_32')).toBe(0);
        expect(iconPadding('icon_192')).toBeLessThan(iconPadding('maskable_192'));
    });

    it('el logo se guarda a 2× sin pasarse de ancho', () => {
        expect(logoCanvasSize(320, 80)).toEqual({ w: 1280, h: 320 });
        expect(logoCanvasSize(4000, 400)).toEqual({ w: 1280, h: 128 });
        // v0.1.328: un isotipo se guarda a 512 (sirve de ícono sin verse borroso).
        expect(logoCanvasSize(160, 160)).toEqual({ w: 512, h: 512 });
    });

    it('iniciales cuando no hay imagen', () => {
        expect(brandInitials('Imagina Base')).toBe('IB');
        expect(brandInitials('acme')).toBe('AC');
        expect(brandInitials('Ñandú Ágil S.A.S.')).toBe('NA');
        expect(brandInitials('')).toBe('?');
    });
});

describe('v0.1.327 — pantalla de arranque', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="imcrm-boot" aria-busy="true"></div><div id="root"></div>';
        localStorage.clear();
    });

    it('v0.1.329 — recuerda si había sesión y los colores de cada tema', () => {
        expect(readSplash()).toEqual({ shell: false, light: null, dark: null });
        rememberShell(true);
        rememberSplashColors('dark', { rail: 'rgb(20, 20, 20)', accent: 'rgb(35, 195, 230)' });
        rememberSplashColors('light', { rail: 'url(javascript:alert(1))', accent: 'rgb(12, 126, 151)' });
        expect(readSplash()).toEqual({
            shell: true,
            light: { rail: null, accent: 'rgb(12, 126, 151)' },
            dark: { rail: 'rgb(20, 20, 20)', accent: 'rgb(35, 195, 230)' },
        });
        rememberShell(false);
        expect(readSplash().shell).toBe(false);
        expect(readSplash().dark?.rail).toBe('rgb(20, 20, 20)');
    });

    it('sólo deja pasar colores rgb() numéricos', () => {
        expect(safeColor('rgba(0, 0, 0, 0.5)')).toBe('rgba(0, 0, 0, 0.5)');
        expect(safeColor('red; background:url(x)')).toBeNull();
        expect(safeColor('rgb(1,2,3)) ; x')).toBeNull();
        localStorage.setItem(SPLASH_KEY, '{roto');
        expect(readSplash()).toEqual({ shell: false, light: null, dark: null });
    });

    it('se desvanece y sale del DOM una sola vez', async () => {
        expect(bootSplashVisible()).toBe(true);
        hideBootSplash();
        expect(bootSplashVisible()).toBe(false);
        hideBootSplash();
        await new Promise((r) => setTimeout(r, 300));
        expect(document.getElementById('imcrm-boot')).toBeNull();
    });
});

describe('v0.1.327 — favicon de la plataforma', () => {
    it('usa el tamaño de Apple propio cuando lo hay', () => {
        document.head.innerHTML = '';
        applyFavicon('/api/v1/public/brand/images/f.png', document, '/api/v1/public/brand/images/a.png');
        expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.getAttribute('href')).toBe('/api/v1/public/brand/images/f.png');
        expect(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')!.getAttribute('href')).toBe('/api/v1/public/brand/images/a.png');
    });
});
