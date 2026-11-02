import { ICON_SCALE_MAX, ICON_SCALE_MIN, iconDesignSchema, type IconArtKind, type IconDesign } from '@imagina-base/shared';

/**
 * v0.1.343 — Las cuentas del «estudio del ícono» (Plataforma → Marca), sin
 * canvas: trabajan sobre los píxeles (RGBA) para poder probarlas en Node.
 *
 * La idea de fondo: un ícono de app no es un logo pegado sobre un plato
 * blanco. El fondo va de borde a borde (el teléfono lo recorta en círculo,
 * gota o cuadrado redondeado) y el dibujo, centrado dentro de la zona que
 * ningún teléfono corta. Un logo que ya es un emblema (un círculo o un
 * cuadrado de color con un dibujo blanco adentro) se separa en sus dos capas:
 * su color pasa a ser el fondo del ícono y su parte blanca, el dibujo.
 */

export interface RgbaImage {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type ArtShape = 'round' | 'square' | 'free';
export type ArtTone = 'color' | 'dark' | 'light' | 'multi' | 'empty';

export interface IconBackgroundSuggestion {
    from: string;
    to: string | null;
    angle: number;
}

export interface ArtworkAnalysis {
    /** Emblema redondo, emblema cuadrado o un dibujo libre (símbolo con transparencia). */
    shape: ArtShape;
    /** Caja de lo que no es transparente. */
    bbox: Box;
    /** Ancho / alto de esa caja. */
    aspect: number;
    /** Parte casi blanca, oscura y de color de lo opaco (0–1). */
    lightRatio: number;
    darkRatio: number;
    coloredRatio: number;
    tone: ArtTone;
    /** Fondo sugerido con los colores del propio logo (null si no tiene color). */
    palette: IconBackgroundSuggestion | null;
    /** Un emblema con un dibujo claro adentro: se puede separar en fondo + marca. */
    hasLightMark: boolean;
    /** El canal mínimo típico del fondo de color del emblema (para separar la marca). */
    backgroundMin: number;
}

const ALPHA_EDGE = 24;
/** Hasta dónde del radio del emblema se toma la marca: el borde suele traer un brillo o un bisel. */
const EMBLEM_TRIM = 0.95;
const OPAQUE = 200;

// ─── Colores ────────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    const n = m ? parseInt(m[1]!, 16) : 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
    const c = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}

/** Aclara (amount > 0) u oscurece (amount < 0) un color mezclándolo con blanco o negro. */
export function shade(hex: string, amount: number): string {
    const [r, g, b] = hexToRgb(hex);
    const t = Math.max(-1, Math.min(1, amount));
    const target = t > 0 ? 255 : 0;
    const k = Math.abs(t);
    return rgbToHex(r + (target - r) * k, g + (target - g) * k, b + (target - b) * k);
}

/** Luminancia relativa (WCAG), 0–1. */
export function luminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ─── Geometría ──────────────────────────────────────────────────────────────

/** La caja de lo que no es transparente (null si la imagen está vacía). */
export function alphaBox(img: RgbaImage, threshold = ALPHA_EDGE): Box | null {
    const { data, width, height } = img;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3]! > threshold) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Qué tan lejos del centro de la caja llega el dibujo (en píxeles): para que
 * entre en el círculo que ve el teléfono no alcanza con la caja (un dibujo
 * cuadrado tiene las esquinas más lejos que los lados).
 */
export function contentRadius(img: RgbaImage, box: Box, threshold = 40): number {
    const { data, width } = img;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    let best = 0;
    for (let y = box.y; y < box.y + box.h; y++) {
        for (let x = box.x; x < box.x + box.w; x++) {
            if (data[(y * width + x) * 4 + 3]! > threshold) {
                const dx = x + 0.5 - cx;
                const dy = y + 0.5 - cy;
                const d = dx * dx + dy * dy;
                if (d > best) best = d;
            }
        }
    }
    return Math.max(1, Math.sqrt(best));
}

/**
 * Los extremos de un degradado que cubre un cuadrado de lado `size` en la
 * dirección `angle` (0 = a la derecha, 90 = hacia abajo).
 */
export function gradientLine(size: number, angle: number): { x0: number; y0: number; x1: number; y1: number } {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const half = (size / 2) * (Math.abs(cos) + Math.abs(sin));
    const c = size / 2;
    return { x0: c - cos * half, y0: c - sin * half, x1: c + cos * half, y1: c + sin * half };
}

/**
 * Dónde va el ícono en cada uso:
 *  - `mask`: Android (maskable). Fondo de borde a borde; el dibujo entra en
 *    un círculo de radio 0,27 del lado: el teléfono que más recorta muestra
 *    un círculo de 2/3 del ancho (radio 0,33).
 *  - `apple`: iPhone. Fondo de borde a borde; iOS redondea las esquinas.
 *  - `tile`: computador (Windows, Mac) y respaldo: un cuadrado redondeado con
 *    las esquinas transparentes y un margen.
 *  - `favicon`: la pestaña del navegador (el dibujo un poco más grande, se
 *    ve a 16 px).
 */
export type IconUse = 'mask' | 'apple' | 'tile' | 'favicon';

/** Radio del dibujo en el ícono de Android (fracción del lado): deja aire dentro del círculo de 2/3. */
const MASK_ART = 0.27;

export interface IconLayout {
    /** El cuadrado del fondo (la baldosa). */
    tile: Box;
    /** Radio de las esquinas del fondo (0 = de borde a borde, sin redondear). */
    corner: number;
    /** Radio del círculo donde entra el dibujo, en píxeles del ícono. */
    artRadius: number;
}

export function iconLayout(use: IconUse, size: number, scale = 1): IconLayout {
    const s = Math.max(ICON_SCALE_MIN, Math.min(ICON_SCALE_MAX, scale));
    if (use === 'mask') return { tile: { x: 0, y: 0, w: size, h: size }, corner: 0, artRadius: size * MASK_ART * s };
    if (use === 'apple') return { tile: { x: 0, y: 0, w: size, h: size }, corner: 0, artRadius: size * 0.31 * s };
    if (use === 'favicon') return { tile: { x: 0, y: 0, w: size, h: size }, corner: size * 0.22, artRadius: size * 0.37 * s };
    const margin = Math.round(size * 0.04);
    const side = size - margin * 2;
    return { tile: { x: margin, y: margin, w: side, h: side }, corner: side * 0.225, artRadius: side * 0.29 * s };
}

/**
 * Cuánto hay que agrandar el dibujo (en píxeles de origen) para que entre en
 * el círculo del ícono. Un emblema con su logo completo (`cover`) se agranda
 * hasta cubrir lo que ve el teléfono: así no queda un anillo del fondo
 * alrededor del emblema.
 */
export function artScaleFactor(
    layout: IconLayout,
    art: { box: Box; radius: number; shape: ArtShape; kind: IconArtKind },
): number {
    const cover = art.kind === 'logo' && art.shape !== 'free';
    if (cover) {
        const emblemRadius = Math.min(art.box.w, art.box.h) / 2;
        // El emblema cubre lo que ve el teléfono (radio 0,42 del lado con el tamaño sugerido).
        const target = layout.tile.w * 0.42 * (layout.artRadius / (layout.tile.w * MASK_ART));
        return target / emblemRadius;
    }
    return layout.artRadius / art.radius;
}

// ─── Análisis ───────────────────────────────────────────────────────────────

interface Sample {
    r: number;
    g: number;
    b: number;
    x: number;
    y: number;
}

function hueOf(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return ((h * 60) + 360) % 360;
}

/** Separa los píxeles de color en dos grupos a lo largo de su eje principal (un 2-means bien arrancado). */
function splitColors(samples: Sample[]): { a: Sample[]; b: Sample[] } {
    const n = samples.length;
    let mr = 0;
    let mg = 0;
    let mb = 0;
    for (const s of samples) {
        mr += s.r;
        mg += s.g;
        mb += s.b;
    }
    mr /= n;
    mg /= n;
    mb /= n;
    // Covarianza 3×3 y eje principal por iteración de potencia.
    const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const s of samples) {
        const d = [s.r - mr, s.g - mg, s.b - mb];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i * 3 + j]! += d[i]! * d[j]!;
    }
    let v = [1, 1, 1];
    for (let it = 0; it < 16; it++) {
        const nv = [0, 1, 2].map((i) => c[i * 3]! * v[0]! + c[i * 3 + 1]! * v[1]! + c[i * 3 + 2]! * v[2]!);
        const len = Math.hypot(nv[0]!, nv[1]!, nv[2]!) || 1;
        v = nv.map((x) => x / len);
    }
    const proj = samples.map((s) => (s.r - mr) * v[0]! + (s.g - mg) * v[1]! + (s.b - mb) * v[2]!);
    const sorted = [...proj].sort((x, y) => x - y);
    const median = sorted[Math.floor(n / 2)] ?? 0;
    const a: Sample[] = [];
    const b: Sample[] = [];
    samples.forEach((s, i) => ((proj[i]! < median ? a : b) as Sample[]).push(s));
    return { a, b };
}

function meanOf(list: Sample[]): Sample {
    const n = Math.max(1, list.length);
    const out = { r: 0, g: 0, b: 0, x: 0, y: 0 };
    for (const s of list) {
        out.r += s.r;
        out.g += s.g;
        out.b += s.b;
        out.x += s.x;
        out.y += s.y;
    }
    return { r: out.r / n, g: out.g / n, b: out.b / n, x: out.x / n, y: out.y / n };
}

/** Un color un poco más lejos del otro (los promedios lavan los extremos del degradado). */
function pushAway(from: Sample, other: Sample, k: number): string {
    return rgbToHex(from.r + (from.r - other.r) * k, from.g + (from.g - other.g) * k, from.b + (from.b - other.b) * k);
}

export function analyzeArtwork(img: RgbaImage): ArtworkAnalysis {
    const box = alphaBox(img);
    if (!box) {
        return {
            shape: 'free',
            bbox: { x: 0, y: 0, w: img.width, h: img.height },
            aspect: 1,
            lightRatio: 0,
            darkRatio: 0,
            coloredRatio: 0,
            tone: 'empty',
            palette: null,
            hasLightMark: false,
            backgroundMin: 0,
        };
    }
    const { data, width } = img;
    const step = Math.max(1, Math.floor(Math.sqrt((box.w * box.h) / 120_000)));
    let total = 0;
    let filled = 0;
    let opaque = 0;
    let light = 0;
    let dark = 0;
    const colored: Sample[] = [];
    const bgMins: number[] = [];
    const hues = new Array<number>(12).fill(0);
    for (let y = box.y; y < box.y + box.h; y += step) {
        for (let x = box.x; x < box.x + box.w; x += step) {
            const i = (y * width + x) * 4;
            const a = data[i + 3]!;
            total++;
            if (a >= 128) filled++;
            if (a < OPAQUE) continue;
            opaque++;
            const r = data[i]!;
            const g = data[i + 1]!;
            const b = data[i + 2]!;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const sat = max === 0 ? 0 : (max - min) / max;
            if (min >= 215 && max - min <= 32) {
                light++;
            } else if (max <= 72) {
                dark++;
                bgMins.push(min);
            } else if (sat >= 0.22) {
                colored.push({ r, g, b, x, y });
                bgMins.push(min);
                hues[Math.floor(hueOf(r, g, b) / 30) % 12]!++;
            }
        }
    }
    const share = (n: number): number => (opaque > 0 ? n / opaque : 0);
    const lightRatio = share(light);
    const darkRatio = share(dark);
    const coloredRatio = share(colored.length);
    const fill = total > 0 ? filled / total : 0;
    const aspect = box.w / box.h;

    // Forma: el anillo justo por dentro del borde y las esquinas.
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const r = Math.min(box.w, box.h) / 2;
    const alphaAt = (x: number, y: number): number => {
        const xi = Math.max(0, Math.min(img.width - 1, Math.round(x)));
        const yi = Math.max(0, Math.min(img.height - 1, Math.round(y)));
        return data[(yi * width + xi) * 4 + 3]! / 255;
    };
    let ring = 0;
    const N = 48;
    for (let k = 0; k < N; k++) {
        const t = (k / N) * Math.PI * 2;
        if (alphaAt(cx + Math.cos(t) * r * 0.9, cy + Math.sin(t) * r * 0.9) > 0.78) ring++;
    }
    const ringShare = ring / N;
    const patch = Math.max(1, Math.round(Math.min(box.w, box.h) * 0.07));
    let cornerSum = 0;
    let cornerN = 0;
    for (const [px, py] of [
        [box.x, box.y],
        [box.x + box.w - patch, box.y],
        [box.x, box.y + box.h - patch],
        [box.x + box.w - patch, box.y + box.h - patch],
    ] as const) {
        for (let y = py; y < py + patch; y++) {
            for (let x = px; x < px + patch; x++) {
                cornerSum += alphaAt(x, y);
                cornerN++;
            }
        }
    }
    const corners = cornerN > 0 ? cornerSum / cornerN : 0;
    const squareish = aspect >= 0.9 && aspect <= 1.11;
    let shape: ArtShape = 'free';
    if (squareish && corners < 0.2 && ringShare >= 0.9 && fill >= 0.7 && fill <= 0.88) shape = 'round';
    else if (aspect >= 0.8 && aspect <= 1.25 && corners > 0.85 && fill > 0.9) shape = 'square';

    // Tono.
    const bigHues = hues.filter((h) => colored.length > 0 && h / colored.length >= 0.15).length;
    let tone: ArtTone;
    if (opaque === 0) tone = 'empty';
    else if (coloredRatio >= 0.2) tone = bigHues >= 3 ? 'multi' : 'color';
    else if (darkRatio >= lightRatio && darkRatio >= 0.3) tone = 'dark';
    else if (lightRatio >= 0.5) tone = 'light';
    else tone = coloredRatio >= 0.08 ? 'color' : 'dark';

    // Paleta: dos grupos de color y hacia dónde va cada uno en la imagen.
    let palette: IconBackgroundSuggestion | null = null;
    if (colored.length >= 40 && tone !== 'multi') {
        const { a, b } = splitColors(colored);
        const ma = meanOf(a);
        const mb = meanOf(b);
        const dist = Math.hypot(ma.r - mb.r, ma.g - mb.g, ma.b - mb.b);
        const all = meanOf(colored);
        if (dist < 30) {
            const base = rgbToHex(all.r, all.g, all.b);
            palette = { from: shade(base, 0.1), to: shade(base, -0.14), angle: 45 };
        } else {
            const dx = mb.x - ma.x;
            const dy = mb.y - ma.y;
            const near = Math.hypot(dx, dy) < Math.min(box.w, box.h) * 0.03;
            const angle = near ? 45 : Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
            palette = { from: pushAway(ma, mb, 0.2), to: pushAway(mb, ma, 0.2), angle };
        }
    }

    bgMins.sort((x, y) => x - y);
    const backgroundMin = bgMins.length > 0 ? bgMins[Math.floor(bgMins.length * 0.6)]! : 0;
    const hasLightMark =
        shape !== 'free' && lightRatio >= 0.04 && lightRatio <= 0.7 && coloredRatio + darkRatio >= 0.25 && backgroundMin < 170;

    return { shape, bbox: box, aspect, lightRatio, darkRatio, coloredRatio, tone, palette, hasLightMark, backgroundMin };
}

// ─── El dibujo ──────────────────────────────────────────────────────────────

/**
 * La parte clara de un emblema como dibujo blanco con transparencia. Cada
 * píxel se lee como una mezcla del fondo de color y blanco (el canal más
 * bajo dice cuánto blanco tiene), así los bordes suaves se conservan. El
 * borde del emblema (donde suele haber un brillo o un bisel) se descarta.
 */
export function extractLightMark(img: RgbaImage, analysis: ArtworkAnalysis): RgbaImage {
    const { width, height, data } = img;
    const out = new Uint8ClampedArray(data.length);
    const m0 = Math.min(150, analysis.backgroundMin);
    // Desde este gris la marca ya es opaca: los logos con brillo o sombreado
    // (un blanco que baja a gris claro) no dejan franjas translúcidas.
    const hi = Math.max(m0 + 40, 196);
    const box = analysis.bbox;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const r = Math.min(box.w, box.h) / 2;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const a = data[i + 3]! / 255;
            if (a === 0) continue;
            const mn = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
            const t = Math.max(0, Math.min(1, (mn - m0) / (hi - m0)));
            if (t === 0) continue;
            let edge = 1;
            if (analysis.shape === 'round') {
                // Corte limpio (1 px de suavizado): un borde difuso se nota como un halo.
                const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
                edge = Math.max(0, Math.min(1, (r * EMBLEM_TRIM - d) / 1.2));
            } else if (analysis.shape === 'square') {
                const inset = Math.min(x - box.x, y - box.y, box.x + box.w - 1 - x, box.y + box.h - 1 - y);
                edge = Math.max(0, Math.min(1, (inset - Math.min(box.w, box.h) * (1 - EMBLEM_TRIM) * 0.5) / 1.2));
            }
            const alpha = a * t * edge;
            if (alpha <= 0) continue;
            out[i] = 255;
            out[i + 1] = 255;
            out[i + 2] = 255;
            out[i + 3] = Math.round(alpha * 255);
        }
    }
    return { data: out, width, height };
}

/** La silueta del logo en blanco (conserva la transparencia). */
export function whiteSilhouette(img: RgbaImage): RgbaImage {
    const out = new Uint8ClampedArray(img.data.length);
    for (let i = 0; i < img.data.length; i += 4) {
        const a = img.data[i + 3]!;
        if (a === 0) continue;
        out[i] = 255;
        out[i + 1] = 255;
        out[i + 2] = 255;
        out[i + 3] = a;
    }
    return { data: out, width: img.width, height: img.height };
}

/** El dibujo que va en el ícono según lo elegido. */
export function artPixels(img: RgbaImage, kind: IconArtKind, analysis: ArtworkAnalysis): RgbaImage {
    if (kind === 'mark') return extractLightMark(img, analysis);
    if (kind === 'white') return whiteSilhouette(img);
    return img;
}

// ─── La sugerencia ──────────────────────────────────────────────────────────

const WHITE = '#ffffff';
const INK = { from: '#2a2a2e', to: '#0c0c0e' };

/**
 * El ícono que sugiere la app para un logo:
 *  - emblema con dibujo claro → fondo con los colores del emblema y la marca en blanco;
 *  - emblema sin dibujo claro → el emblema completo, agrandado hasta cubrir;
 *  - símbolo de un color → la silueta en blanco sobre ese color;
 *  - símbolo negro o de varios colores → sobre blanco;
 *  - símbolo blanco (para fondos oscuros) → sobre casi negro.
 */
export function suggestIconDesign(a: ArtworkAnalysis): IconDesign {
    const base = iconDesignSchema.parse({});
    const grad = (p: IconBackgroundSuggestion | null, fallback: { from: string; to: string | null; angle?: number }) => ({
        bg_from: p?.from ?? fallback.from,
        bg_to: p ? p.to : fallback.to,
        bg_angle: p?.angle ?? fallback.angle ?? 45,
    });
    if (a.tone === 'empty') return { ...base, art: 'logo', bg_from: WHITE, bg_to: null };
    if (a.shape !== 'free') {
        if (a.hasLightMark && a.palette) return { ...base, art: 'mark', ...grad(a.palette, INK) };
        if (a.tone === 'dark' && !a.palette) return { ...base, art: a.hasLightMark ? 'mark' : 'logo', ...grad(null, { ...INK, angle: 90 }) };
        return { ...base, art: 'logo', ...grad(a.palette, { from: WHITE, to: null }) };
    }
    if (a.tone === 'color' && a.palette) return { ...base, art: 'white', ...grad(a.palette, INK) };
    if (a.tone === 'light') return { ...base, art: 'logo', ...grad(null, { ...INK, angle: 90 }) };
    return { ...base, art: 'logo', bg_from: WHITE, bg_to: null, bg_angle: 45 };
}

/** El dibujo blanco no se lee sobre un fondo claro: avisarlo en la pantalla. */
export function lowContrastWhiteArt(design: IconDesign): boolean {
    if (design.art === 'logo') return false;
    const lFrom = luminance(design.bg_from);
    const lTo = design.bg_to ? luminance(design.bg_to) : lFrom;
    return (lFrom + lTo) / 2 > 0.6;
}

/** ¿Es un logo apaisado? Dentro de un cuadrado se ve chico. */
export function isWideArt(a: ArtworkAnalysis): boolean {
    return a.aspect > 1.8 || a.aspect < 0.55;
}
