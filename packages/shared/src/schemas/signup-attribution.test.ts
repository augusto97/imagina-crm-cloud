import { describe, expect, it } from 'vitest';
import {
    parseSignupAttribution,
    parseStoredSignupAttribution,
    signupAttributionLabel,
    signupSourceKey,
} from './signup-attribution';

describe('v0.1.331 — origen del registro', () => {
    it('toma lo válido campo por campo y descarta el resto', () => {
        expect(
            parseSignupAttribution({
                source: '  google ',
                medium: '',
                campaign: 'lanzamiento\u0000',
                term: 7,
                ref: 'x'.repeat(201),
                landing_url: 'javascript:alert(1)',
                referrer: 'https://imagina.cloud/base?gclid=abc#top',
            }),
        ).toEqual({ source: 'google', campaign: 'lanzamiento', referrer: 'https://imagina.cloud/base' });
        expect(parseSignupAttribution({})).toBeNull();
        expect(parseSignupAttribution('utm_source=x')).toBeNull();
        expect(parseSignupAttribution(null)).toBeNull();
    });

    it('lo guardado conserva la fecha sólo si es válida', () => {
        expect(parseStoredSignupAttribution({ source: 'a', at: '2026-10-29T10:00:00.000Z' })).toEqual({
            source: 'a',
            at: '2026-10-29T10:00:00.000Z',
        });
        expect(parseStoredSignupAttribution({ source: 'a', at: 'ayer' })?.at).toBe('');
        expect(parseStoredSignupAttribution({ at: '2026-10-29T10:00:00.000Z' })).toBeNull();
    });

    it('agrupa por fuente, luego por ref, luego por el sitio de donde vino', () => {
        expect(signupSourceKey({ source: 'Google', referrer: 'https://imagina.cloud/' })).toBe('google');
        expect(signupSourceKey({ ref: 'aliado-7' })).toBe('ref: aliado-7');
        expect(signupSourceKey({ referrer: 'https://www.imagina.cloud/base' })).toBe('imagina.cloud');
        expect(signupSourceKey({ landing_url: 'https://base.imagina.cloud/registro' })).toBe('Directo');
        expect(signupSourceKey(null)).toBe('Directo');
    });

    it('arma una línea legible', () => {
        expect(
            signupAttributionLabel({
                source: 'sitio',
                medium: 'landing',
                campaign: 'precios',
                referrer: 'https://www.imagina.cloud/base/precios/',
            }),
        ).toBe('sitio / landing · precios · desde imagina.cloud/base/precios');
        expect(signupAttributionLabel({ referrer: 'https://google.com/' })).toBe('desde google.com');
        expect(signupAttributionLabel(null)).toBe('Directo (sin origen)');
    });
});
