import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * v0.1.344 — El token de una imagen QR pública (`/api/v1/public/qr/<token>.png`).
 *
 * La imagen se arma SIN sesión: la piden Gmail, Outlook o los servidores de
 * WhatsApp al mostrar un correo o un mensaje. El contenido viaja dentro del
 * token (en base64url) y va FIRMADO: sin la firma, cualquiera usaría el
 * servidor como generador de QR gratis — o, peor, para servir un QR con
 * nuestro dominio adelante que lleva a un sitio de phishing. Lo que se firma
 * es sólo lo que la app pone en un QR (el enlace de un registro, el valor de
 * un campo), así que el contenido no es secreto: quien recibe el correo ya lo
 * tiene. No vence: un correo se relee meses después.
 */

/** Tope del contenido de un QR (un enlace o un código; más es un error). */
export const QR_CONTENT_MAX = 1000;

const SIG_CHARS = 22; // ~128 bits

function sign(content: string, secret: string): string {
    return createHmac('sha256', secret).update(`qr:v1:${content}`).digest('base64url').slice(0, SIG_CHARS);
}

/** `<contenido en base64url>.<firma>` (null si no hay contenido o es demasiado largo). */
export function signQrToken(content: string, secret: string): string | null {
    if (!content || content.length > QR_CONTENT_MAX) return null;
    return `${Buffer.from(content, 'utf8').toString('base64url')}.${sign(content, secret)}`;
}

/** El contenido de un token válido; null si la firma no coincide o está mal formado. */
export function verifyQrToken(token: string, secret: string): string | null {
    const m = /^([A-Za-z0-9_-]{1,1400})\.([A-Za-z0-9_-]{22})$/.exec(token);
    if (!m) return null;
    let content: string;
    try {
        content = Buffer.from(m[1]!, 'base64url').toString('utf8');
    } catch {
        return null;
    }
    if (!content || content.length > QR_CONTENT_MAX) return null;
    // Que el contenido vuelva a dar exactamente el mismo token (sin variantes de base64).
    if (Buffer.from(content, 'utf8').toString('base64url') !== m[1]) return null;
    const expected = Buffer.from(sign(content, secret));
    const got = Buffer.from(m[2]!);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    return content;
}
