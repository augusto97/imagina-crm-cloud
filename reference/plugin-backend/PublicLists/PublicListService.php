<?php
declare(strict_types=1);

namespace ImaginaCRM\PublicLists;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Records\RecordService;
use ImaginaCRM\Support\Cache;
use ImaginaCRM\Support\ValidationResult;

/**
 * Orquesta las lecturas públicas de una lista (Fase 8 — 2.A).
 *
 * Camino feliz (PublicListsController):
 *
 *  1. `findPublicList($slug)` → resuelve la lista por slug y valida
 *     `settings.public.enabled = true`. Devuelve null si no.
 *  2. `metaFor($list)` → shape compacto para el endpoint
 *     `GET /public/lists/{slug}` (nombre, descripción, fields visibles).
 *  3. `fetchRecords($list, $params)` → records paginados respetando
 *     `fixed_filter_tree` y proyectando solo los `visible_field_slugs`.
 *
 * Garantías de seguridad:
 *  - El `fixed_filter_tree` SIEMPRE se aplica antes de cualquier filtro
 *    del visitante. Si el visitante manda filtros no listados en
 *    `visible_field_slugs`, se descartan en `resolveVisitorFilterTree`.
 *  - Sort se restringe a `sort_allowed_slugs`. Slugs fuera de esa
 *    whitelist se ignoran (no rompen la query, solo se descartan).
 *  - Solo se serializan los slugs en `visible_field_slugs` — los campos
 *    privados no salen de la BD ni al frontend.
 *  - Cache server-side opcional con TTL del config + invalidación
 *    automática por hooks `imagina_crm/record_*` ya enganchados en
 *    `Cache::registerInvalidationHooks()`.
 */
final class PublicListService implements PublicListReader
{
    public function __construct(
        private readonly ListRepository $lists,
        private readonly FieldRepository $fields,
        private readonly RecordService $records,
        private readonly Cache $cache,
    ) {
    }

    /**
     * Resuelve una lista por slug y valida que esté marcada como pública.
     * Devuelve null en cualquiera de los casos:
     *  - el slug no resuelve a ninguna lista,
     *  - la lista no tiene `settings.public` o `enabled=false`,
     *  - la lista está soft-deleted.
     */
    public function findPublicList(string $slug): ?ListEntity
    {
        $list = $this->lists->findBySlug($slug);
        if ($list === null || $list->deletedAt !== null) {
            return null;
        }
        $config = PublicListConfig::fromListSettings($list->settings);
        if (! $config->enabled) {
            return null;
        }
        return $list;
    }

    public function configFor(ListEntity $list): PublicListConfig
    {
        return PublicListConfig::fromListSettings($list->settings);
    }

    /**
     * Metadata pública de la lista — lo que `GET /public/lists/{slug}`
     * devuelve. Solo expone fields incluidos en `visible_field_slugs`
     * y omite todo lo sensible (created_by, etag interno, etc.).
     *
     * @return array<string, mixed>
     */
    public function metaFor(ListEntity $list): array
    {
        $config = $this->configFor($list);
        $allFields = $this->fields->allForList($list->id);

        $visibleSet = array_flip($config->visibleFieldSlugs);
        $visibleFields = array_values(array_filter(
            $allFields,
            static fn (FieldEntity $f): bool => isset($visibleSet[$f->slug]),
        ));

        return [
            'slug'        => $list->slug,
            'name'        => $list->name,
            'description' => $list->description,
            'fields'      => array_map(
                static fn (FieldEntity $f): array => [
                    'slug'  => $f->slug,
                    'label' => $f->label,
                    'type'  => $f->type,
                    // `config` puede traer info útil (options de select,
                    // precision de number, etc.) sin filtrar nada sensible.
                    'config' => $f->config,
                ],
                $visibleFields,
            ),
            'config'      => [
                'per_page'               => $config->perPage,
                'viewer_filters_allowed' => $config->viewerFiltersAllowed,
                'sort_allowed_slugs'     => $config->sortAllowedSlugs,
                'default_sort'           => $config->defaultSort,
                'search_enabled'         => $config->searchEnabled,
            ],
        ];
    }

    /**
     * Trae una página de records aplicando el fixed_filter_tree y los
     * filtros del visitante (si están permitidos).
     *
     * @param array{
     *     page?: int,
     *     per_page?: int,
     *     search?: ?string,
     *     sort?: ?string,
     *     filter?: array<string, mixed>
     * } $params
     *
     * @return array{
     *     data: list<array<string, mixed>>,
     *     meta: array{page:int, per_page:int, total:int, total_pages:int}
     * }|ValidationResult
     */
    public function fetchRecords(ListEntity $list, array $params): array|ValidationResult
    {
        $config = $this->configFor($list);

        $page    = max(1, (int) ($params['page'] ?? 1));
        $perPage = max(1, min($config->perPage, (int) ($params['per_page'] ?? $config->perPage)));
        $search  = $config->searchEnabled && isset($params['search']) && is_string($params['search']) && $params['search'] !== ''
            ? $params['search']
            : null;

        $visitorFilter = is_array($params['filter'] ?? null) ? $params['filter'] : [];

        $tree = $this->composeFilterTree($list, $config, $visitorFilter);
        $sort = $this->resolveSort($params['sort'] ?? null, $config);

        $allFields = $this->fields->allForList($list->id);
        $visibleSlugs = $config->visibleFieldSlugs;

        $cacheKey = $this->cacheKey($list, $params, $tree, $sort, $page, $perPage, $search);
        $ttl = $config->cacheTtl;

        $loader = function () use ($list, $tree, $sort, $page, $perPage, $search, $allFields, $visibleSlugs): array|ValidationResult {
            $result = $this->records->list(
                list:            $list,
                filters:         [],
                sort:            $sort,
                fields:          $visibleSlugs,
                search:          $search,
                page:            $page,
                perPage:         $perPage,
                filterTree:      $tree,
                cursor:          null,
                additionalWhere: null,
            );
            if ($result instanceof ValidationResult) {
                return $result;
            }
            return [
                'data' => array_map(
                    fn (array $row): array => $this->serializeRecord($row, $allFields, $visibleSlugs),
                    $result['data'],
                ),
                'meta' => $result['meta'],
            ];
        };

        // Si `cache_ttl=0`, omitimos cache (modo "siempre fresco").
        if ($ttl <= 0) {
            return $loader();
        }
        return $this->cache->remember($cacheKey, $loader, $ttl);
    }

    /**
     * Compone el filter tree final: AND del `fixed_filter_tree` (siempre)
     * con los filtros del visitante (si están permitidos y los slugs
     * están en la whitelist visible).
     *
     * Devuelve null si ambos son vacíos — el RecordService entonces no
     * inyecta WHERE adicional.
     *
     * @param array<string, mixed> $visitorFilter
     * @return array<string, mixed>|null
     */
    private function composeFilterTree(ListEntity $list, PublicListConfig $config, array $visitorFilter): ?array
    {
        $children = [];

        if (is_array($config->fixedFilterTree) && ($config->fixedFilterTree['type'] ?? '') === 'group') {
            $children[] = $config->fixedFilterTree;
        }

        if ($config->viewerFiltersAllowed && $visitorFilter !== []) {
            $visitorConds = $this->visitorFilterToConditions($list, $config, $visitorFilter);
            foreach ($visitorConds as $cond) {
                $children[] = $cond;
            }
        }

        if ($children === []) {
            return null;
        }
        return [
            'type'     => 'group',
            'logic'    => 'and',
            'children' => $children,
        ];
    }

    /**
     * Convierte el shape plano `filter[slug][op]=value` del visitante en
     * nodos de filter tree. Solo acepta slugs en `visible_field_slugs` —
     * cualquier intento de filtrar por un campo privado se descarta sin
     * error (no se revela siquiera la existencia del campo).
     *
     * @param array<string, mixed> $visitorFilter
     * @return list<array<string, mixed>>
     */
    private function visitorFilterToConditions(ListEntity $list, PublicListConfig $config, array $visitorFilter): array
    {
        $visibleSet = array_flip($config->visibleFieldSlugs);
        $bySlug = [];
        foreach ($this->fields->allForList($list->id) as $f) {
            $bySlug[$f->slug] = $f;
        }

        $out = [];
        foreach ($visitorFilter as $slug => $opMap) {
            if (! is_string($slug) || ! isset($visibleSet[$slug]) || ! isset($bySlug[$slug])) {
                continue;
            }
            $field = $bySlug[$slug];

            if (is_array($opMap)) {
                foreach ($opMap as $op => $value) {
                    if (! is_string($op)) {
                        continue;
                    }
                    $out[] = [
                        'type'     => 'condition',
                        'field_id' => $field->id,
                        'op'       => $op,
                        'value'    => $value,
                    ];
                }
            } else {
                $out[] = [
                    'type'     => 'condition',
                    'field_id' => $field->id,
                    'op'       => 'eq',
                    'value'    => $opMap,
                ];
            }
        }
        return $out;
    }

    /**
     * Parsea el `?sort=slug:dir` del visitante restringiéndolo a slugs
     * en `sort_allowed_slugs`. Si está vacío y hay default_sort,
     * usa ése.
     *
     * @return list<array{slug:string, dir:string}>
     */
    private function resolveSort(mixed $raw, PublicListConfig $config): array
    {
        $sortStr = is_string($raw) && $raw !== '' ? $raw : $config->defaultSort;
        if ($sortStr === null || $sortStr === '') {
            return [];
        }

        $allowedSet = array_flip($config->sortAllowedSlugs);
        $out = [];
        foreach (explode(',', $sortStr) as $piece) {
            $parts = explode(':', trim($piece), 2);
            $slug = trim($parts[0] ?? '');
            $dir = strtolower(trim($parts[1] ?? 'asc'));
            if ($slug !== '' && isset($allowedSet[$slug])) {
                $out[] = ['slug' => $slug, 'dir' => $dir === 'desc' ? 'desc' : 'asc'];
            }
        }
        return $out;
    }

    /**
     * Recorta un record hidratado a solo los slugs visibles. El record
     * que viene de `RecordService::list` ya proyectó al subset, pero
     * defensivo: si en el futuro el service agrega metadata nueva,
     * acá la filtramos.
     *
     * También elimina campos del envelope que NO deben salir al público
     * (created_by, deleted_at, attribución interna).
     *
     * @param array<string, mixed>      $row
     * @param list<FieldEntity>         $allFields
     * @param list<string>              $visibleSlugs
     * @return array<string, mixed>
     */
    private function serializeRecord(array $row, array $allFields, array $visibleSlugs): array
    {
        $fieldsMap = is_array($row['fields'] ?? null) ? $row['fields'] : [];
        $visibleSet = array_flip($visibleSlugs);

        $cleanFields = [];
        foreach ($fieldsMap as $slug => $value) {
            if (is_string($slug) && isset($visibleSet[$slug])) {
                $cleanFields[$slug] = $value;
            }
        }

        // Las relaciones se incluyen solo si el campo `relation` está
        // en visible_field_slugs.
        $relationsMap = is_array($row['relations'] ?? null) ? $row['relations'] : [];
        $cleanRelations = [];
        foreach ($relationsMap as $slug => $value) {
            if (is_string($slug) && isset($visibleSet[$slug])) {
                $cleanRelations[$slug] = $value;
            }
        }

        unset($allFields); // reservado para enriquecer (ej. resolver labels) en versiones futuras.

        return [
            'id'        => isset($row['id']) ? (int) $row['id'] : 0,
            'fields'    => $cleanFields,
            'relations' => $cleanRelations,
        ];
    }

    /**
     * @param array<string, mixed>      $params
     * @param array<string, mixed>|null $tree
     * @param list<array{slug:string, dir:string}> $sort
     */
    private function cacheKey(
        ListEntity $list,
        array $params,
        ?array $tree,
        array $sort,
        int $page,
        int $perPage,
        ?string $search,
    ): string {
        $hashed = md5(serialize([
            'list_id'   => $list->id,
            'tree'      => $tree,
            'sort'      => $sort,
            'page'      => $page,
            'per_page'  => $perPage,
            'search'    => $search,
            // No incluimos `$params` raw — algunos keys pueden cambiar
            // de orden entre clients y romper el hit rate.
        ]));
        unset($params);
        return $this->cache->key('public_records', $list->id . ':' . $hashed);
    }
}
