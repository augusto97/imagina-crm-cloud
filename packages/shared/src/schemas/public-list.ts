import { z } from 'zod';
import { idSchema } from './common';
import { tenantFormatSchema } from './tenant';

/**
 * Lista pública (`settings.public`). Permite exponer una lista de solo-lectura
 * en una URL propia de la app y embeberla por iframe en sitios externos, con
 * restricción por dominio.
 *
 *  - `token`: identificador público opaco (no filtra ids/slug internos).
 *  - `visible_field_ids`: únicos campos que llegan al público, POR ID (regla
 *    de oro nº 1: renombrar un campo o cambiarle el slug no lo saca de la
 *    lista pública). Hasta v0.1.285 se guardaban por slug
 *    (`visible_field_slugs`): se siguen leyendo y se convierten al guardar.
 *  - `allowed_domains`: si tiene dominios, solo esos pueden embeber la página
 *    (via CSP `frame-ancestors`); vacío = cualquiera puede embeber.
 */
export const publicListSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    token: z.string().default(''),
    visible_field_ids: z.array(idSchema).default([]),
    sort_allowed_field_ids: z.array(idSchema).default([]),
    /** Orden por defecto: campo (por id) y dirección. */
    default_sort_field_id: idSchema.nullable().default(null),
    default_sort_dir: z.enum(['asc', 'desc']).default('asc'),
    per_page: z.number().int().min(1).max(100).default(20),
    search_enabled: z.boolean().default(true),
    allowed_domains: z.array(z.string()).default([]),
    /**
     * Vista guardada que se publica. Con `null` sale la lista completa;
     * con una vista, sus FILTROS acotan lo que ve el visitante (los
     * campos expuestos siguen siendo los visibles — filtrar no es lo mismo
     * que mostrar).
     */
    view_id: z.number().int().positive().nullable().default(null),
    /**
     * Caducidad del enlace (`YYYY-MM-DD`). Pasada esa fecha —al final de ese
     * día en la zona horaria de la empresa— el enlace responde 404, igual que
     * un token desconocido. `null` = no caduca.
     */
    expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    // ── Formato anterior (por slug). Se leen y se convierten a ids. ──
    visible_field_slugs: z.array(z.string()).optional(),
    sort_allowed_slugs: z.array(z.string()).optional(),
    /** `slug:asc|desc`. */
    default_sort: z.string().nullable().optional(),
});
export type PublicListSettings = z.infer<typeof publicListSettingsSchema>;

export const PUBLIC_LIST_DEFAULTS: PublicListSettings = {
    enabled: false,
    token: '',
    visible_field_ids: [],
    sort_allowed_field_ids: [],
    default_sort_field_id: null,
    default_sort_dir: 'asc',
    per_page: 20,
    search_enabled: true,
    allowed_domains: [],
    view_id: null,
    expires_at: null,
};

/**
 * Body del PATCH admin de la config pública (parcial). Acepta los campos por
 * id (lo nuevo) o por slug (clientes viejos y el asistente): el servidor los
 * resuelve a ids antes de guardar.
 */
export const updatePublicListSchema = publicListSettingsSchema
    .omit({ token: true })
    .partial();
export type UpdatePublicListInput = z.infer<typeof updatePublicListSchema>;

/**
 * Vista admin: la config canónica (por id) más los slugs DERIVADOS de los
 * campos actuales (para mostrar), el token (para armar link/embed) y el estado.
 */
export interface PublicListAdmin
    extends Omit<PublicListSettings, 'visible_field_slugs' | 'sort_allowed_slugs' | 'default_sort'> {
    visible_field_slugs: string[];
    sort_allowed_slugs: string[];
    default_sort: string | null;
    /** URL pública (relativa) de la lista, o null si no está habilitada. */
    public_path: string | null;
}

// --- Respuestas PÚBLICAS (sin auth) ---

export interface PublicFieldMeta {
    slug: string;
    label: string;
    type: string;
    /**
     * Lo mínimo para MOSTRAR el valor como en la app: opciones (etiqueta y
     * color), decimales, máximo de estrellas, formato de duración.
     */
    options?: Array<{ value: string; label: string; color: string | null }>;
    precision?: number;
    max?: number;
    duration_format?: string;
}

export interface PublicListMeta {
    name: string;
    description: string | null;
    fields: PublicFieldMeta[];
    sort_allowed: string[];
    default_sort: string | null;
    per_page: number;
    search_enabled: boolean;
    /** Nombre de la vista publicada, si se publicó una vista concreta. */
    view_name: string | null;
    /** White-label del workspace dueño (logo por URL firmada, sin sesión). */
    branding: { primary_color: string | null; app_name: string | null; logo_url: string | null };
    /** Formato regional de la empresa (números, fechas, horas y zona). */
    format?: z.infer<typeof tenantFormatSchema>;
}

export interface PublicRecord {
    id: number;
    /**
     * Por slug, sólo campos visibles. Los valores son los guardados salvo
     * personas (su NOMBRE) y archivos (`[{ name, url }]` con URL firmada).
     */
    data: Record<string, unknown>;
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
