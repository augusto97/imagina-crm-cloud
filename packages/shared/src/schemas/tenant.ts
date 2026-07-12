import { z } from 'zod';
import { idSchema } from './common';
import { tenantSlugSchema } from './slug';

/**
 * Workspace (tenant). El detalle de planes llega en F4 (Stripe);
 * por ahora `plan` es un string con default `trial`.
 */
export const tenantSchema = z.object({
    id: idSchema,
    slug: tenantSlugSchema,
    name: z.string().min(1).max(120),
    plan: z.string().default('trial'),
    settings: z.record(z.unknown()).default({}),
});
export type Tenant = z.infer<typeof tenantSchema>;

export const createWorkspaceSchema = z.object({
    name: z.string().trim().min(1).max(120),
    slug: tenantSlugSchema.optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

/**
 * Branding white-label por workspace (vive en `tenants.settings.branding`).
 * `primary_color` re-pinta los tokens del tema en el boot del front (el
 * sistema de CSS variables hace el resto); `logo_file_id` referencia un
 * attachment del propio tenant (módulo de archivos); `app_name` reemplaza
 * "Imagina Base" en el sidebar. Todo null = branding por defecto.
 */
export const hexColorSchema = z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color hex inválido (formato #RRGGBB)');

export const brandingSchema = z.object({
    primary_color: hexColorSchema.nullable().default(null),
    logo_file_id: idSchema.nullable().default(null),
    app_name: z.string().trim().min(1).max(60).nullable().default(null),
});
export type Branding = z.infer<typeof brandingSchema>;

/** PATCH parcial: sólo las claves presentes se tocan; null = volver al default. */
export const updateBrandingSchema = z
    .object({
        primary_color: hexColorSchema.nullable(),
        logo_file_id: idSchema.nullable(),
        app_name: z.string().trim().min(1).max(60).nullable(),
    })
    .partial();
export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;

/** Respuesta del GET: agrega la URL resuelta del logo (descarga con sesión). */
export const brandingResponseSchema = brandingSchema.extend({
    logo_url: z.string().nullable().default(null),
});
export type BrandingResponse = z.infer<typeof brandingResponseSchema>;
