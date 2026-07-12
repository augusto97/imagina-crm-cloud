import { z } from 'zod';

/**
 * Lista pública (`settings.public`). Permite exponer una lista de solo-lectura
 * en una URL propia de la app y embeberla por iframe en sitios externos, con
 * restricción por dominio.
 *
 *  - `token`: identificador público opaco (no filtra ids/slug internos).
 *  - `visible_field_slugs`: únicos campos que llegan al público.
 *  - `allowed_domains`: si tiene dominios, solo esos pueden embeber la página
 *    (via CSP `frame-ancestors`); vacío = cualquiera puede embeber.
 */
export const publicListSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    token: z.string().default(''),
    visible_field_slugs: z.array(z.string()).default([]),
    sort_allowed_slugs: z.array(z.string()).default([]),
    default_sort: z.string().nullable().default(null),
    per_page: z.number().int().min(1).max(100).default(20),
    search_enabled: z.boolean().default(true),
    allowed_domains: z.array(z.string()).default([]),
    cache_ttl: z.number().int().min(0).max(3600).default(60),
});
export type PublicListSettings = z.infer<typeof publicListSettingsSchema>;

export const PUBLIC_LIST_DEFAULTS: PublicListSettings = {
    enabled: false,
    token: '',
    visible_field_slugs: [],
    sort_allowed_slugs: [],
    default_sort: null,
    per_page: 20,
    search_enabled: true,
    allowed_domains: [],
    cache_ttl: 60,
};

/** Body del PATCH admin de la config pública (parcial). */
export const updatePublicListSchema = publicListSettingsSchema
    .omit({ token: true })
    .partial();
export type UpdatePublicListInput = z.infer<typeof updatePublicListSchema>;

/** Vista admin: incluye el token (para armar link/embed) + estado. */
export interface PublicListAdmin extends PublicListSettings {
    /** URL pública (relativa) de la lista, o null si no está habilitada. */
    public_path: string | null;
}

// --- Respuestas PÚBLICAS (sin auth) ---

export interface PublicFieldMeta {
    slug: string;
    label: string;
    type: string;
}

export interface PublicListMeta {
    name: string;
    description: string | null;
    fields: PublicFieldMeta[];
    sort_allowed: string[];
    default_sort: string | null;
    per_page: number;
    search_enabled: boolean;
    /** White-label del workspace dueño (logo por URL firmada, sin sesión). */
    branding: { primary_color: string | null; app_name: string | null; logo_url: string | null };
}

export interface PublicRecord {
    id: number;
    data: Record<string, unknown>; // por slug, solo campos visibles
}

export interface PublicRecordsPage {
    data: PublicRecord[];
    meta: { next_cursor: string | null };
}

/** Query pública de records (validada; el resto se ignora). */
export const publicRecordsQuerySchema = z.object({
    cursor: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().max(200).optional(),
    sort: z.string().max(120).optional(), // "slug:asc" | "slug:desc"
});
export type PublicRecordsQuery = z.infer<typeof publicRecordsQuerySchema>;
