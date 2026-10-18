import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env';
import { memberships, tenants, users } from '../src/db/schema';
import { RecoveryService } from '../src/recovery/recovery.service';
import { BackupDriveService } from '../src/update/backup-drive.service';
import { BackupsService } from '../src/update/backups.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { startFakeGoogle, type FakeGoogle } from './helpers/fake-google-drive-backups';

const PASS = 'correcto caballo batería grapa';
const CODE = 'K7QF-3MZP-9WXA';
const DEPLOY = path.join(__dirname, '..', '..', '..', 'deploy');

/** Snapshot con la forma real (manifest + env + dump) dentro de un tar. */
function snapshot(dir: string, stamp: string, opts: { env?: string | null } = {}): string {
    const name = `imagina-snapshot-${stamp}-v0.1.283`;
    const work = mkdtempSync(path.join(tmpdir(), 'snap-'));
    const parts = path.join(work, name);
    mkdirSync(parts);
    writeFileSync(path.join(parts, 'manifest.json'), JSON.stringify({ created_at: '2026-10-18T03:00:00Z', app_version: '0.1.283', migrations_applied: 72, includes: { uploads: true, redis: true, env: opts.env !== null } }));
    writeFileSync(path.join(parts, 'db.dump'), randomBytes(200_000));
    const files = [`${name}/manifest.json`, `${name}/db.dump`];
    if (opts.env !== null) {
        writeFileSync(path.join(parts, 'env.production'), opts.env ?? 'SECRETS_KEY=viejo\n');
        files.push(`${name}/env.production`);
    }
    const out = path.join(dir, `${name}.tar`);
    execFileSync('tar', ['-C', work, '-cf', out, ...files]);
    rmSync(work, { recursive: true, force: true });
    return `${name}.tar`;
}

describe('Modo recuperación (v0.1.283) — servidor nuevo con Postgres, Redis y Google falso', () => {
    let pg: TestPg;
    let redisC: TestRedis;
    let redis: Redis;
    let google: FakeGoogle;
    let dir: string;
    let env: Env;
    let backups: BackupsService;
    let drive: BackupDriveService;
    let recovery: RecoveryService;
    let fakeScript: string;

    beforeAll(async () => {
        [pg, redisC, google] = await Promise.all([startPostgres(), startRedis(), startFakeGoogle()]);
        google.pendingPolls = 0;
        redis = new Redis(redisC.url);
        dir = mkdtempSync(path.join(tmpdir(), 'imagina-recovery-'));
        // El script "real" lo reemplaza uno que sólo anota lo que recibió.
        fakeScript = path.join(dir, 'fake-recover.sh');
        writeFileSync(
            fakeScript,
            '#!/usr/bin/env bash\nset -e\ntar -tf "$1" > "$(dirname "$RECOVERY_STATUS_FILE")/recibido.txt"\nrm -f "$1"\nnode -e \'require("fs").writeFileSync(process.env.RECOVERY_STATUS_FILE, JSON.stringify({step:"done",message:"Listo",pct:null,file:null,started_at:new Date().toISOString(),updated_at:new Date().toISOString()}))\'\n',
        );
        chmodSync(fakeScript, 0o755);
        env = {
            UPDATER_BASE_PATH: '',
            BACKUPS_DIR: path.join(dir, 'backups'),
            BACKUPS_SCRIPTS_DIR: path.join(__dirname, '..', '..', '..', 'scripts'),
            GOOGLE_OAUTH_URL: google.url,
            GOOGLE_DRIVE_API_URL: google.url,
            SECRETS_KEY: 'k'.repeat(48),
            APP_BASE_URL: 'https://app.nuevo.co',
            PLATFORM_SUPERADMINS: ['ops@acme.co'],
            RECOVERY_CODE_SHA256: createHash('sha256').update('K7QF3MZP9WXA').digest('hex'),
            RECOVERY_SCRIPT: fakeScript,
        } as unknown as Env;
        mkdirSync(env.BACKUPS_DIR, { recursive: true });
        backups = new BackupsService(env, redis, { currentVersion: () => '0.1.283' } as never);
        drive = new BackupDriveService(env, redis, backups, undefined);
        drive.onModuleInit();
        recovery = new RecoveryService(env, pg.db as never, backups, drive);
    }, 120_000);

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisC?.stop(), google?.close()]);
        rmSync(dir, { recursive: true, force: true });
    });

    it('sin código en el .env no hay modo recuperación (404 opaco)', async () => {
        const off = new RecoveryService({ ...env, RECOVERY_CODE_SHA256: '' } as Env, pg.db as never, backups, drive);
        await expect(off.assertActive()).rejects.toMatchObject({ status: 404 });
        expect(off.verifyToken('1.x')).toBe(false);
    });

    it('con código y base vacía: activo; el código se tipea como sea; los intentos fallidos se frenan', async () => {
        expect(await recovery.isActive()).toBe(true);
        expect(() => recovery.unlock('AAAA-BBBB-CCCC')).toThrow(/no es el código/);
        const token = recovery.unlock(' k7qf 3mzp-9wxa ');
        expect(recovery.verifyToken(token)).toBe(true);
        expect(recovery.verifyToken(`${token}x`)).toBe(false);
        expect(recovery.verifyToken(`${Date.now() - 1}.${token.split('.')[1]}`)).toBe(false);
        const locked = new RecoveryService(env, pg.db as never, backups, drive);
        for (let i = 0; i < 10; i++) expect(() => locked.unlock('XXXX-XXXX-XXXX')).toThrow();
        // Bloqueado: ni el código correcto pasa durante 15 minutos.
        expect(() => locked.unlock(CODE)).toThrow(/Demasiados intentos/);
    });

    it('restaura desde el Drive: verifica la contraseña antes de bajar, baja, descifra y lanza el script', async () => {
        // El servidor viejo subió sus copias (mismo Drive y mismo cliente).
        await drive.update({ client_id: 'client-123.apps.googleusercontent.com', client_secret: 'shh-secret', passphrase: PASS });
        await drive.connectStart();
        await new Promise((r) => setTimeout(r, 1100));
        expect((await drive.connectPoll()).state).toBe('connected');
        expect((await backups.uploadExisting(snapshot(env.BACKUPS_DIR, '20261017T030000Z', { env: null }))).ok).toBe(true);
        expect((await backups.uploadExisting(snapshot(env.BACKUPS_DIR, '20261018T030000Z'))).ok).toBe(true);
        const remote = await drive.listRemote();
        const full = remote.find((f) => f.name.includes('20261018'));
        const noEnv = remote.find((f) => f.name.includes('20261017'));
        expect(noEnv!.includes).toMatchObject({ env: false });

        await expect(recovery.startRestore({ file_id: full!.id, passphrase: 'otra contraseña' })).rejects.toMatchObject({ response: { code: 'bad_passphrase' } });
        await expect(recovery.startRestore({ file_id: noEnv!.id, passphrase: PASS })).rejects.toMatchObject({ response: { code: 'snapshot_without_env' } });
        await expect(recovery.startRestore({ file_id: 'no-existe', passphrase: PASS })).rejects.toMatchObject({ status: 404 });

        expect(await recovery.startRestore({ file_id: full!.id, passphrase: PASS })).toEqual({ ok: true });
        let run = recovery.readRun();
        for (let i = 0; i < 60 && run?.step !== 'done' && run?.step !== 'failed'; i++) {
            await new Promise((r) => setTimeout(r, 250));
            run = recovery.readRun();
        }
        expect(run).toMatchObject({ step: 'done' });
        const recDir = path.join(dir, 'recovery');
        expect(readFileSync(path.join(recDir, 'recibido.txt'), 'utf8')).toMatch(/env\.production/);
        // Nada queda en disco: ni el cifrado ni el descifrado.
        expect(existsSync(path.join(recDir, 'copia.tar.gpg'))).toBe(false);
        expect(existsSync(path.join(recDir, 'copia.tar'))).toBe(false);
        // Terminada: se vuelve a mirar la base (aquí sigue vacía → activo).
        expect(await recovery.isActive()).toBe(true);
        await pg.db.insert(tenants).values({ slug: 'restaurada', name: 'Restaurada' });
        expect(await new RecoveryService(env, pg.db as never, backups, drive).isActive()).toBe(false);
        await pg.db.delete(tenants);
    }, 60_000);

    it('empezar de cero: sólo con el correo de operador; crea cuenta + empresa y el modo se apaga', async () => {
        // El arranque del API ya creó la cuenta del superadmin (SEC-04): el modo
        // sigue activo (no hay empresas) y "empezar de cero" la activa.
        await pg.db.insert(users).values({ email: 'ops@acme.co', passwordHash: 'x', name: 'ops@acme.co' });
        const fresh = new RecoveryService(env, pg.db as never, backups, drive);
        expect(await fresh.isActive()).toBe(true);
        await expect(fresh.fresh({ email: 'otro@x.co', name: 'Ana', password: 'una-clave-larga', workspace_name: 'Acme' })).rejects.toMatchObject({ response: { code: 'not_a_superadmin' } });
        expect(await fresh.fresh({ email: 'OPS@acme.co', name: 'Ana', password: 'una-clave-larga', workspace_name: 'Acme SAS' })).toEqual({ ok: true });
        const all = await pg.db.select().from(users);
        expect(all).toHaveLength(1);
        const [u] = all;
        expect(u).toMatchObject({ email: 'ops@acme.co', name: 'Ana' });
        expect(u!.passwordHash).not.toBe('x');
        expect(u!.emailVerifiedAt).not.toBeNull();
        const [t] = await pg.db.select().from(tenants);
        expect(t).toMatchObject({ name: 'Acme SAS', slug: 'acme-sas' });
        expect(await pg.db.select().from(memberships)).toHaveLength(1);
        expect(await fresh.isActive()).toBe(false);
        // Otra instancia del service (otro proceso) también lo ve apagado.
        const later = new RecoveryService(env, pg.db as never, backups, drive);
        expect(await later.isActive()).toBe(false);
        await expect(later.fresh({ email: 'ops@acme.co', name: 'B', password: 'una-clave-larga', workspace_name: 'B' })).rejects.toMatchObject({ response: { code: 'recovery_done' } });
    });
});

describe('recover-from-snapshot.sh — con docker y systemctl falsos', () => {
    function setup(tenantsInDb: number) {
        const base = mkdtempSync(path.join(tmpdir(), 'imagina-base-'));
        const bin = path.join(base, 'bin');
        const deploy = path.join(base, 'releases', '20261018000000_0.1.283', 'deploy');
        mkdirSync(bin, { recursive: true });
        mkdirSync(deploy, { recursive: true });
        mkdirSync(path.join(base, 'shared'), { recursive: true });
        symlinkSync(path.join(base, 'releases', '20261018000000_0.1.283'), path.join(base, 'current'));
        // docker falso: anota las llamadas; psql responde los usuarios pedidos.
        writeFileSync(
            path.join(bin, 'docker'),
            `#!/usr/bin/env bash\necho "$*" >> "${base}/docker.log"\ncase "$*" in *"from tenants"*) echo ${tenantsInDb};; esac\nexit 0\n`,
        );
        chmodSync(path.join(bin, 'docker'), 0o755);
        writeFileSync(path.join(deploy, 'snapshot-restore.sh'), `#!/usr/bin/env bash\necho "$*" > "${base}/restore.args"\n`);
        writeFileSync(path.join(deploy, 'bootstrap-server.sh'), `#!/usr/bin/env bash\necho "$*" > "${base}/bootstrap.args"\n`);
        writeFileSync(
            path.join(base, 'shared', '.env.production'),
            'APP_BASE_URL=https://app.nuevo.co\nUPDATER_BASE_PATH=/opt/imagina-base\nRECOVERY_CODE_SHA256=abc\nSECRETS_KEY=nuevo\nPOSTGRES_PASSWORD=nuevo\nPOSTGRES_PORT=5433\nREDIS_PORT=6380\n',
        );
        const tar = snapshot(
            base,
            '20261018T030000Z',
            { env: 'SECRETS_KEY=viejo\nPOSTGRES_PASSWORD=viejo\nAPP_BASE_URL=https://app.viejo.co\nNODE_OPTIONS=--require /tmp/x.js\nMAIL_FROM="Acme <a@acme.co>"\nDATABASE_URL=postgres://imagina:viejo@127.0.0.1:5432/imagina_base\nREDIS_URL=redis://:rviejo@127.0.0.1:6379\n' },
        );
        const run = () =>
            spawnSync('bash', [path.join(DEPLOY, 'recover-from-snapshot.sh'), path.join(base, tar)], {
                env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BASE_PATH: base, RESTART_CMD: `touch ${base}/restarted` },
                encoding: 'utf8',
            });
        return { base, run, tar: path.join(base, tar) };
    }

    it('instala el .env de la copia (sin lo peligroso) conservando lo de este servidor, recrea los datos, restaura y reinicia', () => {
        const { base, run, tar } = setup(0);
        const r = run();
        expect(r.status, r.stderr + r.stdout).toBe(0);
        const envNow = readFileSync(path.join(base, 'shared', '.env.production'), 'utf8');
        expect(envNow).toContain('SECRETS_KEY=viejo');
        expect(envNow).toContain('POSTGRES_PASSWORD=viejo');
        expect(envNow).toContain('MAIL_FROM="Acme <a@acme.co>"');
        expect(envNow).toContain('APP_BASE_URL=https://app.nuevo.co');
        expect(envNow).not.toContain('app.viejo.co');
        expect(envNow).not.toContain('NODE_OPTIONS');
        expect(envNow).not.toContain('RECOVERY_CODE_SHA256');
        // Los puertos son de este servidor: las URLs de la copia se reapuntan.
        expect(envNow).toContain('DATABASE_URL=postgres://imagina:viejo@127.0.0.1:5433/imagina_base');
        expect(envNow).toContain('REDIS_URL=redis://:rviejo@127.0.0.1:6380');
        expect(envNow).toContain('REDIS_PORT=6380');
        expect(readFileSync(path.join(base, 'docker.log'), 'utf8')).toMatch(/compose .* down -v/);
        // Misma versión que la instalada → restaura directo (sin bajar otra versión).
        expect(readFileSync(path.join(base, 'restore.args'), 'utf8')).toContain('--skip-env');
        expect(existsSync(path.join(base, 'bootstrap.args'))).toBe(false);
        expect(existsSync(path.join(base, 'restarted'))).toBe(true);
        expect(existsSync(tar)).toBe(false);
        expect(JSON.parse(readFileSync(path.join(base, 'shared', 'recovery', 'status.json'), 'utf8'))).toMatchObject({ step: 'done' });
    });

    it('nunca pisa un servidor con empresas', () => {
        const { base, run } = setup(3);
        const r = run();
        expect(r.status).not.toBe(0);
        expect(JSON.parse(readFileSync(path.join(base, 'shared', 'recovery', 'status.json'), 'utf8'))).toMatchObject({ step: 'failed', message: expect.stringMatching(/ya tiene empresas/) });
        expect(readFileSync(path.join(base, 'shared', '.env.production'), 'utf8')).toContain('SECRETS_KEY=nuevo');
        expect(readFileSync(path.join(base, 'docker.log'), 'utf8')).not.toMatch(/down -v/);
    });
});
