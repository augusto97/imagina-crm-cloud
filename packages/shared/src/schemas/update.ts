import { z } from 'zod';
import { idSchema } from './common';

/**
 * Auto-actualización desde GitHub Releases (ADR-S13). Un release detectado se
 * guarda en `app_releases` (global, sin tenant); el admin de plataforma lo
 * instala con un flip de symlink atómico + health-check + rollback.
 */
export const appReleaseSchema = z.object({
    id: idSchema,
    version: z.string(),
    channel: z.string(),
    bundle_url: z.string().url(),
    checksum: z.string().nullable(),
    released_at: z.string(), // ISO
});
export type AppRelease = z.infer<typeof appReleaseSchema>;

/** Estados del run de actualización (persistidos en Redis, compartidos). */
export const UPDATE_RUN_STATUSES = [
    'idle',
    'queued',
    'running',
    'restarting',
    'success',
    'failed',
    'rolled_back',
] as const;
export const updateRunStatusSchema = z.enum(UPDATE_RUN_STATUSES);
export type UpdateRunStatus = z.infer<typeof updateRunStatusSchema>;

export const updateRunSchema = z.object({
    status: updateRunStatusSchema,
    version: z.string().nullable(),
    message: z.string().nullable(),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
});
export type UpdateRun = z.infer<typeof updateRunSchema>;

export const updateStatusSchema = z.object({
    current_version: z.string(),
    available: appReleaseSchema.nullable(),
    update_available: z.boolean(),
    run: updateRunSchema,
});
export type UpdateStatus = z.infer<typeof updateStatusSchema>;
