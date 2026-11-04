/**
 * v0.1.351 — Achica una imagen EN EL NAVEGADOR antes de subirla (fondo,
 * portada, panel dividido, imágenes del formulario y de sus opciones): una
 * foto del celular de 4000 px y 6 MB no tiene sentido detrás de un
 * formulario. Se re-codifica a WebP con un canvas; si el navegador no sabe
 * (o el resultado no mejora nada), se sube el original.
 *
 * La DECISIÓN es pura (`planImageResize`, `pickResizedResult`, `webpName`)
 * y está probada; el canvas sólo ejecuta lo decidido.
 */

/** Por debajo de esto, una imagen que ya entra en el tamaño no se re-codifica. */
export const REENCODE_MIN_BYTES = 300 * 1024;

export const DEFAULT_WEBP_QUALITY = 0.82;

export interface ImageInfo {
    width: number;
    height: number;
    /** Tipo MIME del archivo original. */
    type: string;
    /** Bytes del archivo original. */
    size: number;
}

export type ImageResizePlan = { action: 'keep' } | { action: 'encode'; width: number; height: number; resized: boolean };

/**
 * Qué hacer con la imagen:
 * - GIF: se sube tal cual (puede ser animado).
 * - SVG: se dibuja a `maxSide` (es vectorial; servido como SVG no se mostraría en la página).
 * - Más grande que `maxSide`: se achica a ese lado mayor, sin deformar.
 * - Ya entra: sólo se re-codifica si es pesada y no es WebP.
 */
export function planImageResize(info: ImageInfo, maxSide: number): ImageResizePlan {
    const type = info.type.toLowerCase();
    if (type === 'image/gif') return { action: 'keep' };
    const w = Math.max(1, Math.round(info.width) || 1);
    const h = Math.max(1, Math.round(info.height) || 1);
    const longest = Math.max(w, h);
    const vector = type === 'image/svg+xml';
    const scale = vector ? maxSide / longest : Math.min(1, maxSide / longest);
    const resized = vector || scale < 1;
    if (!resized && (type === 'image/webp' || info.size <= REENCODE_MIN_BYTES)) return { action: 'keep' };
    return {
        action: 'encode',
        width: Math.max(1, Math.round(w * scale)),
        height: Math.max(1, Math.round(h * scale)),
        resized,
    };
}

/**
 * ¿Se usa lo codificado? No si el navegador devolvió otro formato (no sabe
 * WebP) o si sólo se re-codificó y quedó igual o más pesado.
 */
export function pickResizedResult(original: { size: number }, encoded: { size: number; type: string } | null, resized: boolean): 'encoded' | 'original' {
    if (!encoded || encoded.type !== 'image/webp' || encoded.size === 0) return 'original';
    if (!resized && encoded.size >= original.size) return 'original';
    return 'encoded';
}

/** «foto.final.JPG» → «foto.final.webp». */
export function webpName(name: string): string {
    const base = name.replace(/\.[a-z0-9]{1,5}$/i, '').trim();
    return `${base || 'imagen'}.webp`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('No se pudo leer la imagen'));
        };
        img.src = url;
    });
}

/**
 * Devuelve el archivo a subir: el achicado en WebP o, si no se puede o no
 * vale la pena, el original. Nunca tira: ante cualquier problema, el original.
 */
export async function resizeImageFile(file: File, opts: { maxSide: number; quality?: number }): Promise<File> {
    if (typeof document === 'undefined' || !file.type.startsWith('image/')) return file;
    try {
        const img = await loadImage(file);
        // Un SVG sin ancho/alto propio se dibuja cuadrado.
        const width = img.naturalWidth || img.width || 1024;
        const height = img.naturalHeight || img.height || 1024;
        const plan = planImageResize({ width, height, type: file.type, size: file.size }, opts.maxSide);
        if (plan.action === 'keep') return file;
        const canvas = document.createElement('canvas');
        canvas.width = plan.width;
        canvas.height = plan.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return file;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, plan.width, plan.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', opts.quality ?? DEFAULT_WEBP_QUALITY));
        if (pickResizedResult(file, blob, plan.resized) === 'original' || !blob) return file;
        return new File([blob], webpName(file.name), { type: 'image/webp', lastModified: Date.now() });
    } catch {
        return file;
    }
}

/** Lado mayor para cada uso. */
export const IMAGE_MAX_SIDE = {
    background: 1920,
    split: 1920,
    cover: 1600,
    item: 1400,
    option: 640,
} as const;
