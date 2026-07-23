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

/**
 * Formato regional del workspace (v0.1.104 — vive en `tenants.settings.
 * format`). En LatAm el punto separa MILES y la coma decimales; cada
 * empresa elige. Los defaults preservan el comportamiento previo de la
 * app (1,234.56 / AAAA-MM-DD / 24 h).
 */
export const NUMBER_FORMATS = ['comma_dot', 'dot_comma', 'space_comma'] as const;
export const DATE_FORMATS = ['ymd', 'dmy', 'mdy'] as const;
export const TIME_FORMATS = ['h24', 'h12'] as const;

export const tenantFormatSchema = z.object({
    /** comma_dot → 1,234.56 · dot_comma → 1.234,56 · space_comma → 1 234,56 */
    number_format: z.enum(NUMBER_FORMATS).default('comma_dot'),
    /** ymd → 2026-12-31 · dmy → 31/12/2026 · mdy → 12/31/2026 */
    date_format: z.enum(DATE_FORMATS).default('ymd'),
    /** h24 → 14:30 · h12 → 2:30 p. m. */
    time_format: z.enum(TIME_FORMATS).default('h24'),
});
export type TenantFormat = z.infer<typeof tenantFormatSchema>;

export const updateTenantFormatSchema = z
    .object({
        number_format: z.enum(NUMBER_FORMATS),
        date_format: z.enum(DATE_FORMATS),
        time_format: z.enum(TIME_FORMATS),
    })
    .partial();
export type UpdateTenantFormatInput = z.infer<typeof updateTenantFormatSchema>;

/**
 * Respuesta del GET: agrega la URL resuelta del logo (descarga con sesión)
 * y el formato regional (viaja acá porque el branding ya se fetchea en el
 * boot de todo miembro — sin request extra).
 */
export const brandingResponseSchema = brandingSchema.extend({
    logo_url: z.string().nullable().default(null),
    format: tenantFormatSchema.default({}),
});
export type BrandingResponse = z.infer<typeof brandingResponseSchema>;

/**
 * Branding para superficies SIN sesión de miembro (portal del cliente,
 * listas públicas embebibles): color + nombre + logo por URL FIRMADA
 * (HMAC, TTL corto — el rol client / el visitante anónimo no pueden usar
 * la descarga con sesión). Nunca expone el file_id crudo.
 */
export const publicBrandingSchema = z.object({
    primary_color: z.string().nullable().default(null),
    app_name: z.string().nullable().default(null),
    logo_url: z.string().nullable().default(null),
});
export type PublicBranding = z.infer<typeof publicBrandingSchema>;

/**
 * v0.1.94 — Presets de estilo de marca por workspace: un `BlockStyle`
 * del editor de plantillas (lib/blockStyle del front) con nombre, para
 * aplicar la misma apariencia en un click en cualquier bloque. Viven en
 * `tenants.settings.style_presets` (jsonb, sin migración).
 */
const styleScale = z.enum(['none', 'sm', 'md', 'lg', 'xl']);
export const blockStylePresetSchema = z.object({
    name: z.string().trim().min(1).max(40),
    style: z
        .object({
            bg: hexColorSchema.optional(),
            text: hexColorSchema.optional(),
            border: hexColorSchema.optional(),
            pad: styleScale.optional(),
            radius: styleScale.optional(),
            shadow: z.enum(['none', 'sm', 'md', 'lg']).optional(),
            align: z.enum(['left', 'center', 'right']).optional(),
            size: z.enum(['sm', 'md', 'lg', 'xl', '2xl']).optional(),
            weight: z.enum(['normal', 'medium', 'semibold', 'bold']).optional(),
        })
        .strip(),
});
export type BlockStylePreset = z.infer<typeof blockStylePresetSchema>;

export const stylePresetsSchema = z.array(blockStylePresetSchema).max(24).default([]);
export const updateStylePresetsSchema = z.object({
    presets: z.array(blockStylePresetSchema).max(24),
});
export type UpdateStylePresetsInput = z.infer<typeof updateStylePresetsSchema>;
