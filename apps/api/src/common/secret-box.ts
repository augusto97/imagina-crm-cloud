import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifrado de secretos en reposo, OPT-IN (SEC-20).
 *
 * Con `SECRETS_KEY` configurada, los secretos sensibles (p.ej. el password
 * SMTP de plataforma) se cifran con AES-256-GCM antes de persistir. Sin clave,
 * se guardan en texto plano (comportamiento actual) — así habilitarlo no
 * requiere migrar datos: `decrypt` reconoce valores en claro heredados por la
 * ausencia del prefijo y los devuelve tal cual.
 */

const PREFIX = 'enc:v1:';

/** Deriva una clave de 32 bytes del secreto del env (acepta hex/base64/frase). */
function deriveKey(keySecret: string): Buffer {
    return createHash('sha256').update(keySecret, 'utf8').digest();
}

export function isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
}

/** Cifra `plaintext`. Sin `keySecret`, devuelve el texto plano (opt-in off). */
export function encryptSecret(plaintext: string, keySecret: string): string {
    if (!keySecret) return plaintext;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', deriveKey(keySecret), iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * Descifra un valor. Texto plano heredado (sin prefijo) se devuelve intacto.
 * Sin `keySecret` no se puede descifrar → se devuelve el valor tal cual (el
 * caller decidirá; en la práctica significa que se quitó la clave).
 */
export function decryptSecret(value: string, keySecret: string): string {
    if (!isEncrypted(value)) return value;
    if (!keySecret) return value;
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(keySecret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
