import { describe, expect, it } from 'vitest';
import {
    buildWhatsappTemplateComponents,
    cleanWhatsappParam,
    nextWhatsappStatus,
    readWhatsappListFields,
    renderWhatsappTemplate,
    suggestWhatsappFields,
    whatsappCountryOf,
    whatsappIdVariants,
    whatsappRecipient,
    whatsappStatusFromMeta,
    whatsappTemplateVariables,
    whatsappWindowClosesAt,
    whatsappWindowOpen,
    writeWhatsappListFields,
} from './whatsapp';

const POSITIONAL = [
    { type: 'HEADER', format: 'DOCUMENT' },
    {
        type: 'BODY',
        text: 'Hola {{1}}, tu factura {{2}} vence {{3}}. {{2}} ya está disponible.',
        example: { body_text: [['Ana', 'FAC-1', 'mañana']] },
    },
    { type: 'FOOTER', text: 'Acme S.A.S.' },
    {
        type: 'BUTTONS',
        buttons: [
            { type: 'URL', text: 'Pagar', url: 'https://pagos.acme.test/{{1}}' },
            { type: 'QUICK_REPLY', text: 'Ya pagué' },
        ],
    },
];

const NAMED = [
    { type: 'HEADER', format: 'TEXT', text: 'Pedido {{pedido}}', example: { header_text_named_params: [{ param_name: 'pedido', example: '1042' }] } },
    { type: 'BODY', text: 'Hola {{nombre}}, tu pedido va en camino.', example: { body_text_named_params: [{ param_name: 'nombre', example: 'Ana' }] } },
    { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE', example: 'DESC10' }] },
];

describe('WhatsApp oficial — piezas puras', () => {
    it('variables de una plantilla posicional y con nombre, con sus ejemplos', () => {
        expect(whatsappTemplateVariables(POSITIONAL, 'POSITIONAL')).toEqual([
            { key: 'body.1', part: 'body', name: '1', label: 'Mensaje {{1}}', example: 'Ana' },
            { key: 'body.2', part: 'body', name: '2', label: 'Mensaje {{2}}', example: 'FAC-1' },
            { key: 'body.3', part: 'body', name: '3', label: 'Mensaje {{3}}', example: 'mañana' },
            { key: 'button.0', part: 'button', name: '0', label: 'Botón «Pagar» (final del enlace)', example: null },
        ]);
        expect(whatsappTemplateVariables(NAMED, 'NAMED').map((v) => [v.key, v.example])).toEqual([
            ['header.pedido', '1042'],
            ['body.nombre', 'Ana'],
            ['button.0', null],
        ]);
    });

    it('arma los componentes exactos (documento, cuerpo, botón) y dice qué falta', () => {
        const ok = buildWhatsappTemplateComponents(POSITIONAL, 'POSITIONAL', {
            variables: { 'body.1': 'Ana\nMaría', 'body.2': 'FAC-1', 'body.3': 'mañana', 'button.0': 'FAC-1' },
            header_media: 'https://files.acme.test/facturas/FAC%201.pdf?v=2',
        });
        expect(ok).toEqual({
            ok: true,
            components: [
                { type: 'header', parameters: [{ type: 'document', document: { link: 'https://files.acme.test/facturas/FAC%201.pdf?v=2', filename: 'FAC 1.pdf' } }] },
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: 'Ana María' },
                        { type: 'text', text: 'FAC-1' },
                        { type: 'text', text: 'mañana' },
                    ],
                },
                { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'FAC-1' }] },
            ],
        });
        const missing = buildWhatsappTemplateComponents(POSITIONAL, 'POSITIONAL', { variables: { 'body.1': 'Ana' } });
        expect(missing.ok).toBe(false);
        if (!missing.ok) {
            expect(missing.missing).toEqual([
                'el enlace del documento del encabezado',
                '{{2}} del mensaje',
                '{{3}} del mensaje',
                'el final del enlace del botón «Pagar»',
            ]);
        }
        const insecure = buildWhatsappTemplateComponents(POSITIONAL, 'POSITIONAL', {
            variables: { 'body.1': 'a', 'body.2': 'b', 'body.3': 'c', 'button.0': 'd' },
            header_media: 'http://files.acme.test/x.pdf',
        });
        expect(insecure.ok).toBe(false);
        const named = buildWhatsappTemplateComponents(NAMED, 'NAMED', { variables: { 'header.pedido': '1042', 'body.nombre': 'Ana', 'button.0': 'DESC10' } });
        expect(named).toEqual({
            ok: true,
            components: [
                { type: 'header', parameters: [{ type: 'text', parameter_name: 'pedido', text: '1042' }] },
                { type: 'body', parameters: [{ type: 'text', parameter_name: 'nombre', text: 'Ana' }] },
                { type: 'button', sub_type: 'copy_code', index: '0', parameters: [{ type: 'coupon_code', coupon_code: 'DESC10' }] },
            ],
        });
    });

    it('el texto que ve el contacto y la limpieza de parámetros', () => {
        const r = renderWhatsappTemplate(POSITIONAL, 'POSITIONAL', { 'body.1': 'Ana', 'body.2': 'FAC-1' });
        expect(r.header).toBe('[Documento]');
        expect(r.body).toBe('Hola Ana, tu factura FAC-1 vence {{3}}. FAC-1 ya está disponible.');
        expect(r.text).toBe('[Documento]\n\nHola Ana, tu factura FAC-1 vence {{3}}. FAC-1 ya está disponible.\n\nAcme S.A.S.');
        expect(r.buttons).toEqual(['Pagar', 'Ya pagué']);
        expect(cleanWhatsappParam('  a\r\n\tb      c  ')).toBe('a b   c');
    });

    it('estados: sólo avanzan, el fallido gana salvo tras leído', () => {
        expect(whatsappStatusFromMeta('delivered')).toBe('entregado');
        expect(whatsappStatusFromMeta('deleted')).toBeNull();
        expect(nextWhatsappStatus(null, 'enviado')).toBe('enviado');
        expect(nextWhatsappStatus('leido', 'entregado')).toBeNull();
        expect(nextWhatsappStatus('enviado', 'leido')).toBe('leido');
        expect(nextWhatsappStatus('entregado', 'fallido')).toBe('fallido');
        expect(nextWhatsappStatus('leido', 'fallido')).toBeNull();
        expect(nextWhatsappStatus('fallido', 'entregado')).toBeNull();
        expect(nextWhatsappStatus('entregado', 'entregado')).toBeNull();
    });

    it('ventana de 24 h', () => {
        const now = new Date('2026-10-20T12:00:00Z');
        expect(whatsappWindowOpen(null, now)).toBe(false);
        expect(whatsappWindowOpen('2026-10-19T12:00:01Z', now)).toBe(true);
        expect(whatsappWindowOpen('2026-10-19T12:00:00Z', now)).toBe(false);
        expect(whatsappWindowClosesAt('2026-10-19T12:30:00Z')?.toISOString()).toBe('2026-10-20T12:30:00.000Z');
    });

    it('teléfonos: indicativo por defecto, variantes de México y Argentina', () => {
        expect(whatsappRecipient('300 111 2233', 'CO')).toEqual({ ok: true, digits: '573001112233' });
        expect(whatsappRecipient('+52 55 1234 5678', 'CO')).toEqual({ ok: true, digits: '525512345678' });
        expect(whatsappRecipient('abc', 'CO').ok).toBe(false);
        expect(whatsappCountryOf('+57 300 000 0000')).toBe('CO');
        expect(whatsappIdVariants('5215512345678').sort()).toEqual(['525512345678', '5215512345678'].sort());
        expect(whatsappIdVariants('5491122334455').sort()).toEqual(['541122334455', '5491122334455'].sort());
        expect(whatsappIdVariants('573001112233')).toEqual(['573001112233']);
    });

    it('columnas de la lista: lectura tolerante, escritura y sugerencia por slug', () => {
        expect(readWhatsappListFields({ whatsapp: { phone_field_id: 3, message_field_id: 'x' } })).toMatchObject({ phone: 3, message: null });
        expect(writeWhatsappListFields({ ...readWhatsappListFields({}), phone: 7 })).toMatchObject({ phone_field_id: 7 });
        const s = suggestWhatsappFields([
            { id: 1, slug: 'celular', type: 'phone' },
            { id: 2, slug: 'whatsapp_ultimo_mensaje', type: 'long_text' },
            { id: 3, slug: 'whatsapp_estado', type: 'number' },
        ]);
        expect(s.phone).toBe(1);
        expect(s.message).toBe(2);
        // Un campo con el nombre esperado pero de otro tipo no se sugiere.
        expect(s.status).toBeNull();
    });
});
