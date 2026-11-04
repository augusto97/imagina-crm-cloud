import { describe, expect, it } from 'vitest';

import { planImageResize, pickResizedResult, REENCODE_MIN_BYTES, webpName } from './imageResize';

describe('achicar imágenes antes de subirlas', () => {
    it('una foto grande se achica a su lado mayor, sin deformar', () => {
        expect(planImageResize({ width: 4000, height: 3000, type: 'image/jpeg', size: 6_000_000 }, 1920)).toEqual({
            action: 'encode',
            width: 1920,
            height: 1440,
            resized: true,
        });
        expect(planImageResize({ width: 1000, height: 3000, type: 'image/png', size: 900_000 }, 640)).toEqual({
            action: 'encode',
            width: 213,
            height: 640,
            resized: true,
        });
    });

    it('nunca agranda una imagen chica; si pesa poco la deja como está', () => {
        expect(planImageResize({ width: 800, height: 600, type: 'image/jpeg', size: 120_000 }, 1920)).toEqual({ action: 'keep' });
        // Ya es WebP y entra: no hay nada que ganar.
        expect(planImageResize({ width: 800, height: 600, type: 'image/webp', size: 2_000_000 }, 1920)).toEqual({ action: 'keep' });
    });

    it('una imagen que entra pero pesa mucho se re-codifica al mismo tamaño', () => {
        expect(planImageResize({ width: 1200, height: 800, type: 'image/png', size: REENCODE_MIN_BYTES + 1 }, 1920)).toEqual({
            action: 'encode',
            width: 1200,
            height: 800,
            resized: false,
        });
    });

    it('el GIF se sube tal cual (puede ser animado) y el SVG se dibuja al tamaño pedido', () => {
        expect(planImageResize({ width: 4000, height: 4000, type: 'image/gif', size: 5_000_000 }, 640)).toEqual({ action: 'keep' });
        expect(planImageResize({ width: 100, height: 50, type: 'image/svg+xml', size: 2_000 }, 1400)).toEqual({
            action: 'encode',
            width: 1400,
            height: 700,
            resized: true,
        });
    });

    it('si el navegador no sabe WebP, o re-codificar no ayuda, se sube el original', () => {
        expect(pickResizedResult({ size: 1000 }, null, true)).toBe('original');
        expect(pickResizedResult({ size: 1000 }, { size: 400, type: 'image/png' }, true)).toBe('original');
        expect(pickResizedResult({ size: 1000 }, { size: 1200, type: 'image/webp' }, false)).toBe('original');
        expect(pickResizedResult({ size: 1000 }, { size: 400, type: 'image/webp' }, false)).toBe('encoded');
        // Achicada: se usa aunque pese parecido (lo que importa es el tamaño).
        expect(pickResizedResult({ size: 1000 }, { size: 1100, type: 'image/webp' }, true)).toBe('encoded');
    });

    it('el nombre cambia la extensión a .webp', () => {
        expect(webpName('foto.final.JPG')).toBe('foto.final.webp');
        expect(webpName('portada')).toBe('portada.webp');
        expect(webpName('.png')).toBe('imagen.webp');
    });
});
