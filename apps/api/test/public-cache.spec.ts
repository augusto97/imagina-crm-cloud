import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cacheablePageCsp, inlineScriptHash, inlineScriptText, renderFormPage } from '../src/forms/form-page';
import { bookingClientHash, renderBookingPage } from '../src/booking/booking-page';
import { PublicBusyError, PublicCache } from '../src/public-cache/public-cache';
import { pickEncoding, precompress } from '../src/public-cache/public-send';
import { createHash } from 'node:crypto';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

function cache(over: Partial<ConstructorParameters<typeof PublicCache>[0]> = {}) {
    let now = 1_000_000;
    const c = new PublicCache({ maxEntries: 100, concurrency: 4, maxQueue: 10, queueTimeoutMs: 1000, now: () => now, ...over });
    return { c, advance: (ms: number) => (now += ms) };
}

describe('v0.1.352 — caché de lo público (puro)', () => {
    it('guarda por un rato, vence y vuelve a armar', async () => {
        const { c, advance } = cache();
        let calls = 0;
        const load = async () => ++calls;
        expect(await c.get('a', 30_000, load)).toBe(1);
        expect(await c.get('a', 30_000, load)).toBe(1);
        advance(29_999);
        expect(await c.get('a', 30_000, load)).toBe(1);
        advance(2);
        expect(await c.get('a', 30_000, load)).toBe(2);
        expect(c.stats()).toMatchObject({ hits: 2, misses: 2 });
    });

    it('mil pedidos a la vez de la misma clave arman UNA vez (single-flight)', async () => {
        const { c } = cache();
        let calls = 0;
        const load = async () => {
            calls += 1;
            await tick(20);
            return { page: 'html' };
        };
        const out = await Promise.all(Array.from({ length: 1000 }, () => c.get('form:x', 30_000, load)));
        expect(calls).toBe(1);
        expect(new Set(out).size).toBe(1);
        expect(c.stats().coalesced).toBe(999);
    });

    it('lo que no existe se recuerda menos tiempo', async () => {
        const { c, advance } = cache();
        let calls = 0;
        const load = async () => {
            calls += 1;
            return null;
        };
        await c.get('form:nada', 30_000, load, 5_000);
        await c.get('form:nada', 30_000, load, 5_000);
        expect(calls).toBe(1);
        advance(5_001);
        await c.get('form:nada', 30_000, load, 5_000);
        expect(calls).toBe(2);
    });

    it('invalidar borra lo guardado y un armado en curso NO guarda un resultado viejo', async () => {
        const { c } = cache();
        let version = 1;
        let release: (() => void) | null = null;
        const slow = () =>
            new Promise<number>((r) => {
                const v = version;
                release = () => r(v);
            });
        const inFlight = c.get('form:a', 30_000, slow);
        await tick();
        version = 2;
        c.invalidate('form:a'); // alguien guardó mientras se armaba
        release!();
        expect(await inFlight).toBe(1); // quien esperaba recibe lo que se armó…
        expect(await c.get('form:a', 30_000, async () => version)).toBe(2); // …pero no quedó guardado
        c.invalidatePrefix('form:');
        expect(await c.get('form:a', 30_000, async () => 3)).toBe(3);
    });

    it('versiones por espacio: subirla deja viejas todas sus claves sin recorrerlas', () => {
        const { c } = cache();
        expect(c.version('slots:7')).toBe(0);
        c.bump('slots:7');
        c.bump('slots:7');
        expect(c.version('slots:7')).toBe(2);
        expect(c.version('slots:8')).toBe(0);
    });

    it('tope de armados: lo que no entra espera en fila; con la fila llena, «muchas visitas»', async () => {
        const { c } = cache({ concurrency: 2, maxQueue: 2 });
        let active = 0;
        let maxActive = 0;
        const gates: Array<() => void> = [];
        const load = () =>
            new Promise<number>((r) => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                gates.push(() => {
                    active -= 1;
                    r(1);
                });
            });
        const runs = ['a', 'b', 'c', 'd'].map((k) => c.get(k, 1000, load));
        const fifth = c.get('e', 1000, load);
        await expect(fifth).rejects.toBeInstanceOf(PublicBusyError);
        await tick();
        expect(maxActive).toBe(2);
        while (gates.length) {
            gates.shift()!();
            await tick();
        }
        await Promise.all(runs);
        expect(maxActive).toBe(2);
        expect(c.stats()).toMatchObject({ active: 0, queued: 0, busy: 1 });
    });

    it('una espera larga en la fila se rinde (no deja al visitante colgado)', async () => {
        const c = new PublicCache({ maxEntries: 10, concurrency: 1, maxQueue: 5, queueTimeoutMs: 30 });
        let release: (() => void) | null = null;
        const first = c.get('a', 1000, () => new Promise<number>((r) => (release = () => r(1))));
        const second = c.get('b', 1000, async () => 2);
        await expect(second).rejects.toBeInstanceOf(PublicBusyError);
        release!();
        await first;
        expect(await c.get('b', 1000, async () => 2)).toBe(2);
    });

    it('se van las más viejas cuando se llena', async () => {
        const { c } = cache({ maxEntries: 3 });
        for (const k of ['a', 'b', 'c', 'd']) await c.get(k, 30_000, async () => k);
        expect(c.stats().entries).toBe(3);
        let reloaded = false;
        await c.get('a', 30_000, async () => {
            reloaded = true;
            return 'a';
        });
        expect(reloaded).toBe(true);
    });
});

describe('v0.1.352 — respuestas precomprimidas', () => {
    it('brotli y gzip devuelven lo mismo; el hash y el integrity salen del contenido', () => {
        const body = '<!doctype html><p>Hola ñandú</p>'.repeat(200);
        const p = precompress(body);
        expect(brotliDecompressSync(p.br).toString('utf8')).toBe(body);
        expect(gunzipSync(p.gzip).toString('utf8')).toBe(body);
        expect(p.br.length).toBeLessThan(p.raw.length / 10);
        expect(p.etag).toMatch(/^W\/"[A-Za-z0-9_-]{27}"$/);
        expect(precompress(body).etag).toBe(p.etag);
        expect(precompress(body + ' ').etag).not.toBe(p.etag);
    });

    it('la codificación respeta lo que acepta el navegador (y `q=0`)', () => {
        expect(pickEncoding('gzip, deflate, br')).toBe('br');
        expect(pickEncoding('gzip')).toBe('gzip');
        expect(pickEncoding('br;q=0, gzip')).toBe('gzip');
        expect(pickEncoding('identity')).toBeNull();
        expect(pickEncoding(undefined)).toBeNull();
        expect(pickEncoding('*')).toBe('gzip');
    });
});

describe('v0.1.352 — páginas cacheables: el script se autoriza por su hash', () => {
    const sha = (text: string) => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;

    it('formulario: la CSP lleva el hash EXACTO del script en línea y nada de nonce', () => {
        const client = 'console.log("</script><b>x</b>")';
        const html = renderFormPage({ title: 'T', meta: null, token: 'tok', themeCss: '', bodyClasses: [], preloadFont: null, client });
        const inline = /<script>([\s\S]*?)<\/script>\n<\/body>/.exec(html)![1]!;
        expect(inline).toBe(inlineScriptText(client));
        expect(inline).not.toContain('</script');
        const csp = cacheablePageCsp(inlineScriptHash(client), "'self' acme.co", 'turnstile');
        expect(csp).toContain(`script-src '${sha(inline)}' https://challenges.cloudflare.com`);
        expect(csp).not.toContain('nonce-');
        expect(csp).toContain("frame-ancestors 'self' acme.co");
        expect(html).not.toContain('nonce=');
        // Desarrollo: el módulo de vite, permitido por 'self'.
        expect(cacheablePageCsp(null, '*', null, { dev: true })).toContain("script-src 'self'; ");
    });

    it('agenda: el hash de la CSP es el del script que lleva la página', () => {
        const html = renderBookingPage({ title: 'A', boot: { mode: 'book', token: 't', meta: null, manage: null } });
        const inline = /<script>([\s\S]*?)<\/script>\n<\/body>/.exec(html)![1]!;
        expect(bookingClientHash()).toBe(sha(inline));
        expect(html).not.toContain('nonce=');
    });
});
