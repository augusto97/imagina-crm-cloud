/**
 * Traducciones humanas de los fallos de SMTP (v0.1.151). Viven aparte del
 * panel para poder testearlas sin montar React: son las que convierten un
 * "Connection timeout" —que no le sirve a nadie— en algo accionable.
 */

/** Puertos cuyo modo TLS es conocido: 465 implícito, el resto STARTTLS. */
const STARTTLS_PORTS = new Set(['25', '587', '2525']);

/**
 * Aviso cuando el puerto y la casilla de TLS no se corresponden — la causa
 * clásica del timeout (el servidor espera un handshake que nunca llega, o al
 * revés). `null` si la combinación es coherente o el puerto no es estándar.
 */
export function tlsMismatch(form: { port: string; secure: boolean }): string | null {
    const port = form.port.trim();
    if (port === '465' && !form.secure) {
        return 'El puerto 465 habla TLS desde el inicio: activá «Conexión segura» o el envío queda esperando hasta dar timeout.';
    }
    if (STARTTLS_PORTS.has(port) && form.secure) {
        return `El puerto ${port} usa STARTTLS: desactivá «Conexión segura» (se cifra igual, pero después del saludo).`;
    }
    return null;
}

/** Enriquece el error crudo de nodemailer con la causa probable y el paso siguiente. */
export function explainSendError(error: string | undefined): string {
    const raw = (error ?? '').trim();
    if (!raw) return 'No se pudo enviar la prueba.';
    const low = raw.toLowerCase();
    if (
        low.includes('timeout') ||
        low.includes('etimedout') ||
        low.includes('econnrefused') ||
        low.includes('enotfound')
    ) {
        return `${raw} — el servidor no logró conectarse al SMTP. Tocá «Diagnosticar conexión» para ver qué puerto responde y por qué.`;
    }
    if (low.includes('invalid login') || low.includes('535') || low.includes('auth')) {
        return `${raw} — la conexión llega pero el servidor rechaza las credenciales: revisá usuario y contraseña.`;
    }
    if (low.includes('sender') || low.includes('553') || low.includes('550') || low.includes('from')) {
        return `${raw} — el servidor rechaza el remitente: usá una dirección autorizada por tu proveedor en el campo From.`;
    }
    return raw;
}
