import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SmtpProbeService, isLinkLocal, verdictFor } from '../src/mail/smtp-probe.service';

/**
 * v0.1.151 — diagnóstico de conectividad SMTP. La lógica que traduce los
 * intentos a consejos es PURA (se testea sin red) y la prueba real corre contra
 * un socket local que saluda como un SMTP.
 */
describe('verdictFor (puro)', () => {
    it('puerto configurado abierto y TLS coherente → ok', () => {
        const r = verdictFor({ port: 587, secure: false }, [
            { port: 587, status: 'open', ms: 12, greeting: '220 smtp.acme.com ESMTP' },
            { port: 25, status: 'timeout', ms: 6000 },
        ]);
        expect(r.verdict).toBe('ok');
        expect(r.hints[0]).toContain('220 smtp.acme.com ESMTP');
    });

    it('465 abierto pero sin "conexión segura" → tls_mismatch', () => {
        const r = verdictFor({ port: 465, secure: false }, [{ port: 465, status: 'open', ms: 20 }]);
        expect(r.verdict).toBe('tls_mismatch');
        expect(r.hints[0]).toContain('activá');
    });

    it('587 abierto con "conexión segura" activada → tls_mismatch', () => {
        const r = verdictFor({ port: 587, secure: true }, [{ port: 587, status: 'open', ms: 20 }]);
        expect(r.verdict).toBe('tls_mismatch');
        expect(r.hints[0]).toContain('STARTTLS');
    });

    it('el configurado no responde pero otro sí → sugiere ese puerto', () => {
        const r = verdictFor({ port: 25, secure: false }, [
            { port: 25, status: 'timeout', ms: 6000 },
            { port: 587, status: 'open', ms: 30 },
            { port: 465, status: 'open', ms: 31 },
        ]);
        expect(r.verdict).toBe('port_closed');
        expect(r.hints[0]).toContain('587');
    });

    it('ningún puerto responde → apunta al bloqueo del proveedor (la causa nº 1)', () => {
        const r = verdictFor({ port: 587, secure: false }, [
            { port: 25, status: 'timeout', ms: 6000 },
            { port: 465, status: 'timeout', ms: 6000 },
            { port: 587, status: 'timeout', ms: 6000 },
            { port: 2525, status: 'timeout', ms: 6000 },
        ]);
        expect(r.verdict).toBe('all_blocked');
        expect(r.hints.join(' ')).toMatch(/VPS|proveedor/i);
    });
});

describe('isLinkLocal', () => {
    it('bloquea el endpoint de metadata de las nubes y fe80::/10', () => {
        expect(isLinkLocal('169.254.169.254')).toBe(true);
        expect(isLinkLocal('::ffff:169.254.169.254')).toBe(true);
        expect(isLinkLocal('fe80::1')).toBe(true);
    });

    it('deja pasar públicas y privadas (un relay interno es legítimo)', () => {
        expect(isLinkLocal('1.2.3.4')).toBe(false);
        expect(isLinkLocal('10.0.0.5')).toBe(false);
        expect(isLinkLocal('127.0.0.1')).toBe(false);
    });
});

describe('SmtpProbeService (sockets reales)', () => {
    const probe = new SmtpProbeService();
    let server: Server;
    let port = 0;

    beforeAll(async () => {
        server = createServer((socket) => socket.write('220 sink.local ESMTP listo\r\n'));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as { port: number }).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('lee el saludo del servidor y da veredicto ok', async () => {
        const report = await probe.diagnose({ host: '127.0.0.1', port, secure: false });
        expect(report.dns.ok).toBe(true);
        const mine = report.ports.find((p) => p.port === port);
        expect(mine?.status).toBe('open');
        expect(mine?.greeting).toBe('220 sink.local ESMTP listo');
        expect(report.verdict).toBe('ok');
    });

    it('un host que no resuelve → dns_failed con consejo de escritura', async () => {
        const report = await probe.diagnose({
            host: 'no-existe.invalid-tld-para-test',
            port: 587,
            secure: false,
        });
        expect(report.verdict).toBe('dns_failed');
        expect(report.ports).toEqual([]);
        expect(report.hints[0]).toContain('no resuelve');
    });

    it('pegar un email o una URL en Host se explica, no se intenta', async () => {
        const report = await probe.diagnose({ host: 'https://smtp.acme.com', port: 587, secure: false });
        expect(report.verdict).toBe('dns_failed');
        expect(report.hints.join(' ')).toContain('http://');
    });
});
