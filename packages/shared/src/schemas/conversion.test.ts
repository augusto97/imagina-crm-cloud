import { describe, expect, it } from 'vitest';
import {
    attributionFromSearch,
    cleanAttribution,
    CONVERSION_MAX_PAGE_RULES,
    conversionTargetFor,
    isOwnPublicPage,
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
import { duplicateFormName, formSettingsSchema } from './form';
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

describe('v0.1.388 — una etiqueta distinta por página', () => {
    const base = {
        google_ads: 'AW-111111111/Default01',
        meta_event: true,
        page_rules: [
            { id: 'r1', name: 'Navidad', page_contains: 'landing-navidad, /navidad', google_ads: 'AW-111111111/Navidad01', meta_event: false },
            { id: 'r2', name: '', page_contains: 'Promoción', google_ads: null, meta_event: true },
            { id: 'r3', name: 'Vacía', page_contains: ' , ', google_ads: 'AW-111111111/Nunca0001', meta_event: true },
        ],
    };

    it('gana la primera regla cuya página coincide; si ninguna, la de «las demás páginas»', () => {
        expect(conversionTargetFor(base, 'https://misitio.com/landing-navidad?utm_source=google&gclid=abc123')).toEqual({
            google_ads: 'AW-111111111/Navidad01',
            meta_event: false,
            rule: 'Navidad',
        });
        // Sin mayúsculas ni tildes; una regla sin nombre se llama por sus palabras.
        expect(conversionTargetFor(base, 'https://misitio.com/PROMOCION-verano')).toEqual({ google_ads: null, meta_event: true, rule: 'promocion' });
        expect(conversionTargetFor(base, 'https://misitio.com/contacto')).toEqual({ google_ads: 'AW-111111111/Default01', meta_event: true, rule: null });
        // Sin página (o una rara) vale lo de las demás páginas.
        expect(conversionTargetFor(base, null).rule).toBeNull();
        expect(conversionTargetFor(base, 'javascript:alert(1)').rule).toBeNull();
    });

    it('los parámetros de campaña no cuentan y una regla sin palabras nunca coincide', () => {
        expect(conversionTargetFor(base, 'https://misitio.com/contacto?utm_campaign=landing-navidad').rule).toBeNull();
        expect(conversionTargetFor(base, 'https://misitio.com/nunca').rule).toBeNull();
    });

    it('en el enlace directo (la página propia del formulario o la agenda) no hay reglas', () => {
        expect(isOwnPublicPage('https://app.acme.co/api/v1/public/f/abc123?navidad=1')).toBe(true);
        expect(isOwnPublicPage('https://app.acme.co/api/v1/public/b/xyz')).toBe(true);
        expect(isOwnPublicPage('https://misitio.com/landing-navidad')).toBe(false);
        expect(conversionTargetFor(base, 'https://app.acme.co/api/v1/public/f/landing-navidad').rule).toBeNull();
    });

    it('las reglas se leen con tolerancia: una rota se descarta sin tirar las demás', () => {
        const c = conversionSettingsSchema.parse({
            google_ads: 'AW-111111111/Default01',
            page_rules: [
                { id: 'ok1', page_contains: 'navidad', google_ads: 'AW-111111111/Navidad01' },
                { id: 'mal id!', page_contains: 'x' },
                { id: 'ok2', page_contains: 'promo', google_ads: 'código raro', meta_event: 'si' },
                'basura',
            ],
        });
        expect(c.page_rules).toEqual([
            { id: 'ok1', name: '', page_contains: 'navidad', google_ads: 'AW-111111111/Navidad01', meta_event: false },
            { id: 'ok2', name: '', page_contains: 'promo', google_ads: null, meta_event: false },
        ]);
        expect(conversionSettingsSchema.parse({ page_rules: 'x' }).page_rules).toEqual([]);
        expect(formSettingsSchema.parse({}).conversion.page_rules).toEqual([]);
        const many = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, page_contains: `p${i}` }));
        expect(conversionSettingsSchema.parse({ page_rules: many }).page_rules).toHaveLength(CONVERSION_MAX_PAGE_RULES);
    });
});

describe('v0.1.388 — duplicar un formulario', () => {
    it('«(copia)», y si ya existe, «(copia 2)»; copiar una copia no apila sufijos', () => {
        expect(duplicateFormName('Contacto', ['Contacto'])).toBe('Contacto (copia)');
        expect(duplicateFormName('Contacto', ['Contacto', 'Contacto (copia)'])).toBe('Contacto (copia 2)');
        expect(duplicateFormName('Contacto (copia)', ['Contacto', 'contacto (COPIA)', 'Contacto (copia 2)'])).toBe('Contacto (copia 3)');
        const long = 'x'.repeat(120);
        expect(duplicateFormName(long, [long]).length).toBeLessThanOrEqual(120);
        expect(duplicateFormName(long, [long]).endsWith(' (copia)')).toBe(true);
    });
});
