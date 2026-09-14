import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
    backupsSettingsSchema,
    type BackupRun,
    type BackupSnapshot,
    type BackupsSettings,
    type BackupsStatus,
    type UpdateBackupsSettingsInput,
} from '@imagina-base/shared';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import { DEPLOYER, type Deployer } from './update.types';

const run = promisify(execFile);

/** Ajustes de copias automáticas: clave `platform:*` → viaja en el snapshot. */
const SETTINGS_KEY = 'platform:backups';
const LAST_KEY = 'platform:backups:last';
/** Estado del run: NO es `platform:*` a propósito (es estado de ESTE servidor). */
const RUN_KEY = 'backups:run';
const LOCK_KEY = 'backups:lock';
const STUCK_MS = 60 * 60 * 1000;

const SNAPSHOT_RE = /^imagina-snapshot-(\d{8}T\d{6}Z)-v(.+?)\.tar(\.gpg)?$/;
const DUMP_RE = /^imagina-base-(\d{8}T\d{6}Z)\.dump(\.gpg)?$/;
const PRE_RESTORE_RE = /^pre-restore-(\d{8}T\d{6}Z)\.dump$/;

const idleRun: BackupRun = { status: 'idle', kind: null, message: null, file: null, started_at: null, finished_at: null };

/** `20260914T041844Z` → `2026-09-14T04:18:44Z`. */
export function stampToISO(stamp: string): string {
    return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
}

/** Reconoce los archivos que produce la app en el directorio de copias. */
export function parseBackupName(
    name: string,
): { kind: BackupSnapshot['kind']; created_at: string; app_version: string | null; encrypted: boolean } | null {
    let m = SNAPSHOT_RE.exec(name);
    if (m) return { kind: 'snapshot', created_at: stampToISO(m[1]!), app_version: m[2]!, encrypted: m[3] !== undefined };
    m = DUMP_RE.exec(name);
    if (m) return { kind: 'db_dump', created_at: stampToISO(m[1]!), app_version: null, encrypted: m[2] !== undefined };
    m = PRE_RESTORE_RE.exec(name);
    if (m) return { kind: 'pre_restore', created_at: stampToISO(m[1]!), app_version: null, encrypted: false };
    return null;
}

/**
 * ¿Toca hacer la copia automática? Una por día UTC, en la hora elegida. El
 * tick corre cada hora: si el servidor estuvo apagado a esa hora, la copia se
 * hace en el próximo tick del día (no se pierde el día entero).
 */
export function isSnapshotDue(settings: BackupsSettings, lastAt: string | null, now: Date): boolean {
    if (!settings.enabled) return false;
    if (now.getUTCHours() < settings.hour_utc) return false;
    if (lastAt === null) return true;
    return lastAt.slice(0, 10) !== now.toISOString().slice(0, 10);
}

/** Próxima copia automática (ISO) o null si están apagadas. */
export function nextRunAt(settings: BackupsSettings, lastAt: string | null, now: Date): string | null {
    if (!settings.enabled) return null;
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), settings.hour_utc));
    const ranToday = lastAt !== null && lastAt.slice(0, 10) === now.toISOString().slice(0, 10);
    if (!ranToday && today.getTime() > now.getTime()) return today.toISOString();
    if (!ranToday) return now.toISOString(); // pendiente: sale en el próximo tick
    return new Date(today.getTime() + 24 * 3600 * 1000).toISOString();
}

/**
 * v0.1.179 — Copias de seguridad completas desde la consola (ADR-S20). Este
 * service NO sabe hacer un backup: orquesta `scripts/snapshot.sh` y
 * `scripts/snapshot-restore.sh` (los mismos que se corren a mano) para que lo
 * que se prueba por CLI sea exactamente lo que hace el panel. En producción
 * todo se deriva de `UPDATER_BASE_PATH` (shared/backups + current/deploy);
 * `BACKUPS_DIR`/`BACKUPS_SCRIPTS_DIR` permiten dev/tests o un disco aparte.
 */
@Injectable()
export class BackupsService implements OnModuleInit {
    private readonly logger = new Logger(BackupsService.name);

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(DEPLOYER) private readonly deployer: Deployer,
    ) {}

    /** Al bootear tras una restauración: el API volvió → el restore terminó. */
    async onModuleInit(): Promise<void> {
        try {
            const current = await this.readRun();
            if (current.status === 'restoring') {
                await this.writeRun({
                    ...current,
                    status: 'success',
                    message: 'Restauración completada: el API volvió a arrancar con los datos del snapshot',
                    finished_at: nowISO(),
                });
            }
        } catch (err) {
            this.logger.warn(`Reconciliación de copias pospuesta (Redis no disponible): ${String(err)}`);
        }
    }

    // ── paths ───────────────────────────────────────────────────────────────

    private get base(): string {
        return this.env.UPDATER_BASE_PATH;
    }
    get backupsDir(): string {
        if (this.env.BACKUPS_DIR) return path.resolve(this.env.BACKUPS_DIR);
        return this.base ? path.join(this.base, 'shared', 'backups') : '';
    }
    private get scriptsDir(): string {
        if (this.env.BACKUPS_SCRIPTS_DIR) return path.resolve(this.env.BACKUPS_SCRIPTS_DIR);
        if (this.base) return path.join(this.base, 'current', 'deploy');
        // Dev: el repo tiene los scripts en <raíz>/scripts (cwd = apps/api).
        const repo = path.resolve(process.cwd(), '..', '..', 'scripts');
        return existsSync(path.join(repo, 'snapshot.sh')) ? repo : '';
    }
    private availability(): { available: boolean; reason: string | null } {
        if (!this.backupsDir) return { available: false, reason: 'Falta UPDATER_BASE_PATH (o BACKUPS_DIR): no hay dónde guardar las copias.' };
        if (!this.scriptsDir || !existsSync(path.join(this.scriptsDir, 'snapshot.sh'))) {
            return { available: false, reason: 'No se encuentra snapshot.sh (falta el release instalado o BACKUPS_SCRIPTS_DIR).' };
        }
        return { available: true, reason: null };
    }

    // ── estado ──────────────────────────────────────────────────────────────

    async status(): Promise<BackupsStatus> {
        const { available, reason } = this.availability();
        const settings = await this.getSettings();
        const lastAt = await this.redis.get(LAST_KEY);
        const now = new Date();
        return {
            available,
            reason,
            restore_available: available && this.base !== '',
            backups_dir: this.backupsDir || null,
            current_version: this.deployer.currentVersion(),
            settings,
            run: await this.run(),
            last_snapshot_at: lastAt,
            next_run_at: nextRunAt(settings, lastAt, now),
            snapshots: available ? await this.list() : [],
        };
    }

    async run(): Promise<BackupRun> {
        const current = await this.readRun();
        if ((current.status === 'running' || current.status === 'restoring') && stuck(current.started_at)) {
            const healed: BackupRun = { ...current, status: 'failed', message: 'El proceso quedó colgado', finished_at: nowISO() };
            await this.writeRun(healed);
            return healed;
        }
        return current;
    }

    async getSettings(): Promise<BackupsSettings> {
        const raw = await this.redis.get(SETTINGS_KEY);
        if (!raw) return backupsSettingsSchema.parse({});
        try {
            const parsed = backupsSettingsSchema.safeParse(JSON.parse(raw));
            return parsed.success ? parsed.data : backupsSettingsSchema.parse({});
        } catch {
            return backupsSettingsSchema.parse({});
        }
    }

    async setSettings(patch: UpdateBackupsSettingsInput): Promise<BackupsSettings> {
        const merged = backupsSettingsSchema.parse({ ...(await this.getSettings()), ...patch });
        await this.redis.set(SETTINGS_KEY, JSON.stringify(merged));
        return merged;
    }

    // ── listado ─────────────────────────────────────────────────────────────

    async list(): Promise<BackupSnapshot[]> {
        const dir = this.backupsDir;
        if (!dir || !existsSync(dir)) return [];
        const out: BackupSnapshot[] = [];
        for (const name of readdirSync(dir)) {
            const parsed = parseBackupName(name);
            if (!parsed) continue;
            let size = 0;
            try {
                size = statSync(path.join(dir, name)).size;
            } catch {
                continue;
            }
            const manifest = parsed.kind === 'snapshot' && !parsed.encrypted ? await this.readManifest(path.join(dir, name)) : null;
            out.push({
                name,
                kind: parsed.kind,
                size_bytes: size,
                created_at: manifest?.created_at ?? parsed.created_at,
                app_version: manifest?.app_version ?? parsed.app_version,
                encrypted: parsed.encrypted,
                migrations_applied: manifest?.migrations_applied ?? null,
                includes: manifest?.includes ?? null,
            });
        }
        return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    /** El manifest va PRIMERO en el tar: leerlo no cuesta extraer el resto. */
    private async readManifest(file: string): Promise<{
        created_at: string;
        app_version: string;
        migrations_applied: number | null;
        includes: { uploads: boolean; redis: boolean; env: boolean };
    } | null> {
        try {
            const { stdout } = await run('tar', ['-xOf', file, '--wildcards', '*/manifest.json'], { maxBuffer: 1 << 20 });
            const m = JSON.parse(stdout) as Record<string, unknown>;
            const inc = (m.includes ?? {}) as Record<string, unknown>;
            return {
                created_at: String(m.created_at ?? ''),
                app_version: String(m.app_version ?? ''),
                migrations_applied: typeof m.migrations_applied === 'number' ? m.migrations_applied : null,
                includes: { uploads: inc.uploads === true, redis: inc.redis === true, env: inc.env === true },
            };
        } catch {
            return null;
        }
    }

    // ── crear ───────────────────────────────────────────────────────────────

    async markQueued(): Promise<void> {
        await this.writeRun({ status: 'queued', kind: 'snapshot', message: 'En cola', file: null, started_at: nowISO(), finished_at: null });
    }

    async markFailed(message: string): Promise<void> {
        const current = await this.readRun();
        await this.writeRun({ ...current, status: 'failed', message, finished_at: nowISO() });
    }

    /** Lo corre el worker de la cola (job `snapshot`) o el tick automático. */
    async createSnapshot(trigger: 'manual' | 'scheduled'): Promise<string | null> {
        const { available, reason } = this.availability();
        if (!available) {
            await this.writeRun({ ...idleRun, status: 'failed', kind: 'snapshot', message: reason, finished_at: nowISO() });
            return null;
        }
        const got = await this.redis.set(LOCK_KEY, '1', 'EX', 3600, 'NX');
        if (got !== 'OK') {
            this.logger.warn('Snapshot ya en curso (lock tomado)');
            return null;
        }
        try {
            await this.writeRun({ status: 'running', kind: 'snapshot', message: trigger === 'scheduled' ? 'Copia automática en curso…' : 'Creando la copia…', file: null, started_at: nowISO(), finished_at: null });
            const settings = await this.getSettings();
            mkdirSync(this.backupsDir, { recursive: true });
            const { stdout } = await run('bash', [path.join(this.scriptsDir, 'snapshot.sh')], {
                env: {
                    ...process.env,
                    BASE_PATH: this.base,
                    DATABASE_URL: this.env.DATABASE_URL,
                    REDIS_URL: this.env.REDIS_URL,
                    UPLOADS_DIR: path.resolve(this.env.UPLOADS_DIR),
                    ...(this.base ? { ENV_FILE: path.join(this.base, 'shared', '.env.production') } : {}),
                    APP_VERSION: this.deployer.currentVersion(),
                    BACKUP_DIR: this.backupsDir,
                    SNAPSHOT_KEEP: String(settings.keep),
                    SNAPSHOT_INCLUDE_ENV: settings.include_env ? '1' : '0',
                    STORAGE_DRIVER: this.env.STORAGE_DRIVER,
                },
                maxBuffer: 10 << 20,
            });
            const file = /snapshot listo: (\S+)/.exec(stdout)?.[1] ?? null;
            const name = file ? path.basename(file) : null;
            const at = nowISO();
            await this.redis.set(LAST_KEY, at);
            await this.writeRun({ status: 'success', kind: 'snapshot', message: trigger === 'scheduled' ? 'Copia automática creada' : 'Copia creada', file: name, started_at: null, finished_at: at });
            this.logger.log(`Snapshot creado: ${name ?? '(sin nombre)'} (${trigger})`);
            return name;
        } catch (err) {
            const detail = err instanceof Error && 'stderr' in err ? String((err as { stderr?: string }).stderr ?? '').trim().split('\n').slice(-3).join(' · ') : '';
            const message = `La copia falló: ${detail || (err instanceof Error ? err.message : String(err))}`;
            await this.writeRun({ status: 'failed', kind: 'snapshot', message, file: null, started_at: null, finished_at: nowISO() });
            this.logger.error(message);
            return null;
        } finally {
            await this.redis.del(LOCK_KEY);
        }
    }

    /** Tick horario: copia automática si toca (una por día UTC a la hora elegida). */
    async tick(now = new Date()): Promise<boolean> {
        const settings = await this.getSettings();
        const lastAt = await this.redis.get(LAST_KEY);
        if (!isSnapshotDue(settings, lastAt, now)) return false;
        const current = await this.readRun();
        if (current.status === 'running' || current.status === 'restoring' || current.status === 'queued') return false;
        await this.createSnapshot('scheduled');
        return true;
    }

    // ── archivo ─────────────────────────────────────────────────────────────

    /** Ruta absoluta de una copia por nombre (nombre estricto: sin traversal). */
    resolve(name: string): string {
        if (!parseBackupName(name) || path.basename(name) !== name) throw new NotFoundException({ code: 'backup_not_found', message: 'La copia no existe', data: { status: 404 } });
        const file = path.join(this.backupsDir, name);
        if (!this.backupsDir || !existsSync(file)) throw new NotFoundException({ code: 'backup_not_found', message: 'La copia no existe', data: { status: 404 } });
        return file;
    }

    remove(name: string): void {
        unlinkSync(this.resolve(name));
    }

    /**
     * Restaurar DESDE el panel: sólo con el layout de releases (la restauración
     * detiene y vuelve a arrancar el API por systemd). Se lanza DESACOPLADO
     * (igual que finalize.sh del updater): el script mata a este proceso.
     */
    async restore(name: string): Promise<{ ok: boolean; message: string }> {
        const file = this.resolve(name);
        const parsed = parseBackupName(name)!;
        if (parsed.kind !== 'snapshot') {
            throw new ConflictException({ code: 'not_a_snapshot', message: 'Sólo se restauran snapshots completos desde el panel; un .dump se restaura por CLI (scripts/restore.sh).', data: { status: 409 } });
        }
        if (parsed.encrypted) {
            throw new ConflictException({ code: 'encrypted_snapshot', message: 'Un snapshot cifrado se restaura por CLI (necesita la clave GPG del servidor).', data: { status: 409 } });
        }
        if (!this.base) {
            throw new ConflictException({ code: 'restore_unavailable', message: 'Restaurar desde el panel requiere el layout de releases (UPDATER_BASE_PATH). Por CLI: scripts/snapshot-restore.sh', data: { status: 409 } });
        }
        const current = await this.readRun();
        if (current.status === 'running' || current.status === 'restoring' || current.status === 'queued') {
            throw new ConflictException({ code: 'backup_busy', message: 'Hay una operación de copias en curso', data: { status: 409 } });
        }
        await this.writeRun({ status: 'restoring', kind: 'restore', message: 'Restaurando: el API se detiene, se reemplazan los datos y vuelve a arrancar…', file: name, started_at: nowISO(), finished_at: null });
        const logFile = path.join(this.backupsDir, `restore-${stampNow()}.log`);
        const fd = openSync(logFile, 'a');
        const child = spawn('bash', [path.join(this.scriptsDir, 'snapshot-restore.sh'), file, '--yes'], {
            detached: true,
            stdio: ['ignore', fd, fd],
            env: {
                ...process.env,
                BASE_PATH: this.base,
                HEALTH_URL: `http://127.0.0.1:${this.env.PORT}/api/v1/health/ready`,
            },
        });
        child.unref();
        this.logger.warn(`Restauración lanzada desde el panel: ${name} (log ${logFile})`);
        return { ok: true, message: `Restaurando ${name}. El API se reinicia; la app vuelve en ~1 minuto.` };
    }

    // ── run state ───────────────────────────────────────────────────────────

    private async readRun(): Promise<BackupRun> {
        const raw = await this.redis.get(RUN_KEY);
        if (!raw) return idleRun;
        try {
            return JSON.parse(raw) as BackupRun;
        } catch {
            return idleRun;
        }
    }

    private async writeRun(state: BackupRun): Promise<void> {
        await this.redis.set(RUN_KEY, JSON.stringify(state));
    }
}

function nowISO(): string {
    return new Date().toISOString();
}
function stuck(startedAt: string | null): boolean {
    if (!startedAt) return false;
    return Date.now() - new Date(startedAt).getTime() > STUCK_MS;
}
function stampNow(): string {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
