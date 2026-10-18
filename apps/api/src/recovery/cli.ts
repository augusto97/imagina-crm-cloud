/**
 * v0.1.283 (ADR-S43) — `imagina-restore`: restaurar una copia del Google
 * Drive desde la TERMINAL, en un servidor recién instalado con install.sh.
 * Es el camino cuando el dominio todavía no apunta al servidor (no hay HTTPS
 * para el asistente web) o cuando se prefiere la consola.
 *
 * No necesita Redis ni la base: conecta el Drive por código de dispositivo,
 * lista las copias, pide la contraseña, baja, descifra y corre
 * `recover-from-snapshot.sh` (el mismo que usa el asistente web).
 *
 * Datos por variables (si no, se preguntan): GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET, RECOVERY_PASSPHRASE_FILE, BASE_PATH.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import {
    DriveBackupClient,
    deviceStart,
    devicePoll,
    type DriveUrls,
    type RemoteFile,
} from '../update/drive-backup-client';
import { checkPassphrase, decryptFile } from '../update/snapshot-crypto';

const urls: DriveUrls = {
    oauth: process.env.GOOGLE_OAUTH_URL || 'https://oauth2.googleapis.com',
    api: process.env.GOOGLE_DRIVE_API_URL || 'https://www.googleapis.com',
};
const BASE_PATH = process.env.BASE_PATH || '/opt/imagina-base';

function ask(question: string, hidden = false): Promise<string> {
    return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (hidden) {
            const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
            (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => write(s.includes(question) ? s : '');
        }
        rl.question(question, (answer) => {
            rl.close();
            if (hidden) process.stdout.write('\n');
            resolve(answer.trim());
        });
    });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

async function connect(clientId: string, clientSecret: string): Promise<string> {
    const start = await deviceStart(urls, clientId);
    console.log(`\n  Abre ${start.verification_url} con la cuenta de Google de las copias`);
    console.log(`  y escribe este código:  ${start.user_code}\n`);
    let interval = start.interval;
    const deadline = Date.now() + start.expires_in * 1000;
    while (Date.now() < deadline) {
        await sleep(interval * 1000);
        const r = await devicePoll(urls, clientId, clientSecret, start.device_code);
        if (r.state === 'connected') return r.access_token;
        if (r.state === 'pending') {
            if (r.slowDown) interval += 5;
            continue;
        }
        throw new Error(r.message);
    }
    throw new Error('El código venció sin que se autorizara. Vuelve a correr imagina-restore.');
}

async function main(): Promise<void> {
    console.log('\nImagina Base — restaurar una copia desde Google Drive\n');
    const clientId = process.env.GOOGLE_CLIENT_ID || (await ask('ID del cliente de Google (está en el kit de recuperación): '));
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || (await ask('Secreto del cliente: ', true));
    const token = await connect(clientId, clientSecret);
    const client = new DriveBackupClient(urls, async () => token);
    const email = await client.accountEmail().catch(() => null);
    console.log(`✓ Conectado${email ? ` con ${email}` : ''}\n`);

    const files = await client.listSnapshots();
    if (files.length === 0) throw new Error('No hay copias de Imagina Base en ese Google Drive (¿es la misma cuenta y el mismo cliente de Google?).');
    files.slice(0, 30).forEach((f: RemoteFile, i: number) => {
        const p = f.appProperties;
        console.log(`  ${String(i + 1).padStart(2)}. ${(p.imagina_created_at || f.createdTime).replace('T', ' ').slice(0, 16)}  ${p.imagina_instance ?? '—'}  v${p.imagina_version || '?'}  ${mb(f.size)}`);
    });
    const pick = Number(await ask(`\n¿Cuál restauro? (1-${Math.min(30, files.length)}) [1]: `)) || 1;
    const file = files[pick - 1];
    if (!file) throw new Error('Número inválido.');
    const inc = file.appProperties.imagina_includes;
    if (inc !== undefined && !inc.includes('e')) {
        throw new Error('Esa copia no trae los secretos del servidor (.env): no sirve para levantar un servidor nuevo. Elige otra.');
    }

    let passphrase = process.env.RECOVERY_PASSPHRASE_FILE ? readFileSync(process.env.RECOVERY_PASSPHRASE_FILE, 'utf8').trim() : '';
    for (let tries = 0; ; tries++) {
        if (!passphrase) passphrase = await ask('Contraseña de recuperación: ', true);
        if (checkPassphrase(passphrase, file.appProperties.imagina_pv) !== false) break;
        console.log('✗ Esa no es la contraseña de esta copia.');
        passphrase = '';
        if (tries >= 2) throw new Error('Demasiados intentos.');
    }

    const dir = path.join(BASE_PATH, 'shared', 'recovery');
    mkdirSync(dir, { recursive: true });
    const enc = path.join(dir, 'copia.tar.gpg');
    const tar = path.join(dir, 'copia.tar');
    let last = -1;
    await client.download(file.id, enc, (bytes) => {
        const pct = file.size > 0 ? Math.floor((bytes / file.size) * 100) : 0;
        if (pct !== last && pct % 5 === 0) {
            last = pct;
            process.stdout.write(`\r  Bajando… ${pct}%   `);
        }
    });
    console.log(`\r✓ Copia bajada (${mb(statSync(enc).size)})   `);
    try {
        await decryptFile(enc, tar, passphrase);
    } finally {
        rmSync(enc, { force: true });
    }
    console.log('✓ Copia descifrada. Aplicándola (esto tarda unos minutos)…\n');

    const script = process.env.RECOVERY_SCRIPT || path.join(BASE_PATH, 'current', 'deploy', 'recover-from-snapshot.sh');
    const res = spawnSync('bash', [script, tar], { stdio: 'inherit', env: { ...process.env, BASE_PATH } });
    if (res.status !== 0) throw new Error(`La restauración falló (código ${res.status}). Revisa el detalle de arriba.`);
    console.log('\n✓ Listo: el servidor arrancó con los datos de la copia. Entra con tu cuenta de siempre.\n');
}

main().catch((err: unknown) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
