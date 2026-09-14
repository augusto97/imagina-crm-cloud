import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
