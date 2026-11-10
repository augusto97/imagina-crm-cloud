import { describe, expect, it } from 'vitest';

import {
    buildPublicWidgetButton,
    buildPublicWidgetHours,
    buildPublicWidgetMeta,
    contactWidgetConfigSchema,
    newWidgetButtonId,
    pickWidgetAdvisor,
    readContactWidgetConfig,
    whatsappLink,
    widgetEmbedCode,
    widgetInk,
    widgetLinkUrl,
    widgetMailto,
    widgetPageVar,
    widgetProblems,
    widgetTel,
    widgetChatPath,
    widgetText,
    widgetWhatsappDigits,
    widgetWhatsappReady,
    type WidgetTargetRef,
} from './contact-widget';
import { widgetButtonShown, widgetClock, widgetClosesAt, widgetIsOpen, widgetNextOpening, widgetNextOpeningText } from './widget-hours';

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
        expect(buildPublicWidgetButton(cap, ctx)).toMatchObject({ href: null, frame: '/api/v1/public/f/f5?imb_chat=1', capture: true });
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

describe('widget de contacto: asesores, horario y chat (v0.1.395)', () => {
    it('varias personas: cada una con su número; el botón ya no pide el suyo', () => {
        const cfg = contactWidgetConfigSchema.parse({
            buttons: [
                {
                    id: 'wa',
                    type: 'whatsapp',
                    advisors: [
                        { id: 'a1', name: 'Ana', phone: '+573001112233' },
                        { id: 'a2', name: 'Luis', phone: '300' },
                        { id: 'a1', name: 'Repetida', phone: '+573004445566' },
                        { id: 'MAL', name: 'Id raro', phone: '+573004445566' },
                    ],
                },
            ],
        });
        const wa = cfg.buttons[0]!;
        expect(wa.advisors.map((a) => a.id)).toEqual(['a1', 'a2']);
        const p = widgetProblems(cfg, refs());
        expect(p).toHaveLength(1);
        expect(p[0]!.message).toContain('«Luis»');
        expect(widgetWhatsappReady(wa)).toBe(false);
        expect(widgetWhatsappReady({ ...wa, advisors: [wa.advisors[0]!] })).toBe(true);
    });

    it('por turnos reparte en orden; al azar usa el sorteo', () => {
        const b = { rotation: 'round_robin' as const, advisors: [{ id: 'a', name: 'A', phone: '+57300', user_id: null }, { id: 'b', name: 'B', phone: '+57301', user_id: 4 }] };
        expect([0, 1, 2, 3].map((t) => pickWidgetAdvisor(b, t)!.id)).toEqual(['a', 'b', 'a', 'b']);
        expect(pickWidgetAdvisor({ ...b, rotation: 'random' }, 0, () => 0.99)!.id).toBe('b');
        expect(pickWidgetAdvisor({ ...b, advisors: [] }, 3)).toBeNull();
    });

    it('el formulario se abre como chat (salvo que se apague)', () => {
        const ctx = { accent: '#7c3aed', goPath: (id: string) => `/go/${id}`, formPath: () => '/api/v1/public/f/f5', bookingPath: () => '/api/v1/public/b/b1' };
        const cfg = contactWidgetConfigSchema.parse({
            buttons: [
                { id: 'f', type: 'form', form_id: 5 },
                { id: 'g', type: 'form', form_id: 5, as_chat: false },
                { id: 'w', type: 'whatsapp', phone: '+573001112233', capture_form_id: 5 },
                { id: 'c', type: 'booking', booking_page_id: 1 },
            ],
        });
        const out = cfg.buttons.map((b) => buildPublicWidgetButton(b, ctx)!.frame);
        expect(out).toEqual(['/api/v1/public/f/f5?imb_chat=1', '/api/v1/public/f/f5', '/api/v1/public/f/f5?imb_chat=1', '/api/v1/public/b/b1']);
        expect(widgetChatPath('/x?a=1')).toBe('/x?a=1&imb_chat=1');
    });

    it('horario: tramos limpios y lo que impide publicar', () => {
        const cfg = contactWidgetConfigSchema.parse({
            hours: {
                enabled: true,
                week: [[], [{ start: '14:00', end: '18:00' }, { start: '08:00', end: '12:00' }, { start: '11:00', end: '13:00' }, { start: '18:00', end: '17:00' }], [], [], [], [], []],
            },
            buttons: [{ id: 'wa', type: 'whatsapp', phone: '+573001112233', when: 'open' }],
        });
        expect(cfg.hours.week[1]).toEqual([
            { start: '08:00', end: '12:00' },
            { start: '14:00', end: '18:00' },
        ]);
        expect(widgetProblems(cfg, refs()).map((p) => p.message)).toEqual([expect.stringContaining('Fuera de horario no quedaría ningún botón')]);
        const empty = contactWidgetConfigSchema.parse({ hours: { enabled: true, week: [[], [], [], [], [], [], []] }, buttons: [{ id: 'wa', type: 'whatsapp', phone: '+573001112233' }] });
        expect(widgetProblems(empty, refs())[0]!.message).toContain('marca al menos un día');
        // Lo guardado roto vuelve al horario por defecto (no tira el widget).
        expect(readContactWidgetConfig({ hours: { enabled: true, week: 'basura' } }).hours.week[1]).toEqual([{ start: '08:00', end: '18:00' }]);
    });

    it('abierto, cerrado y la próxima apertura (en la zona de la empresa)', () => {
        const cfg = contactWidgetConfigSchema.parse({ hours: { enabled: true } });
        const h = buildPublicWidgetHours(cfg.hours, { tz: 'America/Bogota', closedDates: ['2026-11-16'], timeFormat: 'h12' })!;
        // Martes 10-nov-2026 15:00 en Bogotá (20:00 UTC): abierto hasta las 18.
        expect(widgetIsOpen(h, new Date('2026-11-10T20:00:00Z'))).toBe(true);
        expect(widgetClosesAt(h, new Date('2026-11-10T20:00:00Z'))!.toISOString()).toBe('2026-11-10T23:00:00.000Z');
        // Martes 19:30: cerrado; abre mañana a las 8.
        const night = new Date('2026-11-11T00:30:00Z');
        expect(widgetIsOpen(h, night)).toBe(false);
        expect(widgetNextOpening(h, night)!.toISOString()).toBe('2026-11-11T13:00:00.000Z');
        expect(widgetNextOpeningText(h, night, 'America/Bogota')).toBe('Abrimos mañana a las 8:00 a. m.');
        // Quien lee en Madrid lee la hora de Madrid.
        expect(widgetNextOpeningText(h, night, 'Europe/Madrid')).toBe('Abrimos hoy a las 2:00 p. m.');
        // Sábado 14:00: cerrado; el domingo no hay y el lunes 16 es festivo → martes 17.
        const sat = new Date('2026-11-14T19:00:00Z');
        expect(widgetNextOpening(h, sat)!.toISOString()).toBe('2026-11-17T13:00:00.000Z');
        expect(widgetNextOpeningText(h, sat, 'America/Bogota')).toBe('Abrimos el martes a las 8:00 a. m.');
        expect(widgetClock(13 * 60 + 5, 'h12')).toBe('1:05 p. m.');
        expect(widgetClock(8 * 60, 'h24')).toBe('08:00');
        expect(widgetButtonShown('open', false)).toBe(false);
        expect(widgetButtonShown('closed', false)).toBe(true);
        expect(widgetButtonShown('open', null)).toBe(true);
        expect(buildPublicWidgetHours({ ...cfg.hours, enabled: false }, { tz: 'UTC', closedDates: [], timeFormat: 'h24' })).toBeNull();
    });
});

describe('widget de contacto — dónde aparece y saludo (v0.1.396)', () => {
    it('lo guardado roto toma su valor por defecto; el saludo apagado o vacío no viaja', () => {
        const cfg = readContactWidgetConfig({ display: { pages: 'raro', delay_s: 9999, scroll_pct: 50 }, greeting: 'x' });
        expect(cfg.display).toEqual({ pages: 'all', page_terms: '', devices: 'all', delay_s: 0, scroll_pct: 50 });
        expect(cfg.greeting.enabled).toBe(false);
        const brand = { accent: '#2563eb', company: 'Acme', logoUrl: null };
        expect(buildPublicWidgetMeta('t'.repeat(20), cfg, brand, []).greeting).toBeNull();
        const on = readContactWidgetConfig({
            greeting: { enabled: true, text: '', rules: [{ contains: 'planes', text: '¿Dudas?' }, { contains: '', text: 'sin palabras' }, 'roto'] },
        });
        expect(on.greeting.rules).toHaveLength(2);
        const pub = buildPublicWidgetMeta('t'.repeat(20), on, brand, []).greeting;
        // Las reglas sin palabras o sin texto no viajan.
        expect(pub).toEqual({ text: '', rules: [{ contains: 'planes', text: '¿Dudas?' }], delay_s: 5, mobile: false });
        expect(buildPublicWidgetMeta('t'.repeat(20), readContactWidgetConfig({ greeting: { enabled: true, text: ' ' } }), brand, []).greeting).toBeNull();
    });
});
