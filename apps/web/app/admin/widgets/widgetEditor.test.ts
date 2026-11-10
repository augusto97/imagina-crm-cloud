import { describe, expect, it } from 'vitest';
import { contactWidgetConfigSchema, type ContactWidgetOptions } from '@imagina-base/shared';

import { addButton, canAddButton, editorProblems, moveButton, newButton, parseDomains, previewMeta, removeButton, sameConfig, updateButton, whatsappVars } from './widgetEditor';

const options: ContactWidgetOptions = {
    forms: [
        { id: 5, name: 'Contacto', enabled: true, list_id: 1, list_name: 'Leads', asks_phone: true, public_path: '/api/v1/public/f/f5', answer_slugs: [{ slug: 'nombre', label: 'Nombre' }] },
        { id: 6, name: 'Borrador', enabled: false, list_id: 1, list_name: 'Leads', asks_phone: false, public_path: '/api/v1/public/f/f6', answer_slugs: [] },
    ],
    bookings: [{ id: 3, name: 'Citas', enabled: true, list_id: 2, list_name: 'Agenda', public_path: '/api/v1/public/b/b3' }],
    brand_color: '#0e7490',
    company: 'Acme',
    logo_url: null,
};

describe('editor del widget (v0.1.394)', () => {
    it('un botón nuevo nace con lo que le sirve', () => {
        let cfg = contactWidgetConfigSchema.parse({ buttons: [{ id: 'wa', type: 'whatsapp', phone: '+573001112233' }] });
        const call = newButton('call', cfg, options);
        expect(call.phone).toBe('+573001112233');
        cfg = addButton(cfg, call);
        const fm = newButton('form', cfg, options);
        expect(fm.form_id).toBe(5);
        expect(newButton('booking', cfg, options).booking_page_id).toBe(3);
        expect(newButton('whatsapp', cfg, options).message).toContain('{{pagina}}');
        expect(new Set([call.id, fm.id, 'wa']).size).toBe(3);
    });

    it('subir, bajar, cambiar y quitar', () => {
        let cfg = contactWidgetConfigSchema.parse({
            buttons: [
                { id: 'a', type: 'call', phone: '+5760' },
                { id: 'b', type: 'email', email: 'x@y.co' },
            ],
        });
        cfg = moveButton(cfg, 'b', -1);
        expect(cfg.buttons.map((b) => b.id)).toEqual(['b', 'a']);
        expect(moveButton(cfg, 'b', -1)).toBe(cfg);
        cfg = updateButton(cfg, 'a', { label: 'Llámanos', id: 'zz' } as never);
        expect(cfg.buttons[1]).toMatchObject({ id: 'a', label: 'Llámanos' });
        cfg = removeButton(cfg, 'b');
        expect(cfg.buttons.map((b) => b.id)).toEqual(['a']);
    });

    it('no pasa de 8 botones', () => {
        let cfg = contactWidgetConfigSchema.parse({});
        for (let i = 0; i < 10; i++) cfg = addButton(cfg, newButton('link', cfg, options));
        expect(cfg.buttons).toHaveLength(8);
        expect(canAddButton(cfg)).toBe(false);
    });

    it('la vista previa: lo publicado se abre, lo demás se ve igual pero sin destino', () => {
        const cfg = contactWidgetConfigSchema.parse({
            color: '#7c3aed',
            buttons: [
                { id: 'f1', type: 'form', form_id: 5 },
                { id: 'f2', type: 'form', form_id: 6 },
                { id: 'wa', type: 'whatsapp', phone: '' },
            ],
        });
        const meta = previewMeta(cfg, options);
        expect(meta.accent).toBe('#7c3aed');
        expect(meta.buttons.map((b) => [b.id, b.frame])).toEqual([
            ['f1', '/api/v1/public/f/f5'],
            ['f2', null],
            ['wa', null],
        ]);
        expect(editorProblems(cfg, options).map((p) => p.button_id)).toEqual(['f2', 'wa']);
    });

    it('variables del mensaje: con datos primero, las respuestas', () => {
        const wa = contactWidgetConfigSchema.parse({ buttons: [{ id: 'wa', type: 'whatsapp', phone: '+57300', capture_form_id: 5 }] }).buttons[0]!;
        expect(whatsappVars(wa, options).map((v) => v.key)).toEqual(['pagina', 'url', 'nombre', 'formulario.nombre']);
        expect(whatsappVars({ ...wa, capture_form_id: null }, options).map((v) => v.key)).toEqual(['pagina', 'url']);
    });

    it('sitios y cambios sin guardar', () => {
        expect(parseDomains('acme.co\n acme.co , www.acme.co\n\n')).toEqual(['acme.co', 'www.acme.co']);
        const a = contactWidgetConfigSchema.parse({ title: 'Hola' });
        expect(sameConfig(a, JSON.parse(JSON.stringify(a)))).toBe(true);
        expect(sameConfig(a, { ...a, title: 'Chao' })).toBe(false);
    });
});
