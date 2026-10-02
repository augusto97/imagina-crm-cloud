import { describe, expect, it } from 'vitest';
import { addressOf } from '../src/mail/transports/smtp.transport';
import { portalAccessEmail, senderName } from '../src/portal/portal-email';

describe('portalAccessEmail (v0.1.245, white-label)', () => {
    const url = 'https://clientes.acme.com/portal/acceso?token=abc123';

    it('usa el nombre, el color y el logo de la empresa', () => {
        const m = portalAccessEmail({ name: 'Acme', color: '#16a34a', logoUrl: 'https://clientes.acme.com/logo.png' }, url);
        expect(m.subject).toBe('Tu acceso al portal de Acme');
        expect(m.text).toContain(url);
        expect(m.html).toContain('background:#16a34a');
        expect(m.html).toContain('src="https://clientes.acme.com/logo.png"');
        expect(m.html).toContain('Acme te dio acceso a su portal de clientes.');
        expect(`${m.subject}${m.text}${m.html}`).not.toMatch(/imagina/i);
    });

    it('escapa lo que escribió la empresa y no deja colar estilos', () => {
        const m = portalAccessEmail({ name: '<b>Acme</b> & "Co"', color: 'red;background:url(x)', logoUrl: null }, url);
        expect(m.html).not.toContain('<b>Acme</b>');
        expect(m.html).toContain('&lt;b&gt;Acme&lt;/b&gt; &amp; &quot;Co&quot;');
        // Un color que no es #rrggbb cae al gris neutro.
        expect(m.html).not.toContain('red;background');
        expect(m.html).toContain('#1f2937');
        expect(m.html).not.toContain('<img');
    });

    it('elige tinta legible sobre el color del botón', () => {
        expect(portalAccessEmail({ name: 'A', color: '#fde047', logoUrl: null }, url).html).toContain('color:#111827;text-decoration');
        expect(portalAccessEmail({ name: 'A', color: '#1e3a8a', logoUrl: null }, url).html).toContain('color:#ffffff;text-decoration');
    });

    it('el correo de "todas tus cuentas" no nombra a ninguna empresa', () => {
        const m = portalAccessEmail({ name: 'Acme', color: null, logoUrl: null }, url, { allAccounts: true });
        expect(m.subject).toBe('Tu acceso a todas tus cuentas');
        expect(m.html).not.toContain('Acme');
    });

    it('senderName quita saltos de línea, comillas y ángulos (inyección de cabeceras)', () => {
        expect(senderName('Acme\r\nBcc: x@y.z')).toBe('Acme Bcc: x@y.z');
        expect(senderName('"Acme" <spoof@x.com>')).toBe('Acme spoof@x.com');
        expect(senderName('a'.repeat(200))).toHaveLength(80);
    });

    it('addressOf toma la dirección de un remitente con nombre', () => {
        expect(addressOf('Imagina Base <no-reply@x.com>')).toBe('no-reply@x.com');
        expect(addressOf('no-reply@x.com')).toBe('no-reply@x.com');
    });
});
