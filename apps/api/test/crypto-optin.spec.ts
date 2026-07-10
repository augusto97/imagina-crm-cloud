import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isEncrypted } from '../src/common/secret-box';
import { verifyDetachedSignature } from '../src/update/verify-signature';

describe('secret-box (cifrado opt-in, SEC-20)', () => {
    const KEY = 'una-clave-maestra-secreta';

    it('sin clave → texto plano (opt-in off)', () => {
        expect(encryptSecret('hola', '')).toBe('hola');
        expect(decryptSecret('hola', '')).toBe('hola');
    });

    it('con clave → cifra y descifra (round-trip)', () => {
        const ct = encryptSecret('p4ssw0rd-smtp', KEY);
        expect(isEncrypted(ct)).toBe(true);
        expect(ct).not.toContain('p4ssw0rd-smtp');
        expect(decryptSecret(ct, KEY)).toBe('p4ssw0rd-smtp');
    });

    it('texto plano heredado se devuelve intacto aunque haya clave', () => {
        expect(decryptSecret('legacy-plano', KEY)).toBe('legacy-plano');
    });

    it('IV aleatorio: dos cifrados del mismo valor difieren', () => {
        expect(encryptSecret('x', KEY)).not.toBe(encryptSecret('x', KEY));
    });

    it('clave equivocada → falla al descifrar', () => {
        const ct = encryptSecret('secreto', KEY);
        expect(() => decryptSecret(ct, 'otra-clave')).toThrow();
    });
});

describe('verify-signature (firma de release opt-in, SEC-12)', () => {
    it('acepta una firma ed25519 válida y rechaza una manipulada', async () => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

        const dir = mkdtempSync(path.join(tmpdir(), 'sigtest-'));
        const zip = path.join(dir, 'bundle.zip');
        const sig = path.join(dir, 'bundle.zip.sig');
        const bad = path.join(dir, 'bad.sig');

        const payload = Buffer.from('contenido del bundle');
        writeFileSync(zip, payload);
        writeFileSync(sig, cryptoSign(null, payload, privateKey));
        writeFileSync(bad, cryptoSign(null, Buffer.from('otra cosa'), privateKey));

        expect(await verifyDetachedSignature(zip, sig, pubPem)).toBe(true);
        expect(await verifyDetachedSignature(zip, bad, pubPem)).toBe(false);
    });

    it('firma en base64 también valida', async () => {
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const dir = mkdtempSync(path.join(tmpdir(), 'sigtest-'));
        const zip = path.join(dir, 'b.zip');
        const sig = path.join(dir, 'b.zip.sig');
        const payload = Buffer.from('datos');
        writeFileSync(zip, payload);
        writeFileSync(sig, cryptoSign(null, payload, privateKey).toString('base64'));
        expect(await verifyDetachedSignature(zip, sig, pubPem)).toBe(true);
    });

    it('clave pública inválida → fail-closed', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'sigtest-'));
        const zip = path.join(dir, 'z.zip');
        const sig = path.join(dir, 'z.sig');
        writeFileSync(zip, Buffer.from('x'));
        writeFileSync(sig, Buffer.from('yy'));
        expect(await verifyDetachedSignature(zip, sig, 'no-es-una-clave')).toBe(false);
    });
});
