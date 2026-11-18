import { describe, expect, it } from 'vitest';
import { buildVerifyResult, parseVerifyOutput, type VerifyRaw } from '../src/update/backup-verify';

/**
 * v0.1.440 — Del resultado del script de prueba de una copia a lo que ve la
 * persona: cada control y una línea con el veredicto.
 */
const NOW = new Date('2026-11-18T10:00:00Z');
const input = { name: 'imagina-snapshot-20261118T030500Z-v0.1.440.tar', trigger: 'scheduled' as const, now: NOW };

function good(over: Partial<VerifyRaw> = {}): VerifyRaw {
    return {
        code: 0,
        stage: null,
        error: null,
        skip: null,
        duration_seconds: 42,
        tar_bytes: 1000,
        checksums_ok: true,
        manifest: {
            app_version: '0.1.440',
            created_at: '2026-11-18T03:05:00Z',
            migrations_applied: 128,
            storage_driver: 'local',
            includes: { uploads: true, redis: true, env: true },
        },
        db: {
            restored: true,
            restore_seconds: 30,
            migrations: 128,
            tables: 101,
            policies: 90,
            grants_ok: true,
            counts: { tenants: 12, users: 28, lists: 511, fields: 4599, records: 5762 },
        },
        live: { tenants: 12, users: 28, lists: 511, fields: 4599, records: 5800 },
        uploads: { ok: true, files: 98 },
        platform_keys: 4,
        env: { secrets_key: true, files_signing_secret: true, database_url: true },
        ...over,
    };
}

describe('Probar una copia (v0.1.440) — veredicto', () => {
    it('lee la última línea VERIFY_JSON de la salida y no se rompe con basura', () => {
        const raw = good();
        expect(parseVerifyOutput(`→ algo\nVERIFY_JSON {"code":9}\nVERIFY_JSON ${JSON.stringify(raw)}\n`)?.code).toBe(0);
        expect(parseVerifyOutput('nada')).toBeNull();
        expect(parseVerifyOutput('VERIFY_JSON {roto')).toBeNull();
    });

    it('todo bien: ocho controles en verde y el resumen con lo que trae', () => {
        const r = buildVerifyResult(good(), input);
        expect(r.status).toBe('ok');
        expect(r.checks.map((c) => c.key)).toEqual(['checksums', 'restore', 'migrations', 'structure', 'data', 'uploads', 'platform', 'env']);
        expect(r.checks.every((c) => c.status === 'ok')).toBe(true);
        expect(r.summary).toBe('La copia se restaura: trae 12 empresas · 28 personas · 511 listas · 5.762 registros.');
        expect(r).toMatchObject({ trigger: 'scheduled', verified_at: NOW.toISOString(), skip_code: null });
    });

    it('migraciones que no coinciden, sin permisos o sin reglas de acceso → NO se puede restaurar', () => {
        const migr = buildVerifyResult(good({ db: { ...good().db!, migrations: 120 } }), input);
        expect(migr.status).toBe('failed');
        expect(migr.summary).toMatch(/dice que tenía 128 y la base restaurada trae 120/);
        expect(buildVerifyResult(good({ db: { ...good().db!, grants_ok: false } }), input).checks.find((c) => c.key === 'structure')?.status).toBe('failed');
        expect(buildVerifyResult(good({ db: { ...good().db!, policies: 0 } }), input).status).toBe('failed');
    });

    it('sin empresas cuando la base de hoy tiene: falla; muchos menos registros en una copia reciente: aviso', () => {
        const empty = good({ db: { ...good().db!, counts: { tenants: 0, users: 0, lists: 0, fields: 0, records: 0 } } });
        expect(buildVerifyResult(empty, input).status).toBe('failed');
        const fewer = good({ db: { ...good().db!, counts: { tenants: 12, users: 28, lists: 511, fields: 4599, records: 100 } } });
        const r = buildVerifyResult(fewer, input);
        expect(r.status).toBe('warning');
        expect(r.summary).toMatch(/con un aviso: Trae 100 registros y la base de hoy tiene 5.800/);
        // La misma copia, pero vieja (una semana): es normal que tenga menos.
        const old = { ...fewer, manifest: { ...fewer.manifest!, created_at: '2026-11-10T03:05:00Z' } };
        expect(buildVerifyResult(old, input).status).toBe('ok');
    });

    it('le falta una parte: aviso (sin archivos, sin ajustes, .env sin SECRETS_KEY); sin .env a propósito: bien', () => {
        const noUploads = good({ manifest: { ...good().manifest!, includes: { uploads: false, redis: true, env: true } }, uploads: null });
        expect(buildVerifyResult(noUploads, input).checks.find((c) => c.key === 'uploads')?.status).toBe('warning');
        const noRedis = good({ manifest: { ...good().manifest!, includes: { uploads: true, redis: false, env: true } } });
        expect(buildVerifyResult(noRedis, input).status).toBe('warning');
        const noKey = good({ env: { secrets_key: false, files_signing_secret: true, database_url: true } });
        expect(buildVerifyResult(noKey, input).checks.find((c) => c.key === 'env')?.status).toBe('warning');
        const noEnv = good({ manifest: { ...good().manifest!, includes: { uploads: true, redis: true, env: false } }, env: null });
        expect(buildVerifyResult(noEnv, input).status).toBe('ok');
        const s3 = good({ manifest: { ...good().manifest!, storage_driver: 's3', includes: { uploads: false, redis: true, env: true } }, uploads: null });
        expect(buildVerifyResult(s3, input).checks.find((c) => c.key === 'uploads')?.detail).toMatch(/bucket/);
    });

    it('falla del script por etapa: sumas, restauración; y «no se probó» no dice nada de la copia', () => {
        const sums = buildVerifyResult({ ...good(), code: 1, stage: 'checksums', error: 'Las sumas no coinciden', checksums_ok: false, manifest: null, db: null, live: null, uploads: null, platform_keys: null, env: null }, input);
        expect(sums.status).toBe('failed');
        expect(sums.checks).toEqual([{ key: 'checksums', label: 'El archivo está completo', status: 'failed', detail: 'Las sumas no coinciden' }]);

        const restore = buildVerifyResult({ ...good(), code: 1, stage: 'restore', error: 'La base de la copia NO se pudo restaurar: end of file', db: { ...good().db!, restored: false, counts: null, migrations: null } }, input);
        expect(restore.status).toBe('failed');
        expect(restore.checks.find((c) => c.key === 'restore')).toMatchObject({ status: 'failed', detail: 'La base de la copia NO se pudo restaurar: end of file' });
        expect(restore.checks.find((c) => c.key === 'migrations')).toBeUndefined();

        const disk = buildVerifyResult({ ...good(), code: 2, stage: 'disk', skip: 'no_space', error: 'Falta espacio en disco' }, input);
        expect(disk).toMatchObject({ status: 'skipped', skip_code: 'no_space', checks: [], summary: 'No se probó: Falta espacio en disco' });

        const crashed = buildVerifyResult(null, { ...input, processError: 'bash: node: command not found' });
        expect(crashed).toMatchObject({ status: 'skipped', skip_code: 'error' });
        expect(crashed.summary).toContain('node: command not found');
    });
});
