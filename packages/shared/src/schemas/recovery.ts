import { z } from 'zod';
import { registerInputSchema } from './auth';
import { backupDriveStatusSchema } from './backups';

/**
 * v0.1.283 (ADR-S43) — Modo recuperación de un servidor recién instalado.
 *
 * `install.sh` deja la app corriendo con una base vacía y un CÓDIGO de un solo
 * servidor (se imprime en la terminal; en el .env sólo queda su hash). Mientras
 * la base no tenga empresas, `/recuperar` ofrece dos caminos:
 *  - restaurar una copia del Google Drive (conectar → elegir → contraseña);
 *  - empezar de cero (crear la cuenta del operador).
 * Apenas existe un usuario el modo se apaga solo.
 */
export const RECOVERY_STEPS = ['download', 'decrypt', 'env', 'data', 'version', 'restore', 'restart', 'done', 'failed'] as const;
export const recoveryStepSchema = z.enum(RECOVERY_STEPS);
export type RecoveryStep = z.infer<typeof recoveryStepSchema>;

export const recoveryRunSchema = z.object({
    step: recoveryStepSchema,
    message: z.string(),
    /** Avance del paso (descarga), 0-100; null si no aplica. */
    pct: z.number().int().min(0).max(100).nullable(),
    file: z.string().nullable(),
    started_at: z.string(),
    updated_at: z.string(),
});
export type RecoveryRun = z.infer<typeof recoveryRunSchema>;

export const recoveryStatusSchema = z.object({
    /** El servidor está en modo recuperación (instalado, sin empresas). */
    active: z.boolean(),
    /** Este navegador ya ingresó el código. */
    unlocked: z.boolean(),
    app_version: z.string(),
    /** Emails de superadmin del .env (para "empezar de cero"). Sólo con el código. */
    superadmins: z.array(z.string()),
    drive: backupDriveStatusSchema.nullable(),
    run: recoveryRunSchema.nullable(),
});
export type RecoveryStatus = z.infer<typeof recoveryStatusSchema>;

export const recoveryUnlockSchema = z.object({ code: z.string().trim().min(6).max(40) });
export type RecoveryUnlockInput = z.infer<typeof recoveryUnlockSchema>;

export const recoveryDriveClientSchema = z.object({
    client_id: z.string().trim().min(10).max(300),
    client_secret: z.string().trim().min(6).max(300),
});
export type RecoveryDriveClientInput = z.infer<typeof recoveryDriveClientSchema>;

export const recoveryRestoreSchema = z.object({
    file_id: z.string().trim().min(1).max(200),
    passphrase: z.string().min(1).max(200),
});
export type RecoveryRestoreInput = z.infer<typeof recoveryRestoreSchema>;

/** Empezar de cero: la cuenta del operador + su primera empresa. */
export const recoveryFreshSchema = registerInputSchema;
export type RecoveryFreshInput = z.infer<typeof recoveryFreshSchema>;

/** Normaliza el código tal como lo tipea la persona (`k7qf 3mzp-9wxa` → `K7QF3MZP9WXA`). */
export function normalizeRecoveryCode(code: string): string {
    return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
