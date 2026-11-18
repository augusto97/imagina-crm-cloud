import type { BackupVerify, BackupVerifyCheck, BackupVerifyCounts } from '@imagina-base/shared';

/**
 * v0.1.440 — Lo que devuelve `scripts/snapshot-verify.sh` (la línea
 * `VERIFY_JSON {…}`) → el resultado de la prueba de una copia, con un control
 * por cosa revisada y una línea para la persona. Puro: lo prueban los tests
 * sin restaurar nada.
 */
export interface VerifyRaw {
    code: number;
    stage: string | null;
    error: string | null;
    skip: string | null;
    duration_seconds: number | null;
    tar_bytes: number | null;
    checksums_ok: boolean | null;
    manifest: {
        app_version: string | null;
        created_at: string | null;
        migrations_applied: number | null;
        storage_driver: string | null;
        includes: { uploads: boolean; redis: boolean; env: boolean };
    } | null;
    db: {
        restored: boolean;
        restore_seconds: number | null;
        migrations: number | null;
        tables: number | null;
        policies: number | null;
        grants_ok: boolean | null;
        counts: BackupVerifyCounts | null;
    } | null;
    live: BackupVerifyCounts | null;
    uploads: { ok: boolean; files: number | null } | null;
    platform_keys: number | null;
    env: { secrets_key: boolean; files_signing_secret: boolean; database_url: boolean } | null;
}

/** La última línea `VERIFY_JSON …` de la salida del script (o null). */
export function parseVerifyOutput(stdout: string): VerifyRaw | null {
    const lines = stdout.split('\n').filter((l) => l.startsWith('VERIFY_JSON '));
    const last = lines[lines.length - 1];
    if (!last) return null;
    try {
        const raw = JSON.parse(last.slice('VERIFY_JSON '.length)) as VerifyRaw;
        return typeof raw === 'object' && raw !== null && typeof raw.code === 'number' ? raw : null;
    } catch {
        return null;
    }
}

const nf = new Intl.NumberFormat('es-CO');
const n = (v: number | null | undefined): string => nf.format(v ?? 0);
function plural(v: number | null | undefined, one: string, many: string): string {
    return `${n(v)} ${v === 1 ? one : many}`;
}
function secs(v: number | null | undefined): string {
    const s = Math.max(0, Math.round(v ?? 0));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

/** «12 empresas · 28 personas · 511 listas · 5.762 registros». */
export function countsText(c: BackupVerifyCounts): string {
    return [
        plural(c.tenants, 'empresa', 'empresas'),
        plural(c.users, 'persona', 'personas'),
        plural(c.lists, 'lista', 'listas'),
        plural(c.records, 'registro', 'registros'),
    ].join(' · ');
}

const DAY = 86_400_000;

export interface BuildVerifyInput {
    name: string;
    trigger: 'manual' | 'scheduled';
    now: Date;
    /** Si no hubo VERIFY_JSON: las últimas líneas del error del proceso. */
    processError?: string | null;
}

export function buildVerifyResult(raw: VerifyRaw | null, input: BuildVerifyInput): BackupVerify {
    const base = {
        name: input.name,
        verified_at: input.now.toISOString(),
        trigger: input.trigger,
    };
    if (!raw) {
        const why = (input.processError ?? '').trim() || 'el proceso terminó sin resultado';
        return {
            ...base,
            status: 'skipped',
            summary: `No se pudo terminar la prueba: ${why}`.slice(0, 500),
            duration_seconds: null,
            checks: [],
            counts: null,
            skip_code: 'error',
        };
    }
    if (raw.code === 2) {
        return {
            ...base,
            status: 'skipped',
            summary: `No se probó: ${raw.error ?? 'sin detalle'}`,
            duration_seconds: raw.duration_seconds,
            checks: [],
            counts: null,
            skip_code: raw.skip ?? 'error',
        };
    }

    const checks: BackupVerifyCheck[] = [];
    const add = (key: string, label: string, status: BackupVerifyCheck['status'], detail: string | null) => checks.push({ key, label, status, detail });
    const failedAt = raw.code !== 0 ? raw.stage : null;

    // 1. El archivo.
    if (raw.checksums_ok === true) add('checksums', 'El archivo está completo', 'ok', 'Las sumas de cada parte coinciden: no está dañado ni lo modificaron.');
    else if (failedAt && ['open', 'decrypt', 'extract', 'checksums', 'manifest', 'platform'].includes(failedAt)) {
        add('checksums', 'El archivo está completo', 'failed', raw.error);
    }

    const m = raw.manifest;
    const db = raw.db;
    // 2. La base se restaura.
    if (db) {
        if (db.restored) add('restore', 'La base se restaura', 'ok', `Se restauró en una base de prueba en ${secs(db.restore_seconds)}.`);
        else add('restore', 'La base se restaura', 'failed', raw.error);
    } else if (failedAt === 'scratch' || failedAt === 'restore') {
        add('restore', 'La base se restaura', 'failed', raw.error);
    }

    if (db?.restored) {
        // 3. Migraciones.
        const want = m?.migrations_applied ?? null;
        if (db.migrations === null) add('migrations', 'Trae todas las migraciones', 'failed', 'La base restaurada no tiene el registro de migraciones.');
        else if (want && want > 0 && db.migrations !== want) {
            add('migrations', 'Trae todas las migraciones', 'failed', `La copia dice que tenía ${n(want)} y la base restaurada trae ${n(db.migrations)}.`);
        } else add('migrations', 'Trae todas las migraciones', 'ok', `${n(db.migrations)} migraciones.`);

        // 4. Estructura, reglas de acceso y permisos del rol de la app.
        if (db.grants_ok === false) {
            add('structure', 'Tablas y permisos', 'failed', 'Faltan los permisos del rol de la app: restaurada, la app no podría leer los datos.');
        } else if (!db.policies) {
            add('structure', 'Tablas y permisos', 'failed', 'Faltan las reglas que separan los datos de cada empresa.');
        } else if ((db.tables ?? 0) < 20) {
            add('structure', 'Tablas y permisos', 'failed', `Trae sólo ${n(db.tables)} tablas.`);
        } else {
            add('structure', 'Tablas y permisos', 'ok', `${n(db.tables)} tablas, con los permisos y las reglas de acceso de cada empresa.`);
        }

        // 5. Los datos.
        const c = db.counts;
        const live = raw.live;
        if (!c) add('data', 'Trae los datos', 'failed', raw.error ?? 'No se pudieron contar los datos.');
        else if ((c.tenants ?? 0) === 0 && (live?.tenants ?? 0) > 0) {
            add('data', 'Trae los datos', 'failed', `La copia no trae ninguna empresa y la base de hoy tiene ${n(live?.tenants)}.`);
        } else {
            const created = m?.created_at ? Date.parse(m.created_at) : NaN;
            const recent = Number.isFinite(created) && input.now.getTime() - created <= 3 * DAY;
            const liveRecords = live?.records ?? 0;
            if (recent && liveRecords >= 100 && (c.records ?? 0) < liveRecords * 0.5) {
                add('data', 'Trae los datos', 'warning', `Trae ${n(c.records)} registros y la base de hoy tiene ${n(liveRecords)}: revisa que la copia esté completa. (${countsText(c)})`);
            } else {
                add('data', 'Trae los datos', 'ok', countsText(c));
            }
        }
    }

    if (m && (raw.code === 0 || failedAt === 'restore' || failedAt === 'inspect')) {
        // 6. Archivos subidos.
        if (m.storage_driver === 's3') add('uploads', 'Archivos subidos', 'ok', 'Viven en el bucket de archivos: no viajan en la copia.');
        else if (m.includes.uploads && raw.uploads?.ok) add('uploads', 'Archivos subidos', 'ok', `${plural(raw.uploads.files, 'archivo', 'archivos')}, completos.`);
        else if (!m.includes.uploads) add('uploads', 'Archivos subidos', 'warning', 'La copia no trae los archivos subidos (no estaba su carpeta al copiar).');

        // 7. Ajustes de la plataforma (Redis platform:*).
        if (m.includes.redis) add('platform', 'Ajustes de la plataforma', 'ok', `${plural(raw.platform_keys, 'ajuste', 'ajustes')} (correo de la plataforma, copias, marca…).`);
        else add('platform', 'Ajustes de la plataforma', 'warning', 'La copia no trae los ajustes de la plataforma (Redis no respondió al copiar): el correo de la plataforma y otros ajustes habría que cargarlos de nuevo.');

        // 8. Secretos del servidor.
        if (!m.includes.env) {
            add('env', 'Secretos del servidor', 'ok', 'No los trae (así está elegido): sirve para volver atrás en este servidor; para mudarse a otro hacen falta.');
        } else if (raw.env && !raw.env.secrets_key) {
            add('env', 'Secretos del servidor', 'warning', 'El .env de la copia no trae SECRETS_KEY: en otro servidor no se podrían leer las contraseñas guardadas.');
        } else {
            add('env', 'Secretos del servidor', 'ok', 'Trae el .env con los secretos: sirve también para mudarse a otro servidor.');
        }
    }

    // Por si el script falló en una etapa sin control propio.
    if (raw.code !== 0 && !checks.some((c) => c.status === 'failed')) add('error', 'Prueba', 'failed', raw.error ?? 'La prueba falló.');

    const failed = checks.find((c) => c.status === 'failed');
    const warning = checks.find((c) => c.status === 'warning');
    const counts = db?.counts ?? null;
    const status: BackupVerify['status'] = failed ? 'failed' : warning ? 'warning' : 'ok';
    const summary = failed
        ? `Esta copia NO se puede restaurar: ${failed.detail ?? failed.label}`
        : warning
          ? `La copia se restaura, con un aviso: ${warning.detail ?? warning.label}`
          : `La copia se restaura${counts ? `: trae ${countsText(counts)}` : ''}.`;
    return { ...base, status, summary: summary.slice(0, 600), duration_seconds: raw.duration_seconds, checks, counts, skip_code: null };
}
