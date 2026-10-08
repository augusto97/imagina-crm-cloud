import { z } from 'zod';

/**
 * Almacenamiento propio de la empresa (v0.1.268, ADR-S36).
 *
 * Por defecto los archivos (adjuntos, logos, PDF guardados) viven en el
 * servidor de la plataforma y cuentan para el límite de almacenamiento del
 * plan. Una empresa puede elegir, en Ajustes → Almacenamiento, una conexión de
 * Integraciones que guarde: lo que se sube desde ese momento va ahí, NO cuenta
 * para el plan y se descarga directo desde el proveedor con un enlace
 * temporal (ni disco ni ancho de banda de la plataforma).
 *
 * Cada archivo recuerda DÓNDE quedó (`attachments.storage_connection_id`), así
 * que cambiar de elección no rompe lo ya guardado: los archivos viejos siguen
 * sirviéndose desde donde están hasta que se muevan.
 */

/** Las apps de Integraciones que pueden guardar los archivos de la empresa. */
export const STORAGE_INTEGRATIONS = ['s3', 'google_drive'] as const;
export type StorageIntegration = (typeof STORAGE_INTEGRATIONS)[number];

export function isStorageIntegration(v: unknown): v is StorageIntegration {
    return typeof v === 'string' && (STORAGE_INTEGRATIONS as readonly string[]).includes(v);
}

/** Una conexión que se puede elegir como almacenamiento. */
export const storageCandidateSchema = z.object({
    id: z.number().int(),
    name: z.string(),
    integration: z.string(),
    /** «bucket · proveedor» para reconocerla. */
    detail: z.string().nullable(),
    /** Si no se puede usar (credencial ilegible, del dueño…), el motivo. */
    problem: z.string().nullable(),
    /** Archivos que ya están guardados en esta conexión. */
    files: z.number().int(),
    bytes: z.number(),
});
export type StorageCandidate = z.infer<typeof storageCandidateSchema>;

export const tenantStorageStatusSchema = z.object({
    /** `platform` = el servidor de la plataforma; `connection` = la conexión elegida. */
    mode: z.enum(['platform', 'connection']),
    connection: storageCandidateSchema.nullable(),
    candidates: z.array(storageCandidateSchema),
    platform: z.object({
        files: z.number().int(),
        bytes: z.number(),
        /** Límite del plan en MB (null = ilimitado). Sólo cuenta lo de la plataforma. */
        limit_mb: z.number().nullable(),
    }),
    /** Archivos guardados en conexiones que NO son la elegida (quedaron de antes). */
    elsewhere: z.object({ files: z.number().int(), bytes: z.number() }),
});
export type TenantStorageStatus = z.infer<typeof tenantStorageStatusSchema>;

export const setTenantStorageSchema = z.object({ connection_id: z.number().int().positive() });
export type SetTenantStorageInput = z.infer<typeof setTenantStorageSchema>;

/**
 * Mover archivos YA guardados: a la conexión elegida (libera el disco y el
 * cupo del plan) o de vuelta al servidor de la plataforma (antes de dejar de
 * usar un almacenamiento). Se hace por tandas: la interfaz llama hasta que
 * `remaining` llega a 0.
 */
export const moveTenantFilesSchema = z.object({
    to: z.enum(['connection', 'platform']),
});
export type MoveTenantFilesInput = z.infer<typeof moveTenantFilesSchema>;

export const moveTenantFilesResultSchema = z.object({
    moved: z.number().int(),
    bytes: z.number(),
    failed: z.array(z.object({ id: z.number().int(), name: z.string(), error: z.string() })),
    remaining: z.number().int(),
});
export type MoveTenantFilesResult = z.infer<typeof moveTenantFilesResultSchema>;
