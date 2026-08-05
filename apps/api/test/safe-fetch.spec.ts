import { describe, expect, it } from 'vitest';
import { isBlockedAddress, safeWebhookFetch, withContentLength } from '../src/common/safe-fetch';
import { createServer, request, type Server } from 'node:http';

describe('isBlockedAddress (guard anti-SSRF, SEC-03)', () => {
    it('bloquea metadata cloud, loopback, privadas y link-local (IPv4)', () => {
        for (const ip of [
            '169.254.169.254', // IMDS / metadata
            '127.0.0.1',
            '0.0.0.0',
            '10.0.0.5',
            '172.16.0.1',
            '172.31.255.255',
            '192.168.1.1',
            '100.64.0.1', // CGNAT
            '224.0.0.1', // multicast
            '169.254.0.1', // link-local
        ]) {
            expect(isBlockedAddress(ip), ip).toBe(true);
        }
    });

    it('permite IPs públicas (IPv4)', () => {
        for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
            expect(isBlockedAddress(ip), ip).toBe(false);
        }
    });

    it('bloquea loopback, ULA, link-local y IPv4-mapped (IPv6)', () => {
        for (const ip of [
            '::1',
            '::',
            'fc00::1', // ULA
            'fd12:3456::1', // ULA
            'fe80::1', // link-local
            'ff02::1', // multicast
            '::ffff:127.0.0.1', // IPv4-mapped loopback
            '::ffff:169.254.169.254', // IPv4-mapped metadata
        ]) {
            expect(isBlockedAddress(ip), ip).toBe(true);
        }
    });

    it('permite IPv6 público', () => {
        expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
    });

    it('bloquea entradas no-IP (defensa)', () => {
        expect(isBlockedAddress('no-una-ip')).toBe(true);
        expect(isBlockedAddress('')).toBe(true);
    });
});

describe('safeWebhookFetch (SEC-03)', () => {
    it('rechaza esquemas no http/https', async () => {
        await expect(safeWebhookFetch('file:///etc/passwd')).rejects.toThrow();
        await expect(safeWebhookFetch('ftp://example.com')).rejects.toThrow();
    });

    it('rechaza una URL inválida', async () => {
        await expect(safeWebhookFetch('no-es-una-url')).rejects.toThrow();
    });

    it('bloquea la conexión a la metadata del cloud por IP literal', async () => {
        // El lookup ve una IP link-local y aborta antes de conectar.
        await expect(
            safeWebhookFetch('http://169.254.169.254/latest/meta-data/', { timeoutMs: 2000 }),
        ).rejects.toThrow(/interna|bloqueada|SSRF/i);
    });

    it('bloquea loopback', async () => {
        await expect(
            safeWebhookFetch('http://127.0.0.1:6379/', { timeoutMs: 2000 }),
        ).rejects.toThrow(/interna|bloqueada|SSRF/i);
    });
});

/**
 * v0.1.157 — `Content-Length` obligatorio cuando hay cuerpo.
 *
 * Sin esa cabecera, node:http manda `Transfer-Encoding: chunked` y Apache/PHP
 * (y varios gateways de WhatsApp/SMS) contestan **411 Length Required** sin
 * leer el cuerpo. El reporte del usuario era exactamente ese 411.
 */
describe('withContentLength (fix del 411)', () => {
    it('agrega content-length con el tamaño en BYTES (no en caracteres)', () => {
        // 'a=ñ' son 4 bytes en UTF-8: contar caracteres daría 3 y el servidor
        // leería el cuerpo cortado.
        expect(withContentLength({}, 'POST', 'a=ñ')['content-length']).toBe('4');
    });

    it('no lo agrega en GET/HEAD ni pisa el del llamador', () => {
        expect(withContentLength({}, 'GET', undefined)['content-length']).toBeUndefined();
        expect(withContentLength({}, 'HEAD', 'x')['content-length']).toBeUndefined();
        const kept = withContentLength({ 'Content-Length': '99' }, 'POST', 'abc');
        expect(kept['Content-Length']).toBe('99');
        expect(kept['content-length']).toBeUndefined();
    });

    it('sin la cabecera node manda chunked (lo que dispara el 411); con ella, no', async () => {
        const seen: Array<Record<string, unknown>> = [];
        const server: Server = createServer((req, res) => {
            seen.push({
                te: req.headers['transfer-encoding'] ?? null,
                cl: req.headers['content-length'] ?? null,
            });
            req.resume();
            req.on('end', () => res.end('ok'));
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
        const port = (server.address() as { port: number }).port;
        const post = (headers: Record<string, string>): Promise<void> =>
            new Promise((resolve) => {
                const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers }, (res) => {
                    res.resume();
                    res.on('end', () => resolve());
                });
                req.write('a=1&b=2');
                req.end();
            });

        await post({});
        await post(withContentLength({}, 'POST', 'a=1&b=2'));
        await new Promise<void>((r) => server.close(() => r()));

        expect(seen[0]).toEqual({ te: 'chunked', cl: null }); // el caso que rompía
        expect(seen[1]).toEqual({ te: null, cl: '7' }); // con el fix
    });
});
