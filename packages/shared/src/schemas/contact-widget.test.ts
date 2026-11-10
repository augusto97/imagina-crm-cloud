import { describe, expect, it } from 'vitest';

import {
    buildPublicWidgetButton,
    buildPublicWidgetMeta,
    contactWidgetConfigSchema,
    newWidgetButtonId,
    readContactWidgetConfig,
    whatsappLink,
    widgetEmbedCode,
    widgetInk,
    widgetLinkUrl,
    widgetMailto,
    widgetPageVar,
    widgetProblems,
    widgetTel,
    widgetText,
    widgetWhatsappDigits,
    type WidgetTargetRef,
} from './contact-widget';

const refs = (forms: WidgetTargetRef[] = [], bookings: WidgetTargetRef[] = []) => ({
    forms: new Map(forms.map((f) => [f.id, f])),
    bookings: new Map(bookings.map((b) => [b.id, b])),
});

describe('widget de contacto (v0.1.394)', () => {
    it('lee lo guardado con tolerancia: un botón roto se descarta, el resto queda', () => {
        const cfg = readContactWidgetConfig({
            layout: 'raro',
            offset_x: 9999,
            buttons: [
                { id: 'wa', type: 'whatsapp', phone: '+573001112233' },
                { id: 'mal', type: 'fax' },
                { id: 'wa', type: 'call', phone: '+5760' },
                { id: 'ok2', type: 'link', url: 'https://acme.co', new_tab: 'sí' },
            ],
        });
        expect(cfg.layout).toBe('card');
        expect(cfg.offset_x).toBe(20);
        expect(cfg.buttons.map((b) => b.id)).toEqual(['wa', 'ok2']);
        expect(cfg.buttons[1]!.new_tab).toBe(true);
        expect(readContactWidgetConfig(null).buttons).toEqual([]);
        expect(readContactWidgetConfig('basura').title).toBe('¡Hola! ¿En qué te ayudamos?');
    });

    it('ids nuevos que no chocan', () => {
        const taken = new Set<string>();
        for (let i = 0; i < 50; i++) taken.add(newWidgetButtonId(taken));
        expect(taken.size).toBe(50);
        for (const id of taken) expect(id).toMatch(/^[a-z0-9]{1,16}$/);
    });

    it('números, enlaces y correos: sólo lo que sirve', () => {
        expect(widgetWhatsappDigits('+57 (300) 111-2233')).toBe('573001112233');
        expect(widgetWhatsappDigits('3001112233')).toBeNull();
        expect(widgetWhatsappDigits('+57 30')).toBeNull();
        expect(whatsappLink('+573001112233', 'Hola, ¿cómo?')).toBe('https://wa.me/573001112233?text=Hola%2C%20%C2%BFc%C3%B3mo%3F');
        expect(whatsappLink('+573001112233', '')).toBe('https://wa.me/573001112233');
        expect(widgetTel('+57 601 234 5678')).toBe('tel:+576012345678');
        expect(widgetTel('601 234')).toBeNull();
        expect(widgetLinkUrl('https://acme.co/x#y')).toBe('https://acme.co/x#y');
        expect(widgetLinkUrl('http://acme.co')).toBeNull();
        expect(widgetLinkUrl('javascript:alert(1)')).toBeNull();
        expect(widgetMailto('hola@acme.co', 'Una pregunta')).toBe('mailto:hola@acme.co?subject=Una%20pregunta');
        expect(widgetMailto('no-es-correo', '')).toBeNull();
        expect(widgetInk('#ffffff')).not.toBe(widgetInk('#111111'));
    });

    it('el mensaje: variables de la página y las desconocidas quedan vacías', () => {
        const page = { url: 'https://acme.co/planes', title: 'Planes' };
        expect(widgetText('Vengo de {{pagina}} ({{url}}) {{nada}}', (k) => widgetPageVar(k, page))).toBe('Vengo de Planes (https://acme.co/planes)');
        expect(widgetPageVar('pagina', { url: 'https://acme.co/x', title: null })).toBe('https://acme.co/x');
        expect(widgetPageVar('pagina', { url: null, title: null }) ?? '').toBe('');
    });

    it('problemas: lo que falta y lo que no está publicado', () => {
        const cfg = contactWidgetConfigSchema.parse({
            buttons: [
                { id: 'wa', type: 'whatsapp', phone: '123', capture_form_id: 9 },
                { id: 'fm', type: 'form', form_id: 5 },
                { id: 'ag', type: 'booking' },
                { id: 'web', type: 'link', url: 'http://x' },
            ],
        });
        const p = widgetProblems(cfg, refs([{ id: 5, name: 'Contacto', enabled: false }]));
        expect(p.map((x) => x.button_id)).toEqual(['wa', 'wa', 'fm', 'ag', 'web']);
        expect(p[2]!.message).toContain('«Contacto» no está publicado');
        expect(widgetProblems(contactWidgetConfigSchema.parse({}), refs())).toEqual([{ button_id: null, message: 'Agrega al menos un botón.' }]);
    });

    it('el botón público: WhatsApp directo pasa por la app; con datos primero, el formulario', () => {
        const ctx = {
            accent: '#7c3aed',
            goPath: (id: string) => `/api/v1/public/w/tok/go/${id}`,
            formPath: (id: number) => (id === 5 ? '/api/v1/public/f/f5' : null),
            bookingPath: () => null,
        };
        const wa = contactWidgetConfigSchema.parse({ buttons: [{ id: 'wa', type: 'whatsapp', phone: '+573001112233' }] }).buttons[0]!;
        expect(buildPublicWidgetButton(wa, ctx)).toMatchObject({ href: '/api/v1/public/w/tok/go/wa', target: '_blank', color: '#25D366', capture: false });
        expect(JSON.stringify(buildPublicWidgetButton(wa, ctx))).not.toContain('3001112233');
        const cap = { ...wa, capture_form_id: 5 };
        expect(buildPublicWidgetButton(cap, ctx)).toMatchObject({ href: null, frame: '/api/v1/public/f/f5', capture: true });
        // Con el formulario sin publicar, WhatsApp directo (nunca un botón muerto).
        expect(buildPublicWidgetButton({ ...wa, capture_form_id: 6 }, ctx)).toMatchObject({ href: '/api/v1/public/w/tok/go/wa', capture: false });
        const sinNumero = { ...wa, phone: '' };
        expect(buildPublicWidgetButton(sinNumero, ctx)).toBeNull();
        expect(buildPublicWidgetButton(sinNumero, { ...ctx, lenient: true })).toMatchObject({ href: null, frame: null });
    });

    it('la meta pública y el código para el sitio', () => {
        const cfg = contactWidgetConfigSchema.parse({ show_logo: false, color: '#ffeb3b' });
        const meta = buildPublicWidgetMeta('tok', cfg, { accent: '#0e7490', company: 'Acme', logoUrl: '/logo.png' }, []);
        expect(meta).toMatchObject({ accent: '#ffeb3b', logo_url: null, company: 'Acme' });
        expect(meta.ink).not.toBe('#ffffff');
        expect(widgetEmbedCode('https://app.test/', '/api/v1/public/w/abc')).toBe(
            '<script src="https://app.test/api/v1/public/f/embed.js" data-imagina-widget="https://app.test/api/v1/public/w/abc" async></script>',
        );
    });
});
