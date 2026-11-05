import { describe, expect, it } from 'vitest';
import {
    attributionFromSearch,
    cleanAttribution,
    conversionValue,
    fillRedirectUrl,
    parseGoogleAdsSendTo,
    REDIRECT_URL_RE,
    redirectVariables,
} from './conversion-logic';
import { attributionFieldFor, attributionSettingsSchema, conversionSettingsSchema } from './conversion';
import { formSettingsSchema } from './form';
import { bookingSettingsSchema } from './booking';

describe('v0.1.374 — medir conversiones', () => {
    it('reconoce el send_to de Google Ads en lo que se pega', () => {
        expect(parseGoogleAdsSendTo('AW-123456789/AbC-dEf_12')).toBe('AW-123456789/AbC-dEf_12');
        expect(parseGoogleAdsSendTo("gtag('event', 'conversion', {'send_to': 'AW-987654321/xYz123AB', 'value': 1.0});")).toBe('AW-987654321/xYz123AB');
        expect(parseGoogleAdsSendTo('AW-123')).toBeNull();
        expect(parseGoogleAdsSendTo('G-ABC123')).toBeNull();
        expect(parseGoogleAdsSendTo('')).toBeNull();
    });

    it('limpia el origen: sólo claves conocidas, ids de clic con su forma y direcciones http(s)', () => {
        const out = cleanAttribution({
            utm_source: '  google ',
            utm_campaign: 'x'.repeat(400),
            gclid: 'Cj0KCQiA-abc_123',
            fbclid: 'mal id con espacios',
            page_url: 'javascript:alert(1)',
            referrer: 'https://www.google.com/',
            otra: 'nada',
            utm_medium: 'cpc\u0000',
        });
        expect(out.utm_source).toBe('google');
        expect(out.utm_campaign).toHaveLength(300);
        expect(out.gclid).toBe('Cj0KCQiA-abc_123');
        expect(out.fbclid).toBeUndefined();
        expect(out.page_url).toBeUndefined();
        expect(out.referrer).toBe('https://www.google.com/');
        expect(out.utm_medium).toBe('cpc');
        expect('otra' in out).toBe(false);
        expect(cleanAttribution(null)).toEqual({});
        expect(cleanAttribution(['x'])).toEqual({});
    });

    it('lee el origen de una dirección', () => {
        expect(attributionFromSearch('?utm_source=facebook&utm_medium=paid&gclid=abcd1234&page_url=https://x.co')).toEqual({
            utm_source: 'facebook',
            utm_medium: 'paid',
            gclid: 'abcd1234',
        });
        expect(attributionFromSearch('')).toEqual({});
    });

    it('la dirección de gracias: variables sólo después del dominio, codificadas', () => {
        expect(REDIRECT_URL_RE.test('https://acme.co/gracias?n={{nombre}}')).toBe(true);
        expect(REDIRECT_URL_RE.test('https://acme.co?gracias=1')).toBe(true);
        expect(REDIRECT_URL_RE.test('https://acme.co')).toBe(true);
        expect(REDIRECT_URL_RE.test('https://{{dominio}}/gracias')).toBe(false);
        expect(REDIRECT_URL_RE.test('http://acme.co/gracias')).toBe(false);
        expect(redirectVariables('https://a.co/g?x={{ nombre }}&y={{envio.id}}&z={{nombre}}')).toEqual(['nombre', 'envio.id']);

        const vars: Record<string, string> = { nombre: 'Ana María', envio_id: 'x', 'envio.id': 'S1/../?a=b' };
        const url = fillRedirectUrl('https://acme.co/gracias?n={{nombre}}&id={{envio.id}}&q={{falta}}', (k) => vars[k]);
        expect(url).toBe('https://acme.co/gracias?n=Ana%20Mar%C3%ADa&id=S1%2F..%2F%3Fa%3Db&q=');
        // Un valor en la ruta no puede salirse del segmento.
        expect(fillRedirectUrl('https://acme.co/{{x}}/listo', () => '../../evil')).toBe('https://acme.co/..%2F..%2Fevil/listo');
        // Sin variables queda igual (normalizada).
        expect(fillRedirectUrl('https://acme.co/gracias', () => null)).toBe('https://acme.co/gracias');
    });

    it('el valor de una conversión: número finito y redondeado', () => {
        expect(conversionValue(1500.456)).toBe(1500.46);
        expect(conversionValue(-1)).toBeNull();
        expect(conversionValue(Number.NaN)).toBeNull();
        expect(conversionValue('10')).toBeNull();
    });

    it('los ajustes se leen con tolerancia y viajan en formularios y agendas', () => {
        const c = conversionSettingsSchema.parse({ google_ads: 'malo', value: 'raro', currency: 'cop', share_contact: 'si' });
        expect(c).toMatchObject({ google_ads: null, value: 'none', currency: 'COP', share_contact: false, meta_event: false });
        const a = attributionSettingsSchema.parse({ enabled: true, gclid_field_id: 12, utm_source_field_id: -3 });
        expect(attributionFieldFor(a, 'gclid')).toBe(12);
        expect(attributionFieldFor(a, 'utm_source')).toBeNull();

        const form = formSettingsSchema.parse({});
        expect(form.conversion.google_ads).toBeNull();
        expect(form.attribution.enabled).toBe(false);
        expect(form.redirect_delay).toBe(0);
        expect(() => formSettingsSchema.parse({ redirect_url: 'https://{{x}}.co/' })).toThrow();
        const booking = bookingSettingsSchema.parse({ redirect_url: 'https://acme.co/gracias?s={{cita.servicio}}', redirect_delay: 99 });
        expect(booking.redirect_url).toBe('https://acme.co/gracias?s={{cita.servicio}}');
        expect(booking.redirect_delay).toBe(0);
        expect(bookingSettingsSchema.parse({ redirect_url: 'ftp://x' }).redirect_url).toBeNull();
    });
});
