/**
 * Tipos compartidos del bundle público (Fase 8 — 2.C).
 *
 * Espejan los shapes que emite el `Shortcode.php` server-side en los
 * atributos `data-imcrm-config` y `data-imcrm-initial`, y los que
 * devuelve el endpoint REST público `/imagina-crm/v1/public/lists/...`.
 */

export interface PublicFieldMeta {
    slug: string;
    label: string;
    type: string;
    /** Config del field — el bundle JS la usa para armar dropdowns de
     * filtro con las options correctas. Opcional para backward-compat
     * con shortcodes antiguos. (Fase 12.E) */
    config?: {
        options?: Array<{ value: string; label?: string; color?: string }>;
        [k: string]: unknown;
    };
}

/** Lo que el shortcode mete en `data-imcrm-config`. */
export interface PublicListConfig {
    slug: string;
    name: string;
    description: string | null;
    per_page: number;
    viewer_filters: boolean;
    sort_allowed_slugs: string[];
    default_sort: string | null;
    search_enabled: boolean;
    visible_field_slugs: string[];
    /** Columnas con type — necesario para formatear celdas en cliente. */
    columns: PublicFieldMeta[];
    rest_root: string;
}

export interface PublicRecord {
    id: number;
    fields: Record<string, unknown>;
    relations: Record<string, unknown>;
}

export interface PublicMeta {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
}

/** Lo que el shortcode mete en `data-imcrm-initial`. */
export interface PublicInitialPayload {
    data: PublicRecord[];
    meta: PublicMeta;
}

export interface FetchParams {
    page: number;
    search: string;
    sort: { slug: string; dir: 'asc' | 'desc' } | null;
    /** Filtros activos: map `slug -> string value`. Operador implícito
     * `eq` para select / checkbox; `in` para multi_select cuando el
     * value se splitea por `,`. (Fase 12.E) */
    filters: Record<string, string>;
}
