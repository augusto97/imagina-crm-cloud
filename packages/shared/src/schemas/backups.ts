import { z } from 'zod';

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
    kind: z.enum(['snapshot', 'restore']).nullable(),
    message: z.string().nullable(),
    /** Nombre del archivo producido (snapshot) o restaurado (restore). */
    file: z.string().nullable(),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
});
export type BackupRun = z.infer<typeof backupRunSchema>;

export const BACKUP_KINDS = ['snapshot', 'db_dump', 'pre_restore'] as const;

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
});
export type BackupsSettings = z.infer<typeof backupsSettingsSchema>;

export const updateBackupsSettingsSchema = backupsSettingsSchema.partial();
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
});
export type BackupsStatus = z.infer<typeof backupsStatusSchema>;
