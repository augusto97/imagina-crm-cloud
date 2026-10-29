import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type Redis from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config/env';
import type { MailService } from '../src/mail/mail.service';
import {
    PostgresWalService,
    STUCK_PENDING,
    archiveDirFromCommand,
    commandCompresses,
    compressScript,
    isLocalDatabase,
    safeDir,
    walHealth,
} from '../src/update/postgres-wal';

/**
 * v0.1.337 — Un servidor de producción juntó 45 GB de WAL en 20 días: el
 * volumen del archivo nacía `root:root`, Postgres no podía escribir, el
 * archivado fallaba siempre y nada lo avisaba. Estos tests reproducen ese
 * estado con un Postgres real y prueban la salida sin consola; y prueban que
 * la configuración nueva del compose arranca bien aunque la carpeta nazca de
 * root.
 */

const COMPOSE = readFileSync(path.join(__dirname, '..', '..', '..', 'deploy', 'docker-compose.prod.yml'), 'utf8');
/** `$$` es `$` para docker compose. */
const unescape = (s: string): string => s.replace(/\$\$/g, '$');
const unquote = (s: string): string => s.replace(/^'(.*)'$/, '$1');

/** El archive_command del compose, tal como lo recibe Postgres. */
function composeArchiveCommand(): string {
    const line = COMPOSE.split('\n').find((l) => l.includes('archive_command='));
    if (!line) throw new Error('el compose no tiene archive_command');
    return unescape(unquote(line.trim().replace(/^- /, ''))).replace(/^archive_command=/, '');
}

/** El entrypoint del servicio postgres del compose. */
function composeEntrypoint(): string[] {
    const lines = COMPOSE.split('\n');
    const i = lines.findIndex((l) => l.trim() === 'entrypoint:');
    if (i < 0) throw new Error('el compose no tiene entrypoint');
    const out: string[] = [];
    for (const l of lines.slice(i + 1)) {
        const m = /^\s+- (.*)$/.exec(l);
        if (!m) break;
        out.push(unescape(unquote(m[1]!)));
    }
    return out;
}

const OLD_COMMAND = 'test ! -f /wal_archive/%f && cp %p /wal_archive/%f && (find /wal_archive -type f -mmin +4320 -delete || true)';

function fakeRedis(): Redis & { keys: Map<string, string> } {
    const keys = new Map<string, string>();
    return {
        keys,
        set: async (k: string, v: string, ..._rest: unknown[]) => {
            if (keys.has(k)) return null;
            keys.set(k, v);
            return 'OK';
        },
        del: async (k: string) => (keys.delete(k) ? 1 : 0),
    } as unknown as Redis & { keys: Map<string, string> };
}

async function sh(c: StartedPostgreSqlContainer, script: string, user = 'root'): Promise<string> {
    const r = await c.exec(['sh', '-c', script], { user });
    if (r.exitCode !== 0) throw new Error(`exec ${r.exitCode}: ${r.output}`);
    return r.output.trim();
}

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 90_000): Promise<T> {
    const end = Date.now() + ms;
    let last = await fn();
    while (!ok(last)) {
        if (Date.now() > end) throw new Error(`timeout esperando condición (último: ${JSON.stringify(last)})`);
        await new Promise((r) => setTimeout(r, 500));
        last = await fn();
    }
    return last;
}

async function makeWal(pool: Pool, segments: number): Promise<void> {
    await pool.query('CREATE TABLE IF NOT EXISTS walgen (x text)');
    for (let i = 0; i < segments; i++) {
        await pool.query("INSERT INTO walgen SELECT repeat('x', 200) FROM generate_series(1, 2000)");
        await pool.query('SELECT pg_switch_wal()');
    }
}

describe('v0.1.337 — piezas puras', () => {
    it('la carpeta del archivo sale del archive_command (viejo y nuevo) y sólo si es una ruta segura', () => {
        expect(archiveDirFromCommand(OLD_COMMAND)).toBe('/wal_archive');
        expect(archiveDirFromCommand(composeArchiveCommand())).toBe('/wal_archive');
        expect(archiveDirFromCommand('cp %p /mnt/../etc/%f')).toBeNull();
        expect(archiveDirFromCommand('(disabled)')).toBeNull();
        expect(safeDir('/wal_archive')).toBe(true);
        expect(safeDir('/wal archive')).toBe(false);
        expect(safeDir('/x;rm -rf /')).toBe(false);
    });

    it('el comando nuevo comprime; el viejo no', () => {
        expect(commandCompresses(composeArchiveCommand())).toBe(true);
        expect(commandCompresses(OLD_COMMAND)).toBe(false);
    });

    it('«fallando» = pendientes acumulados y el último intento fallido es posterior al último bueno', () => {
        const base = { mode: 'on', archived_count: 10, failed_count: 3 };
        expect(walHealth({ ...base, pending: 40, last_archived_at: null, last_failed_at: '2026-10-29T10:00:00Z' })).toBe('failing');
        expect(walHealth({ ...base, pending: 40, last_archived_at: '2026-10-29T09:00:00Z', last_failed_at: '2026-10-29T10:00:00Z' })).toBe('failing');
        // Un fallo que ya se recuperó no cuenta.
        expect(walHealth({ ...base, pending: 1, last_archived_at: '2026-10-29T11:00:00Z', last_failed_at: '2026-10-29T10:00:00Z' })).toBe('ok');
        // Un fallo reciente con pocos pendientes todavía no es «trabado».
        expect(walHealth({ ...base, pending: STUCK_PENDING - 1, last_archived_at: null, last_failed_at: '2026-10-29T10:00:00Z' })).toBe('ok');
        expect(walHealth({ ...base, mode: 'off', pending: 99, last_archived_at: null, last_failed_at: null })).toBe('off');
        expect(walHealth({ ...base, pending: null, last_archived_at: null, last_failed_at: null })).toBe('unknown');
    });

    it('la base es local sólo si apunta a esta máquina', () => {
        expect(isLocalDatabase('postgres://u:p@127.0.0.1:5432/db')).toBe(true);
        expect(isLocalDatabase('postgres://u:p@localhost/db')).toBe(true);
        expect(isLocalDatabase('postgres://u:p@[::1]:5432/db')).toBe(true);
        expect(isLocalDatabase('postgres://u:p@db.example.com/db')).toBe(false);
    });

    it('comprimir sólo toca nombres de segmento y conserva la fecha (la poda de 3 días se mide por fecha)', () => {
        const s = compressScript('/wal_archive');
        expect(s).toContain("-name '[0-9A-F]*' ! -name '*.*'");
        expect(s).toContain('touch -r "$f" "$f.gz.tmp"');
        expect(s).toContain('-mmin +4320 -delete');
    });
});

describe('v0.1.337 — archivado trabado por permiso (configuración vieja, carpeta de root)', () => {
    let c: StartedPostgreSqlContainer;
    let pool: Pool;
    let svc: PostgresWalService;
    let redis: ReturnType<typeof fakeRedis>;
    const enqueue = vi.fn(async () => undefined);

    beforeAll(async () => {
        c = await new PostgreSqlContainer('postgres:16-alpine')
            // La carpeta del archivo nace como en producción: de root, 755.
            .withTmpFs({ '/wal_archive': 'rw,mode=755' })
            .withCommand([
                'postgres',
                '-c', 'wal_level=replica',
                '-c', 'archive_mode=on',
                '-c', `archive_command=${OLD_COMMAND}`,
                '-c', 'fsync=off',
                // Con el default (1 GB) Postgres RECICLA los segmentos en vez de
                // borrarlos y el test no vería el espacio liberado.
                '-c', 'max_wal_size=64MB',
                '-c', 'min_wal_size=32MB',
            ])
            .start();
        pool = new Pool({ connectionString: c.getConnectionUri(), max: 4 });
        redis = fakeRedis();
        const env = loadEnv({ DATABASE_URL: c.getConnectionUri(), PLATFORM_SUPERADMINS: 'ops@example.com', APP_BASE_URL: 'https://base.example.com' });
        svc = new PostgresWalService(pool, env, redis, { enqueue } as unknown as MailService);
        svc.rootRunner = (script) => sh(c, script).then(() => undefined);
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await c?.stop();
    });

    it('mide la base y el WAL, ve que nunca archivó nada y dice por qué', async () => {
        await makeWal(pool, STUCK_PENDING + 4);
        const s = await until(
            () => svc.status(),
            (v) => v.health === 'failing',
        );
        expect(s.available).toBe(true);
        expect(s.archive_mode).toBe('on');
        expect(s.archive_dir).toBe('/wal_archive');
        expect(s.archive_compressed).toBe(false);
        expect(s.archived_count).toBe(0);
        expect(s.failed_count).toBeGreaterThan(0);
        expect(s.pending).toBeGreaterThanOrEqual(STUCK_PENDING);
        expect(s.wal_bytes).toBeGreaterThanOrEqual((s.pending ?? 0) * 16 * 1024 * 1024);
        expect(s.archive_files).toBe(0);
        expect(s.db_bytes).toBeGreaterThan(0);
        // Postgres no puede escribir en la carpeta del archivo.
        expect(s.problem).toBe('not_writable');
    }, 120_000);

    it('avisa una sola vez a los superadmins cuando no se puede reparar solo', async () => {
        const real = svc.rootRunner;
        svc.rootRunner = async () => {
            throw new Error('permission denied while trying to connect to the Docker daemon socket');
        };
        await svc.tick();
        await svc.tick();
        svc.rootRunner = real;
        const walMails = enqueue.mock.calls.filter((args) => (args as unknown as [{ subject: string }])[0].subject.includes('registro de cambios'));
        expect(walMails).toHaveLength(1);
        const msg = (walMails[0] as unknown as [{ to: string; text: string }])[0];
        expect(msg.to).toBe('ops@example.com');
        expect(msg.text).toContain('nunca archivó nada');
        expect(msg.text).toContain('no tiene permiso para escribir en /wal_archive');
        expect(msg.text).toContain('Liberar y reparar');
        expect(msg.text).toContain('https://base.example.com/#/platform?tab=diagnostico');
    }, 60_000);

    it('«Liberar y reparar»: libera el atraso SIN copiarlo y le devuelve la carpeta a postgres', async () => {
        const before = await svc.status();
        const r = await svc.release();
        expect(r.marked).toBeGreaterThanOrEqual(STUCK_PENDING);
        expect(r.freed_bytes).toBeGreaterThan(0);
        expect(r.permission).toBe('fixed');
        expect(r.wal_bytes).toBeLessThan(before.wal_bytes ?? 0);
        // No se copió nada al archivo (el atraso habría llenado el disco).
        expect(await sh(c, 'ls /wal_archive | wc -l')).toBe('0');
        expect(await sh(c, 'stat -c %U /wal_archive')).toBe('postgres');
        // Lo nuevo se archiva.
        await makeWal(pool, 2);
        const after = await until(
            () => svc.status(),
            (v) => (v.archived_count ?? 0) >= 2 && v.health === 'ok',
        );
        expect(after.pending).toBeLessThan(STUCK_PENDING);
        expect(after.archive_files).toBeGreaterThanOrEqual(2);
        // Ya no hay nada que liberar.
        expect((await svc.release()).marked).toBe(0);
    }, 120_000);

    it('con el comando viejo, comprime lo archivado conservando la fecha', async () => {
        // Fechas de hace una hora: más viejas que el mínimo para comprimir y más nuevas que la poda.
        const t = new Date(Date.now() - 3600_000);
        const stamp = `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}${String(t.getUTCHours()).padStart(2, '0')}${String(t.getUTCMinutes()).padStart(2, '0')}`;
        await sh(c, `TZ=UTC touch -t ${stamp} /wal_archive/*`);
        const plain = (await sh(c, 'ls /wal_archive')).split(/\s+/).filter(Boolean);
        expect(plain.length).toBeGreaterThan(0);
        expect(plain.filter((f) => !/^[0-9A-F]{24}$/.test(f))).toEqual([]);
        const s = await svc.status();
        await svc.compressArchive(s);
        const files = (await sh(c, 'ls /wal_archive')).split(/\s+/).filter(Boolean);
        expect(files.sort()).toEqual(plain.map((f) => `${f}.gz`).sort());
        const mtime = await sh(c, `stat -c %Y /wal_archive/${files[0]}`);
        expect(Math.abs(Number(mtime) * 1000 - t.getTime())).toBeLessThan(120_000);
        // Los comprimidos pesan mucho menos que 16 MB.
        const after = await svc.status();
        expect(after.archive_bytes).toBeLessThan(files.length * 4 * 1024 * 1024);
    }, 60_000);

    it('si vuelve a fallar con poco atraso, la revisión lo repara sola y no avisa', async () => {
        await sh(c, 'chown root:root /wal_archive');
        await makeWal(pool, STUCK_PENDING + 2);
        await until(
            () => svc.status(),
            (v) => v.health === 'failing',
        );
        redis.keys.clear();
        enqueue.mockClear();
        await svc.tick();
        expect(await sh(c, 'stat -c %U /wal_archive')).toBe('postgres');
        expect(enqueue.mock.calls.filter((args) => (args as unknown as [{ subject: string }])[0].subject.includes('registro de cambios'))).toHaveLength(0);
        await until(
            () => svc.status(),
            (v) => v.health === 'ok' && (v.pending ?? 99) < STUCK_PENDING,
        );
    }, 150_000);
});

describe('v0.1.337 — la configuración nueva del compose', () => {
    let c: StartedPostgreSqlContainer;
    let pool: Pool;
    let svc: PostgresWalService;

    beforeAll(async () => {
        const ep = composeEntrypoint();
        expect(ep[0]).toBe('sh');
        c = await new PostgreSqlContainer('postgres:16-alpine')
            .withTmpFs({ '/wal_archive': 'rw,mode=755' })
            .withEntrypoint(ep)
            .withCommand(['postgres', '-c', 'wal_level=replica', '-c', 'archive_mode=on', '-c', `archive_command=${composeArchiveCommand()}`, '-c', 'fsync=off'])
            .start();
        pool = new Pool({ connectionString: c.getConnectionUri(), max: 4 });
        svc = new PostgresWalService(pool, loadEnv({ DATABASE_URL: c.getConnectionUri() }), fakeRedis());
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await c?.stop();
    });

    it('el entrypoint le da la carpeta a postgres y el archivado sale comprimido', async () => {
        expect(await sh(c, 'stat -c %U /wal_archive')).toBe('postgres');
        await makeWal(pool, 3);
        const s = await until(
            () => svc.status(),
            (v) => (v.archived_count ?? 0) >= 3,
        );
        expect(s.health).toBe('ok');
        expect(s.failed_count).toBe(0);
        expect(s.archive_compressed).toBe(true);
        const files = (await sh(c, 'ls /wal_archive')).split(/\s+/).filter(Boolean);
        expect(files.length).toBeGreaterThanOrEqual(3);
        expect(files.every((f) => f.endsWith('.gz'))).toBe(true);
        // Un segmento que cerró casi vacío pesa KB, no 16 MB.
        expect(s.archive_bytes).toBeLessThan(files.length * 4 * 1024 * 1024);
    }, 120_000);

    it('es idempotente: si el segmento ya está archivado (corte entre copiar y marcar), sigue', async () => {
        const next = (await pool.query<{ f: string }>('SELECT pg_walfile_name(pg_current_wal_lsn()) AS f')).rows[0]!.f;
        await sh(c, `echo viejo | gzip > /wal_archive/${next}.gz && chown postgres:postgres /wal_archive/${next}.gz`);
        const before = await svc.status();
        // Un switch sin escrituras no cierra un segmento nuevo.
        await pool.query("INSERT INTO walgen VALUES ('y')");
        await pool.query('SELECT pg_switch_wal()');
        await until(
            () => svc.status(),
            (v) => (v.archived_count ?? 0) > (before.archived_count ?? 0),
        );
        const s = await svc.status();
        expect(s.failed_count).toBe(0);
        // No pisó el que ya estaba.
        expect(await sh(c, `gunzip -c /wal_archive/${next}.gz`)).toBe('viejo');
    }, 60_000);

    it('no deja archivos a medias si la copia falla (escribe a .tmp y renombra)', () => {
        const cmd = composeArchiveCommand();
        expect(cmd).toContain('.gz.tmp');
        expect(cmd).toMatch(/mv -f "\$f\.gz\.tmp" "\$f\.gz"/);
    });
});
