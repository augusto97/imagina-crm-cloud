// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ATTRIBUTION_TTL_MS,
    attributionFromVisit,
    captureSignupAttribution,
    clearSignupAttribution,
    isRegisterEntry,
    readSignupAttribution,
    stripAttributionParams,
} from './signupAttribution';

afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
});

describe('v0.1.331 — origen de la visita para el registro', () => {
    it('toma las etiquetas y el sitio de donde vino; una visita directa no trae nada', () => {
        expect(
            attributionFromVisit(
                'https://base.imagina.cloud/registro?utm_source=sitio&utm_campaign=precios&ref=aliado&otro=1',
                'https://imagina.cloud/base/precios',
            ),
        ).toEqual({
            source: 'sitio',
            campaign: 'precios',
            ref: 'aliado',
            referrer: 'https://imagina.cloud/base/precios',
            landing_url: 'https://base.imagina.cloud/registro',
        });
        expect(attributionFromVisit('https://base.imagina.cloud/', '')).toBeNull();
        // Navegar dentro de la propia app no cuenta como origen.
        expect(attributionFromVisit('https://base.imagina.cloud/lists', 'https://base.imagina.cloud/')).toBeNull();
    });

    it('limpia la barra sin tocar el resto de la dirección', () => {
        expect(stripAttributionParams('https://x.test/registro?utm_source=a&s=perfil#h')).toBe('/registro?s=perfil#h');
        expect(stripAttributionParams('https://x.test/lists?s=1')).toBeNull();
    });

    it('recuerda el origen; una visita directa no lo pisa; vence a los 30 días', () => {
        window.history.replaceState(null, '', '/registro?utm_source=sitio&utm_medium=landing');
        captureSignupAttribution();
        expect(window.location.search).toBe('');
        expect(readSignupAttribution()).toMatchObject({ source: 'sitio', medium: 'landing' });

        window.history.replaceState(null, '', '/');
        captureSignupAttribution();
        expect(readSignupAttribution()?.source).toBe('sitio');

        expect(readSignupAttribution(Date.now() + ATTRIBUTION_TTL_MS + 1000)).toBeNull();
        clearSignupAttribution();
        expect(readSignupAttribution()).toBeNull();
    });

    it('`/registro` y `?registro` abren el alta', () => {
        expect(isRegisterEntry({ pathname: '/registro', search: '' })).toBe(true);
        expect(isRegisterEntry({ pathname: '/registro/', search: '' })).toBe(true);
        expect(isRegisterEntry({ pathname: '/', search: '?registro' })).toBe(true);
        expect(isRegisterEntry({ pathname: '/', search: '' })).toBe(false);
        expect(isRegisterEntry({ pathname: '/lists', search: '?s=1' })).toBe(false);
    });
});
