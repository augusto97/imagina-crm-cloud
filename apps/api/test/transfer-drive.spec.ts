import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env';
import { TenantTransferService } from '../src/platform/tenant-transfer.service';
import { TransferDriveService } from '../src/platform/transfer-drive.service';
import { BackupDriveService } from '../src/update/backup-drive.service';
import { BackupsService } from '../src/update/backups.service';
import { startRedis, type TestRedis } from './helpers/containers';
import { startFakeGoogle, type FakeGoogle } from './helpers/fake-google-drive-backups';

const PASS_A = 'contraseña del servidor viejo';
const PASS_B = 'contraseña del servidor nuevo';

/** Un archivo de empresa con la forma de ADR-S23 (manifest + una tabla). */
function exportFile(dir: string): string {
    const work = mkdtempSync(path.join(tmpdir(), 'xfer-'));
    writeFileSync(
        path.join(work, 'manifest.json'),
        JSON.stringify({
            format: 1, app_version: '0.1.284', exported_at: '2026-10-18T12:00:00.000Z', secrets_fingerprint: null,
            tenant: { slug: 'acme', name: 'Acme SAS', plan: 'pro', status: 'active' },
            counts: { records: 4200, lists: 3 }, files: { count: 0, bytes: 0 }, excluded: [],
        }),
    );
    writeFileSync(path.join(work, 'records.ndjson'), randomBytes(150_000).toString('base64'));
    const name = 'imagina-tenant-acme-20261018T120000Z.tar';
    execFileSync('tar', ['-C', work, '-cf', path.join(dir, name), '.']);
    rmSync(work, { recursive: true, force: true });
    return name;
}

async function waitRun(svc: TransferDriveService) {
    for (let i = 0; i < 80; i++) {
        const r = await svc.run();
        if (r && r.status !== 'running') return r;
        await new Promise((res) => setTimeout(res, 200));
    }
    return svc.run();
}

describe('Mover una empresa por Google Drive (v0.1.284) — dos servidores, un Drive', () => {
    let redisC: TestRedis;
    let google: FakeGoogle;
    let root: string;
    const servers: Array<{ redis: Redis; dir: string; drive: BackupDriveService; svc: TransferDriveService }> = [];

    beforeAll(async () => {
        [redisC, google] = await Promise.all([startRedis(), startFakeGoogle()]);
        google.pendingPolls = 0;
        root = mkdtempSync(path.join(tmpdir(), 'imagina-xfer-'));
        for (const [i, instance] of ['viejo.acme.co', 'nuevo.acme.co'].entries()) {
            const redis = new Redis(`${redisC.url}/${i}`);
            const dir = path.join(root, instance, 'transfers');
            mkdirSync(dir, { recursive: true });
            const env = {
                UPDATER_BASE_PATH: '', BACKUPS_DIR: path.join(root, instance, 'backups'), TRANSFERS_DIR: dir,
                GOOGLE_OAUTH_URL: google.url, GOOGLE_DRIVE_API_URL: google.url, SECRETS_KEY: `k${i}`.repeat(24),
                APP_BASE_URL: `https://${instance}`, PLATFORM_SUPERADMINS: [], UPDATER_GITHUB_REPO: 'x/y',
            } as unknown as Env;
            const backups = new BackupsService(env, redis, { currentVersion: () => '0.1.284' } as never);
            const drive = new BackupDriveService(env, redis, backups, undefined);
            const transfers = new TenantTransferService({} as never, env, {} as never);
            servers.push({ redis, dir, drive, svc: new TransferDriveService(redis, transfers, drive) });
        }
    }, 120_000);

    afterAll(async () => {
        for (const s of servers) await s.redis.quit();
        await Promise.all([redisC?.stop(), google?.close()]);
        rmSync(root, { recursive: true, force: true });
    });

    async function connect(drive: BackupDriveService, pass: string | null) {
        await drive.update({ client_id: 'client-123.apps.googleusercontent.com', client_secret: 'shh-secret', ...(pass ? { passphrase: pass } : {}) });
        await drive.connectStart();
        await new Promise((r) => setTimeout(r, 1100));
        expect((await drive.connectPoll()).state).toBe('connected');
    }

    it('sin Drive conectado lo dice (no sube ni lista)', async () => {
        const [a] = servers;
        const st = await a!.svc.status();
        expect(st).toMatchObject({ ready: false, files: [] });
        expect(st.reason).toMatch(/Conecta Google Drive/);
        await expect(a!.svc.startUpload(exportFile(a!.dir))).rejects.toMatchObject({ response: { code: 'drive_not_ready' } });
    });

    it('sin contraseña de recuperación tampoco: la empresa nunca sube sin cifrar', async () => {
        const [a] = servers;
        await connect(a!.drive, null);
        expect((await a!.svc.status()).reason).toMatch(/contraseña de recuperación/);
    });

    it('el servidor viejo sube la empresa cifrada; el nuevo la ve, verifica la contraseña y la trae idéntica', async () => {
        const [a, b] = servers;
        await a!.drive.update({ passphrase: PASS_A });
        const name = readdirSync(a!.dir).find((n) => n.endsWith('.tar'))!;
        await expect(a!.svc.startUpload('../../etc/passwd.tar')).rejects.toBeDefined();
        expect(await a!.svc.startUpload(name)).toEqual({ ok: true });
        await expect(a!.svc.startUpload(name)).rejects.toMatchObject({ response: { code: 'transfer_busy' } });
        expect(await waitRun(a!.svc)).toMatchObject({ op: 'upload', status: 'success', message: expect.stringContaining('Acme SAS') });

        // En el Drive: dentro de «Empresas exportadas», cifrada.
        const files = [...google.files.values()];
        const folder = files.find((f) => f.name === 'Empresas exportadas')!;
        const up = files.find((f) => f.appProperties.imagina_backups === 'tenant_transfer')!;
        expect(up.parents).toEqual([folder.id]);
        expect(up.data.includes(Buffer.from('Acme SAS'))).toBe(false);

        // El servidor nuevo (otro Redis, otra contraseña, mismo Drive).
        await connect(b!.drive, PASS_B);
        const st = await b!.svc.status();
        expect(st.ready).toBe(true);
        expect(st.files).toHaveLength(1);
        expect(st.files[0]).toMatchObject({ tenant_slug: 'acme', tenant_name: 'Acme SAS', instance: 'viejo.acme.co', records: 4200, app_version: '0.1.284', this_server: false });
        // Las copias del servidor y las empresas no se mezclan.
        expect(await b!.drive.listRemote()).toEqual([]);

        await expect(b!.svc.startFetch(st.files[0]!.id, PASS_B)).rejects.toMatchObject({ response: { code: 'bad_passphrase' } });
        expect(await b!.svc.startFetch(st.files[0]!.id, PASS_A)).toEqual({ ok: true });
        const run = await waitRun(b!.svc);
        expect(run).toMatchObject({ op: 'fetch', status: 'success', file: name });
        expect(readFileSync(path.join(b!.dir, name)).equals(readFileSync(path.join(a!.dir, name)))).toBe(true);
        // Sin restos del cifrado en el directorio.
        expect(readdirSync(b!.dir)).toEqual([name]);

        // Traerla otra vez no pisa la anterior.
        await b!.svc.startFetch(st.files[0]!.id, PASS_A);
        expect((await waitRun(b!.svc))?.file).toBe(name.replace(/\.tar$/, '-2.tar'));
    }, 60_000);

    it('borrar del Drive sólo borra empresas exportadas', async () => {
        const [, b] = servers;
        const [f] = (await b!.svc.status()).files;
        const folder = [...google.files.values()].find((x) => x.name === 'Empresas exportadas')!;
        await expect(b!.svc.remove(folder.id)).rejects.toMatchObject({ response: { code: 'transfer_not_found' } });
        await b!.svc.remove(f!.id);
        expect((await b!.svc.status()).files).toEqual([]);
    });
});
