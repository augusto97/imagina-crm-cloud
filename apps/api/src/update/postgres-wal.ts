import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PostgresWalHealth, PostgresWalStatus, WalReleaseResult } from '@imagina-base/shared';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type Redis from 'ioredis';
import type { Pool, PoolClient } from 'pg';
import { ENV, type Env } from '../config/env';
import { PG_POOL } from '../db/client';
import { MailService } from '../mail/mail.service';
import { recordServerError } from '../observability/diagnostics';
import { REDIS } from '../redis/redis.module';
import { LayoutDisk, freeBytes, freeInodes, MIN_FREE_INODES } from './disk-space';

const run = promisify(execFile);

/**
 * v0.1.337 — El registro de cambios de Postgres (WAL), vigilado desde la app.
 *
 * Nació de un servidor que se llenó con 45 GB de WAL en 20 días sin que nadie
 * se enterara: el volumen del archivo (`/wal_archive`) nacía `root:root`,
 * Postgres no podía escribir, el archivado fallaba siempre (86.256 intentos,
 * 0 archivados) y, como Postgres no borra un segmento hasta archivarlo, todo
 * quedaba en `pg_wal`. La tarjeta Disco sólo decía «Base de datos, sistema y
 * otros» porque el API no corre como root y no puede mirar dentro de Docker.
 *
 * Se mide por SQL (la conexión base es superusuario): `pg_ls_waldir()`,
 * `pg_stat_archiver`, `pg_ls_archive_statusdir()` y el archivo con
 * `pg_ls_dir`/`pg_stat_file`. Lo que hace falta ejecutar DENTRO del
 * contenedor (comprimir el archivo, dar por archivados los pendientes) va por
 * `COPY … TO PROGRAM`, que corre como el usuario postgres con el directorio de
 * datos como cwd — con comandos fijos, nunca con texto de una persona. Lo
 * único que necesita root (devolverle la carpeta a postgres) va por
 * `docker exec -u 0`, y sólo si el usuario del API puede usar Docker.
 */

/** Segmentos pendientes desde los que el archivado se considera trabado (~30 min con archive_timeout=300). */
export const STUCK_PENDING = 6;
/** Lo que guarda el archivo (igual que el archive_command del compose). */
export const ARCHIVE_RETENTION_MINUTES = 4320;
/** Tamaño de un segmento de WAL (el default de Postgres). */
export const WAL_SEGMENT_BYTES = 16 * 1024 * 1024;
/** Cuántos archivos sin comprimir se comprimen por pasada (acota el tiempo de la consulta). */
const COMPRESS_BATCH = 400;

const ALERT_WAL = 'platform:alert:wal';
const ALERT_DISK = 'platform:alert:disk';

/** La carpeta del archivo según el `archive_command` (`… /wal_archive/%f …`). */
export function archiveDirFromCommand(cmd: string): string | null {
    const m = /(\/[A-Za-z0-9_.\-/]*[A-Za-z0-9_])\/%f/.exec(cmd);
    return m && safeDir(m[1]!) ? m[1]! : null;
}

/** Sólo rutas absolutas simples: van dentro de un comando de shell. */
export function safeDir(dir: string): boolean {
    return /^\/[A-Za-z0-9_.\-/]+$/.test(dir) && !dir.split('/').includes('..');
}

export function commandCompresses(cmd: string): boolean {
    return /\bgzip\b/.test(cmd);
}

/** Literal SQL de una cadena (para COPY … TO PROGRAM, que no acepta parámetros). */
function sqlLiteral(s: string): string {
    return `'${s.replace(/'/g, "''")}'`;
}

export interface ArchiverStats {
    mode: string;
    pending: number | null;
    archived_count: number | null;
    failed_count: number | null;
    last_archived_at: string | null;
    last_failed_at: string | null;
}

/**
 * ¿Funciona el archivado? `failing` cuando hay segmentos esperando y el último
 * intento fallido es posterior al último que salió bien (o nunca salió
 * ninguno). Un fallo aislado que ya se recuperó no cuenta.
 */
export function walHealth(s: ArchiverStats): PostgresWalHealth {
    if (s.mode === 'off') return 'off';
    if (s.pending === null) return 'unknown';
    const failedAfter = s.last_failed_at !== null && (s.last_archived_at === null || Date.parse(s.last_failed_at) > Date.parse(s.last_archived_at));
    return failedAfter && s.pending >= STUCK_PENDING ? 'failing' : 'ok';
}

/** La base corre en esta máquina: lo que ocupa cuenta en ESTE disco. */
export function isLocalDatabase(url: string): boolean {
    try {
        const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
        return host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1';
    } catch {
        return false;
    }
}

/**
 * Comprime lo que el `archive_command` viejo dejó sin comprimir (servidores
 * con el contenedor creado antes de v0.1.337) conservando la fecha — la poda
 * de 3 días se mide por fecha — y poda lo de más de 3 días. Sólo nombres de
 * segmento (24 hex, sin punto): nunca `.history`, `.backup` ni `.tmp`.
 */
export function compressScript(dir: string, minAgeMinutes = 2): string {
    return [
        `d=${dir};`,
        `for f in $(find "$d" -maxdepth 1 -type f -name '[0-9A-F]*' ! -name '*.*' -mmin +${Math.max(0, Math.floor(minAgeMinutes))} | head -n ${COMPRESS_BATCH}); do`,
        `gzip -c "$f" > "$f.gz.tmp" && touch -r "$f" "$f.gz.tmp" && mv -f "$f.gz.tmp" "$f.gz" && rm -f "$f";`,
        'done;',
        `find "$d" -maxdepth 1 -type f -mmin +${ARCHIVE_RETENTION_MINUTES} -delete;`,
        'true',
    ].join(' ');
}

/** Da por archivados los pendientes: Postgres los libera en el próximo punto de control sin copiar nada. */
export const MARK_DONE_SCRIPT =
    'cd pg_wal/archive_status && for r in *.ready; do [ -e "$r" ] || continue; mv "$r" "${r%.ready}.done"; done; true';

/** Ejecuta un comando como root dentro del contenedor de Postgres. Inyectable en los tests. */
export type RootRunner = (script: string) => Promise<void>;

function iso(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function num(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function size(bytes: number): string {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
}
function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

@Injectable()
export class PostgresWalService {
    private readonly logger = new Logger(PostgresWalService.name);
    /** Para los tests: cómo correr un comando como root en el contenedor. */
    rootRunner: RootRunner;

    constructor(
        @Inject(PG_POOL) private readonly pool: Pool,
        @Inject(ENV) private readonly env: Env,
        @Inject(REDIS) private readonly redis: Redis,
        @Optional() private readonly mail?: MailService,
    ) {
        this.rootRunner = async (script) => {
            await run('docker', ['exec', '-u', '0', this.env.PG_CONTAINER, 'sh', '-c', script], { timeout: 20_000 });
        };
    }

    /** Una conexión con su propio tope por sentencia (comprimir o un punto de control pueden tardar más que el del pool). */
    private async withClient<T>(fn: (c: PoolClient) => Promise<T>, timeoutMs = 15_000): Promise<T> {
        const c = await this.pool.connect();
        try {
            await c.query(`SET statement_timeout = ${Math.max(0, Math.floor(timeoutMs))}`);
            return await fn(c);
        } finally {
            await c.query('RESET statement_timeout').catch(() => undefined);
            c.release();
        }
    }

    async status(): Promise<PostgresWalStatus> {
        const base: PostgresWalStatus = {
            available: false,
            reason: null,
            local: isLocalDatabase(this.env.DATABASE_URL),
            db_bytes: null,
            wal_bytes: null,
            archive_mode: 'off',
            archive_dir: null,
            archive_bytes: null,
            archive_files: null,
            archive_oldest_at: null,
            archive_compressed: false,
            pending: null,
            pending_bytes: null,
            archived_count: null,
            failed_count: null,
            last_archived_at: null,
            last_failed_at: null,
            last_failed_wal: null,
            health: 'unknown',
            problem: null,
        };
        try {
            return await this.withClient(async (c) => {
                const su = await c.query<{ rolsuper: boolean }>('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
                if (!su.rows[0]?.rolsuper) {
                    return { ...base, reason: 'La conexión a la base de datos no es de superusuario: el registro de cambios no se puede medir desde la app.' };
                }
                const r = await c.query<Record<string, unknown>>(`
                    SELECT (SELECT sum(pg_database_size(oid)) FROM pg_database)::bigint AS db_bytes,
                           (SELECT coalesce(sum(size), 0) FROM pg_ls_waldir())::bigint AS wal_bytes,
                           current_setting('archive_mode') AS mode,
                           current_setting('archive_command') AS command,
                           (SELECT count(*) FROM pg_ls_archive_statusdir() WHERE name LIKE '%.ready')::int AS pending,
                           a.archived_count, a.failed_count, a.last_archived_time, a.last_failed_time, a.last_failed_wal
                      FROM pg_stat_archiver a`);
                const row = r.rows[0] ?? {};
                const mode = String(row.mode ?? 'off');
                const command = String(row.command ?? '');
                const pending = num(row.pending);
                const out: PostgresWalStatus = {
                    ...base,
                    available: true,
                    db_bytes: num(row.db_bytes),
                    wal_bytes: num(row.wal_bytes),
                    archive_mode: mode,
                    archive_compressed: commandCompresses(command),
                    pending,
                    pending_bytes: pending === null ? null : pending * WAL_SEGMENT_BYTES,
                    archived_count: num(row.archived_count),
                    failed_count: num(row.failed_count),
                    last_archived_at: iso(row.last_archived_time),
                    last_failed_at: iso(row.last_failed_time),
                    last_failed_wal: row.last_failed_wal ? String(row.last_failed_wal) : null,
                };
                out.health = walHealth({ mode, pending, archived_count: out.archived_count, failed_count: out.failed_count, last_archived_at: out.last_archived_at, last_failed_at: out.last_failed_at });
                const dir = mode === 'off' ? null : archiveDirFromCommand(command);
                out.archive_dir = dir;
                if (dir) {
                    const a = await c.query<Record<string, unknown>>(
                        `SELECT count(*)::int AS files, coalesce(sum((pg_stat_file($1 || '/' || f, true)).size), 0)::bigint AS bytes,
                                min((pg_stat_file($1 || '/' || f, true)).modification) AS oldest
                           FROM pg_ls_dir($1, true, false) AS f`,
                        [dir],
                    );
                    out.archive_files = num(a.rows[0]?.files);
                    out.archive_bytes = num(a.rows[0]?.bytes);
                    out.archive_oldest_at = iso(a.rows[0]?.oldest);
                }
                if (out.health === 'failing') out.problem = dir && !(await this.writable(c, dir)) ? 'not_writable' : 'unknown';
                return out;
            });
        } catch (err) {
            return { ...base, reason: `No se pudo consultar la base de datos: ${(err as Error).message}` };
        }
    }

    /** ¿Postgres puede escribir en la carpeta del archivo? (lo prueba el propio usuario postgres). */
    private async writable(c: PoolClient, dir: string): Promise<boolean> {
        try {
            await c.query(`COPY (SELECT 1) TO PROGRAM ${sqlLiteral(`test -w ${dir}`)}`);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * «Liberar y reparar»: sólo con el archivado trabado. Da por archivados los
     * pendientes (Postgres no los copia: con el disco casi lleno, copiarlos al
     * mismo disco lo llenaría), hace un punto de control para que los borre, y
     * después intenta devolverle la carpeta a postgres. El orden importa: si se
     * arregla el permiso primero, Postgres copia el atraso entero de golpe.
     */
    async release(): Promise<WalReleaseResult> {
        const before = await this.status();
        if (!before.available) throw new Error(before.reason ?? 'No se pudo consultar la base de datos.');
        if (before.health !== 'failing') {
            return { marked: 0, freed_bytes: 0, wal_bytes: before.wal_bytes, permission: 'ok', message: 'El archivado funciona: no hay nada trabado que liberar.' };
        }
        const marked = before.pending ?? 0;
        await this.withClient(async (c) => {
            await c.query(`COPY (SELECT 1) TO PROGRAM ${sqlLiteral(MARK_DONE_SCRIPT)}`);
            await c.query('CHECKPOINT');
        }, 300_000);
        let permission: WalReleaseResult['permission'] = 'ok';
        let message: string | null = null;
        if (before.problem === 'not_writable' && before.archive_dir) {
            const fixed = await this.fixPermission(before.archive_dir);
            permission = fixed.ok ? 'fixed' : 'failed';
            message = fixed.message;
        }
        const after = await this.status();
        const freed = Math.max(0, (before.wal_bytes ?? 0) - (after.wal_bytes ?? 0));
        this.logger.log(`Registro de cambios liberado: ${marked} segmentos dados por archivados, ${size(freed)} liberados (permiso: ${permission}).`);
        if (permission !== 'failed') await this.redis.del(ALERT_WAL).catch(() => undefined);
        return { marked, freed_bytes: freed, wal_bytes: after.wal_bytes, permission, message };
    }

    /** Le devuelve la carpeta del archivo a postgres (necesita root: `docker exec -u 0`). */
    async fixPermission(dir: string): Promise<{ ok: boolean; message: string | null }> {
        if (!safeDir(dir)) return { ok: false, message: 'Ruta del archivo no válida.' };
        try {
            await this.rootRunner(`mkdir -p ${dir} && chown postgres:postgres ${dir}`);
            return { ok: true, message: null };
        } catch (err) {
            const detail = (err as Error).message.split('\n')[0] ?? '';
            return {
                ok: false,
                message: `No se pudo reparar el permiso desde la app (${detail.slice(0, 160)}). En la consola del servidor: sudo docker exec -u 0 ${this.env.PG_CONTAINER} chown postgres:postgres ${dir}`,
            };
        }
    }

    /** Comprime y poda el archivo si el archive_command del contenedor es el viejo. */
    async compressArchive(status: PostgresWalStatus, minAgeMinutes = 2): Promise<void> {
        if (!status.available || status.archive_compressed || !status.archive_dir || status.health === 'failing') return;
        await this.withClient((c) => c.query(`COPY (SELECT 1) TO PROGRAM ${sqlLiteral(compressScript(status.archive_dir!, minAgeMinutes))}`), 300_000);
    }

    /**
     * Cada 15 minutos (cola de actualizaciones): repara lo que se puede reparar
     * solo y avisa por correo a los superadmins lo que no. El permiso se
     * arregla solo únicamente si el atraso entra holgado en el disco libre —
     * con el comando viejo Postgres lo copiaría sin comprimir de golpe.
     */
    async tick(): Promise<void> {
        const where = this.env.UPDATER_BASE_PATH || process.cwd();
        const status = await this.status();
        let justFixed = false;
        if (status.available && status.health === 'failing' && status.problem === 'not_writable' && status.archive_dir) {
            const free = freeBytes(where).free;
            const backlog = status.pending_bytes ?? 0;
            if (backlog * 1.5 < free) {
                const fixed = await this.fixPermission(status.archive_dir);
                if (fixed.ok) {
                    // Postgres reintenta el archivado a su ritmo (hasta un minuto
                    // después de un fallo): el aviso sólo si en la PRÓXIMA revisión
                    // sigue trabado.
                    this.logger.log(`El archivado del WAL fallaba porque Postgres no podía escribir en ${status.archive_dir}: permiso reparado solo.`);
                    justFixed = true;
                }
            }
        }
        if (status.available && status.health === 'ok') {
            await this.compressArchive(status).catch((err: unknown) => this.logger.warn(`No se pudo comprimir el archivo de WAL: ${(err as Error).message}`));
            await this.redis.del(ALERT_WAL).catch(() => undefined);
        }
        if (status.available && status.health === 'failing' && !justFixed) await this.alertWal(status);
        await this.checkDisk(where, status);
    }

    private async checkDisk(where: string, status: PostgresWalStatus): Promise<void> {
        const { free, total } = freeBytes(where);
        const ino = freeInodes(where);
        const threshold = Math.max(2 * 1024 ** 3, total * 0.05);
        const lowInodes = ino !== null && ino.free < MIN_FREE_INODES;
        if (free >= threshold && !lowInodes) {
            await this.redis.del(ALERT_DISK).catch(() => undefined);
            return;
        }
        const lines: string[] = [];
        if (status.available && status.local) {
            if (status.wal_bytes !== null) lines.push(`Registro de cambios de la base (WAL): ${size(status.wal_bytes)}`);
            if (status.archive_bytes !== null) lines.push(`Archivo del registro de cambios: ${size(status.archive_bytes)}`);
            if (status.db_bytes !== null) lines.push(`Datos de la base: ${size(status.db_bytes)}`);
        }
        if (this.env.UPDATER_BASE_PATH) {
            const layout = new LayoutDisk(this.env.UPDATER_BASE_PATH, this.env.UPDATER_KEEP_RELEASES);
            const reclaimable = await layout.reclaimable().catch(() => 0);
            if (reclaimable > 0) lines.push(`«Liberar espacio» puede recuperar ${size(reclaimable)} (versiones viejas y copias previas a cada actualización).`);
        }
        const what = lowInodes ? `se está quedando sin lugar para más archivos (quedan ${ino!.free} de ${ino!.total})` : `tiene ${size(free)} libres de ${size(total)}`;
        await this.alert(
            ALERT_DISK,
            24 * 3600,
            'El disco del servidor se está llenando',
            [`El disco del servidor ${what}.`, 'Si se llena, la base de datos se detiene y la app deja de funcionar; las actualizaciones tampoco se pueden instalar.', ...(lines.length ? ['', ...lines] : [])],
        );
    }

    private async alertWal(s: PostgresWalStatus): Promise<void> {
        const since = s.last_archived_at ? `desde el ${s.last_archived_at.slice(0, 10)}` : 'desde que se creó el contenedor (nunca archivó nada)';
        const why =
            s.problem === 'not_writable'
                ? `Motivo: Postgres no tiene permiso para escribir en ${s.archive_dir}.`
                : `El último intento fallido fue con el segmento ${s.last_failed_wal ?? '—'}; el detalle está en el registro del contenedor de Postgres.`;
        await this.alert(ALERT_WAL, 12 * 3600, 'La base de datos no está archivando su registro de cambios', [
            `El archivado del registro de cambios (WAL) de la base de datos está fallando ${since}.`,
            `Hay ${s.pending ?? 0} segmentos pendientes (${size(s.pending_bytes ?? 0)}) y Postgres no puede borrarlos hasta archivarlos: el disco se va llenando y, si se llena, la base se detiene.`,
            why,
            '',
            'Se arregla sin consola en Plataforma → Diagnóstico → Disco, con «Liberar y reparar».',
        ]);
    }

    /**
     * Un aviso por tipo cada `ttl` segundos como mucho: queda en Plataforma →
     * Diagnóstico y, si hay correo de cuenta, llega a los superadmins.
     */
    private async alert(key: string, ttl: number, subject: string, paragraphs: string[]): Promise<void> {
        let first: string | null = null;
        try {
            first = await this.redis.set(key, '1', 'EX', ttl, 'NX');
        } catch {
            return;
        }
        if (first !== 'OK') return;
        recordServerError({ source: 'database', message: `${subject}. ${paragraphs.find(Boolean) ?? ''}` });
        const to = this.env.PLATFORM_SUPERADMINS;
        if (!this.mail || to.length === 0) return;
        try {
            const panel = `${this.env.APP_BASE_URL.replace(/\/$/, '')}/#/platform?tab=diagnostico`;
            const text = [...paragraphs, '', `Plataforma → Diagnóstico: ${panel}`].join('\n');
            const html =
                paragraphs.map((p) => (p ? `<p>${esc(p)}</p>` : '')).join('') +
                `<p><a href="${esc(panel)}">Abrir Plataforma → Diagnóstico</a></p>`;
            for (const address of to) await this.mail.enqueue({ to: address, subject, text, html });
        } catch (err) {
            this.logger.warn(`No se pudo avisar por correo (${subject}): ${(err as Error).message}`);
        }
    }
}
