import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) sobre HOTP (RFC 4226) — implementación propia con
 * `node:crypto`, sin dependencias.
 *
 * Es el algoritmo que hablan Google Authenticator, Authy, 1Password y el resto:
 * HMAC-SHA1 sobre el contador de ventanas de 30 s, truncamiento dinámico y 6
 * dígitos. Los vectores de prueba del RFC están en los tests.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** Ventanas de tolerancia hacia atrás y adelante (reloj desfasado del móvil). */
const DRIFT_WINDOWS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 RFC 4648 sin relleno — el formato que esperan las apps de OTP. */
export function base32Encode(buf: Buffer): string {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
}

/** Decodifica base32 tolerando minúsculas, espacios y el relleno `=`. */
export function base32Decode(input: string): Buffer {
    const clean = input.toUpperCase().replace(/[\s=]/g, '');
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const ch of clean) {
        const idx = BASE32_ALPHABET.indexOf(ch);
        if (idx === -1) throw new Error('base32 inválido');
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

/** Secreto nuevo de 20 bytes (160 bits, lo que recomienda el RFC 4226). */
export function generateTotpSecret(): string {
    return base32Encode(randomBytes(20));
}

/** HOTP: un código de 6 dígitos para un contador dado. */
export function hotp(secret: Buffer, counter: number): string {
    const buf = Buffer.alloc(8);
    // El contador es de 64 bits; con ventanas de 30 s los 32 altos son 0 hasta
    // el año 6000, pero se escriben igual para respetar el formato.
    buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
    buf.writeUInt32BE(counter >>> 0, 4);
    const digest = createHmac('sha1', secret).update(buf).digest();
    const offset = digest[digest.length - 1]! & 0x0f;
    const bin =
        ((digest[offset]! & 0x7f) << 24) |
        ((digest[offset + 1]! & 0xff) << 16) |
        ((digest[offset + 2]! & 0xff) << 8) |
        (digest[offset + 3]! & 0xff);
    return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** El código válido AHORA (o en el instante dado, en milisegundos). */
export function totp(secretBase32: string, atMs: number = Date.now()): string {
    return hotp(base32Decode(secretBase32), Math.floor(atMs / 1000 / PERIOD_SECONDS));
}

/**
 * Verifica un código contra el secreto, aceptando ±1 ventana de desfase.
 *
 * La comparación es en tiempo constante: un atacante no puede medir cuántos
 * dígitos acertó.
 */
export function verifyTotp(
    secretBase32: string,
    code: string,
    atMs: number = Date.now(),
): boolean {
    const clean = code.replace(/\D/g, '');
    if (clean.length !== DIGITS) return false;
    const secret = base32Decode(secretBase32);
    const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
    const given = Buffer.from(clean, 'utf8');
    let ok = false;
    for (let w = -DRIFT_WINDOWS; w <= DRIFT_WINDOWS; w++) {
        const expected = Buffer.from(hotp(secret, counter + w), 'utf8');
        // Sin cortocircuito: se recorren todas las ventanas siempre.
        if (timingSafeEqual(expected, given)) ok = true;
    }
    return ok;
}

/**
 * URI `otpauth://` — lo que se codifica en el QR y lo que el usuario puede
 * pegar a mano en su app si no puede escanear.
 */
export function otpauthUri(issuer: string, account: string, secretBase32: string): string {
    const label = encodeURIComponent(`${issuer}:${account}`);
    const params = new URLSearchParams({
        secret: secretBase32,
        issuer,
        algorithm: 'SHA1',
        digits: String(DIGITS),
        period: String(PERIOD_SECONDS),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Códigos de respaldo: 10 códigos de 10 caracteres base32 (50 bits cada uno).
 * Se muestran UNA vez y se guardan hasheados — quien lea la base de datos no
 * puede usarlos.
 */
export function generateBackupCodes(count = 10): string[] {
    return Array.from({ length: count }, () => {
        const raw = base32Encode(randomBytes(7)).slice(0, 10);
        return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
}

/** Normaliza un código de respaldo tipeado (guiones, espacios, minúsculas). */
export function normalizeBackupCode(code: string): string {
    return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}
