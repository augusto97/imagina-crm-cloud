import { describe, expect, it } from 'vitest';
import { ipv6Hextets, isBlockedAddress, safeWebhookFetch, stripUnsafeHeaders, withContentLength } from '../src/common/safe-fetch';
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
        expect(isBlockedAddress('[2a01:4f8::1]')).toBe(false);
        expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
        expect(isBlockedAddress('64:ff9b::8.8.8.8')).toBe(false);
    });

    it('SEC-23: bloquea toda IPv6 que EMBEBE una IPv4 interna, en cualquier notación', () => {
        for (const ip of [
            '[::1]', // con corchetes, como lo devuelve URL.hostname
            '::ffff:7f00:1', // mapped en hex
            '0:0:0:0:0:ffff:7f00:0001', // mapped sin comprimir
            '[::ffff:a9fe:a9fe]', // metadata cloud, mapped hex con corchetes
            '::7f00:1', // IPv4-compatible
            '::127.0.0.1',
            '64:ff9b::a9fe:a9fe', // NAT64 → metadata
            '64:ff9b:1::1', // NAT64 de uso local
            '2002:7f00:1::', // 6to4 → loopback
            '2002:a9fe:a9fe::1', // 6to4 → metadata
            '2001::1', // Teredo
            '2001:db8::1', // documentación
            'fec0::1', // site-local
            '100::1', // discard
            'fd00:ec2::254', // metadata AWS por IPv6 (ULA)
            '::', // unspecified
        ]) {
            expect(isBlockedAddress(ip), ip).toBe(true);
        }
    });

    it('SEC-23: bloquea los rangos IPv4 de benchmark/documentación y la metadata de Alibaba', () => {
        for (const ip of ['198.18.0.1', '198.19.255.1', '198.51.100.7', '203.0.113.9', '192.88.99.1', '100.100.100.200', '255.255.255.255']) {
            expect(isBlockedAddress(ip), ip).toBe(true);
        }
    });

    it('ipv6Hextets normaliza todas las notaciones a los mismos 8 números', () => {
        const ref = [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1];
        expect(ipv6Hextets('::ffff:127.0.0.1')).toEqual(ref);
        expect(ipv6Hextets('::ffff:7f00:1')).toEqual(ref);
        expect(ipv6Hextets('0:0:0:0:0:ffff:7f00:0001')).toEqual(ref);
        expect(ipv6Hextets('[::ffff:7f00:1]')).toEqual(ref);
        expect(ipv6Hextets('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
        expect(ipv6Hextets('1::2::3')).toBeNull();
        expect(ipv6Hextets('1:2:3:4:5:6:7:8:9')).toBeNull();
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

    it('SEC-23: un literal IPv6 entre corchetes pasa por el guard (antes ni se miraba)', async () => {
        // Antes estos llegaban a `connect` directo: el lookup no corre para IPs
        // literales y la validación del literal comparaba `[::1]` con corchetes.
        for (const url of [
            'http://[::1]:3001/',
            'http://[::ffff:127.0.0.1]:2019/load',
            'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
            'http://[::7f00:1]/',
            'http://[64:ff9b::a9fe:a9fe]/',
            'http://[2002:7f00:1::]/',
        ]) {
            await expect(safeWebhookFetch(url, { timeoutMs: 2000 }), url).rejects.toThrow(/SSRF/);
        }
    });
});

describe('stripUnsafeHeaders (SEC-23)', () => {
    it('saca Host y las cabeceras de framing, conserva el resto', () => {
        expect(
            stripUnsafeHeaders({
                Host: 'localhost:2019',
                'Content-Length': '5',
                'Transfer-Encoding': 'chunked',
                Connection: 'close',
                Authorization: 'Bearer x',
                'X-Custom': '1',
            }),
        ).toEqual({ Authorization: 'Bearer x', 'X-Custom': '1' });
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

describe('safeWebhookFetch binario (v0.1.210, proxy de miniaturas)', () => {
    it('devuelve los bytes tal cual (una imagen no es texto)', async () => {
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0xc3]);
        const server: Server = createServer((_req, res) => {
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(bytes.length) });
            res.end(bytes);
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
        const port = (server.address() as { port: number }).port;
        const prev = process.env.DEV_ALLOW_PRIVATE_EGRESS;
        process.env.DEV_ALLOW_PRIVATE_EGRESS = '1';
        try {
            const res = await safeWebhookFetch(`http://127.0.0.1:${port}/a.png`, {
                method: 'GET',
                captureBody: true,
                binary: true,
                maxCaptureBytes: 1024,
            });
            expect(res.status).toBe(200);
            expect(res.contentType).toBe('image/png');
            expect(res.bytes!.equals(bytes)).toBe(true);
            expect(res.body).toBeUndefined();
        } finally {
            if (prev === undefined) delete process.env.DEV_ALLOW_PRIVATE_EGRESS;
            else process.env.DEV_ALLOW_PRIVATE_EGRESS = prev;
            await new Promise<void>((r) => server.close(() => r()));
        }
    });
});
