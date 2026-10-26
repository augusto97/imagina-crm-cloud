import { describe, expect, it } from 'vitest';
import type { Field } from '@imagina-base/shared';
import { describeHelpdeskForModel } from '../src/ai/tools/helpdesk-schema';
import { accountMailParts, buildAccountRfc2822, threadHeaderLines } from '../src/connectors/mail-account-request';
import { autoReplyReason, parseInbound, stripQuotedReply } from '../src/helpdesk/inbound-mail';
import { imapErrorDiagnostic } from '../src/helpdesk/imap-reader';
import { htmlToRichDoc, textToRichDoc } from '../src/helpdesk/mail-html';
import { buildMime } from './helpers/fake-imap-server';

/** Junta todo el texto de un documento (para buscar sin depender de la forma del árbol). */
function docText(node: unknown): string {
    if (!node || typeof node !== 'object') return '';
    const n = node as { text?: string; content?: unknown[] };
    return `${n.text ?? ''}${(n.content ?? []).map(docText).join(' ')}`;
}

function marks(node: unknown, out: string[] = []): string[] {
    if (!node || typeof node !== 'object') return out;
    const n = node as { marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; content?: unknown[] };
    for (const m of n.marks ?? []) out.push(m.type === 'link' ? `link:${String(m.attrs?.href ?? '')}` : m.type);
    for (const c of n.content ?? []) marks(c, out);
    return out;
}

describe('Mesa de ayuda — piezas puras', () => {
    it('el HTML del correo pasa a la descripción con formato básico, sin scripts ni enlaces peligrosos', () => {
        const doc = htmlToRichDoc(`
            <html><head><style>p{color:red}</style><script>alert(1)</script></head>
            <body>
              <h2>Pedido 1234</h2>
              <p>Hola, <b>no llegó</b> el <i>pedido</i>. <a href="https://acme.test/p/1">Ver</a> <a href="javascript:alert(1)">malo</a></p>
              <ul><li>Uno</li><li>Dos</li></ul>
              <img src="x" alt="logo">
            </body></html>`);
        expect(doc).not.toBeNull();
        const text = docText(doc);
        expect(text).toContain('Pedido 1234');
        expect(text).toContain('no llegó');
        expect(text).toContain('Uno');
        expect(text).not.toContain('alert');
        expect(text).not.toContain('color:red');
        const m = marks(doc);
        expect(m).toContain('bold');
        expect(m).toContain('italic');
        expect(m).toContain('link:https://acme.test/p/1');
        expect(m.some((x) => x.includes('javascript'))).toBe(false);
        expect(JSON.stringify(doc)).toContain('bulletList');
    });

    it('un correo en texto plano se convierte en párrafos', () => {
        const doc = textToRichDoc('Hola\n\nSegunda línea\ny más');
        expect(docText(doc)).toContain('Segunda línea');
        expect(textToRichDoc('   ')).toBeNull();
    });

    it('reconoce respuestas automáticas, rebotes y envíos masivos', () => {
        const h = (headers: Record<string, string>) => (name: string) => headers[name] ?? '';
        expect(autoReplyReason(h({ 'auto-submitted': 'auto-replied' }), 'a@b.co', 'Hola')).toMatch(/automática/);
        expect(autoReplyReason(h({ 'auto-submitted': 'no' }), 'a@b.co', 'Hola')).toBeNull();
        expect(autoReplyReason(h({ precedence: 'bulk' }), 'a@b.co', 'Promo')).toMatch(/masivo/);
        expect(autoReplyReason(h({ 'x-autoreply': 'yes' }), 'a@b.co', 'x')).not.toBeNull();
        expect(autoReplyReason(h({}), 'MAILER-DAEMON@mx.acme.test', 'Undelivered')).toMatch(/rebote/);
        expect(autoReplyReason(h({}), 'ana@cliente.test', 'Fuera de la oficina: vuelvo el lunes')).not.toBeNull();
        expect(autoReplyReason(h({}), 'ana@cliente.test', 'No me llegó el pedido')).toBeNull();
    });

    it('corta el historial citado de una respuesta, sin perder nunca lo que escribió el cliente', () => {
        const reply = 'Gracias, ya funciona.\n\nEl lun, 2 nov 2026 a las 10:00, Soporte <soporte@acme.test> escribió:\n> Hola Ana\n> prueba de nuevo';
        expect(stripQuotedReply(reply)).toBe('Gracias, ya funciona.');
        const outlook = 'Listo.\n\n-----Mensaje original-----\nDe: Soporte\nAsunto: x';
        expect(stripQuotedReply(outlook)).toBe('Listo.');
        const quoteOnly = '> todo citado';
        expect(stripQuotedReply(quoteOnly)).toBe('> todo citado');
    });

    it('lee un correo real: el cliente es el Reply-To, los adjuntos y las cabeceras del hilo', async () => {
        const raw = buildMime({
            from: 'Robot <noreply@tienda.test>',
            to: 'soporte@acme.test',
            subject: 'Re: Tu pedido [TCK-0007]',
            text: 'Hola',
            messageId: 'abc@tienda.test',
            inReplyTo: 'hd.7.xyz@acme.test',
            references: ['m0@tienda.test', 'hd.7.xyz@acme.test'],
            headers: { 'Reply-To': 'Ana Pérez <ana@cliente.test>' },
            attachments: [{ filename: 'factura.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 x') }],
        });
        const mail = await parseInbound(Buffer.from(raw.replace(/\r?\n/g, '\r\n')));
        expect(mail.customer).toEqual({ email: 'ana@cliente.test', name: 'Ana Pérez' });
        expect(mail.messageId).toBe('abc@tienda.test');
        expect(mail.inReplyTo).toBe('hd.7.xyz@acme.test');
        expect(mail.references).toContain('m0@tienda.test');
        expect(mail.attachments.map((a) => a.filename)).toEqual(['factura.pdf']);
        expect(mail.autoReason).toBeNull();
    });

    it('traduce los errores del IMAP a un diagnóstico en lenguaje claro', () => {
        const ctx = { host: 'imap.acme.test', port: 993, security: 'tls' as const, folder: 'Soporte' };
        expect(imapErrorDiagnostic({ authenticationFailed: true, message: 'Command failed' }, ctx).step).toBe('auth');
        expect(imapErrorDiagnostic({ mailboxMissing: true, message: 'x' }, ctx).step).toBe('folder');
        expect(imapErrorDiagnostic({ code: 'ENOTFOUND', message: 'getaddrinfo' }, ctx).step).toBe('dns');
        expect(imapErrorDiagnostic({ code: 'ERR_TLS_CERT_ALTNAME_INVALID', message: 'certificate' }, ctx).step).toBe('tls');
        expect(imapErrorDiagnostic({ code: 'ECONNREFUSED', message: 'refused' }, ctx).step).toBe('connect');
        const auth = imapErrorDiagnostic({ authenticationFailed: true }, ctx);
        expect(auth.hints.join(' ')).toMatch(/CONTRASEÑA DE APLICACIÓN/);
    });

    it('las cabeceras del hilo salen limpias (sin inyección de cabeceras) en Gmail y en SMTP', () => {
        const lines = threadHeaderLines({
            messageId: 'hd.1.aa@acme.test',
            inReplyTo: 'm1@cliente.test>\r\nBcc: espia@malo.test',
            references: ['m0@cliente.test', 'm1@cliente.test'],
            headers: { 'X-Imagina-Helpdesk': '1', 'Auto-Submitted': 'auto-generated\r\nX-Otra: si', Bcc: 'nadie@malo.test' },
        });
        const joined = lines.join('\n');
        expect(joined).toContain('Message-ID: <hd.1.aa@acme.test>');
        expect(joined).toContain('References: <m0@cliente.test> <m1@cliente.test>');
        expect(joined).toContain('X-Imagina-Helpdesk: 1');
        expect(lines).toHaveLength(5);
        expect(lines.some((l) => l.startsWith('X-Otra'))).toBe(false);
        expect(joined).toContain('In-Reply-To: <m1@cliente.test>\n');
        expect(joined).not.toMatch(/\r|\nBcc|espia|nadie@malo/i);
        const msg = { to: 'ana@cliente.test', subject: 'Re: x [#1]', text: 'hola', inReplyTo: 'm1@cliente.test', references: ['m1@cliente.test'] };
        const raw = buildAccountRfc2822(msg, accountMailParts(msg, 'soporte@acme.test'), 'soporte@acme.test');
        expect(raw).toContain('In-Reply-To: <m1@cliente.test>');
    });

    it('el asistente ve la mesa de ayuda sin secretos', () => {
        const fields = new Map<number, Field>([
            [1, { id: 1, slug: 'asunto', type: 'text', config: {} } as unknown as Field],
            [2, { id: 2, slug: 'estado', type: 'select', config: { options: [{ value: 'nuevo', label: 'Nuevo' }, { value: 'cerrado', label: 'Cerrado' }] } } as unknown as Field],
        ]);
        const out = describeHelpdeskForModel(
            {
                helpdesk: {
                    mailbox: { id: 9, support_address: 'soporte@acme.test', password: 'NO-DEBE-SALIR' },
                    title_field_id: 1,
                    status_field_id: 2,
                    initial_status: 'nuevo',
                    closed_statuses: ['cerrado'],
                    sla: { enabled: true, targets: [{ priority: null, first_response_hours: 4, resolution_hours: 24 }] },
                },
            },
            fields,
        );
        const json = JSON.stringify(out);
        expect(json).toContain('soporte@acme.test');
        expect(json).not.toContain('NO-DEBE-SALIR');
        expect(out?.initial_status).toBe('Nuevo');
        expect((out?.sla as { targets: unknown[] }).targets).toHaveLength(1);
        expect(describeHelpdeskForModel({}, fields)).toBeNull();
    });
});
