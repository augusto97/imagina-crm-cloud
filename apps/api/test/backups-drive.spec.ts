import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env';
import { BackupDriveService, toRemoteBackup } from '../src/update/backup-drive.service';
import { BackupsService } from '../src/update/backups.service';
import { DriveBackupClient, rangeEnd } from '../src/update/drive-backup-client';
import { checkPassphrase, decryptFile, encryptFileStream, passphraseVerifier } from '../src/update/snapshot-crypto';
import { startRedis, type TestRedis } from './helpers/containers';
import { startFakeGoogle, type FakeGoogle } from './helpers/fake-google-drive-backups';

const PASS = 'correcto caballo batería grapa';

/** Un snapshot "de mentira" con la forma real: dir con manifest.json + datos. */
function fakeSnapshot(dir: string, stamp: string, megabytes: number): string {
    const name = `imagina-snapshot-${stamp}-v0.1.282`;
    const work = mkdtempSync(path.join(tmpdir(), 'snap-'));
    const parts = path.join(work, name);
    mkdirSync(parts);
    writeFileSync(
        path.join(parts, 'manifest.json'),
        JSON.stringify({ created_at: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T00:00:00Z`, app_version: '0.1.282', migrations_applied: 72, includes: { uploads: true, redis: true, env: true } }),
    );
    writeFileSync(path.join(parts, 'db.dump'), randomBytes(megabytes * 1024 * 1024));
    const out = path.join(dir, `${name}.tar`);
    execFileSync('tar', ['-C', work, '-cf', out, `${name}/manifest.json`, `${name}/db.dump`]);
    rmSync(work, { recursive: true, force: true });
    return `${name}.tar`;
}

describe('Copias del servidor en Google Drive (v0.1.282) — piezas puras', () => {
    it('rangeEnd lee la cabecera Range de la subida reanudable', () => {
        expect(rangeEnd('bytes=0-8388607')).toBe(8388607);
        expect(rangeEnd(null)).toBe(-1);
    });

    it('el verificador reconoce la contraseña sin poder recuperarla', () => {
        const v = passphraseVerifier(PASS);
        expect(v).toMatch(/^s1\.[\w-]+\.[\w-]+$/);
        expect(v.length + 'imagina_pv'.length).toBeLessThanOrEqual(124);
        expect(checkPassphrase(PASS, v)).toBe(true);
        expect(checkPassphrase('otra cosa cualquiera', v)).toBe(false);
        expect(checkPassphrase(PASS, '')).toBeNull();
    });

    it('toRemoteBackup arma la fila del panel con las propiedades', () => {
        const r = toRemoteBackup(
            { id: 'x', name: 'a.tar.gpg', size: 10, createdTime: '2026-10-01T00:00:00Z', appProperties: { imagina_instance: 'app.acme.co', imagina_version: '0.1.282', imagina_migrations: '72', imagina_includes: 'ue', imagina_created_at: '2026-10-02T00:00:00Z' } },
            'app.acme.co',
        );
        expect(r).toMatchObject({ instance: 'app.acme.co', app_version: '0.1.282', migrations_applied: 72, includes: { uploads: true, redis: false, env: true }, this_server: true, created_at: '2026-10-02T00:00:00Z' });
        expect(toRemoteBackup({ id: 'y', name: 'b', size: 0, createdTime: 't', appProperties: {} }, 'z')).toMatchObject({ migrations_applied: null, includes: null, this_server: false });
    });

    it('cifra con gpg y descifra con la contraseña; la equivocada lo dice', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'gpg-'));
        const plain = path.join(dir, 'a.bin');
        writeFileSync(plain, randomBytes(300_000));
        const { stream, done } = encryptFileStream(plain, PASS);
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(c as Buffer);
        await done;
        const enc = path.join(dir, 'a.bin.gpg');
        writeFileSync(enc, Buffer.concat(chunks));
        expect(Buffer.concat(chunks).subarray(0, 300_000).equals(readFileSync(plain))).toBe(false);
        await decryptFile(enc, path.join(dir, 'back.bin'), PASS);
        expect(readFileSync(path.join(dir, 'back.bin')).equals(readFileSync(plain))).toBe(true);
        await expect(decryptFile(enc, path.join(dir, 'x.bin'), 'una contraseña mala')).rejects.toThrow(/no es la de esta copia/);
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('Copias del servidor en Google Drive (v0.1.282) — con Redis real y Google falso', () => {
    let redisC: TestRedis;
    let redis: Redis;
    let google: FakeGoogle;
    let dir: string;
    let backups: BackupsService;
    let drive: BackupDriveService;
    const mail = { enqueue: vi.fn(async (_message: unknown) => undefined) };

    beforeAll(async () => {
        [redisC, google] = await Promise.all([startRedis(), startFakeGoogle()]);
        redis = new Redis(redisC.url);
        dir = mkdtempSync(path.join(tmpdir(), 'imagina-drive-'));
        const env = {
            UPDATER_BASE_PATH: '',
            BACKUPS_DIR: dir,
            BACKUPS_SCRIPTS_DIR: path.join(__dirname, '..', '..', '..', 'scripts'),
            GOOGLE_OAUTH_URL: google.url,
            GOOGLE_DRIVE_API_URL: google.url,
            SECRETS_KEY: 'k'.repeat(48),
            APP_BASE_URL: 'https://app.acme.co',
            PLATFORM_SUPERADMINS: ['ops@acme.co'],
            UPDATER_GITHUB_REPO: 'augusto97/imagina-crm-cloud',
        } as unknown as Env;
        backups = new BackupsService(env, redis, { currentVersion: () => '0.1.282' } as never);
        drive = new BackupDriveService(env, redis, backups, mail as never);
        drive.onModuleInit();
    }, 120_000);

    afterAll(async () => {
        await redis?.quit();
        await redisC?.stop();
        await google?.close();
        rmSync(dir, { recursive: true, force: true });
    });

    it('sin cliente cargado no se puede conectar; los secretos se guardan cifrados', async () => {
        await expect(drive.connectStart()).rejects.toMatchObject({ response: { code: 'drive_not_configured' } });
        const st = await drive.update({ client_id: 'client-123.apps.googleusercontent.com', client_secret: 'shh-secret', passphrase: PASS, keep: 2 });
        expect(st).toMatchObject({ configured: true, connected: false, passphrase_set: true, instance: 'app.acme.co', client_secret_hint: '••••' });
        const raw = (await redis.get('platform:backups:drive'))!;
        expect(raw).not.toContain('shh-secret');
        expect(raw).not.toContain(PASS);
        expect(JSON.stringify(st)).not.toContain('shh-secret');
    });

    it('conecta por código de dispositivo respetando el intervalo de Google', async () => {
        const start = await drive.connectStart();
        expect(start).toMatchObject({ state: 'pending', user_code: 'ABCD-EFGH', verification_url: 'https://www.google.com/device' });
        // Antes del intervalo no se le pregunta a Google.
        expect((await drive.connectPoll()).state).toBe('pending');
        expect(google.devicePolls).toBe(0);
        await new Promise((r) => setTimeout(r, 1100));
        expect((await drive.connectPoll()).state).toBe('pending'); // authorization_pending
        expect(google.devicePolls).toBe(1);
        await new Promise((r) => setTimeout(r, 1100));
        const done = await drive.connectPoll();
        expect(done).toMatchObject({ state: 'connected', account_email: 'ops@acme.co' });
        const st = await drive.status();
        expect(st).toMatchObject({ connected: true, account_email: 'ops@acme.co', pending: null, broken: null });
        expect(await redis.get('platform:backups:drive')).not.toContain('rt-1');
    });

    it('sube una copia cifrada por partes (y se recupera de una parte caída), con sus propiedades', async () => {
        const name = fakeSnapshot(dir, '20261001T030000Z', 20);
        google.failPart = 2;
        const r = await backups.uploadExisting(name);
        expect(r.ok).toBe(true);
        const run = await backups.run();
        expect(run).toMatchObject({ status: 'success', kind: 'drive_upload', message: 'Copia subida a Google Drive' });

        const list = await drive.listRemote();
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ name: `${name}.gpg`, instance: 'app.acme.co', app_version: '0.1.282', migrations_applied: 72, includes: { uploads: true, redis: true, env: true }, this_server: true });
        // Carpeta raíz + carpeta del servidor, encontradas por propiedad.
        const folders = [...google.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
        expect(folders.map((f) => f.name).sort()).toEqual(['Imagina Base · Copias del servidor', 'app.acme.co']);
        const file = google.files.get(list[0]!.id)!;
        expect(file.parents).toEqual([folders.find((f) => f.name === 'app.acme.co')!.id]);
        expect(checkPassphrase(PASS, file.appProperties.imagina_pv)).toBe(true);

        // Lo que quedó en el Drive se baja y se descifra igual al original.
        const client = new DriveBackupClient({ oauth: google.url, api: google.url }, async () => 'at-test');
        const enc = path.join(dir, 'bajada.tar.gpg');
        await client.download(list[0]!.id, enc);
        await decryptFile(enc, path.join(dir, 'bajada.tar'), PASS);
        expect(readFileSync(path.join(dir, 'bajada.tar')).equals(readFileSync(path.join(dir, name)))).toBe(true);
        expect((await drive.status()).last_upload).toMatchObject({ ok: true, file: `${name}.gpg` });
    }, 60_000);

    it('conserva sólo las N más nuevas de ESTE servidor (y no toca las de otro)', async () => {
        // Una copia de OTRO servidor en el mismo Drive.
        const other = await new DriveBackupClient({ oauth: google.url, api: google.url }, async () => 'at-test').uploadStream(Readable.from(Buffer.from('x')), {
            name: 'otra.tar.gpg', parent: 'raiz', appProperties: { imagina_backups: 'snapshot', imagina_instance: 'viejo.acme.co', imagina_created_at: '2020-01-01T00:00:00Z' },
        }).catch(() => null);
        expect(other).toBeNull(); // el padre no existe en el falso → 404
        const root = [...google.files.values()].find((f) => f.name === 'Imagina Base · Copias del servidor')!;
        await new DriveBackupClient({ oauth: google.url, api: google.url }, async () => 'at-test').uploadStream(Readable.from(Buffer.from('x')), {
            name: 'otra.tar.gpg', parent: root.id, appProperties: { imagina_backups: 'snapshot', imagina_instance: 'viejo.acme.co', imagina_created_at: '2020-01-01T00:00:00Z' },
        });
        expect(await backups.uploadExisting(fakeSnapshot(dir, '20261002T030000Z', 1))).toMatchObject({ ok: true });
        expect(await backups.uploadExisting(fakeSnapshot(dir, '20261003T030000Z', 1))).toMatchObject({ ok: true });
        const list = await drive.listRemote();
        const mine = list.filter((b) => b.this_server).map((b) => b.name);
        expect(mine).toEqual(['imagina-snapshot-20261003T030000Z-v0.1.282.tar.gpg', 'imagina-snapshot-20261002T030000Z-v0.1.282.tar.gpg']);
        expect(list.find((b) => !b.this_server)).toMatchObject({ instance: 'viejo.acme.co' });
        expect((await drive.status()).last_upload?.message).toMatch(/se borraron 1 copias viejas/);
    }, 60_000);

    it('si Google revoca la autorización: falla con el motivo, avisa por correo una sola vez y lo marca', async () => {
        await redis.del('backups:drive:token');
        google.revoked = true;
        const a = await backups.uploadExisting(fakeSnapshot(dir, '20261004T030000Z', 1));
        expect(a).toMatchObject({ ok: false });
        expect(a.message).toMatch(/ya no acepta esta autorización/);
        expect((await backups.run()).status).toBe('failed');
        const st = await drive.status();
        expect(st.broken).toMatch(/vuelve a conectar/);
        expect(st.last_upload).toMatchObject({ ok: false });
        await backups.uploadExisting(fakeSnapshot(dir, '20261005T030000Z', 1));
        expect(mail.enqueue).toHaveBeenCalledTimes(1);
        expect(mail.enqueue.mock.calls[0]![0]).toMatchObject({ to: 'ops@acme.co', subject: expect.stringMatching(/no se pudo subir a Google Drive/) });
        google.revoked = false;
    }, 60_000);

    it('sin contraseña de recuperación el hook no sube y lo dice; apagado no hace nada', async () => {
        const cfg = JSON.parse((await redis.get('platform:backups:drive'))!) as Record<string, unknown>;
        await redis.set('platform:backups:drive', JSON.stringify({ ...cfg, passphrase: null }));
        expect(await drive.afterSnapshot('x', async () => undefined)).toMatchObject({ ok: false, message: expect.stringMatching(/contraseña de recuperación/) });
        await drive.update({ passphrase: PASS, enabled: false });
        expect(await drive.afterSnapshot('x', async () => undefined)).toBeNull();
        await drive.update({ enabled: true });
    });

    it('el kit trae el cliente y los pasos, pero NUNCA la contraseña', async () => {
        const kit = await drive.recoveryKit();
        expect(kit).toContain('client-123.apps.googleusercontent.com');
        expect(kit).toContain('ops@acme.co');
        expect(kit).toContain('gpg --output copia.tar --decrypt');
        expect(kit).toContain('releases/latest/download/install.sh | sudo bash');
        expect(kit).toContain('/recuperar');
        expect(kit).not.toContain(PASS);
    });

    it('borrar desde el panel sólo borra copias; desconectar revoca y olvida', async () => {
        const [first] = await drive.listRemote();
        await drive.deleteRemote(first!.id);
        expect(google.files.has(first!.id)).toBe(false);
        const folder = [...google.files.values()].find((f) => f.name === 'app.acme.co')!;
        await expect(drive.deleteRemote(folder.id)).rejects.toMatchObject({ response: { code: 'backup_not_found' } });
        const st = await drive.disconnect();
        expect(st).toMatchObject({ connected: false, account_email: null, configured: true });
        expect(google.revokeCalls).toBe(1);
        expect(await drive.listRemote()).toEqual([]);
    });
});
