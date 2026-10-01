import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyDetachedSignature } from '../src/update/verify-signature';

/**
 * SEC-37 (v0.1.239) — la firma que arma el workflow de release
 * (`openssl pkeyutl -sign -rawin` con ed25519) la acepta el verificador del
 * servidor, y un bundle alterado no.
 */
describe('firma de releases (CI ↔ servidor)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'relsig-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('firma con openssl como el workflow → valida; un byte cambiado → no', async () => {
        const priv = path.join(dir, 'k.pem');
        const pub = path.join(dir, 'k.pub');
        execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', priv]);
        execFileSync('openssl', ['pkey', '-in', priv, '-pubout', '-out', pub]);
        const zip = path.join(dir, 'imagina-base-9.9.9.zip');
        writeFileSync(zip, Buffer.from('bundle de prueba '.repeat(1000)));
        execFileSync('openssl', ['pkeyutl', '-sign', '-inkey', priv, '-rawin', '-in', zip, '-out', `${zip}.sig`]);
        const pem = readFileSync(pub, 'utf8');

        expect(await verifyDetachedSignature(zip, `${zip}.sig`, pem)).toBe(true);
        // En el .env la clave va en UNA línea: con `\n` literales o sólo el cuerpo.
        expect(await verifyDetachedSignature(zip, `${zip}.sig`, pem.trim().replace(/\n/g, '\\n'))).toBe(true);
        const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
        expect(await verifyDetachedSignature(zip, `${zip}.sig`, body)).toBe(true);
        writeFileSync(zip, Buffer.from('bundle de prueba '.repeat(1000) + 'x'));
        expect(await verifyDetachedSignature(zip, `${zip}.sig`, pem)).toBe(false);
    });
});
