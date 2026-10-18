import { execFile, spawn } from 'node:child_process';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    normalizeRecoveryCode,
    recoveryRunSchema,
    type RecoveryDriveClientInput,
    type RecoveryFreshInput,
    type RecoveryRestoreInput,
    type RecoveryRun,
    type RecoveryStatus,
    type RecoveryStep,
} from '@imagina-base/shared';
import * as argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { memberships, tenants, users } from '../db/schema';
import { BackupDriveService } from '../update/backup-drive.service';
import { BackupsService } from '../update/backups.service';
import { checkPassphrase, decryptFile } from '../update/snapshot-crypto';

const run = promisify(execFile);

export const RECOVERY_COOKIE = 'imbase_recovery';
const TOKEN_TTL_MS = 2 * 3600 * 1000;
const MAX_FAILS = 10;
const LOCK_MS = 15 * 60 * 1000;

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function slugify(name: string): string {
    const base = name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return base.length >= 3 ? base : `empresa-${base || 'nueva'}`;
}

/**
 * v0.1.283 (ADR-S43) — Modo recuperación de un servidor recién instalado.
 *
 * Está activo mientras haya código en el .env y la base no tenga empresas.
 *
 * Todo el estado que tiene que sobrevivir a la restauración vive FUERA de
 * Redis y de Postgres, porque la restauración los reemplaza:
 *  - el permiso del navegador es un token HMAC sin estado (cookie);
 *  - el avance se escribe en `shared/recovery/status.json` (lo escriben este
 *    service mientras baja/descifra y después el script que aplica la copia).
 */
@Injectable()
export class RecoveryService {
    private readonly logger = new Logger(RecoveryService.name);
    private activeCache: { value: boolean; at: number } | null = null;
    /** Una restauración en curso deja el modo activo aunque la base cambie debajo. */
    private restoring = false;
    private fails = { count: 0, until: 0 };

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly backups: BackupsService,
        private readonly drive: BackupDriveService,
    ) {}

    // ── activo / código ─────────────────────────────────────────────────

    async isActive(): Promise<boolean> {
        if (!this.env.RECOVERY_CODE_SHA256) return false;
        if (this.restoring) {
            // Sigue activo mientras dura, aunque la base cambie debajo. Al
            // terminar (normalmente el reinicio ya lo cortó) se vuelve a mirar.
            const step = this.readRun()?.step;
            if (step !== 'done' && step !== 'failed') return true;
            this.restoring = false;
            this.activeCache = null;
        }
        if (this.activeCache && Date.now() - this.activeCache.at < 10_000) return this.activeCache.value;
        try {
            // "Sin empresas", no "sin usuarios": al arrancar, el API ya crea la
            // cuenta de cada superadmin del .env (SEC-04), así que un servidor
            // recién instalado nunca tiene la tabla de usuarios vacía.
            const [anyTenant] = await this.db.select({ id: tenants.id }).from(tenants).limit(1);
            this.activeCache = { value: !anyTenant, at: Date.now() };
        } catch {
            // Base caída: si ya estaba activo, sigue (no se corta a mitad de camino).
            if (!this.activeCache) return false;
        }
        return this.activeCache?.value ?? false;
    }

    async assertActive(): Promise<void> {
        // 404 opaco: un servidor en uso no anuncia que tiene este modo.
        if (!(await this.isActive())) throw new NotFoundException();
    }

    private tokenKey(): Buffer {
        return createHash('sha256').update(`${this.env.RECOVERY_CODE_SHA256}:${this.env.SECRETS_KEY}:imagina-recovery`).digest();
    }

    unlock(code: string): string {
        if (Date.now() < this.fails.until) {
            throw new ForbiddenException({ code: 'recovery_locked', message: 'Demasiados intentos. Espera 15 minutos y vuelve a probar.', data: { status: 403 } });
        }
        const got = Buffer.from(sha256(normalizeRecoveryCode(code)), 'hex');
        const want = Buffer.from(this.env.RECOVERY_CODE_SHA256.toLowerCase(), 'hex');
        if (got.length !== want.length || !timingSafeEqual(got, want)) {
            this.fails.count++;
            if (this.fails.count >= MAX_FAILS) this.fails = { count: 0, until: Date.now() + LOCK_MS };
            throw new ForbiddenException({ code: 'recovery_bad_code', message: 'Ese no es el código que mostró el instalador.', data: { status: 403 } });
        }
        this.fails = { count: 0, until: 0 };
        const exp = String(Date.now() + TOKEN_TTL_MS);
        return `${exp}.${createHmac('sha256', this.tokenKey()).update(exp).digest('base64url')}`;
    }

    verifyToken(token: string | undefined): boolean {
        if (!token || !this.env.RECOVERY_CODE_SHA256) return false;
        const [exp, sig] = token.split('.');
        if (!exp || !sig || Number(exp) < Date.now()) return false;
        const want = createHmac('sha256', this.tokenKey()).update(exp).digest();
        const got = Buffer.from(sig, 'base64url');
        return got.length === want.length && timingSafeEqual(got, want);
    }

    // ── estado ──────────────────────────────────────────────────────────

    private get dir(): string {
        if (this.env.UPDATER_BASE_PATH) return path.join(this.env.UPDATER_BASE_PATH, 'shared', 'recovery');
        return path.join(path.dirname(this.backups.backupsDir || path.resolve('data', 'backups')), 'recovery');
    }
    private get statusFile(): string {
        return path.join(this.dir, 'status.json');
    }

    readRun(): RecoveryRun | null {
        try {
            const parsed = recoveryRunSchema.safeParse(JSON.parse(readFileSync(this.statusFile, 'utf8')));
            return parsed.success ? parsed.data : null;
        } catch {
            return null;
        }
    }

    private writeRun(step: RecoveryStep, message: string, extra: { pct?: number | null; file?: string | null } = {}): void {
        const prev = this.readRun();
        const now = new Date().toISOString();
        const runState: RecoveryRun = {
            step,
            message,
            pct: extra.pct ?? null,
            file: extra.file ?? prev?.file ?? null,
            started_at: prev && prev.step !== 'failed' && prev.step !== 'done' ? prev.started_at : now,
            updated_at: now,
        };
        mkdirSync(this.dir, { recursive: true });
        writeFileSync(this.statusFile, JSON.stringify(runState), { mode: 0o600 });
    }

    async status(unlocked: boolean): Promise<RecoveryStatus> {
        return {
            active: true,
            unlocked,
            app_version: this.backups.currentVersion(),
            superadmins: unlocked ? this.env.PLATFORM_SUPERADMINS : [],
            drive: unlocked ? await this.drive.status().catch(() => null) : null,
            run: unlocked ? this.readRun() : null,
        };
    }

    private assertIdle(): void {
        const current = this.readRun();
        if (this.restoring || (current && !['done', 'failed'].includes(current.step))) {
            throw new ConflictException({ code: 'recovery_busy', message: 'Ya hay una restauración en curso.', data: { status: 409 } });
        }
    }

    // ── Drive ───────────────────────────────────────────────────────────

    setDriveClient(input: RecoveryDriveClientInput) {
        return this.drive.update({ client_id: input.client_id, client_secret: input.client_secret });
    }

    // ── restaurar ───────────────────────────────────────────────────────

    private get script(): string {
        if (this.env.RECOVERY_SCRIPT) return path.resolve(this.env.RECOVERY_SCRIPT);
        return path.join(this.env.UPDATER_BASE_PATH, 'current', 'deploy', 'recover-from-snapshot.sh');
    }

    /**
     * Valida, y arranca en segundo plano: bajar → descifrar → el script que
     * aplica la copia (cambia el .env, recrea Postgres/Redis, instala la
     * versión de la copia y reinicia el API). Responde enseguida.
     */
    async startRestore(input: RecoveryRestoreInput): Promise<{ ok: true }> {
        this.assertIdle();
        if (!existsSync(this.script)) {
            throw new ConflictException({ code: 'recovery_unavailable', message: 'Este servidor no tiene el script de recuperación (¿se instaló con install.sh?).', data: { status: 409 } });
        }
        const file = await this.drive.remoteFile(input.file_id).catch((err: unknown) => {
            throw new BadRequestException({ code: 'drive_unavailable', message: (err as Error).message, data: { status: 400 } });
        });
        if (!file) throw new NotFoundException({ code: 'backup_not_found', message: 'Esa copia ya no está en el Drive.', data: { status: 404 } });
        if (file.appProperties.imagina_includes !== undefined && !file.appProperties.imagina_includes.includes('e')) {
            throw new BadRequestException({
                code: 'snapshot_without_env',
                message: 'Esa copia no trae los secretos del servidor (.env): no sirve para levantar un servidor nuevo. Elige otra.',
                data: { status: 400 },
            });
        }
        if (checkPassphrase(input.passphrase, file.appProperties.imagina_pv) === false) {
            throw new BadRequestException({ code: 'bad_passphrase', message: 'La contraseña de recuperación no es la de esa copia.', data: { status: 400 } });
        }
        this.restoring = true;
        this.writeRun('download', 'Bajando la copia de Google Drive…', { pct: 0, file: file.name });
        void this.pipeline(file.id, file.name, file.size, input.passphrase).catch((err: unknown) => {
            this.restoring = false;
            const message = err instanceof Error ? err.message : String(err);
            this.writeRun('failed', `No se pudo restaurar: ${message}`);
            this.logger.error(`Restauración desde el Drive falló: ${message}`);
        });
        return { ok: true };
    }

    private async pipeline(id: string, name: string, size: number, passphrase: string): Promise<void> {
        const dir = this.dir;
        mkdirSync(dir, { recursive: true });
        const enc = path.join(dir, 'copia.tar.gpg');
        const tar = path.join(dir, 'copia.tar');
        rmSync(enc, { force: true });
        rmSync(tar, { force: true });
        let lastPct = -1;
        await this.drive.downloadRemote(id, enc, (bytes) => {
            const pct = size > 0 ? Math.min(100, Math.floor((bytes / size) * 100)) : 0;
            if (pct !== lastPct) {
                lastPct = pct;
                this.writeRun('download', 'Bajando la copia de Google Drive…', { pct, file: name });
            }
        });
        this.writeRun('decrypt', 'Descifrando la copia…', { file: name });
        try {
            await decryptFile(enc, tar, passphrase);
        } finally {
            rmSync(enc, { force: true });
        }
        // Una copia sin .env no sirve en un servidor nuevo (los secretos están ahí).
        const { stdout } = await run('tar', ['-tf', tar], { maxBuffer: 16 << 20 });
        if (!/\/env\.production$/m.test(stdout)) {
            rmSync(tar, { force: true });
            throw new Error('la copia no trae los secretos del servidor (.env). Elige una copia completa.');
        }
        this.writeRun('env', 'Aplicando la copia: el servidor se reinicia solo al terminar…', { file: name });
        const log = openSync(path.join(dir, `recover-${Date.now()}.log`), 'a');
        const child = spawn('bash', [this.script, tar], {
            detached: true,
            stdio: ['ignore', log, log],
            env: { ...process.env, BASE_PATH: this.env.UPDATER_BASE_PATH, RECOVERY_STATUS_FILE: this.statusFile },
        });
        child.unref();
        this.logger.warn(`Recuperación lanzada con ${name}`);
    }

    // ── empezar de cero ─────────────────────────────────────────────────

    /** La cuenta del operador (superadmin del .env) + su primera empresa. */
    async fresh(input: RecoveryFreshInput): Promise<{ ok: true }> {
        this.assertIdle();
        const email = input.email.trim().toLowerCase();
        if (!this.env.PLATFORM_SUPERADMINS.includes(email)) {
            throw new BadRequestException({
                code: 'not_a_superadmin',
                message: `Usa el correo de operador que diste al instalar (${this.env.PLATFORM_SUPERADMINS.join(', ') || 'PLATFORM_SUPERADMINS está vacío'}).`,
                data: { status: 400 },
            });
        }
        const passwordHash = await argon2.hash(input.password);
        await this.db.transaction(async (tx) => {
            const [anyTenant] = await tx.select({ id: tenants.id }).from(tenants).limit(1);
            if (anyTenant) throw new ConflictException({ code: 'recovery_done', message: 'Este servidor ya tiene empresas.', data: { status: 409 } });
            // La cuenta del superadmin ya existe (la pre-crea el arranque, SEC-04,
            // con una contraseña al azar): se activa con la que elige la persona.
            const [existing] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
            const [user] = existing
                ? await tx.update(users).set({ passwordHash, name: input.name, emailVerifiedAt: new Date(), disabledAt: null }).where(eq(users.id, existing.id)).returning()
                : await tx.insert(users).values({ email, passwordHash, name: input.name, emailVerifiedAt: new Date() }).returning();
            const [tenant] = await tx.insert(tenants).values({ slug: slugify(input.workspace_name), name: input.workspace_name }).returning();
            if (!user || !tenant) throw new Error('No se pudo crear la cuenta');
            await tx.execute(sql`set local role imagina_app`);
            await tx.execute(sql`select set_config('app.user_id', ${String(user.id)}, true)`);
            await tx.execute(sql`select set_config('app.tenant_id', ${String(tenant.id)}, true)`);
            await tx.insert(memberships).values({ userId: user.id, tenantId: tenant.id, role: 'admin' });
        });
        this.activeCache = { value: false, at: Date.now() };
        this.logger.log(`Instalación nueva: cuenta del operador creada (${email})`);
        return { ok: true };
    }
}
