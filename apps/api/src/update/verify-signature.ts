import { readFile } from 'node:fs/promises';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * Verificación de FIRMA de un release, OPT-IN (SEC-12).
 *
 * El checksum `.sha256` solo protege de corrupción en tránsito, no de
 * autenticidad: quien pueda alterar el release aporta un checksum coincidente.
 * Con `UPDATER_PUBLIC_KEY` configurada, además se verifica una firma DETACHED
 * del `.zip` contra la clave pública embebida en el servidor (no traída del
 * release), así un release manipulado NO se instala. Soporta ed25519 (default
 * moderno) y RSA. La firma puede venir en binario crudo o base64.
 */
export async function verifyDetachedSignature(
    dataPath: string,
    signaturePath: string,
    publicKeyPem: string,
): Promise<boolean> {
    const [data, sigRaw] = await Promise.all([readFile(dataPath), readFile(signaturePath)]);
    let key;
    try {
        key = createPublicKey(normalizePublicKey(publicKeyPem));
    } catch {
        return false; // clave pública inválida → fail-closed
    }
    const algo = key.asymmetricKeyType === 'ed25519' || key.asymmetricKeyType === 'ed448' ? null : 'sha256';

    const candidates: Buffer[] = [sigRaw];
    // Si el archivo parece base64 de texto, probá también decodificarlo.
    const asText = sigRaw.toString('utf8').trim();
    if (/^[A-Za-z0-9+/=\s]+$/.test(asText)) {
        candidates.push(Buffer.from(asText, 'base64'));
    }

    for (const sig of candidates) {
        try {
            if (cryptoVerify(algo, data, key, sig)) return true;
        } catch {
            // probá el siguiente candidato
        }
    }
    return false;
}

/**
 * SEC-37 (v0.1.239): un `.env` no admite cómodamente un PEM de varias líneas.
 * Se acepta el PEM con `\n` literales (una sola línea) o sólo el cuerpo base64
 * (sin las líneas BEGIN/END), además del PEM normal.
 */
export function normalizePublicKey(raw: string): string {
    const text = raw.trim().replace(/\\n/g, '\n');
    if (text.includes('-----BEGIN')) return text;
    const body = text.replace(/\s+/g, '');
    return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)?.join('\n') ?? body}\n-----END PUBLIC KEY-----\n`;
}
