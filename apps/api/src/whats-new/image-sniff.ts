/**
 * Reconoce una imagen por sus PRIMEROS BYTES (no por el nombre ni por el tipo
 * que declara el navegador, que vienen del cliente). Sólo PNG, JPEG, WebP y
 * GIF: SVG queda fuera a propósito (es XML y puede traer `<script>`).
 */
export type SniffedImage = { ext: 'png' | 'jpg' | 'webp' | 'gif'; mime: string };

export function sniffImage(bytes: Uint8Array): SniffedImage | null {
    const b = bytes;
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
        return { ext: 'png', mime: 'image/png' };
    }
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
    if (
        b.length >= 6 &&
        b[0] === 0x47 &&
        b[1] === 0x49 &&
        b[2] === 0x46 &&
        b[3] === 0x38 &&
        (b[4] === 0x37 || b[4] === 0x39) &&
        b[5] === 0x61
    ) {
        return { ext: 'gif', mime: 'image/gif' };
    }
    if (
        b.length >= 12 &&
        b[0] === 0x52 &&
        b[1] === 0x49 &&
        b[2] === 0x46 &&
        b[3] === 0x46 &&
        b[8] === 0x57 &&
        b[9] === 0x45 &&
        b[10] === 0x42 &&
        b[11] === 0x50
    ) {
        return { ext: 'webp', mime: 'image/webp' };
    }
    return null;
}

export const IMAGE_MIME_BY_EXT: Record<SniffedImage['ext'], string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
};
