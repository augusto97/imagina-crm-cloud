/**
 * Lectura de un .zip (un .xlsx es un zip de XMLs) con TOPES.
 *
 * Un zip es una bomba posible: 1 MB comprimido puede inflarse a 1 GB. Los
 * tamaños que declara el directorio central NO son confiables (los escribe
 * quien armó el archivo), así que el inflado se hace por tramos y se corta
 * en cuanto lo descomprimido supera el tope — nunca se reserva memoria por
 * lo que el archivo dice que mide.
 */
import { Inflate, strFromU8 } from 'fflate';
import { XlsxError } from './errors';

export interface ZipEntry {
    name: string;
    /** 0 = sin comprimir, 8 = deflate. */
    method: number;
    flags: number;
    compressedSize: number;
    /** Lo que DECLARA el archivo (sólo orientativo). */
    declaredSize: number;
    localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const u16 = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, o: number): number => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

/** Firma de un CFB/OLE (`.xls` viejo o un `.xlsx` cifrado con contraseña). */
export function isCompoundFile(bytes: Uint8Array): boolean {
    return bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

/** Lee el directorio central del zip: nombre → entrada. */
export function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
    if (isCompoundFile(bytes)) {
        throw new XlsxError(
            'legacy_or_encrypted',
            'El archivo es un Excel antiguo (.xls) o está protegido con contraseña. Ábrelo en Excel y guárdalo como «Libro de Excel (.xlsx)» sin contraseña.',
        );
    }
    if (bytes.length < 22 || u32(bytes, 0) !== SIG_LOCAL) {
        throw new XlsxError('not_xlsx', 'El archivo no es un libro de Excel (.xlsx).');
    }
    // El fin del directorio central está al final (hay un comentario opcional de hasta 64 KB).
    let eocd = -1;
    for (let o = bytes.length - 22; o >= Math.max(0, bytes.length - 22 - 65_535); o--) {
        if (u32(bytes, o) === SIG_EOCD) {
            eocd = o;
            break;
        }
    }
    if (eocd === -1) throw corrupt();
    const count = u16(bytes, eocd + 10);
    const cdSize = u32(bytes, eocd + 12);
    const cdOffset = u32(bytes, eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff || cdOffset + cdSize > bytes.length) {
        // ZIP64: un .xlsx de más de 4 GB no es algo que se importe.
        throw corrupt();
    }
    const out = new Map<string, ZipEntry>();
    let p = cdOffset;
    for (let k = 0; k < count; k++) {
        if (p + 46 > bytes.length || u32(bytes, p) !== SIG_CENTRAL) throw corrupt();
        const flags = u16(bytes, p + 8);
        const method = u16(bytes, p + 10);
        const compressedSize = u32(bytes, p + 20);
        const declaredSize = u32(bytes, p + 24);
        const nameLen = u16(bytes, p + 28);
        const extraLen = u16(bytes, p + 30);
        const commentLen = u16(bytes, p + 32);
        const localHeaderOffset = u32(bytes, p + 42);
        const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
        // Bit 11: nombre en UTF-8; si no, CP437 (en un .xlsx los nombres son ASCII).
        const name = strFromU8(nameBytes, (flags & 0x800) === 0);
        out.set(name.replace(/^\/+/, ''), { name, method, flags, compressedSize, declaredSize, localHeaderOffset });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}

/** Bytes comprimidos de una entrada (lo que sigue a su cabecera local). */
function rawData(bytes: Uint8Array, e: ZipEntry): Uint8Array {
    const o = e.localHeaderOffset;
    if (o + 30 > bytes.length || u32(bytes, o) !== SIG_LOCAL) throw corrupt();
    const start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28);
    const end = start + e.compressedSize;
    if (end > bytes.length) throw corrupt();
    return bytes.subarray(start, end);
}

/**
 * Descomprime una entrada cortando en `maxBytes`. Con `stopAt`, en vez de
 * fallar devuelve lo que haya hasta ahí (para espiar el principio de una
 * hoja sin inflarla entera).
 */
export function inflateEntry(bytes: Uint8Array, e: ZipEntry, maxBytes: number, stopAt?: number): Uint8Array {
    if ((e.flags & 1) !== 0) {
        throw new XlsxError('legacy_or_encrypted', 'El archivo está protegido con contraseña. Guárdalo sin contraseña y vuelve a intentar.');
    }
    const data = rawData(bytes, e);
    if (e.method === 0) {
        if (stopAt !== undefined) return data.subarray(0, stopAt);
        if (data.length > maxBytes) throw tooLarge();
        return data;
    }
    if (e.method !== 8) throw new XlsxError('corrupt', 'El archivo usa un tipo de compresión que no se puede leer.');

    const chunks: Uint8Array[] = [];
    let total = 0;
    let done = false;
    const STOP = Symbol('stop');
    const inflater = new Inflate((chunk) => {
        chunks.push(chunk);
        total += chunk.length;
        if (stopAt !== undefined && total >= stopAt) throw STOP;
        if (total > maxBytes) throw tooLarge();
    });
    // Tramos de 16 KB: lo peor que puede inflarse antes de poder cortar es
    // ~16 MB (la relación máxima de deflate ronda 1:1000).
    const STEP = 16_384;
    try {
        for (let o = 0; o < data.length && !done; o += STEP) {
            const end = Math.min(data.length, o + STEP);
            inflater.push(data.subarray(o, end), end >= data.length);
        }
        if (data.length === 0) inflater.push(new Uint8Array(0), true);
    } catch (err) {
        if (err === STOP) done = true;
        else if (err instanceof XlsxError) throw err;
        else throw corrupt();
    }
    return concat(chunks, total);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
    if (chunks.length === 1) return chunks[0]!;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
        out.set(c, o);
        o += c.length;
    }
    return out;
}

/** Bytes de un XML → texto (UTF-8 con o sin BOM; UTF-16 si trae su BOM). */
export function decodeXmlBytes(bytes: Uint8Array): string {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return utf16(bytes.subarray(2), true);
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return utf16(bytes.subarray(2), false);
    const body = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
    return strFromU8(body);
}

function utf16(b: Uint8Array, le: boolean): string {
    const parts: string[] = [];
    const STEP = 8192;
    for (let o = 0; o + 1 < b.length; o += STEP * 2) {
        const codes: number[] = [];
        for (let i = o; i + 1 < b.length && i < o + STEP * 2; i += 2) {
            codes.push(le ? (b[i]! | (b[i + 1]! << 8)) : ((b[i]! << 8) | b[i + 1]!));
        }
        parts.push(String.fromCharCode(...codes));
    }
    return parts.join('');
}

function corrupt(): XlsxError {
    return new XlsxError('corrupt', 'El archivo está dañado o no es un .xlsx válido.');
}

function tooLarge(): XlsxError {
    return new XlsxError('too_large', 'El contenido del archivo es demasiado grande para importarlo de una vez. Divídelo en archivos más pequeños.');
}
