import { spawn } from 'node:child_process';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

/**
 * v0.1.282 (ADR-S43) — Cifrado de las copias que salen del servidor.
 *
 * GPG simétrico (AES-256) con la contraseña de recuperación del operador: es
 * un formato ABIERTO, así que una copia se descifra aun sin la app
 * (`gpg --decrypt copia.tar.gpg > copia.tar`). Cada llamada usa un GNUPGHOME
 * temporal (no necesita ni toca el `~/.gnupg` del usuario del servicio) y la
 * contraseña viaja en un archivo 0600 dentro de él, nunca en la línea de
 * comandos (que se ve con `ps`).
 */

export class SnapshotCryptoError extends Error {
    override name = 'SnapshotCryptoError';
}

interface GpgRun {
    home: string;
    passFile: string;
    cleanup: () => void;
}

function gpgHome(passphrase: string): GpgRun {
    const home = mkdtempSync(path.join(tmpdir(), 'imagina-gpg-'));
    const passFile = path.join(home, 'pass');
    writeFileSync(passFile, passphrase, { mode: 0o600 });
    return { home, passFile, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

function baseArgs(run: GpgRun): string[] {
    return ['--homedir', run.home, '--batch', '--yes', '--no-tty', '--pinentry-mode', 'loopback', '--passphrase-file', run.passFile];
}

/**
 * Cifra un archivo y devuelve el resultado como STREAM (para subirlo sin
 * escribir una segunda copia en disco). `done` resuelve cuando gpg terminó
 * bien; si falla, rechaza con su motivo.
 */
export function encryptFileStream(file: string, passphrase: string): { stream: Readable; done: Promise<void> } {
    const run = gpgHome(passphrase);
    // Sin compresión: el tar ya trae el dump comprimido y los archivos en .tar.gz.
    const child = spawn(
        'gpg',
        [...baseArgs(run), '--symmetric', '--cipher-algo', 'AES256', '--s2k-digest-algo', 'SHA512', '--compress-algo', 'none', '--output', '-', file],
        { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    const done = new Promise<void>((resolve, reject) => {
        child.on('error', (err) => {
            run.cleanup();
            reject(new SnapshotCryptoError(`No se pudo cifrar la copia: falta gpg en el servidor (${err.message}).`));
        });
        child.on('close', (code) => {
            run.cleanup();
            if (code === 0) resolve();
            else reject(new SnapshotCryptoError(`No se pudo cifrar la copia (gpg: ${lastLine(stderr) || `código ${code}`}).`));
        });
    });
    // Que un rechazo de `done` sin listener todavía no tumbe el proceso.
    done.catch(() => undefined);
    return { stream: child.stdout, done };
}

/** Descifra una copia bajada (`.tar.gpg` → `.tar`). Contraseña mala → error claro. */
export function decryptFile(input: string, output: string, passphrase: string): Promise<void> {
    const run = gpgHome(passphrase);
    return new Promise<void>((resolve, reject) => {
        const child = spawn('gpg', [...baseArgs(run), '--output', output, '--decrypt', input], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
        child.on('error', (err) => {
            run.cleanup();
            reject(new SnapshotCryptoError(`No se pudo descifrar la copia: falta gpg en el servidor (${err.message}).`));
        });
        child.on('close', (code) => {
            run.cleanup();
            if (code === 0) return resolve();
            if (/bad (session key|passphrase)|decryption failed/i.test(stderr)) {
                return reject(new SnapshotCryptoError('La contraseña de recuperación no es la de esta copia.'));
            }
            reject(new SnapshotCryptoError(`No se pudo descifrar la copia (gpg: ${lastLine(stderr) || `código ${code}`}).`));
        });
    });
}

function lastLine(s: string): string {
    return s.trim().split('\n').filter(Boolean).slice(-1)[0]?.replace(/^gpg:\s*/, '') ?? '';
}

// ---------------------------------------------------------------------------
// Verificador de la contraseña
// ---------------------------------------------------------------------------

/**
 * Viaja en las propiedades de cada copia del Drive: permite decir "esa no es
 * la contraseña" ANTES de bajar varios GB. scrypt (N=2^15) no es más débil
 * que el S2K del propio archivo, así que no le regala nada a quien lo tenga.
 * Formato: `s1.<sal b64url>.<hash b64url>` (cabe en los 124 bytes de una
 * propiedad de Drive).
 */
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function passphraseVerifier(passphrase: string, salt: Buffer = randomBytes(16)): string {
    const hash = scryptSync(passphrase, salt, 32, SCRYPT);
    return `s1.${salt.toString('base64url')}.${hash.toString('base64url')}`;
}

/** true/false si el verificador es legible; null si no hay o no se entiende. */
export function checkPassphrase(passphrase: string, verifier: string | null | undefined): boolean | null {
    const m = /^s1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(verifier ?? '');
    if (!m) return null;
    const expected = Buffer.from(m[2]!, 'base64url');
    const got = scryptSync(passphrase, Buffer.from(m[1]!, 'base64url'), expected.length, SCRYPT);
    return got.length === expected.length && timingSafeEqual(got, expected);
}
