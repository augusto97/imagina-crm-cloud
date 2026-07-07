<?php
declare(strict_types=1);

namespace ImaginaCRM\PublicLists;

/**
 * Value object inmutable que representa `wp_imcrm_lists.settings.public`.
 *
 * Shape persistido:
 * ```
 * {
 *   "public": {
 *     "enabled":               false,
 *     "visible_field_slugs":   ["nombre", "precio", "categoria"],
 *     "fixed_filter_tree":     { ... } | null,   // tree con shape igual al de /records
 *     "viewer_filters_allowed": true,
 *     "sort_allowed_slugs":    ["nombre", "precio"],
 *     "default_sort":          "precio:asc" | null,
 *     "per_page":              20,
 *     "search_enabled":        true,
 *     "cache_ttl":             60
 *   }
 * }
 * ```
 *
 * Garantías:
 *  - `enabled=false` o ausencia de la clave `public` → lista NO se expone
 *    en `/v1/public/*`. El controller responde 404.
 *  - Solo se serializan campos en `visible_field_slugs` — los demás
 *    quedan ocultos aun si están en la BD.
 *  - `fixed_filter_tree` se aplica SIEMPRE server-side y antes que
 *    cualquier filtro del visitante.
 *
 * Ver `docs/multi-stakeholder-design.md` §2 (Fase 8).
 */
final class PublicListConfig
{
    public const MAX_PER_PAGE     = 100;
    public const DEFAULT_PER_PAGE = 20;
    public const DEFAULT_TTL      = 60;
    public const MIN_TTL          = 0;
    public const MAX_TTL          = 3600;

    /**
     * @param list<string>               $visibleFieldSlugs
     * @param array<string, mixed>|null  $fixedFilterTree
     * @param list<string>               $sortAllowedSlugs
     */
    private function __construct(
        public readonly bool $enabled,
        public readonly array $visibleFieldSlugs,
        public readonly ?array $fixedFilterTree,
        public readonly bool $viewerFiltersAllowed,
        public readonly array $sortAllowedSlugs,
        public readonly ?string $defaultSort,
        public readonly int $perPage,
        public readonly bool $searchEnabled,
        public readonly int $cacheTtl,
        /**
         * Slug del permalink dedicado para esta lista en el frontend
         * (Fase 10 — pulidos). Cuando está seteado, el plugin registra
         * un rewrite rule `^{permalinkBase}/?$` → render automático
         * con shortcode. Null = solo accesible via shortcode/bloque
         * manual del admin.
         */
        public readonly ?string $permalinkBase,
    ) {
    }

    /**
     * Construye desde el JSON ya decodificado de `settings`. Si `public`
     * no existe o no es un array, devuelve un config "deshabilitado"
     * (back-compat seguro — listas pre-Fase-8 no se exponen
     * automáticamente).
     *
     * @param array<string, mixed> $settings
     */
    public static function fromListSettings(array $settings): self
    {
        $raw = $settings['public'] ?? null;
        if (! is_array($raw)) {
            return self::disabled();
        }

        $enabled = (bool) ($raw['enabled'] ?? false);

        $visible = [];
        if (isset($raw['visible_field_slugs']) && is_array($raw['visible_field_slugs'])) {
            foreach ($raw['visible_field_slugs'] as $slug) {
                if (is_string($slug) && $slug !== '') {
                    $visible[] = $slug;
                }
            }
        }
        $visible = array_values(array_unique($visible));

        $fixedTree = null;
        if (
            isset($raw['fixed_filter_tree'])
            && is_array($raw['fixed_filter_tree'])
            && ($raw['fixed_filter_tree']['type'] ?? '') === 'group'
        ) {
            $fixedTree = $raw['fixed_filter_tree'];
        }

        $sortAllowed = [];
        if (isset($raw['sort_allowed_slugs']) && is_array($raw['sort_allowed_slugs'])) {
            foreach ($raw['sort_allowed_slugs'] as $slug) {
                if (is_string($slug) && $slug !== '') {
                    $sortAllowed[] = $slug;
                }
            }
        }
        $sortAllowed = array_values(array_unique($sortAllowed));

        $defaultSort = isset($raw['default_sort']) && is_string($raw['default_sort']) && $raw['default_sort'] !== ''
            ? $raw['default_sort']
            : null;

        $perPage = isset($raw['per_page']) && is_numeric($raw['per_page'])
            ? (int) $raw['per_page']
            : self::DEFAULT_PER_PAGE;
        $perPage = max(1, min(self::MAX_PER_PAGE, $perPage));

        $cacheTtl = isset($raw['cache_ttl']) && is_numeric($raw['cache_ttl'])
            ? (int) $raw['cache_ttl']
            : self::DEFAULT_TTL;
        $cacheTtl = max(self::MIN_TTL, min(self::MAX_TTL, $cacheTtl));

        $permalinkBase = isset($raw['permalink_base']) && is_string($raw['permalink_base'])
            ? self::sanitizePermalink($raw['permalink_base'])
            : null;

        return new self(
            enabled:              $enabled,
            visibleFieldSlugs:    $visible,
            fixedFilterTree:      $fixedTree,
            viewerFiltersAllowed: (bool) ($raw['viewer_filters_allowed'] ?? true),
            sortAllowedSlugs:     $sortAllowed,
            defaultSort:          $defaultSort,
            perPage:              $perPage,
            searchEnabled:        (bool) ($raw['search_enabled'] ?? true),
            cacheTtl:             $cacheTtl,
            permalinkBase:        $permalinkBase,
        );
    }

    /**
     * Saneamiento del permalink_base: solo `a-z0-9-` permitidos, max 64
     * chars (que cumple con SEO best practices y evita choque con
     * reserved slugs de WP). Retorna null si el resultado es vacío.
     */
    public static function sanitizePermalink(string $raw): ?string
    {
        $clean = strtolower(trim($raw));
        $clean = preg_replace('/[^a-z0-9-]/', '', $clean) ?? '';
        $clean = trim($clean, '-');
        if (strlen($clean) > 64) {
            $clean = substr($clean, 0, 64);
        }
        return $clean === '' ? null : $clean;
    }

    /**
     * Default cerrado: lista NO pública. Equivalente a no tener la clave
     * `public` en `settings`. Útil cuando hay que devolver algo sin
     * romper el flujo (ej. preview en el List Builder antes de guardar).
     */
    public static function disabled(): self
    {
        return new self(
            enabled:              false,
            visibleFieldSlugs:    [],
            fixedFilterTree:      null,
            viewerFiltersAllowed: false,
            sortAllowedSlugs:     [],
            defaultSort:          null,
            perPage:              self::DEFAULT_PER_PAGE,
            searchEnabled:        false,
            cacheTtl:             self::DEFAULT_TTL,
            permalinkBase:        null,
        );
    }

    /**
     * Forma serializable para guardar en `settings.public`. Solo
     * incluye los campos del shape — no metadata interna.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'enabled'                => $this->enabled,
            'visible_field_slugs'    => $this->visibleFieldSlugs,
            'fixed_filter_tree'      => $this->fixedFilterTree,
            'viewer_filters_allowed' => $this->viewerFiltersAllowed,
            'sort_allowed_slugs'     => $this->sortAllowedSlugs,
            'default_sort'           => $this->defaultSort,
            'per_page'               => $this->perPage,
            'search_enabled'         => $this->searchEnabled,
            'cache_ttl'              => $this->cacheTtl,
            'permalink_base'         => $this->permalinkBase,
        ];
    }
}
