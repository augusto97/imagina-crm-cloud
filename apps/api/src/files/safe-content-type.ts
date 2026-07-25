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
export function safeDisposition(storedMime: string): SafeDisposition {
    const base = storedMime.split(';')[0]!.trim().toLowerCase();
    if (INLINE_SAFE.has(base)) {
        return { contentType: base, disposition: 'inline' };
    }
    return { contentType: 'application/octet-stream', disposition: 'attachment' };
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
