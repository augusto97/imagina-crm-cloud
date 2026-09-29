import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { SafeFetchResult } from '../src/common/safe-fetch';
import { imageContentType, imageProxyTarget, ImageProxyService } from '../src/files/image-proxy';

/**
 * v0.1.210 — Proxy de miniaturas. La red se simula en el borde (`fetcher`):
 * lo que se prueba es qué se ACEPTA servir, no la conexión.
 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function svc(responses: Record<string, SafeFetchResult | Error>): { s: ImageProxyService; asked: string[] } {
    const s = new ImageProxyService();
    const asked: string[] = [];
    s.fetcher = async (url) => {
        asked.push(url);
        const r = responses[url];
        if (!r) throw new Error('sin ruta');
        if (r instanceof Error) throw r;
        return r;
    };
    return { s, asked };
}

describe('proxy de miniaturas', () => {
    it('sólo acepta http(s) sin credenciales y de largo razonable', () => {
        expect(imageProxyTarget('https://tienda.test/wp-content/a.jpg')?.hostname).toBe('tienda.test');
        expect(imageProxyTarget('http://tienda.test/a.jpg')).not.toBeNull();
        for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AA', 'file:///etc/passwd', 'ftp://x/a.png', 'https://u:p@x.test/a.png', '', 'no es url', `https://x.test/${'a'.repeat(2100)}`, 42, null]) {
            expect(imageProxyTarget(bad), String(bad)).toBeNull();
        }
    });

    it('sólo sirve tipos de imagen que no ejecutan nada (SVG fuera)', () => {
        expect(imageContentType('image/png')).toBe('image/png');
        expect(imageContentType('IMAGE/JPEG; charset=binary')).toBe('image/jpeg');
        expect(imageContentType('image/webp')).toBe('image/webp');
        for (const bad of ['image/svg+xml', 'text/html', 'application/octet-stream', '', undefined]) {
            expect(imageContentType(bad), String(bad)).toBeNull();
        }
    });

    it('trae la imagen, sigue redirecciones re-validándolas y rechaza lo raro con 404', async () => {
        const ok: SafeFetchResult = { status: 200, contentType: 'image/png', bytes: PNG };
        const { s, asked } = svc({
            'https://t.test/a.png': ok,
            'http://t.test/viejo.png': { status: 301, headers: { location: 'https://t.test/a.png' } },
            'https://t.test/svg': { status: 200, contentType: 'image/svg+xml', bytes: Buffer.from('<svg/>') },
            'https://t.test/html': { status: 200, contentType: 'text/html', bytes: Buffer.from('<p>') },
            'https://t.test/grande.png': { status: 200, contentType: 'image/png', bytes: PNG, truncated: true },
            'https://t.test/404.png': { status: 404, contentType: 'image/png', bytes: PNG },
            'https://t.test/a-archivo': { status: 302, headers: { location: 'file:///etc/passwd' } },
            'https://t.test/interna.png': new Error('SSRF: destino de red interna bloqueado (10.0.0.1)'),
            'https://t.test/bucle1': { status: 302, headers: { location: '/bucle2' } },
            'https://t.test/bucle2': { status: 302, headers: { location: '/bucle1' } },
        });
        const got = await s.fetch('https://t.test/a.png');
        expect(got.contentType).toBe('image/png');
        expect(got.bytes.equals(PNG)).toBe(true);
        // Redirección relativa o absoluta: se vuelve a pedir por el guard.
        expect((await s.fetch('http://t.test/viejo.png')).bytes.equals(PNG)).toBe(true);
        expect(asked).toContain('https://t.test/a.png');
        for (const bad of [
            'https://t.test/svg',
            'https://t.test/html',
            'https://t.test/grande.png',
            'https://t.test/404.png',
            'https://t.test/a-archivo',
            'https://t.test/interna.png',
            'https://t.test/bucle1',
            'javascript:alert(1)',
        ]) {
            await expect(s.fetch(bad), bad).rejects.toBeInstanceOf(NotFoundException);
        }
    });
});
