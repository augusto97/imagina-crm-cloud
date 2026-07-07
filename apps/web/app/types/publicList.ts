/**
 * Tipos del shape `settings.public` (Fase 8 — 2.E).
 *
 * Espejan `PublicListConfig` en PHP (`src/PublicLists/PublicListConfig.php`).
 * Se persisten dentro de `lists.{id}.settings.public`.
 */

export interface PublicListSettings {
    enabled: boolean;
    visible_field_slugs: string[];
    fixed_filter_tree: Record<string, unknown> | null;
    viewer_filters_allowed: boolean;
    sort_allowed_slugs: string[];
    default_sort: string | null;
    per_page: number;
    search_enabled: boolean;
    cache_ttl: number;
    /**
     * Slug del permalink dedicado en el frontend (Fase 10). Cuando está
     * seteado, la lista es accesible en `/{permalink_base}/`. Null =
     * solo via shortcode/bloque.
     */
    permalink_base: string | null;
}

export const PUBLIC_DEFAULTS: PublicListSettings = {
    enabled: false,
    visible_field_slugs: [],
    fixed_filter_tree: null,
    viewer_filters_allowed: true,
    sort_allowed_slugs: [],
    default_sort: null,
    per_page: 20,
    search_enabled: true,
    cache_ttl: 60,
    permalink_base: null,
};

export const PUBLIC_LIMITS = {
    perPageMin: 1,
    perPageMax: 100,
    cacheTtlMin: 0,
    cacheTtlMax: 3600,
} as const;
