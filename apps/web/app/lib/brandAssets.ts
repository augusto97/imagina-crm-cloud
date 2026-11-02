import { iconDesignBackground, PLATFORM_ICON_SIZES, type IconArtKind, type IconDesign, type PlatformIconKey } from '@imagina-base/shared';

import {
    alphaBox,
    analyzeArtwork,
    artPixels,
    artScaleFactor,
    contentRadius,
    gradientLine,
    iconLayout,
    type ArtShape,
    type ArtworkAnalysis,
    type Box,
    type IconUse,
    type RgbaImage,
} from './iconDesign';

/**
 * v0.1.327 — Convierte el logo o el ícono que sube el operador (Plataforma →
 * Marca) en los PNG que necesitan el login, la pestaña y el teléfono. Se hace
 * en el NAVEGADOR con un canvas: el servidor no necesita una librería de
 * imágenes nativa y sólo recibe PNG (que reconoce por sus bytes). Un SVG se
 * dibuja desde un `<img>`, que no ejecuta scripts.
 */

/** Rectángulo donde se dibuja la imagen, centrada y sin deformarla. */
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Encaja una imagen de `srcW × srcH` dentro de una caja de `boxW × boxH`
 * dejando `padding` (fracción del lado menor de la caja) libre en cada borde.
 */
export function fitRect(srcW: number, srcH: number, boxW: number, boxH: number, padding = 0): Rect {
    const pad = Math.max(0, Math.min(padding, 0.45)) * Math.min(boxW, boxH);
    const availW = boxW - pad * 2;
    const availH = boxH - pad * 2;
    const scale = Math.min(availW / srcW, availH / srcH);
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);
    return { x: Math.round((boxW - w) / 2), y: Math.round((boxH - h) / 2), w, h };
}

/**
 * Margen de cada tamaño del ícono. Los "maskable" (Android recorta en
 * círculo, gota o cuadrado) llevan fondo y el dibujo dentro de la zona
 * segura (el 80 % central; dejamos un poco más). El de Apple también lleva
 * fondo: iOS pinta de negro lo transparente.
 */
export function iconPadding(key: PlatformIconKey): number {
    if (key === 'favicon_32') return 0;
    if (key === 'apple_180') return 0.14;
    return PLATFORM_ICON_SIZES[key].maskable ? 0.2 : 0.06;
}

/**
 * Tamaño del logo que se guarda. v0.1.328: hasta 512 de alto (antes 160) para
 * que un isotipo también sirva de ícono del teléfono sin verse borroso.
 */
export function logoCanvasSize(srcW: number, srcH: number): { w: number; h: number } {
    const maxH = 512;
    const maxW = 1280;
    const scale = Math.min(maxH / srcH, maxW / srcW, 4);
    return { w: Math.max(1, Math.round(srcW * scale)), h: Math.max(1, Math.round(srcH * scale)) };
}

/** Carga un archivo de imagen (PNG, JPG, WebP, GIF o SVG). */
export function loadImageFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            // Algunos SVG no declaran ancho/alto: sin tamaño propio se dibujan a 512.
            if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                img.width = 512;
                img.height = 512;
            }
            resolve(img);
            URL.revokeObjectURL(url);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('No pudimos leer esa imagen. Prueba con un PNG, JPG o SVG.'));
        };
        img.src = url;
    });
}

/** Carga una imagen de la propia app (mismo origen: el canvas no queda "contaminado"). */
export function loadImageUrl(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No pudimos leer el ícono guardado. Súbelo de nuevo.'));
        img.src = url;
    });
}

function sizeOf(img: HTMLImageElement): { w: number; h: number } {
    return { w: img.naturalWidth || img.width || 512, h: img.naturalHeight || img.height || 512 };
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen'))), 'image/png');
    });
}

function draw(img: HTMLImageElement | HTMLCanvasElement, w: number, h: number, rect: Rect, background: string | null): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Tu navegador no permite generar imágenes');
    if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    return canvas;
}

/** El logo como PNG (fondo transparente, sin recortar). */
export function renderLogoPng(img: HTMLImageElement): Promise<Blob> {
    const src = sizeOf(img);
    const { w, h } = logoCanvasSize(src.w, src.h);
    return canvasToPng(draw(img, w, h, { x: 0, y: 0, w, h }, null));
}

/** Un tamaño del ícono (el estilo de antes: el logo sobre un fondo liso). */
export function renderIconCanvas(img: HTMLImageElement | HTMLCanvasElement, key: PlatformIconKey, background: string): HTMLCanvasElement {
    const spec = PLATFORM_ICON_SIZES[key];
    const src = img instanceof HTMLCanvasElement ? { w: img.width, h: img.height } : sizeOf(img);
    const rect = fitRect(src.w, src.h, spec.size, spec.size, iconPadding(key));
    // Con fondo todos salvo el de la pestaña (que queda transparente, como
    // cualquier favicon): un ícono transparente en el inicio del teléfono o
    // en el escritorio queda "flotando" y se lee peor.
    const withBg = key === 'favicon_32' ? null : background;
    return draw(img, spec.size, spec.size, rect, withBg);
}

/** Un tamaño del ícono como PNG. */
export function renderIconPng(img: HTMLImageElement, key: PlatformIconKey, background: string): Promise<Blob> {
    return canvasToPng(renderIconCanvas(img, key, background));
}

/** El ícono original: 512 × 512, transparente y sin margen (de él salen los tamaños). */
export function renderIconSourcePng(img: HTMLImageElement): Promise<Blob> {
    const src = sizeOf(img);
    const rect = fitRect(src.w, src.h, 512, 512, 0);
    return canvasToPng(draw(img, 512, 512, rect, null));
}

// ─── v0.1.343 — El ícono diseñado ───────────────────────────────────────────

/** Los píxeles del ícono original a 512 × 512 (el mismo encuadre que `renderIconSourcePng`). */
export function iconSourcePixels(img: HTMLImageElement): RgbaImage {
    const src = sizeOf(img);
    const canvas = draw(img, 512, 512, fitRect(src.w, src.h, 512, 512, 0), null);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Tu navegador no permite generar imágenes');
    const { data, width, height } = ctx.getImageData(0, 0, 512, 512);
    return { data, width, height };
}

/** El dibujo listo para pintar: sus píxeles, su caja y hasta dónde llega. */
export interface PreparedIconArt {
    canvas: HTMLCanvasElement;
    box: Box;
    radius: number;
    shape: ArtShape;
    kind: IconArtKind;
}

export function prepareIconArt(pixels: RgbaImage, analysis: ArtworkAnalysis, kind: IconArtKind): PreparedIconArt {
    const art = artPixels(pixels, kind, analysis);
    const canvas = document.createElement('canvas');
    canvas.width = art.width;
    canvas.height = art.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Tu navegador no permite generar imágenes');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(art.data), art.width, art.height), 0, 0);
    // Un emblema con su logo completo se encuadra por el emblema (la caja del original).
    const box = kind === 'logo' ? analysis.bbox : (alphaBox(art) ?? analysis.bbox);
    return { canvas, box, radius: contentRadius(art, box), shape: analysis.shape, kind };
}

export function iconUseOf(key: PlatformIconKey): IconUse {
    if (key === 'apple_180') return 'apple';
    if (key === 'favicon_32') return 'favicon';
    return PLATFORM_ICON_SIZES[key].maskable ? 'mask' : 'tile';
}

function roundedRect(ctx: CanvasRenderingContext2D, box: Box, r: number): void {
    const rr = Math.max(0, Math.min(r, box.w / 2, box.h / 2));
    ctx.beginPath();
    ctx.moveTo(box.x + rr, box.y);
    ctx.arcTo(box.x + box.w, box.y, box.x + box.w, box.y + box.h, rr);
    ctx.arcTo(box.x + box.w, box.y + box.h, box.x, box.y + box.h, rr);
    ctx.arcTo(box.x, box.y + box.h, box.x, box.y, rr);
    ctx.arcTo(box.x, box.y, box.x + box.w, box.y, rr);
    ctx.closePath();
}

/** Un ícono de `size` px para un uso (Android, iPhone, computador o pestaña). */
export function renderDesignedIconCanvas(art: PreparedIconArt, use: IconUse, size: number, design: IconDesign): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Tu navegador no permite generar imágenes');
    const layout = iconLayout(use, size, design.scale);
    const bg = iconDesignBackground(design);
    ctx.save();
    if (layout.corner > 0) {
        roundedRect(ctx, layout.tile, layout.corner);
        ctx.clip();
    }
    if (bg.to) {
        // El degradado se calcula sobre la baldosa (en el de la pestaña y el del computador, más chica que el lienzo).
        const line = gradientLine(layout.tile.w, bg.angle);
        const grad = ctx.createLinearGradient(
            layout.tile.x + line.x0,
            layout.tile.y + line.y0,
            layout.tile.x + line.x1,
            layout.tile.y + line.y1,
        );
        grad.addColorStop(0, bg.from);
        grad.addColorStop(1, bg.to);
        ctx.fillStyle = grad;
    } else {
        ctx.fillStyle = bg.from;
    }
    ctx.fillRect(layout.tile.x, layout.tile.y, layout.tile.w, layout.tile.h);

    const f = artScaleFactor(layout, art);
    const w = art.box.w * f;
    const h = art.box.h * f;
    const cx = layout.tile.x + layout.tile.w / 2;
    const cy = layout.tile.y + layout.tile.h / 2;
    if (art.kind !== 'logo') {
        // Una sombra apenas visible despega el dibujo blanco del fondo.
        ctx.shadowColor = 'rgba(0, 0, 0, 0.16)';
        ctx.shadowBlur = Math.max(1, size * 0.018);
        ctx.shadowOffsetY = Math.max(0.5, size * 0.006);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(art.canvas, art.box.x, art.box.y, art.box.w, art.box.h, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
    return canvas;
}

/** Un tamaño del ícono diseñado como PNG. */
export function renderDesignedIconPng(art: PreparedIconArt, key: PlatformIconKey, design: IconDesign): Promise<Blob> {
    return canvasToPng(renderDesignedIconCanvas(art, iconUseOf(key), PLATFORM_ICON_SIZES[key].size, design));
}

/** Lo que hace falta para diseñar el ícono a partir de una imagen ya cargada. */
export function analyzeIconImage(img: HTMLImageElement): { pixels: RgbaImage; analysis: ArtworkAnalysis } {
    const pixels = iconSourcePixels(img);
    return { pixels, analysis: analyzeArtwork(pixels) };
}
