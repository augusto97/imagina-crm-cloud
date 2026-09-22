import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

/**
 * Migración de UNA empresa entre instancias (v0.1.197, ADR-S23).
 *
 * El snapshot de ADR-S20 mueve el SERVIDOR entero. Esto mueve un cliente: se
 * exporta su empresa a un archivo portable y se importa en otra instalación,
 * donde todos los ids se regeneran. Es lo que hace falta para partir un
 * servidor en dos, vender una empresa a otro operador o sacar a un cliente de
 * la nube compartida a la suya.
 */

/** Sube de número cuando el formato del archivo deja de ser compatible. */
export const TENANT_TRANSFER_FORMAT = 1;

export const tenantTransferCountsSchema = z.record(z.number().int().min(0));
export type TenantTransferCounts = z.infer<typeof tenantTransferCountsSchema>;

export const tenantTransferManifestSchema = z.object({
    format: z.number().int(),
    app_version: z.string(),
    exported_at: isoDateTimeSchema,
    /**
     * Huella de la `SECRETS_KEY` del ORIGEN. Los secretos viajan cifrados tal
     * cual; si el destino tiene otra clave no se pueden descifrar, así que se
     * descartan en vez de guardar basura que después falla al usarse.
     */
    secrets_fingerprint: z.string().nullable(),
    tenant: z.object({
        slug: z.string(),
        name: z.string(),
        plan: z.string(),
        status: z.string(),
    }),
    counts: tenantTransferCountsSchema,
    files: z.object({ count: z.number().int().min(0), bytes: z.number().int().min(0) }),
    /** Qué NO viaja y por qué, para que el operador no lo descubra después. */
    excluded: z.array(z.string()),
});
export type TenantTransferManifest = z.infer<typeof tenantTransferManifestSchema>;

/** Una fila del listado de archivos de transferencia del servidor. */
export const tenantTransferFileSchema = z.object({
    name: z.string(),
    size: z.number().int().min(0),
    created_at: isoDateTimeSchema,
    /** `null` si el archivo está corrupto o no es una exportación. */
    manifest: tenantTransferManifestSchema.nullable(),
});
export type TenantTransferFile = z.infer<typeof tenantTransferFileSchema>;

export const tenantTransferStatusSchema = z.object({
    available: z.boolean(),
    reason: z.string().nullable(),
    files: z.array(tenantTransferFileSchema),
});
export type TenantTransferStatus = z.infer<typeof tenantTransferStatusSchema>;

export const exportTenantSchema = z.object({
    /** Los registros de ejecución de automatizaciones pueden ser muchos. */
    include_runs: z.boolean().default(true),
    /** Los archivos subidos: sin ellos el import deja los adjuntos rotos. */
    include_files: z.boolean().default(true),
});
export type ExportTenantInput = z.infer<typeof exportTenantSchema>;

export const exportTenantResultSchema = z.object({
    file: z.string(),
    size: z.number().int().min(0),
    manifest: tenantTransferManifestSchema,
});
export type ExportTenantResult = z.infer<typeof exportTenantResultSchema>;

export const importTenantSchema = z.object({
    file: z.string().min(1),
    /** Slug destino; si choca con uno existente se rechaza con el motivo. */
    slug: z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9_-]{1,62}$/, 'Slug inválido')
        .optional(),
    name: z.string().trim().min(1).max(120).optional(),
});
export type ImportTenantInput = z.infer<typeof importTenantSchema>;

/** El mismo pedido sin `file`: el archivo viaja en la ruta del endpoint. */
export const importTenantBodySchema = importTenantSchema.omit({ file: true });
export type ImportTenantBody = z.infer<typeof importTenantBodySchema>;

export const importTenantResultSchema = z.object({
    tenant_id: idSchema,
    slug: z.string(),
    name: z.string(),
    counts: tenantTransferCountsSchema,
    /** Cuentas creadas vs. cuentas que ya existían en el destino (por email). */
    users_created: z.number().int().min(0),
    users_linked: z.number().int().min(0),
    /** Lo que no se pudo traer: secretos ilegibles, referencias muertas… */
    warnings: z.array(z.string()),
});
export type ImportTenantResult = z.infer<typeof importTenantResultSchema>;
