import type { Readable } from 'node:stream';

/**
 * El tipo de una imagen por su CABECERA (nunca por el nombre ni por lo que
 * declaró quien la subió): PNG, JPEG, GIF o WebP. Cualquier otra cosa —SVG
 * incluido, que puede llevar script— no es una imagen que se sirva.
 *
 * v0.1.426 — se mudó aquí desde los widgets de contacto para que la usen
 * también las miniaturas de los archivos (los widgets la reexportan).
 */
export function imageMimeOf(b: Buffer): string | null {
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length > 6 && b.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'image/gif';
    if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
}

/**
 * Lo mismo, sumando AVIF (caja `ftyp` con la marca `avif`/`avis`, como marca
 * principal o compatible). La usan las miniaturas: `sharp` la lee y la
 * devuelve como WebP.
 */
export function sniffImageMime(b: Buffer): string | null {
    const known = imageMimeOf(b);
    if (known) return known;
    if (b.length < 16 || b.subarray(4, 8).toString('latin1') !== 'ftyp') return null;
    const boxSize = Math.min(b.readUInt32BE(0), b.length, 64);
    for (let i = 8; i + 4 <= boxSize; i += 4) {
        // 8 = marca principal; 12 = versión (no es una marca); 16+ = compatibles.
        if (i === 12) continue;
        const brand = b.subarray(i, i + 4).toString('latin1');
        if (brand === 'avif' || brand === 'avis') return 'image/avif';
    }
    return null;
}

/** Lee un stream hasta `max` bytes; más que eso → null (y corta la lectura). */
export async function readCapped(stream: Readable, max: number): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += b.length;
        if (size > max) {
            stream.destroy();
            return null;
        }
        chunks.push(b);
    }
    return Buffer.concat(chunks);
}
