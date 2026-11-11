import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env';
import { BackupsService, isSnapshotDue, nextRunAt, parseBackupName, stampToISO } from '../src/update/backups.service';
import { tenants } from '../src/db/schema';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');

describe('Copias de seguridad completas (v0.1.179) — helpers puros', () => {
    it('parseBackupName reconoce snapshots (cifrados o no), dumps lógicos y copias pre-restore', () => {
        expect(parseBackupName('imagina-snapshot-20260914T041844Z-v0.1.179.tar')).toEqual({
            kind: 'snapshot', created_at: '2026-09-14T04:18:44Z', app_version: '0.1.179', encrypted: false,
        });
        expect(parseBackupName('imagina-snapshot-20260914T041844Z-v0.1.179.tar.gpg')?.encrypted).toBe(true);
        expect(parseBackupName('imagina-base-20260913T030000Z.dump')).toMatchObject({ kind: 'db_dump', app_version: null });
        expect(parseBackupName('pre-restore-20260913T030000Z.dump')?.kind).toBe('pre_restore');
        // Nada de traversal ni archivos ajenos.
        expect(parseBackupName('../etc/passwd')).toBeNull();
        expect(parseBackupName('restore-20260913T030000Z.log')).toBeNull();
        expect(stampToISO('20260101T235959Z')).toBe('2026-01-01T23:59:59Z');
    });

    it('isSnapshotDue: una por día UTC a partir de la hora elegida; apagado → nunca', () => {
        const s = { enabled: true, hour_utc: 3, keep: 14, include_env: true };
        const at = (iso: string) => new Date(iso);
        expect(isSnapshotDue(s, null, at('2026-09-14T02:59:00Z'))).toBe(false); // todavía no es la hora
        expect(isSnapshotDue(s, null, at('2026-09-14T03:05:00Z'))).toBe(true); // nunca corrió
        expect(isSnapshotDue(s, '2026-09-14T03:06:00.000Z', at('2026-09-14T04:05:00Z'))).toBe(false); // ya corrió hoy
        expect(isSnapshotDue(s, '2026-09-13T03:06:00.000Z', at('2026-09-14T09:05:00Z'))).toBe(true); // el server estuvo apagado a las 3 → sale en el próximo tick
        expect(isSnapshotDue({ ...s, enabled: false }, null, at('2026-09-14T03:05:00Z'))).toBe(false);
    });

    it('nextRunAt: hoy si falta, "ahora" si está pendiente, mañana si ya corrió', () => {
        const s = { enabled: true, hour_utc: 3, keep: 14, include_env: true };
        expect(nextRunAt(s, null, new Date('2026-09-14T01:00:00Z'))).toBe('2026-09-14T03:00:00.000Z');
        expect(nextRunAt(s, null, new Date('2026-09-14T05:00:00Z'))).toBe('2026-09-14T05:00:00.000Z');
        expect(nextRunAt(s, '2026-09-14T03:06:00.000Z', new Date('2026-09-14T05:00:00Z'))).toBe('2026-09-15T03:00:00.000Z');
        expect(nextRunAt({ ...s, enabled: false }, null, new Date())).toBeNull();
    });
});

describe('Copias de seguridad completas (v0.1.179) — snapshot real (Postgres + Redis en contenedores)', () => {
    let pg: TestPg;
    let redisC: TestRedis;
    let redis: Redis;
    let dir: string;
    let uploads: string;
    let svc: BackupsService;

    beforeAll(async () => {
        [pg, redisC] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisC.url);
        dir = mkdtempSync(path.join(tmpdir(), 'imagina-backups-'));
        uploads = path.join(dir, 'uploads');
        mkdirSync(path.join(uploads, 't1'), { recursive: true });
        writeFileSync(path.join(uploads, 't1', 'logo.png'), 'png-bytes');
        await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME', plan: 'trial', status: 'trialing' });
        await redis.set('platform:smtp', JSON.stringify({ host: 'smtp.acme.test', port: 587 }));
        await redis.set('sess:abc', 'no-debe-viajar');
        const env = {
            UPDATER_BASE_PATH: '',
            BACKUPS_DIR: path.join(dir, 'backups'),
            BACKUPS_SCRIPTS_DIR: SCRIPTS,
            DATABASE_URL: pg.container.getConnectionUri(),
            REDIS_URL: redisC.url,
            UPLOADS_DIR: uploads,
            STORAGE_DRIVER: 'local',
            PORT: 3001,
        } as unknown as Env;
        svc = new BackupsService(env, redis, { currentVersion: () => '9.9.9' } as never);
    }, 120_000);

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisC?.stop()]);
        rmSync(dir, { recursive: true, force: true });
    });

    it('createSnapshot corre snapshot.sh: un tar con base + uploads + redis platform:* y manifest legible', async () => {
        const name = await svc.createSnapshot('manual');
        expect(name).toMatch(/^imagina-snapshot-\d{8}T\d{6}Z-v9\.9\.9\.tar$/);
        const run = await svc.run();
        expect(run.status).toBe('success');
        expect(run.file).toBe(name);

        const status = await svc.status();
        expect(status.available).toBe(true);
        expect(status.restore_available).toBe(false); // sin layout de releases: restaurar es por CLI
        expect(status.last_snapshot_at).not.toBeNull();
        expect(status.snapshots).toHaveLength(1);
        const snap = status.snapshots[0]!;
        expect(snap.kind).toBe('snapshot');
        expect(snap.app_version).toBe('9.9.9');
        expect(snap.encrypted).toBe(false);
        expect(snap.includes).toEqual({ uploads: true, redis: true, env: false });
        expect(snap.migrations_applied).toBeGreaterThan(40);
        expect(snap.size_bytes).toBeGreaterThan(1000);

        // El contenido es el prometido — y las sesiones NO viajan.
        const file = svc.resolve(name!);
        const entries = execFileSync('tar', ['-tf', file]).toString();
        expect(entries).toContain('/db.dump');
        expect(entries).toContain('/uploads.tar.gz');
        expect(entries).toContain('/redis-platform.json');
        expect(entries).not.toContain('env.production');
        const redisJson = execFileSync('tar', ['-xOf', file, '--wildcards', '*/redis-platform.json']).toString();
        expect(JSON.parse(redisJson)).toEqual({ 'platform:smtp': JSON.stringify({ host: 'smtp.acme.test', port: 587 }) });
    }, 120_000);

    it('snapshot-restore.sh deja la base, los uploads y Redis como en el snapshot (en una base scratch)', async () => {
        const [snap] = await svc.list();
        const file = svc.resolve(snap!.name);
        const scratchUrl = pg.container.getConnectionUri().replace(/\/[^/]+$/, '/imagina_scratch');
        await pg.pool.query('CREATE DATABASE imagina_scratch');
        const restoredUploads = path.join(dir, 'restored-uploads');
        const out = execFileSync('bash', [path.join(SCRIPTS, 'snapshot-restore.sh'), file, '--yes', '--no-service', '--no-safety', '--skip-env', '--no-migrate'], {
            env: {
                ...process.env,
                DATABASE_URL: scratchUrl,
                REDIS_URL: `${redisC.url.replace(/\/\d+$/, '')}/3`,
                UPLOADS_DIR: restoredUploads,
                APP_VERSION: '9.9.9',
            },
        }).toString();
        expect(out).toContain('✓ restore completo');

        const { Pool } = await import('pg');
        const scratch = new Pool({ connectionString: scratchUrl });
        try {
            const t = await scratch.query('select slug from tenants');
            expect(t.rows.map((r: { slug: string }) => r.slug)).toEqual(['acme']);
            const priv = await scratch.query("select has_table_privilege('imagina_app','records','select') as ok");
            expect(priv.rows[0]!.ok).toBe(true);
            const pol = await scratch.query('select count(*)::int as n from pg_policies');
            expect(pol.rows[0]!.n).toBeGreaterThan(10);
        } finally {
            await scratch.end();
        }
        expect(existsSync(path.join(restoredUploads, 't1', 'logo.png'))).toBe(true);
        const r3 = new Redis(`${redisC.url.replace(/\/\d+$/, '')}/3`);
        try {
            expect(await r3.get('platform:smtp')).toBe(JSON.stringify({ host: 'smtp.acme.test', port: 587 }));
            expect(await r3.get('sess:abc')).toBeNull();
        } finally {
            await r3.quit();
        }
    }, 120_000);

    it('un snapshot más NUEVO que el código se rechaza (código 3) salvo --force-version', async () => {
        const [snap] = await svc.list();
        const file = svc.resolve(snap!.name);
        let code = 0;
        try {
            execFileSync('bash', [path.join(SCRIPTS, 'snapshot-restore.sh'), file, '--dry-run'], {
                env: { ...process.env, DATABASE_URL: pg.container.getConnectionUri(), APP_VERSION: '1.0.0' },
                stdio: 'pipe',
            });
        } catch (err) {
            code = (err as { status: number }).status;
        }
        expect(code).toBe(3);
    });

    it('lee el .env como dotenv, no con `source`: un MAIL_FROM sin comillas con <> no aborta el restore (v0.1.180)', async () => {
        // Regresión atrapada en el simulacro de migración: `.env.production.example`
        // trae `MAIL_FROM=Imagina Base <no-reply@…>` sin comillas y `source` lo
        // interpretaba como comando + redirección → "syntax error near newline".
        const [snap] = await svc.list();
        const file = svc.resolve(snap!.name);
        const envFile = path.join(dir, 'tricky.env');
        writeFileSync(envFile, [
            '# comentario',
            'NODE_ENV=production',
            'MAIL_FROM=Imagina Base <no-reply@acme.test>',
            `DATABASE_URL=${pg.container.getConnectionUri()}`,
            "SMTP_PASS='p#ss=w0rd'",
            '',
        ].join('\n'));
        const { DATABASE_URL: _drop, ...envWithoutDb } = process.env;
        void _drop;
        const out = execFileSync('bash', [path.join(SCRIPTS, 'snapshot-restore.sh'), file, '--dry-run'], {
            env: { ...envWithoutDb, ENV_FILE: envFile, APP_VERSION: '9.9.9' },
            stdio: 'pipe',
        }).toString();
        expect(out).toContain('dry-run: no se cambió nada');
        expect(out).toContain(`SE REEMPLAZA por la del snapshot (${pg.container.getConnectionUri()})`);
    });

    it('SEC-37: el .env de un snapshot no puede traer NODE_OPTIONS, LD_PRELOAD ni proxies (se descartan)', async () => {
        // Se arma un snapshot "ajeno" con un env envenenado y checksums válidos.
        const [snap] = await svc.list();
        const work = mkdtempSync(path.join(tmpdir(), 'sec37-'));
        try {
            execFileSync('tar', ['-xf', svc.resolve(snap!.name), '-C', work]);
            const inner = readdirSync(work).find((d) => d.startsWith('imagina-snapshot-'))!;
            const root = path.join(work, inner);
            writeFileSync(path.join(root, 'env.production'), [
                'NODE_ENV=production',
                `DATABASE_URL=${pg.container.getConnectionUri()}`,
                'NODE_OPTIONS=--require /tmp/pwn.js',
                'export LD_PRELOAD=/tmp/pwn.so',
                'HTTPS_PROXY=http://evil.test:8080',
                'SECRETS_KEY=abc',
                '',
            ].join('\n'));
            const manifest = JSON.parse(execFileSync('cat', [path.join(root, 'manifest.json')]).toString()) as { includes: Record<string, boolean> };
            manifest.includes.env = true;
            writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
            const files = readdirSync(root).filter((f) => f !== 'checksums.sha256');
            writeFileSync(path.join(root, 'checksums.sha256'), execFileSync('sha256sum', files, { cwd: root }));
            const poisoned = path.join(work, `${inner}.tar`);
            execFileSync('tar', ['-cf', poisoned, '-C', work, inner]);

            const { DATABASE_URL: _drop, NODE_OPTIONS: _n, ...envClean } = process.env;
            void _drop;
            void _n;
            const run = spawnSync('bash', [path.join(SCRIPTS, 'snapshot-restore.sh'), poisoned, '--dry-run'], {
                env: { ...envClean, ENV_FILE: path.join(work, 'nuevo', '.env.production'), APP_VERSION: '9.9.9' },
                encoding: 'utf8',
            });
            expect(run.status).toBe(0);
            const res = `${run.stdout}\n${run.stderr}`;
            expect(res).toContain('se descartaron variables que no son de la app: NODE_OPTIONS LD_PRELOAD HTTPS_PROXY');
            expect(res).toContain('dry-run: no se cambió nada');
        } finally {
            rmSync(work, { recursive: true, force: true });
        }
    }, 120_000);

    /** Un snapshot "ajeno": el real, con otro env (y otra versión) y checksums válidos. */
    async function poisonedSnapshot(work: string, envLines: string[], version?: string): Promise<string> {
        const [snap] = await svc.list();
        execFileSync('tar', ['-xf', svc.resolve(snap!.name), '-C', work]);
        const inner = readdirSync(work).find((d) => d.startsWith('imagina-snapshot-'))!;
        const root = path.join(work, inner);
        writeFileSync(path.join(root, 'env.production'), [...envLines, ''].join('\n'));
        const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as { app_version: string; includes: Record<string, boolean> };
        manifest.includes.env = true;
        if (version !== undefined) manifest.app_version = version;
        writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
        const files = readdirSync(root).filter((f) => f !== 'checksums.sha256');
        writeFileSync(path.join(root, 'checksums.sha256'), execFileSync('sha256sum', files, { cwd: root }));
        const out = path.join(work, `${inner}.tar`);
        execFileSync('tar', ['-cf', out, '-C', work, inner]);
        rmSync(root, { recursive: true, force: true });
        return out;
    }
    const cleanEnv = (): NodeJS.ProcessEnv => {
        const { DATABASE_URL: _d, NODE_OPTIONS: _n, REDIS_URL: _r, UPLOADS_DIR: _u, BASE_PATH: _b, ENV_FILE: _e, MIGRATE_CMD: _m, ...rest } = process.env;
        void [_d, _n, _r, _u, _b, _e, _m];
        return rest;
    };

    it('SEC-37 (lista de permitidas): el env de un snapshot no ejecuta MIGRATE_CMD / STOP_CMD ni instala rutas de scripts, repo de actualización o claves desconocidas', async () => {
        const work = mkdtempSync(path.join(tmpdir(), 'sec37b-'));
        const base = path.join(work, 'base');
        mkdirSync(base, { recursive: true });
        const marker = path.join(work, 'pwned');
        const scratchUrl = pg.container.getConnectionUri().replace(/\/[^/]+$/, '/imagina_scratch_env');
        await pg.pool.query('CREATE DATABASE imagina_scratch_env');
        try {
            const poisoned = await poisonedSnapshot(work, [
                'NODE_ENV=production',
                `DATABASE_URL=${scratchUrl}`,
                'SECRETS_KEY=abc',
                'MAIL_FROM=Acme <no-reply@acme.test>',
                `MIGRATE_CMD=touch ${marker}.migrate`,
                `STOP_CMD=touch ${marker}.stop`,
                `START_CMD=touch ${marker}.start`,
                'NODE_OPTIONS=--require /tmp/pwn.js',
                'BACKUPS_SCRIPTS_DIR=/tmp/evil-scripts',
                'RECOVERY_SCRIPT=/tmp/evil.sh',
                'UPDATER_GITHUB_REPO=evil/repo',
                'UPDATER_PUBLIC_KEY=evilkey',
                'PG_CONTAINER=evil-container',
                'MERCADOPAGO_API_URL=https://evil.test',
                `UPLOADS_DIR=${path.join(work, 'evil-uploads')}`,
                'CLAVE_DESCONOCIDA=1',
            ]);
            // Servidor NUEVO: sin env instalado → el script se conecta con el del snapshot y lo instala.
            const run = spawnSync('bash', [path.join(SCRIPTS, 'snapshot-restore.sh'), poisoned, '--yes', '--no-safety', '--skip-redis'], {
                env: { ...cleanEnv(), BASE_PATH: base, APP_VERSION: '9.9.9', STOP_CMD: 'true', START_CMD: 'true' },
                encoding: 'utf8',
            });
            expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
            // Nada de lo del snapshot se ejecutó.
            expect(existsSync(`${marker}.migrate`)).toBe(false);
            expect(existsSync(`${marker}.stop`)).toBe(false);
            expect(existsSync(`${marker}.start`)).toBe(false);
            // Los uploads fueron a la carpeta de ESTE servidor, no a la que decía el snapshot.
            expect(existsSync(path.join(base, 'shared', 'uploads', 't1', 'logo.png'))).toBe(true);
            expect(existsSync(path.join(work, 'evil-uploads'))).toBe(false);
            const installed = readFileSync(path.join(base, 'shared', '.env.production'), 'utf8');
            for (const bad of ['MIGRATE_CMD', 'STOP_CMD', 'START_CMD', 'NODE_OPTIONS', 'BACKUPS_SCRIPTS_DIR', 'RECOVERY_SCRIPT', 'UPDATER_GITHUB_REPO', 'UPDATER_PUBLIC_KEY', 'PG_CONTAINER', 'MERCADOPAGO_API_URL', 'UPLOADS_DIR', 'CLAVE_DESCONOCIDA']) {
                expect(installed, bad).not.toContain(bad);
            }
            // Lo que es configuración de la app sobrevive tal cual.
            expect(installed).toContain('SECRETS_KEY=abc');
            expect(installed).toContain(`DATABASE_URL=${scratchUrl}`);
            expect(installed).toContain('MAIL_FROM=Acme <no-reply@acme.test>');
            expect(installed).toContain(`UPDATER_BASE_PATH=${base}`);
            expect(`${run.stdout}\n${run.stderr}`).toContain('se descartaron variables que no son de la app: MIGRATE_CMD STOP_CMD START_CMD NODE_OPTIONS');

            // Una versión que no es x.y.z en el manifest: no se restaura.
            const work2 = mkdtempSync(path.join(tmpdir(), 'sec37c-'));
            try {
                const badVersion = await poisonedSnapshot(work2, [`DATABASE_URL=${scratchUrl}`], '../../x');
                const r2 = spawnSync('bash', [path.join(SCRIPTS, 'snapshot-restore.sh'), badVersion, '--dry-run'], {
                    env: { ...cleanEnv(), ENV_FILE: path.join(work2, 'nuevo', '.env.production'), APP_VERSION: '9.9.9' },
                    encoding: 'utf8',
                });
                expect(r2.status).not.toBe(0);
                expect(r2.stderr).toContain('versión inválida');
                // bootstrap-server.sh: la versión va a una URL y a una ruta → se rechaza antes de descargar nada.
                const b2 = spawnSync('bash', [path.join(SCRIPTS, 'bootstrap-server.sh'), '--snapshot', badVersion, '--yes'], {
                    env: { ...cleanEnv(), BASE_PATH: path.join(work2, 'srv') },
                    encoding: 'utf8',
                });
                expect(b2.status).not.toBe(0);
                expect(b2.stderr).toContain('versión inválida');
                expect(existsSync(path.join(work2, 'srv', 'releases')) ? readdirSync(path.join(work2, 'srv', 'releases')) : []).toEqual([]);
            } finally {
                rmSync(work2, { recursive: true, force: true });
            }
        } finally {
            rmSync(work, { recursive: true, force: true });
        }
    }, 180_000);

    it('bootstrap-server.sh instala el env del snapshot FILTRADO (antes lo copiaba tal cual) y no ejecuta su MIGRATE_CMD', async () => {
        const work = mkdtempSync(path.join(tmpdir(), 'sec37d-'));
        const base = path.join(work, 'srv');
        const bin = path.join(work, 'bin');
        mkdirSync(bin, { recursive: true });
        const marker = path.join(work, 'pwned');
        const scratchUrl = pg.container.getConnectionUri().replace(/\/[^/]+$/, '/imagina_scratch_boot');
        await pg.pool.query('CREATE DATABASE imagina_scratch_boot');
        try {
            const poisoned = await poisonedSnapshot(work, [
                `DATABASE_URL=${scratchUrl}`,
                `REDIS_URL=${redisC.url.replace(/\/\d+$/, '')}/4`,
                'SECRETS_KEY=abc',
                `MIGRATE_CMD=touch ${marker}`,
                'NODE_OPTIONS=--require /tmp/pwn.js',
                'export LD_PRELOAD=/tmp/pwn.so',
                'BACKUPS_SCRIPTS_DIR=/tmp/evil-scripts',
                'UPDATER_GITHUB_REPO=evil/repo',
                'CLAVE_DESCONOCIDA=1',
            ]);
            // "GitHub" falso: curl entrega un bundle mínimo y su sha256.
            const bundle = path.join(work, 'bundle');
            mkdirSync(path.join(bundle, 'apps', 'api'), { recursive: true });
            mkdirSync(path.join(bundle, 'deploy'), { recursive: true });
            writeFileSync(path.join(bundle, 'VERSION'), '9.9.9\n');
            const zip = path.join(work, 'bundle.zip');
            execFileSync('zip', ['-q', '-r', zip, '.'], { cwd: bundle });
            const sha = execFileSync('sha256sum', [zip]).toString().split(' ')[0]!;
            writeFileSync(
                path.join(bin, 'curl'),
                `#!/usr/bin/env bash\nout=""; url=""\nwhile [[ $# -gt 0 ]]; do case "$1" in -o) out="$2"; shift 2;; -H|--retry) shift 2;; -*) shift;; *) url="$1"; shift;; esac; done\necho "$url" >> "${work}/curl.log"\nif [[ "$url" == *.sha256 ]]; then echo "${sha}  bundle.zip" > "$out"; else cp "${zip}" "$out"; fi\n`,
            );
            chmodSync(path.join(bin, 'curl'), 0o755);
            const run = spawnSync('bash', [path.join(SCRIPTS, 'bootstrap-server.sh'), '--snapshot', poisoned, '--yes'], {
                env: { ...cleanEnv(), PATH: `${bin}:${process.env.PATH}`, BASE_PATH: base },
                encoding: 'utf8',
            });
            expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
            expect(existsSync(marker)).toBe(false);
            const installed = readFileSync(path.join(base, 'shared', '.env.production'), 'utf8');
            for (const bad of ['MIGRATE_CMD', 'NODE_OPTIONS', 'LD_PRELOAD', 'BACKUPS_SCRIPTS_DIR', 'evil/repo', 'CLAVE_DESCONOCIDA']) {
                expect(installed, bad).not.toContain(bad);
            }
            expect(installed).toContain('SECRETS_KEY=abc');
            expect(installed).toContain(`DATABASE_URL=${scratchUrl}`);
            // De dónde se actualiza y dónde vive: de ESTE servidor.
            expect(installed).toContain('UPDATER_GITHUB_REPO=augusto97/imagina-crm-cloud');
            expect(installed).toContain(`UPDATER_BASE_PATH=${base}`);
            expect(readFileSync(path.join(work, 'curl.log'), 'utf8')).toContain('/releases/download/v9.9.9/imagina-base-9.9.9.zip');
        } finally {
            rmSync(work, { recursive: true, force: true });
        }
    }, 180_000);

    it('settings: defaults, PATCH parcial persiste en Redis (platform:*), y el tick respeta la hora', async () => {
        expect(await svc.getSettings()).toEqual({ enabled: false, hour_utc: 3, keep: 14, include_env: true });
        const set = await svc.setSettings({ enabled: true, hour_utc: 22 });
        expect(set).toEqual({ enabled: true, hour_utc: 22, keep: 14, include_env: true });
        expect(await redis.get('platform:backups')).not.toBeNull();
        // Ya se hizo una copia hoy → el tick no dispara otra.
        expect(await svc.tick(new Date())).toBe(false);
    });

    it('resolve/remove: nombres estrictos, restore por panel rechazado sin layout, borrado real', async () => {
        const [snap] = await svc.list();
        expect(() => svc.resolve('../../etc/passwd')).toThrow(NotFoundException);
        expect(() => svc.resolve('imagina-snapshot-20200101T000000Z-v0.0.1.tar')).toThrow(NotFoundException);
        await expect(svc.restore(snap!.name)).rejects.toBeInstanceOf(ConflictException);
        svc.remove(snap!.name);
        expect(readdirSync(path.join(dir, 'backups')).filter((n) => n.startsWith('imagina-snapshot-'))).toHaveLength(0);
        expect(await svc.list()).toHaveLength(0);
    });
});
