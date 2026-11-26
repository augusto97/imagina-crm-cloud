import { z } from 'zod';
import { partialPatch } from './common';

/**
 * v0.1.179 — Copias de seguridad completas (ADR-S20). Un snapshot es UN
 * archivo con todo lo necesario para volver a levantar la app tal cual
 * estaba: base (pg_dump), archivos subidos, claves `platform:*` de Redis y
 * el `.env` con los secretos. Lo produce `scripts/snapshot.sh`; lo consume
 * `scripts/snapshot-restore.sh` (mismo servidor) o
 * `scripts/bootstrap-server.sh` (servidor nuevo). La consola de plataforma
 * los crea, programa, descarga y restaura.
 */
export const BACKUP_RUN_STATUSES = ['idle', 'queued', 'running', 'restoring', 'success', 'failed'] as const;
export const backupRunStatusSchema = z.enum(BACKUP_RUN_STATUSES);
export type BackupRunStatus = z.infer<typeof backupRunStatusSchema>;

export const backupRunSchema = z.object({
    status: backupRunStatusSchema,
    kind: z.enum(['snapshot', 'restore', 'drive_upload', 'verify']).nullable(),
    message: z.string().nullable(),
    /** Nombre del archivo producido (snapshot) o restaurado (restore). */
    file: z.string().nullable(),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
});
export type BackupRun = z.infer<typeof backupRunSchema>;

export const BACKUP_KINDS = ['snapshot', 'db_dump', 'pre_restore'] as const;

/**
 * v0.1.440 — La PRUEBA de una copia: se restaura en una base temporal aparte
 * (scripts/snapshot-verify.sh) y se mide lo que trae. Una copia que no se
 * puede restaurar es peor que no tener copia: da una tranquilidad falsa.
 *
 * - `ok`: se restauró y trae lo esperado.
 * - `warning`: se restaura, con algo para revisar (le falta una parte, trae
 *   muchos menos registros que la base de hoy…).
 * - `failed`: NO se puede restaurar (dañada, base que no carga, migraciones
 *   que no coinciden, sin permisos del rol de la app…).
 * - `skipped`: no se pudo probar (cifrada, sin disco, sin permiso para crear
 *   la base temporal): no dice nada de la copia.
 */
export const BACKUP_VERIFY_STATUSES = ['ok', 'warning', 'failed', 'skipped'] as const;
export type BackupVerifyStatus = (typeof BACKUP_VERIFY_STATUSES)[number];

export const backupVerifyCheckSchema = z.object({
    key: z.string(),
    label: z.string(),
    status: z.enum(['ok', 'warning', 'failed']),
    detail: z.string().nullable(),
});
export type BackupVerifyCheck = z.infer<typeof backupVerifyCheckSchema>;

export const backupVerifyCountsSchema = z.object({
    tenants: z.number().int().nullable(),
    users: z.number().int().nullable(),
    lists: z.number().int().nullable(),
    fields: z.number().int().nullable(),
    records: z.number().int().nullable(),
});
export type BackupVerifyCounts = z.infer<typeof backupVerifyCountsSchema>;

export const backupVerifySchema = z.object({
    name: z.string(),
    status: z.enum(BACKUP_VERIFY_STATUSES),
    /** Una línea para la persona: qué salió y, si falló, por qué. */
    summary: z.string(),
    verified_at: z.string(),
    trigger: z.enum(['manual', 'scheduled']),
    duration_seconds: z.number().nullable(),
    checks: z.array(backupVerifyCheckSchema),
    /** Lo que trae la copia restaurada (null si no llegó a restaurarse). */
    counts: backupVerifyCountsSchema.nullable(),
    /** Motivo de un `skipped` (encrypted · no_space · no_scratch_db · no_tools · error). */
    skip_code: z.string().nullable(),
});
export type BackupVerify = z.infer<typeof backupVerifySchema>;

export const backupSnapshotSchema = z.object({
    name: z.string(),
    kind: z.enum(BACKUP_KINDS),
    size_bytes: z.number().int().nonnegative(),
    created_at: z.string(),
    app_version: z.string().nullable(),
    encrypted: z.boolean(),
    migrations_applied: z.number().int().nullable(),
    includes: z
        .object({ uploads: z.boolean(), redis: z.boolean(), env: z.boolean() })
        .nullable(),
    /** v0.1.440 — La última prueba de esta copia (null: todavía no se probó). */
    verify: backupVerifySchema.nullable().default(null),
});
export type BackupSnapshot = z.infer<typeof backupSnapshotSchema>;

/** Copias automáticas (viven en Redis `platform:backups` → viajan en el snapshot). */
export const backupsSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    /** Hora UTC del día a la que se hace la copia. */
    hour_utc: z.number().int().min(0).max(23).default(3),
    /** Cuántas copias conservar (las más nuevas). */
    keep: z.number().int().min(1).max(90).default(14),
    /** Incluir el .env (secretos) — necesario para migrar de servidor. */
    include_env: z.boolean().default(true),
    /**
     * v0.1.440 — Probar cada copia automática restaurándola en una base
     * temporal (mismo servidor de Postgres, a la hora de la copia).
     */
    verify_auto: z.boolean().default(true),
});
export type BackupsSettings = z.infer<typeof backupsSettingsSchema>;

export const updateBackupsSettingsSchema = partialPatch(backupsSettingsSchema.partial());
export type UpdateBackupsSettingsInput = z.infer<typeof updateBackupsSettingsSchema>;

export const backupsStatusSchema = z.object({
    /** Falso en dev (sin layout de releases ni BACKUPS_DIR). */
    available: z.boolean(),
    reason: z.string().nullable(),
    /** Restaurar desde el panel exige el layout de releases (reinicia el API). */
    restore_available: z.boolean(),
    backups_dir: z.string().nullable(),
    current_version: z.string(),
    settings: backupsSettingsSchema,
    run: backupRunSchema,
    last_snapshot_at: z.string().nullable(),
    next_run_at: z.string().nullable(),
    snapshots: z.array(backupSnapshotSchema),
    /** v0.1.440 — La prueba más reciente (de cualquier copia). */
    last_verify: backupVerifySchema.nullable().default(null),
});
export type BackupsStatus = z.infer<typeof backupsStatusSchema>;

// ---------------------------------------------------------------------------
// v0.1.282 — Copia externa del servidor en Google Drive (ADR-S43)
// ---------------------------------------------------------------------------

/**
 * La copia completa del servidor (el mismo snapshot de ADR-S20) se sube,
 * CIFRADA con una contraseña de recuperación que elige el operador, a una
 * carpeta de SU Google Drive. Es la pieza que permite levantar la app en un
 * VPS limpio: el instalador conecta el Drive, lista las copias y restaura.
 *
 * La conexión con Google es por "código de dispositivo" (el operador abre
 * google.com/device y escribe un código): no necesita dominio, HTTPS ni
 * redirect — por eso sirve igual en un servidor recién instalado.
 */
export const DRIVE_BACKUP_ROOT_FOLDER = 'Imagina Base · Copias del servidor';
/** Contraseña de recuperación: larga, porque protege TODOS los secretos del servidor. */
export const RECOVERY_PASSPHRASE_MIN = 12;

export const backupDriveUploadSchema = z.object({
    at: z.string(),
    file: z.string().nullable(),
    ok: z.boolean(),
    message: z.string().nullable(),
});
export type BackupDriveUpload = z.infer<typeof backupDriveUploadSchema>;

export const backupDriveStatusSchema = z.object({
    /** Datos del cliente OAuth de Google ("TV y dispositivos de entrada limitada") cargados. */
    configured: z.boolean(),
    client_id: z.string().nullable(),
    /** `••••` si está cargado: el secreto nunca vuelve. */
    client_secret_hint: z.string().nullable(),
    connected: z.boolean(),
    account_email: z.string().nullable(),
    /** La autorización no se puede leer (cambió SECRETS_KEY) o Google la revocó. */
    broken: z.string().nullable(),
    passphrase_set: z.boolean(),
    enabled: z.boolean(),
    keep: z.number().int(),
    /** Nombre del servidor: la subcarpeta de sus copias en el Drive. */
    instance: z.string(),
    folder_url: z.string().nullable(),
    last_upload: backupDriveUploadSchema.nullable(),
    /** Conexión en curso (código de dispositivo). */
    pending: z
        .object({ user_code: z.string(), verification_url: z.string(), expires_at: z.string() })
        .nullable(),
});
export type BackupDriveStatus = z.infer<typeof backupDriveStatusSchema>;

export const updateBackupDriveSchema = z.object({
    client_id: z.string().trim().min(10).max(300).optional(),
    client_secret: z.string().trim().min(6).max(300).optional(),
    passphrase: z.string().min(RECOVERY_PASSPHRASE_MIN).max(200).optional(),
    enabled: z.boolean().optional(),
    keep: z.number().int().min(1).max(90).optional(),
    instance: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .regex(/^[\p{L}\p{N} ._-]+$/u, 'Usa letras, números, espacios, puntos o guiones')
        .optional(),
});
export type UpdateBackupDriveInput = z.infer<typeof updateBackupDriveSchema>;

export const DRIVE_CONNECT_STATES = ['pending', 'connected', 'expired', 'denied', 'idle'] as const;
export const driveConnectPollSchema = z.object({
    state: z.enum(DRIVE_CONNECT_STATES),
    message: z.string().nullable(),
    user_code: z.string().nullable(),
    verification_url: z.string().nullable(),
    account_email: z.string().nullable(),
});
export type DriveConnectPoll = z.infer<typeof driveConnectPollSchema>;

/** Una copia que está en el Drive (se lee de sus propiedades: no hace falta bajarla). */
export const remoteBackupSchema = z.object({
    id: z.string(),
    name: z.string(),
    instance: z.string(),
    created_at: z.string(),
    app_version: z.string().nullable(),
    size_bytes: z.number().int().nonnegative(),
    migrations_applied: z.number().int().nullable(),
    includes: z.object({ uploads: z.boolean(), redis: z.boolean(), env: z.boolean() }).nullable(),
    /** De ESTE servidor (misma instancia). */
    this_server: z.boolean(),
});
export type RemoteBackup = z.infer<typeof remoteBackupSchema>;
