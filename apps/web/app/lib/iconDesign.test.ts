import { describe, expect, it } from 'vitest';

import {
    alphaBox,
    analyzeArtwork,
    artScaleFactor,
    contentRadius,
    extractLightMark,
    gradientLine,
    iconLayout,
    isWideArt,
    lowContrastWhiteArt,
    suggestIconDesign,
    whiteSilhouette,
    type RgbaImage,
} from './iconDesign';

const S = 128;

function blank(w = S, h = S): RgbaImage {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}

function paint(img: RgbaImage, test: (x: number, y: number) => [number, number, number, number] | null): RgbaImage {
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            const c = test(x + 0.5, y + 0.5);
            if (!c) continue;
            const i = (y * img.width + x) * 4;
            img.data[i] = c[0];
            img.data[i + 1] = c[1];
            img.data[i + 2] = c[2];
            img.data[i + 3] = c[3];
        }
    }
    return img;
}

/** Un emblema redondo azul→cian (izquierda a derecha) con un triángulo blanco adentro, como el logo del usuario. */
function emblem(): RgbaImage {
    const c = S / 2;
    return paint(blank(), (x, y) => {
        const d = Math.hypot(x - c, y - c);
        if (d > c - 1) return null;
        const inTriangle = y > 30 && y < 100 && Math.abs(x - c) < (y - 30) * 0.5;
        if (inTriangle) return [255, 255, 255, 255];
        const t = x / S;
        return [Math.round(10 + 10 * t), Math.round(150 + 70 * t), Math.round(215 - 5 * t), 255];
    });
}

describe('v0.1.343 — el ícono de app desde el logo', () => {
    it('reconoce un emblema redondo con una marca blanca y sugiere fondo con sus colores + la marca en blanco', () => {
        const a = analyzeArtwork(emblem());
        expect(a.shape).toBe('round');
        expect(a.hasLightMark).toBe(true);
        expect(a.tone).toBe('color');
        // El degradado va hacia la derecha (de azul a cian), como en el emblema.
        expect(a.palette).not.toBeNull();
        expect(Math.abs(((a.palette!.angle + 180) % 360) - 180)).toBeLessThan(25);
        const d = suggestIconDesign(a);
        expect(d.art).toBe('mark');
        expect(d.bg_to).not.toBeNull();
        expect(d.splash).toBe('app');
    });

    it('separa la marca: el blanco queda opaco, el fondo de color transparente y el borde del emblema se descarta', () => {
        const img = emblem();
        const a = analyzeArtwork(img);
        const mark = extractLightMark(img, a);
        const at = (x: number, y: number): [number, number] => {
            const i = (y * S + x) * 4;
            return [mark.data[i]!, mark.data[i + 3]!];
        };
        expect(at(64, 80)).toEqual([255, 255]); // dentro del triángulo
        expect(at(20, 64)[1]).toBe(0); // fondo azul
        expect(at(2, 2)[1]).toBe(0); // fuera del emblema
        // Un píxel mitad blanco (borde suave del dibujo) queda semitransparente, no se pierde.
        const half = blank(2, 1);
        half.data.set([10, 150, 215, 255, 133, 200, 235, 255]);
        const out = extractLightMark(half, { ...a, shape: 'free', bbox: { x: 0, y: 0, w: 2, h: 1 } });
        expect(out.data[3]).toBe(0);
        expect(out.data[7]).toBeGreaterThan(80);
        expect(out.data[7]).toBeLessThan(255);
    });

    it('un símbolo de un color sobre transparente: la silueta en blanco sobre ese color', () => {
        const img = paint(blank(), (x, y) => (Math.abs(x - 64) < 40 && Math.abs(y - 64) < 22 ? [200, 40, 60, 255] : null));
        const a = analyzeArtwork(img);
        expect(a.shape).toBe('free');
        expect(a.tone).toBe('color');
        const d = suggestIconDesign(a);
        expect(d.art).toBe('white');
        expect(d.bg_from).not.toBe('#ffffff');
        const white = whiteSilhouette(img);
        const i = (64 * S + 64) * 4;
        expect([white.data[i], white.data[i + 1], white.data[i + 2], white.data[i + 3]]).toEqual([255, 255, 255, 255]);
    });

    it('un símbolo negro va sobre blanco y uno blanco (para fondos oscuros) sobre casi negro', () => {
        const black = analyzeArtwork(paint(blank(), (x, y) => (Math.hypot(x - 64, y - 64) < 30 && x > 50 ? [10, 10, 12, 255] : null)));
        expect(black.tone).toBe('dark');
        expect(suggestIconDesign(black)).toMatchObject({ art: 'logo', bg_from: '#ffffff', bg_to: null });
        const light = analyzeArtwork(paint(blank(), (x, y) => (Math.abs(x - 64) < 20 && Math.abs(y - 64) < 40 ? [250, 250, 250, 255] : null)));
        expect(light.tone).toBe('light');
        const d = suggestIconDesign(light);
        expect(d.art).toBe('logo');
        expect(d.bg_from).toBe('#2a2a2e');
    });

    it('una imagen vacía no rompe: logo sobre blanco', () => {
        const a = analyzeArtwork(blank());
        expect(a.tone).toBe('empty');
        expect(suggestIconDesign(a).bg_from).toBe('#ffffff');
    });

    it('caja y radio del dibujo: el radio mide hasta la esquina más lejana', () => {
        const img = paint(blank(), (x, y) => (x >= 34 && x < 94 && y >= 54 && y < 74 ? [0, 0, 0, 255] : null));
        expect(alphaBox(img)).toEqual({ x: 34, y: 54, w: 60, h: 20 });
        const r = contentRadius(img, { x: 34, y: 54, w: 60, h: 20 });
        expect(r).toBeGreaterThan(30);
        expect(r).toBeLessThan(Math.hypot(30, 10) + 1);
    });

    it('el dibujo entra en el círculo que ve Android (2/3 del ancho) con aire alrededor', () => {
        const layout = iconLayout('mask', 512);
        expect(layout.corner).toBe(0);
        expect(layout.artRadius).toBeLessThan(512 / 3);
        const f = artScaleFactor(layout, { box: { x: 0, y: 0, w: 100, h: 100 }, radius: 70, shape: 'free', kind: 'white' });
        expect(70 * f).toBeCloseTo(layout.artRadius, 5);
        // El logo completo de un emblema se agranda hasta cubrir lo que ve el teléfono.
        const cover = artScaleFactor(layout, { box: { x: 0, y: 0, w: 200, h: 200 }, radius: 141, shape: 'round', kind: 'logo' });
        expect(100 * cover).toBeGreaterThan(512 / 3);
        // Computador: baldosa redondeada con margen; pestaña: el dibujo más grande.
        const tile = iconLayout('tile', 512);
        expect(tile.tile.x).toBeGreaterThan(0);
        expect(tile.corner).toBeGreaterThan(0);
        expect(iconLayout('favicon', 32).artRadius / 32).toBeGreaterThan(layout.artRadius / 512);
    });

    it('el degradado cubre todo el cuadrado en cualquier dirección', () => {
        const right = gradientLine(100, 0);
        expect(right).toMatchObject({ x0: 0, y0: 50, x1: 100, y1: 50 });
        const diag = gradientLine(100, 45);
        expect(diag.x0).toBeCloseTo(0);
        expect(diag.y1).toBeCloseTo(100);
    });

    it('avisa cuando el dibujo blanco no contrasta y cuando el logo es alargado', () => {
        expect(lowContrastWhiteArt({ art: 'white', bg_from: '#f8f8f8', bg_to: null, bg_angle: 0, scale: 1, splash: 'app' })).toBe(true);
        expect(lowContrastWhiteArt({ art: 'mark', bg_from: '#0090c0', bg_to: '#00d0d0', bg_angle: 0, scale: 1, splash: 'app' })).toBe(false);
        expect(lowContrastWhiteArt({ art: 'logo', bg_from: '#ffffff', bg_to: null, bg_angle: 0, scale: 1, splash: 'app' })).toBe(false);
        const wide = analyzeArtwork(paint(blank(), (_x, y) => (y > 54 && y < 74 ? [0, 0, 0, 255] : null)));
        expect(isWideArt(wide)).toBe(true);
        expect(isWideArt(analyzeArtwork(emblem()))).toBe(false);
    });
});
