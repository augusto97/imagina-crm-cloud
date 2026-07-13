import { describe, expect, it } from 'vitest';
import { deriveDnsRecords, domainOfFrom } from '../src/mail/smtp-dns.service';

const cfg = (host: string, from: string) => ({
    host,
    port: 587,
    secure: false,
    user: 'u',
    pass: 'p',
    from,
});

describe('domainOfFrom', () => {
    it('extrae el dominio del from con y sin display name', () => {
        expect(domainOfFrom('Acme <ventas@acme.com>')).toBe('acme.com');
        expect(domainOfFrom('ventas@acme.com')).toBe('acme.com');
        expect(domainOfFrom('VENTAS@Sub.Acme.COM')).toBe('sub.acme.com');
    });

    it('rechaza froms sin dominio utilizable', () => {
        expect(domainOfFrom('no-es-un-email')).toBeNull();
        expect(domainOfFrom('a@localhost')).toBeNull();
        expect(domainOfFrom('')).toBeNull();
    });
});

describe('deriveDnsRecords', () => {
    it('proveedor conocido (Google): SPF con su include y DKIM con su selector', () => {
        const d = deriveDnsRecords(cfg('smtp.gmail.com', 'Acme <ventas@acme.com>'))!;
        expect(d.domain).toBe('acme.com');
        expect(d.provider).toBe('Google Workspace');

        const spf = d.records.find((r) => r.purpose === 'spf')!;
        expect(spf).toMatchObject({ type: 'TXT', host: '@', value: 'v=spf1 include:_spf.google.com ~all' });

        const dkim = d.records.find((r) => r.purpose === 'dkim')!;
        expect(dkim.host).toBe('google._domainkey');
        expect(dkim.type).toBe('TXT');
        // La clave la genera el proveedor: value vacío + guía.
        expect(dkim.value).toBe('');
        expect(dkim.note).toContain('admin.google.com');
    });

    it('proveedor Easy-DKIM (Microsoft 365): DKIM por CNAME con selector1', () => {
        const d = deriveDnsRecords(cfg('smtp.office365.com', 'soporte@acme.com'))!;
        expect(d.provider).toBe('Microsoft 365');
        const dkim = d.records.find((r) => r.purpose === 'dkim')!;
        expect(dkim.type).toBe('CNAME');
        expect(dkim.host).toBe('selector1._domainkey');
        expect(d.dkimSelectors).toEqual(['selector1', 'selector2']);
    });

    it('proveedor desconocido: SPF genérico a:host con nota, DKIM guiado', () => {
        const d = deriveDnsRecords(cfg('mail.hosting-propio.net', 'x@acme.com'))!;
        expect(d.provider).toBe('desconocido');
        const spf = d.records.find((r) => r.purpose === 'spf')!;
        expect(spf.value).toBe('v=spf1 a:mail.hosting-propio.net ~all');
        expect(spf.note).toBeTruthy();
        const dkim = d.records.find((r) => r.purpose === 'dkim')!;
        expect(dkim.host).toBe('selector._domainkey');
    });

    it('DMARC de arranque: _dmarc TXT con p=none y rua al dominio', () => {
        const d = deriveDnsRecords(cfg('smtp.gmail.com', 'v@acme.com'))!;
        const dmarc = d.records.find((r) => r.purpose === 'dmarc')!;
        expect(dmarc).toMatchObject({ type: 'TXT', host: '_dmarc' });
        expect(dmarc.value).toBe('v=DMARC1; p=none; rua=mailto:postmaster@acme.com');
    });

    it('from sin dominio válido → null (el endpoint responde 404)', () => {
        expect(deriveDnsRecords(cfg('smtp.gmail.com', 'sin-arroba'))).toBeNull();
    });
});
