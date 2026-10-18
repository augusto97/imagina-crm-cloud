import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { hostname } from 'node:os';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, type OnModuleInit } from '@nestjs/common';
import {
    updateBackupDriveSchema,
    type BackupDriveStatus,
    type BackupDriveUpload,
    type DriveConnectPoll,
    type RemoteBackup,
    type RemoteTransfer,
    type UpdateBackupDriveInput,
} from '@imagina-base/shared';
import type Redis from 'ioredis';
import { decryptSecret, encryptSecret, isEncrypted } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { REDIS } from '../redis/redis.module';
import { BackupsService, type SnapshotUploader } from './backups.service';
import {
    DriveBackupClient,
    DriveBackupError,
    deviceStart,
    devicePoll,
    refreshAccessToken,
    revokeToken,
    type DriveUrls,
    type RemoteFile,
} from './drive-backup-client';
import { checkPassphrase, decryptFile, encryptFileStream, passphraseVerifier } from './snapshot-crypto';

/**
 * Config de la copia externa. Clave `platform:*` → viaja DENTRO del snapshot:
 * el servidor restaurado sigue conectado y sigue subiendo, sin reconfigurar.
 * Los secretos van cifrados con SECRETS_KEY (que también viaja, en el .env).
 */
const CONFIG_KEY = 'platform:backups:drive';
/** Estado de ESTE servidor (no viaja). */
const LAST_KEY = 'backups:drive:last';
const TOKEN_KEY = 'backups:drive:token';
const DEVICE_KEY = 'backups:drive:device';
const BROKEN_KEY = 'backups:drive:broken';
const ALERT_KEY = 'backups:drive:alerted';

interface DriveConfig {
    client_id: string | null;
    client_secret: string | null;
    refresh_token: string | null;
    account_email: string | null;
    passphrase: string | null;
    passphrase_verifier: string | null;
    enabled: boolean;
    keep: number;
    instance: string | null;
    root_folder_id: string | null;
    instance_folder_id: string | null;
}

const EMPTY: DriveConfig = {
    client_id: null,
    client_secret: null,
    refresh_token: null,
    account_email: null,
    passphrase: null,
    passphrase_verifier: null,
    enabled: true,
    keep: 14,
    instance: null,
    root_folder_id: null,
    instance_folder_id: null,
};

interface PendingDevice {
    device_code: string;
    user_code: string;
    verification_url: string;
    interval: number;
    expires_at: string;
    next_poll_at: number;
}


/** Propiedades de Drive: clave+valor ≤ 124 bytes. */
function prop(value: string): string {
    return value.slice(0, 100);
}

/** `RemoteFile` → lo que ve el panel (sólo con las propiedades: no se baja nada). */
export function toRemoteBackup(f: RemoteFile, currentInstance: string): RemoteBackup {
    const p = f.appProperties;
    const inc = p.imagina_includes ?? '';
    const migrations = Number(p.imagina_migrations);
    return {
        id: f.id,
        name: f.name,
        instance: p.imagina_instance ?? '—',
        created_at: p.imagina_created_at || f.createdTime,
        app_version: p.imagina_version || null,
        size_bytes: f.size,
        migrations_applied: Number.isFinite(migrations) && p.imagina_migrations !== undefined && p.imagina_migrations !== '' ? migrations : null,
        includes: inc ? { uploads: inc.includes('u'), redis: inc.includes('r'), env: inc.includes('e') } : null,
        this_server: (p.imagina_instance ?? '') === currentInstance,
    };
}

/** v0.1.284 — Fila del panel de una empresa exportada que está en el Drive. */
export function toRemoteTransfer(f: RemoteFile, currentInstance: string): RemoteTransfer {
    const p = f.appProperties;
    const records = Number(p.imagina_records);
    return {
        id: f.id,
        name: f.name,
        instance: p.imagina_instance ?? '—',
        tenant_slug: p.imagina_tenant ?? '',
        tenant_name: p.imagina_tenant_name || p.imagina_tenant || f.name,
        exported_at: p.imagina_created_at || f.createdTime,
        app_version: p.imagina_version || null,
        records: p.imagina_records !== undefined && p.imagina_records !== '' && Number.isFinite(records) ? records : null,
        size_bytes: f.size,
        this_server: (p.imagina_instance ?? '') === currentInstance,
    };
}

/**
 * v0.1.282 (ADR-S43) — Copia del SERVIDOR en el Google Drive del operador.
 * Cada snapshot que se crea (manual o automático) se sube cifrado con la
 * contraseña de recuperación a `Imagina Base · Copias del servidor/<servidor>`
 * y se conservan las N más nuevas. Es lo que permite, si el servidor muere,
 * instalar uno limpio, conectar el mismo Drive y elegir la copia.
 */
@Injectable()
export class BackupDriveService implements OnModuleInit, SnapshotUploader {
    private readonly logger = new Logger(BackupDriveService.name);

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(REDIS) private readonly redis: Redis,
        private readonly backups: BackupsService,
        @Optional() private readonly mail?: MailService,
    ) {}

    onModuleInit(): void {
        this.backups.registerUploader(this);
    }

    private get urls(): DriveUrls {
        return { oauth: this.env.GOOGLE_OAUTH_URL, api: this.env.GOOGLE_DRIVE_API_URL };
    }

    /** Nombre por defecto del servidor: el host de la app, o el de la máquina. */
    defaultInstance(): string {
        try {
            const host = new URL(this.env.APP_BASE_URL).hostname;
            if (host && host !== 'localhost' && host !== '127.0.0.1') return host;
        } catch {
            // URL inválida
        }
        return hostname() || 'servidor';
    }

    // ── config ──────────────────────────────────────────────────────────

    private async config(): Promise<DriveConfig> {
        const raw = await this.redis.get(CONFIG_KEY);
        if (!raw) return { ...EMPTY };
        try {
            return { ...EMPTY, ...(JSON.parse(raw) as Partial<DriveConfig>) };
        } catch {
            return { ...EMPTY };
        }
    }

    private async save(cfg: DriveConfig): Promise<void> {
        await this.redis.set(CONFIG_KEY, JSON.stringify(cfg));
    }

    private instanceOf(cfg: DriveConfig): string {
        return cfg.instance?.trim() || this.defaultInstance();
    }

    /** Un secreto guardado; `null` si no hay; lanza si está pero no se puede leer. */
    private reveal(value: string | null, what: string): string | null {
        if (!value) return null;
        if (!isEncrypted(value)) return value;
        if (!this.env.SECRETS_KEY) throw new DriveBackupError(`${what} está cifrado y falta SECRETS_KEY en el servidor.`);
        try {
            return decryptSecret(value, this.env.SECRETS_KEY);
        } catch {
            throw new DriveBackupError(`${what} no se puede leer: SECRETS_KEY cambió desde que se guardó. Vuelve a cargarlo.`);
        }
    }

    private seal(value: string): string {
        return encryptSecret(value, this.env.SECRETS_KEY);
    }

    async status(): Promise<BackupDriveStatus> {
        const cfg = await this.config();
        let broken: string | null = await this.redis.get(BROKEN_KEY);
        if (!broken) {
            try {
                this.reveal(cfg.client_secret, 'El secreto del cliente de Google');
                this.reveal(cfg.refresh_token, 'La autorización de Google Drive');
                this.reveal(cfg.passphrase, 'La contraseña de recuperación');
            } catch (err) {
                broken = (err as Error).message;
            }
        }
        const pending = await this.pending();
        const lastRaw = await this.redis.get(LAST_KEY);
        let last: BackupDriveUpload | null = null;
        try {
            last = lastRaw ? (JSON.parse(lastRaw) as BackupDriveUpload) : null;
        } catch {
            last = null;
        }
        return {
            configured: !!cfg.client_id && !!cfg.client_secret,
            client_id: cfg.client_id,
            client_secret_hint: cfg.client_secret ? '••••' : null,
            connected: !!cfg.refresh_token,
            account_email: cfg.account_email,
            broken,
            passphrase_set: !!cfg.passphrase,
            enabled: cfg.enabled,
            keep: cfg.keep,
            instance: this.instanceOf(cfg),
            folder_url: cfg.instance_folder_id ? `https://drive.google.com/drive/folders/${cfg.instance_folder_id}` : null,
            last_upload: last,
            pending: pending
                ? { user_code: pending.user_code, verification_url: pending.verification_url, expires_at: pending.expires_at }
                : null,
        };
    }

    async update(input: UpdateBackupDriveInput): Promise<BackupDriveStatus> {
        const patch = updateBackupDriveSchema.parse(input);
        const cfg = await this.config();
        if (patch.client_id !== undefined && patch.client_id !== cfg.client_id) {
            // Otro cliente de Google: la autorización anterior no le sirve.
            cfg.client_id = patch.client_id;
            cfg.refresh_token = null;
            cfg.account_email = null;
            await this.redis.del(TOKEN_KEY, DEVICE_KEY, BROKEN_KEY);
        }
        if (patch.client_secret !== undefined) cfg.client_secret = this.seal(patch.client_secret);
        if (patch.passphrase !== undefined) {
            cfg.passphrase = this.seal(patch.passphrase);
            cfg.passphrase_verifier = passphraseVerifier(patch.passphrase);
        }
        if (patch.enabled !== undefined) cfg.enabled = patch.enabled;
        if (patch.keep !== undefined) cfg.keep = patch.keep;
        if (patch.instance !== undefined && patch.instance !== this.instanceOf(cfg)) {
            cfg.instance = patch.instance;
            cfg.instance_folder_id = null;
        }
        await this.save(cfg);
        return this.status();
    }

    // ── conexión (código de dispositivo) ────────────────────────────────

    private async pending(): Promise<PendingDevice | null> {
        const raw = await this.redis.get(DEVICE_KEY);
        if (!raw) return null;
        try {
            return JSON.parse(raw) as PendingDevice;
        } catch {
            return null;
        }
    }

    private async clientCredentials(cfg: DriveConfig): Promise<{ id: string; secret: string }> {
        const secret = this.reveal(cfg.client_secret, 'El secreto del cliente de Google');
        if (!cfg.client_id || !secret) {
            throw new BadRequestException({ code: 'drive_not_configured', message: 'Primero carga el ID y el secreto del cliente de Google.', data: { status: 400 } });
        }
        return { id: cfg.client_id, secret };
    }

    async connectStart(): Promise<DriveConnectPoll> {
        const cfg = await this.config();
        const cred = await this.clientCredentials(cfg);
        const started = await deviceStart(this.urls, cred.id).catch((err: unknown) => {
            throw new BadRequestException({ code: 'drive_connect_failed', message: (err as Error).message, data: { status: 400 } });
        });
        const pending: PendingDevice = {
            device_code: started.device_code,
            user_code: started.user_code,
            verification_url: started.verification_url,
            interval: started.interval,
            expires_at: new Date(Date.now() + started.expires_in * 1000).toISOString(),
            next_poll_at: Date.now() + started.interval * 1000,
        };
        await this.redis.set(DEVICE_KEY, JSON.stringify(pending), 'EX', started.expires_in);
        return { state: 'pending', message: null, user_code: pending.user_code, verification_url: pending.verification_url, account_email: null };
    }

    /** Lo pregunta el panel cada pocos segundos mientras el operador autoriza. */
    async connectPoll(): Promise<DriveConnectPoll> {
        const pending = await this.pending();
        if (!pending) {
            const cfg = await this.config();
            return cfg.refresh_token
                ? { state: 'connected', message: null, user_code: null, verification_url: null, account_email: cfg.account_email }
                : { state: 'idle', message: null, user_code: null, verification_url: null, account_email: null };
        }
        const base = { user_code: pending.user_code, verification_url: pending.verification_url, account_email: null };
        if (Date.now() > new Date(pending.expires_at).getTime()) {
            await this.redis.del(DEVICE_KEY);
            return { ...base, state: 'expired', message: 'El código venció sin que se autorizara. Pide uno nuevo.' };
        }
        // Google pide no preguntar más seguido que `interval`.
        if (Date.now() < pending.next_poll_at) return { ...base, state: 'pending', message: null };
        const cfg = await this.config();
        const cred = await this.clientCredentials(cfg);
        const result = await devicePoll(this.urls, cred.id, cred.secret, pending.device_code).catch((err: unknown) => {
            throw new BadRequestException({ code: 'drive_connect_failed', message: (err as Error).message, data: { status: 400 } });
        });
        if (result.state === 'pending') {
            const interval = result.slowDown ? pending.interval + 5 : pending.interval;
            const ttl = Math.max(1, Math.ceil((new Date(pending.expires_at).getTime() - Date.now()) / 1000));
            await this.redis.set(DEVICE_KEY, JSON.stringify({ ...pending, interval, next_poll_at: Date.now() + interval * 1000 }), 'EX', ttl);
            return { ...base, state: 'pending', message: null };
        }
        await this.redis.del(DEVICE_KEY);
        if (result.state !== 'connected') return { ...base, state: result.state, message: result.message };

        await this.redis.set(TOKEN_KEY, result.access_token, 'EX', Math.max(60, result.expires_in - 120));
        const client = new DriveBackupClient(this.urls, async () => result.access_token);
        const email = await client.accountEmail().catch(() => null);
        const fresh = await this.config();
        // Otra cuenta de Google: las carpetas recordadas son de la anterior.
        const sameAccount = fresh.account_email && email && fresh.account_email.toLowerCase() === email.toLowerCase();
        await this.save({
            ...fresh,
            refresh_token: this.seal(result.refresh_token),
            account_email: email,
            ...(sameAccount ? {} : { root_folder_id: null, instance_folder_id: null }),
        });
        await this.redis.del(BROKEN_KEY);
        this.logger.log(`Google Drive conectado para las copias del servidor (${email ?? 'cuenta sin email'})`);
        return { state: 'connected', message: null, user_code: null, verification_url: null, account_email: email };
    }

    async connectCancel(): Promise<void> {
        await this.redis.del(DEVICE_KEY);
    }

    async disconnect(): Promise<BackupDriveStatus> {
        const cfg = await this.config();
        try {
            const refresh = this.reveal(cfg.refresh_token, 'La autorización');
            if (refresh) await revokeToken(this.urls, refresh);
        } catch {
            // ilegible: igual se olvida
        }
        await this.save({ ...cfg, refresh_token: null, account_email: null, root_folder_id: null, instance_folder_id: null });
        await this.redis.del(TOKEN_KEY, DEVICE_KEY, BROKEN_KEY);
        return this.status();
    }

    // ── cliente con token vigente ───────────────────────────────────────

    private async accessToken(): Promise<string> {
        const cached = await this.redis.get(TOKEN_KEY);
        if (cached) return cached;
        const cfg = await this.config();
        const cred = await this.clientCredentials(cfg);
        const refresh = this.reveal(cfg.refresh_token, 'La autorización de Google Drive');
        if (!refresh) throw new DriveBackupError('Google Drive no está conectado.');
        try {
            const t = await refreshAccessToken(this.urls, cred.id, cred.secret, refresh);
            await this.redis.set(TOKEN_KEY, t.access_token, 'EX', Math.max(60, t.expires_in - 120));
            return t.access_token;
        } catch (err) {
            if (err instanceof DriveBackupError && err.reconnect) await this.redis.set(BROKEN_KEY, err.message);
            throw err;
        }
    }

    private client(): DriveBackupClient {
        return new DriveBackupClient(this.urls, () => this.accessToken());
    }

    private async instanceFolder(client: DriveBackupClient, cfg: DriveConfig): Promise<string> {
        if (cfg.instance_folder_id) return cfg.instance_folder_id;
        const root = cfg.root_folder_id ?? (await client.ensureRootFolder());
        const folder = await client.ensureInstanceFolder(root, this.instanceOf(cfg));
        const fresh = await this.config();
        await this.save({ ...fresh, root_folder_id: root, instance_folder_id: folder });
        return folder;
    }

    // ── subir ───────────────────────────────────────────────────────────

    /** Hook de BackupsService: tras crear una copia, subirla si corresponde. */
    async afterSnapshot(name: string, progress: (message: string) => Promise<void>): Promise<{ ok: boolean; message: string } | null> {
        const cfg = await this.config();
        if (!cfg.refresh_token || !cfg.enabled) return null;
        if (!cfg.passphrase) {
            const message = 'Falta definir la contraseña de recuperación: sin ella las copias no se suben.';
            await this.recordUpload(name, false, message);
            return { ok: false, message };
        }
        return this.upload(name, progress);
    }

    async upload(name: string, progress: (message: string) => Promise<void> = async () => undefined): Promise<{ ok: boolean; message: string }> {
        try {
            const file = this.backups.resolve(name);
            const { size } = statSync(file);
            let cfg = await this.config();
            const passphrase = this.reveal(cfg.passphrase, 'La contraseña de recuperación');
            if (!passphrase) throw new DriveBackupError('Falta definir la contraseña de recuperación.');
            const manifest = await this.backups.manifestOf(file);
            const client = this.client();
            let folder = await this.instanceFolder(client, cfg);
            cfg = await this.config();

            const doUpload = (parent: string) =>
                this.encryptAndUpload(client, file, size, passphrase, {
                    name: `${name}.gpg`,
                    parent,
                    appProperties: {
                        imagina_backups: 'snapshot',
                        imagina_instance: prop(this.instanceOf(cfg)),
                        imagina_version: prop(manifest?.app_version || /-v(.+?)\.tar/.exec(name)?.[1] || ''),
                        imagina_created_at: prop(manifest?.created_at || new Date().toISOString()),
                        imagina_migrations: manifest?.migrations_applied != null ? String(manifest.migrations_applied) : '',
                        imagina_includes: manifest
                            ? `${manifest.includes.uploads ? 'u' : ''}${manifest.includes.redis ? 'r' : ''}${manifest.includes.env ? 'e' : ''}`
                            : '',
                        imagina_pv: cfg.passphrase_verifier ?? '',
                    },
                }, progress);

            await progress('Subiendo a Google Drive…');
            let up;
            try {
                up = await doUpload(folder);
            } catch (err) {
                // La carpeta se borró desde el Drive: se crea de nuevo y se reintenta.
                if (!(err instanceof DriveBackupError) || err.status !== 404) throw err;
                await this.save({ ...(await this.config()), root_folder_id: null, instance_folder_id: null });
                folder = await this.instanceFolder(client, await this.config());
                up = await doUpload(folder);
            }
            const pruned = await this.prune(client, cfg.keep).catch(() => 0);
            const message = `Subida a Google Drive (${formatMb(up.size)})${pruned ? `; se borraron ${pruned} copias viejas del Drive` : ''}.`;
            await this.recordUpload(`${name}.gpg`, true, message);
            this.logger.log(`Copia subida a Google Drive: ${name}.gpg`);
            return { ok: true, message };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.recordUpload(name, false, message);
            this.logger.error(`La subida a Google Drive falló: ${message}`);
            await this.alert(name, message);
            return { ok: false, message };
        }
    }

    /**
     * Cifra un archivo (GPG, contraseña de recuperación) MIENTRAS lo sube por
     * partes. Si gpg falla a mitad, el archivo subido quedó truncado: se borra.
     */
    private async encryptAndUpload(
        client: DriveBackupClient,
        file: string,
        size: number,
        passphrase: string,
        meta: { name: string; parent: string; appProperties: Record<string, string> },
        progress: (message: string) => Promise<void>,
    ): Promise<{ id: string; size: number }> {
        const enc = encryptFileStream(file, passphrase);
        let lastPct = -1;
        const uploaded = client.uploadStream(enc.stream, meta, (bytes) => {
            const pct = size > 0 ? Math.min(99, Math.floor((bytes / size) * 100)) : 0;
            if (pct !== lastPct && pct % 5 === 0) {
                lastPct = pct;
                void progress(`Subiendo a Google Drive… ${pct}%`);
            }
        });
        const [up] = await Promise.all([uploaded, enc.done]).catch(async (err: unknown) => {
            const done = await uploaded.catch(() => null);
            if (done) await client.deleteFile(done.id).catch(() => undefined);
            throw err;
        });
        return up;
    }

    /** Conserva las N más nuevas de ESTE servidor. Devuelve cuántas borró. */
    private async prune(client: DriveBackupClient, keep: number): Promise<number> {
        const cfg = await this.config();
        const mine = (await client.listSnapshots()).filter((f) => f.appProperties.imagina_instance === prop(this.instanceOf(cfg)));
        const extra = mine.slice(keep);
        for (const f of extra) await client.deleteFile(f.id);
        return extra.length;
    }

    private async recordUpload(file: string, ok: boolean, message: string): Promise<void> {
        const entry: BackupDriveUpload = { at: new Date().toISOString(), file, ok, message };
        await this.redis.set(LAST_KEY, JSON.stringify(entry));
        if (ok) await this.redis.del(ALERT_KEY);
    }

    /**
     * Aviso por correo a los superadmins: una copia que no sale del servidor
     * es una copia que no sirve si el servidor se pierde. Uno cada 12 h como
     * mucho (si todas las noches falla, no se inunda la casilla).
     */
    private async alert(name: string, message: string): Promise<void> {
        const to = this.env.PLATFORM_SUPERADMINS;
        if (!this.mail || to.length === 0) return;
        try {
            const first = await this.redis.set(ALERT_KEY, '1', 'EX', 12 * 3600, 'NX');
            if (first !== 'OK') return;
            const panel = `${this.env.APP_BASE_URL.replace(/\/$/, '')}/platform?tab=backups`;
            const subject = 'La copia del servidor no se pudo subir a Google Drive';
            const text = [
                `La copia ${name} se creó en el servidor, pero no se pudo subir a Google Drive:`,
                '',
                message,
                '',
                'Mientras no se arregle, si el servidor se pierde no hay copia fuera de él.',
                `Revísalo en Plataforma → Copias de seguridad: ${panel}`,
            ].join('\n');
            const html = `<p>La copia <b>${esc(name)}</b> se creó en el servidor, pero <b>no se pudo subir a Google Drive</b>:</p><p style="padding:10px;background:#fef2f2;border-radius:6px">${esc(message)}</p><p>Mientras no se arregle, si el servidor se pierde no hay copia fuera de él.</p><p><a href="${esc(panel)}">Revisar en Plataforma → Copias de seguridad</a></p>`;
            for (const address of to) await this.mail.enqueue({ to: address, subject, text, html });
        } catch {
            // sin correo de plataforma: el panel igual lo muestra
        }
    }

    // ── listar / borrar ─────────────────────────────────────────────────

    async listRemote(): Promise<RemoteBackup[]> {
        const cfg = await this.config();
        if (!cfg.refresh_token) return [];
        const files = await this.client()
            .listSnapshots()
            .catch((err: unknown) => {
                throw new ConflictException({ code: 'drive_unavailable', message: (err as Error).message, data: { status: 409 } });
            });
        const instance = prop(this.instanceOf(cfg));
        return files.map((f) => toRemoteBackup(f, instance));
    }

    /** v0.1.283 — Una copia del Drive (null si no existe o no es una copia). */
    async remoteFile(id: string): Promise<RemoteFile | null> {
        const file = await this.client().getFile(id);
        return file && file.appProperties.imagina_backups === 'snapshot' ? file : null;
    }

    /** v0.1.283 — Baja una copia del Drive a disco (modo recuperación). */
    async downloadRemote(id: string, dest: string, onProgress?: (bytes: number) => void): Promise<number> {
        return this.client().download(id, dest, onProgress);
    }

    async deleteRemote(id: string): Promise<void> {
        const client = this.client();
        const file = await client.getFile(id).catch((err: unknown) => {
            throw new ConflictException({ code: 'drive_unavailable', message: (err as Error).message, data: { status: 409 } });
        });
        if (!file || file.appProperties.imagina_backups !== 'snapshot') {
            throw new NotFoundException({ code: 'backup_not_found', message: 'Esa copia no está en el Drive', data: { status: 404 } });
        }
        await client.deleteFile(id);
    }

    // ── v0.1.284 — empresas exportadas (ADR-S23) por el Drive ───────────

    /** Si este servidor puede subir/traer empresas; si no, el motivo. */
    async transferReadiness(): Promise<string | null> {
        const st = await this.status();
        if (st.broken) return st.broken;
        if (!st.connected) return 'Conecta Google Drive en Copias de seguridad para mover empresas por ahí.';
        if (!st.passphrase_set) return 'Define la contraseña de recuperación en Copias de seguridad: cifra la empresa antes de subirla.';
        return null;
    }

    /** Sube el archivo de una empresa, cifrado, a «Empresas exportadas». */
    async uploadTransfer(
        file: string,
        info: { tenant_slug: string; tenant_name: string; exported_at: string; app_version: string; records: number | null },
        progress: (message: string) => Promise<void> = async () => undefined,
    ): Promise<{ id: string; size: number }> {
        const cfg = await this.config();
        const passphrase = this.reveal(cfg.passphrase, 'La contraseña de recuperación');
        if (!passphrase) throw new DriveBackupError('Falta definir la contraseña de recuperación.');
        const client = this.client();
        const root = cfg.root_folder_id ?? (await client.ensureRootFolder());
        const name = `${path.basename(file)}.gpg`;
        const meta = (parent: string) => ({
            name,
            parent,
            appProperties: {
                imagina_backups: 'tenant_transfer',
                imagina_instance: prop(this.instanceOf(cfg)),
                imagina_tenant: prop(info.tenant_slug),
                imagina_tenant_name: prop(info.tenant_name),
                imagina_version: prop(info.app_version),
                imagina_created_at: prop(info.exported_at),
                imagina_records: info.records != null ? String(info.records) : '',
                imagina_pv: cfg.passphrase_verifier ?? '',
            },
        });
        const { size } = statSync(file);
        try {
            const folder = await client.ensureTransfersFolder(root);
            return await this.encryptAndUpload(client, file, size, passphrase, meta(folder), progress);
        } catch (err) {
            // La carpeta raíz se borró desde el Drive: se crea de nuevo una vez.
            if (!(err instanceof DriveBackupError) || err.status !== 404) throw err;
            await this.save({ ...(await this.config()), root_folder_id: null, instance_folder_id: null });
            const folder = await client.ensureTransfersFolder(await client.ensureRootFolder());
            return this.encryptAndUpload(client, file, size, passphrase, meta(folder), progress);
        }
    }

    async listTransfers(): Promise<RemoteTransfer[]> {
        const cfg = await this.config();
        if (!cfg.refresh_token) return [];
        const instance = prop(this.instanceOf(cfg));
        return (await this.client().listByKind('tenant_transfer')).map((f) => toRemoteTransfer(f, instance));
    }

    /**
     * Trae una empresa del Drive a `destDir` (descifrada, lista para importar).
     * La contraseña es la del servidor que la SUBIÓ (puede no ser la de éste):
     * se verifica antes de bajar nada. Devuelve el nombre del archivo.
     */
    async fetchTransfer(id: string, passphrase: string, destDir: string, onProgress?: (pct: number) => void): Promise<string> {
        const client = this.client();
        const file = await this.verifyTransfer(id, passphrase);
        // Mismo criterio de nombres que el directorio de transferencias (sin traversal).
        let base = file.name.replace(/\.gpg$/, '').replace(/[^A-Za-z0-9._-]/g, '_');
        if (!base.endsWith('.tar')) base = `${base}.tar`;
        let target = path.join(destDir, base);
        for (let i = 2; existsSync(target); i++) target = path.join(destDir, base.replace(/\.tar$/, `-${i}.tar`));
        const enc = path.join(destDir, `.drive-${Date.now()}.gpg`);
        const tmp = path.join(destDir, `.drive-${Date.now()}.tar`);
        try {
            await client.download(id, enc, (bytes) => onProgress?.(file.size > 0 ? Math.min(100, Math.floor((bytes / file.size) * 100)) : 0));
            await decryptFile(enc, tmp, passphrase);
            renameSync(tmp, target);
        } finally {
            rmSync(enc, { force: true });
            rmSync(tmp, { force: true });
        }
        return path.basename(target);
    }

    /** La empresa existe en el Drive y la contraseña es la que la cifró (sin bajar nada). */
    async verifyTransfer(id: string, passphrase: string): Promise<RemoteFile> {
        const file = await this.client().getFile(id);
        if (!file || file.appProperties.imagina_backups !== 'tenant_transfer') {
            throw new NotFoundException({ code: 'transfer_not_found', message: 'Esa empresa ya no está en el Drive.', data: { status: 404 } });
        }
        if (checkPassphrase(passphrase, file.appProperties.imagina_pv) === false) {
            throw new BadRequestException({ code: 'bad_passphrase', message: 'La contraseña no es la del servidor que subió esa empresa.', data: { status: 400 } });
        }
        return file;
    }

    async deleteTransfer(id: string): Promise<void> {
        const client = this.client();
        const file = await client.getFile(id);
        if (!file || file.appProperties.imagina_backups !== 'tenant_transfer') {
            throw new NotFoundException({ code: 'transfer_not_found', message: 'Esa empresa ya no está en el Drive.', data: { status: 404 } });
        }
        await client.deleteFile(id);
    }

    // ── kit de recuperación ─────────────────────────────────────────────

    /**
     * Lo que hay que tener a mano el día que el servidor no está: con esto
     * y la contraseña de recuperación (que NO va acá) se levanta otro.
     */
    async recoveryKit(): Promise<string> {
        const cfg = await this.config();
        const cred = await this.clientCredentials(cfg).catch(() => null);
        const instance = this.instanceOf(cfg);
        const lines = [
            'IMAGINA BASE — KIT DE RECUPERACIÓN DEL SERVIDOR',
            '='.repeat(48),
            '',
            `Generado: ${new Date().toISOString()}`,
            `Servidor: ${instance}  (${this.env.APP_BASE_URL})`,
            `Versión instalada: ${this.backups.currentVersion()}`,
            `Cuenta de Google con las copias: ${cfg.account_email ?? '(sin conectar)'}`,
            `Carpeta del Drive: «${'Imagina Base · Copias del servidor'}» / «${instance}»`,
            ...(cfg.instance_folder_id ? [`  https://drive.google.com/drive/folders/${cfg.instance_folder_id}`] : []),
            '',
            'Cliente de Google (para conectar el Drive desde el servidor nuevo):',
            `  ID del cliente: ${cred?.id ?? '(sin cargar)'}`,
            `  Secreto:        ${cred?.secret ?? '(sin cargar)'}`,
            '',
            'LA CONTRASEÑA DE RECUPERACIÓN NO ESTÁ EN ESTE ARCHIVO (a propósito).',
            'Sin ella las copias no se pueden abrir: guárdala en un gestor de contraseñas.',
            '',
            '-'.repeat(48),
            'CÓMO LEVANTAR UN SERVIDOR NUEVO CON UNA COPIA',
            '-'.repeat(48),
            '',
            '1. En un VPS limpio con Ubuntu o Debian, como root:',
            `     curl -fsSL https://github.com/${this.env.UPDATER_GITHUB_REPO}/releases/latest/download/install.sh | sudo bash`,
            '   Pregunta el dominio, tu correo y el servidor web (Caddy o ServerAvatar),',
            '   instala todo y muestra un CÓDIGO.',
            '2. Apunta el DNS del dominio al servidor nuevo.',
            '3. Abre https://<tu dominio>/recuperar, escribe el código y elige',
            '   «Restaurar una copia de Google Drive»: pega el ID y el secreto de',
            '   arriba, conecta la misma cuenta de Google, elige la copia y escribe',
            '   la contraseña de recuperación. Instala la versión de la copia y',
            '   restaura datos, archivos, ajustes y secretos.',
            '   Sin dominio todavía: en la terminal del servidor, sudo imagina-restore',
            '',
            'A mano (sin el instalador): baja la copia (…tar.gpg) de la carpeta, descífrala',
            '     gpg --output copia.tar --decrypt imagina-snapshot-…tar.gpg',
            '   y sigue docs/runbook-migration.md (escenario 2, bootstrap-server.sh).',
            '',
            'El servidor restaurado sigue conectado al mismo Google Drive y sigue',
            'subiendo sus copias solo.',
            '',
        ];
        return lines.join('\n');
    }
}

function formatMb(n: number): string {
    return n >= 1024 * 1024 * 1024 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

