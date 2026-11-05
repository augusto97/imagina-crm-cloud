import { describe, expect, it } from 'vitest';
import {
    attributionFromSearch,
    cleanAttribution,
    conversionValue,
    directTagsNotice,
    fillRedirectUrl,
    googleAdsIdFromSendTo,
    parseGoogleTagId,
    parseMetaPixelId,
    trackingSafeUrl,
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

describe('v0.1.375 — etiquetas en el enlace directo', () => {
    it('reconoce los IDs en lo que se pega (nunca guarda código)', () => {
        expect(parseGoogleTagId('G-AB12CD34EF')).toBe('G-AB12CD34EF');
        expect(parseGoogleTagId('<script async src="https://www.googletagmanager.com/gtag/js?id=G-XYZ9876"></script>')).toBe('G-XYZ9876');
        expect(parseGoogleTagId('g-abc123')).toBe('G-ABC123');
        expect(parseGoogleTagId('GTM-ABC123')).toBeNull();
        expect(parseGoogleTagId('AW-123456789')).toBeNull();
        expect(parseMetaPixelId("fbq('init', '1234567890123456');")).toBe('1234567890123456');
        expect(parseMetaPixelId('https://www.facebook.com/tr?id=987654321012&ev=PageView&noscript=1')).toBe('987654321012');
        expect(parseMetaPixelId(' 1234 5678 9012 ')).toBe('123456789012');
        expect(parseMetaPixelId('abc')).toBeNull();
        expect(googleAdsIdFromSendTo('AW-123456789/AbC-dEf_12')).toBe('AW-123456789');
        expect(googleAdsIdFromSendTo(null)).toBeNull();
    });

    it('la dirección que ven Google y Meta lleva sólo la campaña', () => {
        expect(trackingSafeUrl('https://base.acme.co/api/v1/public/f/tok?nombre=Ana&email=ana%40x.co&utm_source=google&gclid=Cj0K&seguir=abc#x')).toBe(
            'https://base.acme.co/api/v1/public/f/tok?utm_source=google&gclid=Cj0K',
        );
        expect(trackingSafeUrl('https://base.acme.co/api/v1/public/b/tok')).toBe('https://base.acme.co/api/v1/public/b/tok');
        expect(trackingSafeUrl('https://base.acme.co/f?editar=1.2.3')).toBe('https://base.acme.co/f');
        expect(trackingSafeUrl('javascript:alert(1)')).toBe('');
    });

    it('los ajustes nuevos se leen con tolerancia y el aviso nombra lo que se carga', () => {
        const c = conversionSettingsSchema.parse({ direct_tags: 'si', google_tag_id: 'GTM-XYZ', meta_pixel_id: '12', cookie_notice: 'no' });
        expect(c).toMatchObject({ direct_tags: false, google_tag_id: null, meta_pixel_id: null, cookie_notice: true });
        expect(conversionSettingsSchema.parse({ direct_tags: true, google_tag_id: 'G-ABC123', meta_pixel_id: '1234567890' })).toMatchObject({
            direct_tags: true,
            google_tag_id: 'G-ABC123',
            meta_pixel_id: '1234567890',
        });
        expect(directTagsNotice({ google_ads_id: 'AW-1', google_tag_id: null, meta_pixel_id: '1' })).toBe('Esta página usa cookies de Google y Meta para medir las campañas.');
        expect(directTagsNotice({ google_ads_id: null, google_tag_id: null, meta_pixel_id: '1' })).toBe('Esta página usa cookies de Meta para medir las campañas.');
        expect(directTagsNotice({ google_ads_id: null, google_tag_id: null, meta_pixel_id: null })).toBe('');
    });
});
