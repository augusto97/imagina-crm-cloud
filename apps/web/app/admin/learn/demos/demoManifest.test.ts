import { afterEach, describe, expect, it, vi } from 'vitest';

import { frameDuration, loadDemoManifest, panFor, resetDemoManifestCache, zoomFor } from './demoManifest';

const VW = 1100;
const VH = 700;

describe('reproductor de capturas — cámara', () => {
    it('sin algo que tocar no acerca', () => {
        expect(zoomFor(800, VW, undefined)).toBe(1);
        expect(panFor(1, VW, VH, undefined)).toEqual({ x: 0, y: 0 });
    });

    it('acerca más cuanto más chico es el espacio (el texto tiene que leerse)', () => {
        const t = { x: 500, y: 300, w: 120, h: 30 };
        const wide = zoomFor(1000, VW, t);
        const phone = zoomFor(360, VW, t);
        expect(phone).toBeGreaterThan(wide);
        expect(wide).toBeGreaterThanOrEqual(1);
    });

    it('un objetivo grande no se acerca tanto que no entre', () => {
        const big = { x: 100, y: 100, w: 800, h: 400 };
        expect(zoomFor(360, VW, big)).toBe(1);
    });

    it('centra lo que se toca sin mostrar bordes vacíos', () => {
        const z = 1.5;
        const center = panFor(z, VW, VH, { x: 500, y: 300, w: 100, h: 40 });
        // El centro del objetivo queda en el centro de la vista acercada.
        expect(center.x + VW / (2 * z)).toBeCloseTo(550, 5);
        expect(center.y + VH / (2 * z)).toBeCloseTo(320, 5);
        // En una esquina, se pega al borde en vez de salirse.
        const corner = panFor(z, VW, VH, { x: 0, y: 0, w: 20, h: 20 });
        expect(corner).toEqual({ x: 0, y: 0 });
        const far = panFor(z, VW, VH, { x: 1080, y: 680, w: 20, h: 20 });
        expect(far.x).toBeCloseTo((VW * (z - 1)) / z, 5);
        expect(far.y).toBeCloseTo((VH * (z - 1)) / z, 5);
    });

    it('lo que se escribe y los textos largos se quedan más tiempo en pantalla', () => {
        const base = frameDuration({ src: 'a', caption: 'Corto', action: 'click' });
        const typing = frameDuration({ src: 'a', caption: 'Corto', action: 'type', text: 'Un texto largo que se escribe' });
        const long = frameDuration({ src: 'a', caption: 'x'.repeat(200), action: 'click' });
        expect(typing).toBeGreaterThan(base);
        expect(long).toBeGreaterThan(base);
    });
});

describe('reproductor de capturas — índice', () => {
    afterEach(() => {
        resetDemoManifestCache();
        vi.unstubAllGlobals();
    });

    it('si el servidor no tiene capturas (o devuelve la app en vez del índice), no hay demo', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })));
        expect(await loadDemoManifest()).toBeNull();
        resetDemoManifestCache();
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
        expect(await loadDemoManifest()).toBeNull();
    });

    it('lee el índice una sola vez', async () => {
        const body = { viewport: { width: VW, height: VH }, demos: { a: { title: 'A', frames: [] } } };
        const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', f);
        const [m1, m2] = await Promise.all([loadDemoManifest(), loadDemoManifest()]);
        expect(m1?.demos.a?.title).toBe('A');
        expect(m2).toBe(m1);
        expect(f).toHaveBeenCalledTimes(1);
    });
});
