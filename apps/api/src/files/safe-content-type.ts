/**
 * v0.1.113 (SEC-21) — Content-type seguro para servir archivos subidos.
 *
 * El mime que se guarda al subir viene del CLIENTE (`part.mimetype`), y la
 * descarga lo devolvía tal cual con `content-disposition: inline`. Eso es un
 * XSS ALMACENADO: cualquier miembro con permiso de editar registros subía un
 * `.html` (o un `.svg`, que también ejecuta script) y obtenía una URL en el
 * MISMO origen de la app que corría su JavaScript — peor aún por la ruta
 * firmada `/files/:id/signed`, que no pide sesión y sirve para pasarle el
 * link a cualquiera, incluido el cliente del portal.
 *
 * `X-Content-Type-Options: nosniff` NO alcanza: sólo impide que el navegador
 * ADIVINE el tipo, no que respete un `text/html` explícito.
 *
 * Regla: sólo se sirven inline los tipos que un navegador renderiza sin poder
 * ejecutar script. Todo lo demás baja como `application/octet-stream` +
 * `attachment` (se descarga, no se ejecuta). SVG queda FUERA de la whitelist a
 * propósito: es XML con `<script>` permitido.
 */

/** Tipos que se pueden mostrar inline sin riesgo de ejecución. */
const INLINE_SAFE = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/avif',
    'image/bmp',
    'image/x-icon',
    'application/pdf',
    // v0.1.291 — la vista previa de adjuntos reproduce video y audio. Un
    // contenedor de medios no ejecuta script: el navegador sólo lo decodifica.
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/ogg',
    'audio/webm',
    'audio/mp4',
    'audio/x-m4a',
    'audio/m4a',
    'audio/aac',
    'audio/flac',
]);

/**
 * v0.1.291 — Texto que se puede MOSTRAR (no ejecutar): se sirve siempre como
 * `text/plain` (con `nosniff` y `CSP: sandbox`), nunca con su tipo original.
 * HTML, SVG y XML quedan afuera a propósito: aunque su contenido sea texto,
 * un navegador los interpreta.
 */
const TEXT_AS_PLAIN = new Set([
    'text/plain',
    'text/csv',
    'text/tab-separated-values',
    'text/markdown',
    'text/x-markdown',
    'application/json',
    'application/x-ndjson',
]);

export interface SafeDisposition {
    /** Content-Type con el que se sirve realmente. */
    contentType: string;
    /** `inline` o `attachment`. */
    disposition: 'inline' | 'attachment';
}

/**
 * Traduce el mime almacenado al par (content-type, disposition) con el que es
 * seguro servirlo. Normaliza mayúsculas y parámetros (`; charset=…`).
 */
export function safeDisposition(storedMime: string, opts: { download?: boolean } = {}): SafeDisposition {
    const base = storedMime.split(';')[0]!.trim().toLowerCase();
    // `download` (botón «Descargar» de la vista previa): mismo tipo seguro,
    // pero siempre como archivo para guardar.
    const inline = opts.download ? 'attachment' : 'inline';
    if (INLINE_SAFE.has(base)) {
        return { contentType: base, disposition: inline };
    }
    if (TEXT_AS_PLAIN.has(base)) {
        return { contentType: 'text/plain; charset=utf-8', disposition: inline };
    }
    return { contentType: 'application/octet-stream', disposition: 'attachment' };
}

/**
 * v0.1.291 — Rango pedido (`Range: bytes=…`) sobre un archivo de `size`
 * bytes, para que el video y el audio de la vista previa se puedan adelantar.
 * Sólo un rango simple; cualquier otra cosa (varios rangos, sintaxis rara)
 * devuelve null y se sirve el archivo entero, como si no se hubiera pedido.
 * `invalid` = el rango cae fuera del archivo (416).
 */
export function parseByteRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
    if (!header) return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m || (m[1] === '' && m[2] === '')) return null;
    let start: number;
    let end: number;
    if (m[1] === '') {
        // `bytes=-500`: los últimos 500.
        const tail = Number(m[2]);
        if (!Number.isSafeInteger(tail) || tail <= 0) return 'invalid';
        start = Math.max(0, size - tail);
        end = size - 1;
    } else {
        start = Number(m[1]);
        end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || size <= 0 || start >= size || start > end) {
        return 'invalid';
    }
    return { start, end };
}

/**
 * Nombre de archivo seguro para la cabecera `content-disposition`: sin
 * comillas ni caracteres de control ni saltos (que permitirían inyectar
 * cabeceras). El nombre real viaja además en `filename*` (RFC 5987) para
 * conservar acentos.
 */
export function contentDispositionHeader(
    disposition: 'inline' | 'attachment',
    filename: string,
): string {
    // eslint-disable-next-line no-control-regex
    const ascii = filename.replace(/[\u0000-\u001f"\\]/g, '').replace(/[^\x20-\x7e]/g, '_');
    const encoded = encodeURIComponent(filename);
    return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
