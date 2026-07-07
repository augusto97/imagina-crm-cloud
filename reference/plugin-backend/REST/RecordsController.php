<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Permissions\PermissionService;
use ImaginaCRM\Records\RecordAggregator;
use ImaginaCRM\Records\RecordsETag;
use ImaginaCRM\Records\RecordService;
use ImaginaCRM\Support\ValidationResult;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * REST controller para `/imagina-crm/v1/lists/{list}/records`.
 *
 * Acepta los query params definidos en CLAUDE.md §9.3:
 * filter[slug][op]=value, sort=slug:dir, search, fields, page, per_page.
 * El parsing vive aquí; toda la lógica de SQL en `QueryBuilder`.
 */
final class RecordsController extends AbstractController
{
    public function __construct(
        private readonly RecordService $service,
        private readonly ListService $lists,
        private readonly RecordsETag $etag,
        private readonly RecordAggregator $aggregator,
        private readonly PermissionService $permissions,
        private readonly \ImaginaCRM\Fields\FieldRepository $fields,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        $base = 'lists/(?P<list>[a-zA-Z0-9_-]+)/records';

        // GET requiere cap view_records O view_own_records — el scope
        // efectivo se aplica abajo via `recordsScopeWhere`.
        $canRead = $this->requireAnyCapability(
            CapabilityRegistry::CAP_VIEW_RECORDS,
            CapabilityRegistry::CAP_VIEW_OWN_RECORDS,
        );
        $canCreate = $this->requireCapability(CapabilityRegistry::CAP_CREATE_RECORDS);
        $canEdit = $this->requireAnyCapability(
            CapabilityRegistry::CAP_EDIT_RECORDS,
            CapabilityRegistry::CAP_EDIT_OWN_RECORDS,
        );
        $canDelete = $this->requireAnyCapability(
            CapabilityRegistry::CAP_DELETE_RECORDS,
            CapabilityRegistry::CAP_DELETE_OWN_RECORDS,
        );

        register_rest_route($this->namespace, '/' . $base, [
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getCollection'],
                'permission_callback' => $canRead,
            ],
            [
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => [$this, 'createItem'],
                'permission_callback' => $canCreate,
            ],
        ]);

        // Bulk: la cap se chequea aquí al nivel mínimo (cualquier cap
        // de edit/delete pasa). Dentro del callback se valida con
        // mayor precisión según action y se aplican checks por record.
        $canBulk = $this->requireAnyCapability(
            CapabilityRegistry::CAP_BULK_ACTIONS,
            CapabilityRegistry::CAP_EDIT_RECORDS,
            CapabilityRegistry::CAP_EDIT_OWN_RECORDS,
            CapabilityRegistry::CAP_DELETE_RECORDS,
            CapabilityRegistry::CAP_DELETE_OWN_RECORDS,
        );

        register_rest_route($this->namespace, '/' . $base . '/bulk', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'bulk'],
            'permission_callback' => $canBulk,
        ]);

        register_rest_route($this->namespace, '/' . $base . '/groups', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'getGroups'],
            'permission_callback' => $canRead,
        ]);

        // Bundle endpoint para vista agrupada — devuelve buckets +
        // records expandidos + aggregates en una sola respuesta. Antes
        // GroupedTableView necesitaba 1 + N + N requests (groups +
        // records-per-bucket + aggregates-per-bucket); ahora 1.
        register_rest_route($this->namespace, '/' . $base . '/grouped-bundle', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'getGroupedBundle'],
            'permission_callback' => $canRead,
        ]);

        register_rest_route($this->namespace, '/' . $base . '/(?P<id>\d+)', [
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getItem'],
                'permission_callback' => $canRead,
            ],
            [
                'methods'             => WP_REST_Server::EDITABLE,
                'callback'            => [$this, 'updateItem'],
                'permission_callback' => $canEdit,
            ],
            [
                'methods'             => WP_REST_Server::DELETABLE,
                'callback'            => [$this, 'deleteItem'],
                'permission_callback' => $canDelete,
                'args'                => ['purge' => ['type' => 'boolean', 'default' => false]],
            ],
        ]);
    }

    /**
     * Helper: chequea visibilidad de la lista para el user actual y
     * devuelve 404 si no puede acceder (no 403 para no revelar la
     * existencia de la lista).
     */
    private function resolveAccessibleList(WP_REST_Request $request): ListEntity|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $user = wp_get_current_user();
        if (! $this->permissions->userCanSeeList($user, $list)) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        return $list;
    }

    public function getCollection(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->resolveAccessibleList($request);
        if ($list instanceof WP_Error) {
            return $list;
        }

        $page    = max(1, (int) ($request->get_param('page') ?? 1));
        $perPage = max(1, (int) ($request->get_param('per_page') ?? 50));
        $search  = $request->get_param('search');
        $search  = is_string($search) ? $search : null;

        $filters    = $request->get_param('filter');
        $filters    = is_array($filters) ? $filters : [];
        $filterTree = $this->parseFilterTree($request->get_param('filter_tree'));

        $sort = $this->parseSort($request->get_param('sort'));
        $proj = $this->parseFields($request->get_param('fields'));

        // Cursor opt-in (keyset pagination). Cuando el cliente lo
        // manda y no hay sort custom, el QueryBuilder usa
        // `WHERE id < cursor` — costo constante a cualquier
        // profundidad (vs OFFSET que degrada lineal con la página).
        $cursor = $request->get_param('cursor');
        $cursor = is_numeric($cursor) ? (int) $cursor : null;

        // ETag: hash determinístico de (versionDeLaLista, queryParams).
        // Si el `If-None-Match` del request matchea, retornamos 304
        // sin ejecutar el query — ahorra serialización JSON y todo el
        // hydration. La versión se bumpea en cada record_* / import_*
        // / field_* hook, así que un cliente con cache puede confiar
        // en el ETag.
        $etagContext = [
            'filter'      => $filters,
            'filter_tree' => $filterTree,
            'sort'        => $sort,
            'fields'      => $proj,
            'search'      => $search,
            'page'        => $page,
            'per_page'    => $perPage,
            'cursor'      => $cursor,
        ];
        $etag = $this->etag->compute($list->id, $etagContext);
        $etagHeader = '"' . $etag . '"';
        $ifNoneMatch = $request->get_header('if_none_match');
        if (is_string($ifNoneMatch) && trim($ifNoneMatch) === $etagHeader) {
            $resp = new WP_REST_Response(null, 304);
            $resp->header('ETag', $etagHeader);
            $resp->header('Cache-Control', 'private, must-revalidate');
            return $resp;
        }

        // Scope de permisos (Fase 7 — 1.D): si el user no es admin/manager,
        // su rol limita qué filas puede ver (own/assigned/none). Se inyecta
        // al WHERE como cláusula adicional. El admin/crm_admin recibe
        // `{sql: '', args: []}` → sin filtro extra.
        $additionalWhere = $this->permissions->recordsScopeWhere(wp_get_current_user(), $list);
        if ($additionalWhere['sql'] === '') {
            $additionalWhere = null;
        }

        $result = $this->service->list(
            $list,
            $filters,
            $sort,
            $proj,
            $search,
            $page,
            $perPage,
            $filterTree,
            $cursor,
            $additionalWhere,
        );
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }

        // Filtrado per-field por rol (Fase 10 — fields_hidden).
        // Si el ACL declara campos ocultos para el rol del user, los
        // removemos del payload antes de serializar. Defensa adicional
        // al gating client-side: si el user mira la network tab o
        // hace fetch directo al endpoint, no recibe los slugs ocultos.
        $hidden = $this->permissions->hiddenFieldSlugs(wp_get_current_user(), $list);
        if ($hidden !== []) {
            $result['data'] = $this->stripHiddenFields($result['data'], $hidden);
        }

        $response = new WP_REST_Response($result);
        $response->header('ETag', $etagHeader);
        $response->header('Cache-Control', 'private, must-revalidate');
        return $response;
    }

    /**
     * Acepta `filter_tree` como JSON-encoded string (query param) o
     * array ya decodificado (raro, vendría de tests). Devuelve `null`
     * si está ausente, vacío, malformado o no es un grupo válido —
     * el caller cae al filtro plano en ese caso.
     *
     * @return array<string, mixed>|null
     */
    private function parseFilterTree(mixed $raw): ?array
    {
        if ($raw === null || $raw === '') {
            return null;
        }
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            $raw     = is_array($decoded) ? $decoded : null;
        }
        if (! is_array($raw) || ($raw['type'] ?? '') !== 'group') {
            return null;
        }
        // Tree vacío (raíz sin hijos) lo tratamos como ausente para
        // que el path sea idéntico al de "sin filtros".
        $children = $raw['children'] ?? [];
        if (! is_array($children) || $children === []) {
            return null;
        }
        return $raw;
    }

    public function getItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->resolveAccessibleList($request);
        if ($list instanceof WP_Error) {
            return $list;
        }

        $id     = (int) $request->get_param('id');
        $record = $this->service->find($list, $id);
        if ($record === null) {
            return $this->notFound();
        }
        // Check per-record: si el user no puede ver este record concreto
        // (scope=own y no lo creó él), devolvemos 404 para no revelar la
        // existencia del record. Admins/managers tienen bypass.
        $user = wp_get_current_user();
        if (! $this->permissions->userCanViewRecord($user, $list, $record)) {
            return $this->notFound();
        }
        // Filtrado per-field (Fase 10).
        $hidden = $this->permissions->hiddenFieldSlugs($user, $list);
        if ($hidden !== []) {
            $record = $this->stripHiddenFieldsFromRow($record, $hidden);
        }
        return new WP_REST_Response(['data' => $record]);
    }

    public function createItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->resolveAccessibleList($request);
        if ($list instanceof WP_Error) {
            return $list;
        }

        // create requiere ACL.create=true para esta lista en alguno de
        // los roles del user. La cap `imcrm_create_records` ya se
        // verificó en el permission_callback.
        $user = wp_get_current_user();
        if (! $this->permissions->userCanCreateInList($user, $list)) {
            return $this->forbidden(__('No tienes permiso para crear registros en esta lista.', 'imagina-crm'));
        }

        $values = $this->extractValues($request);
        $result = $this->service->create($list, $values);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }
        return new WP_REST_Response(['data' => $result], 201);
    }

    public function updateItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->resolveAccessibleList($request);
        if ($list instanceof WP_Error) {
            return $list;
        }

        $id      = (int) $request->get_param('id');
        $current = $this->service->find($list, $id);
        if ($current === null) {
            return $this->notFound();
        }
        $user = wp_get_current_user();
        if (! $this->permissions->userCanEditRecord($user, $list, $current)) {
            // 404 cuando ni siquiera lo puede VER (data leak prevention),
            // 403 cuando lo ve pero no puede editar.
            if (! $this->permissions->userCanViewRecord($user, $list, $current)) {
                return $this->notFound();
            }
            return $this->forbidden(__('No tienes permiso para editar este registro.', 'imagina-crm'));
        }

        $values = $this->extractValues($request);

        // Validación per-field (Fase 10): si el user pide editar un slug
        // que está en `fields_hidden` para sus roles → 403. Defensa
        // contra escritura de campos que ni siquiera puede leer.
        $hidden = $this->permissions->hiddenFieldSlugs($user, $list);
        if ($hidden !== []) {
            $touched = array_intersect(array_keys($values), $hidden);
            if ($touched !== []) {
                return $this->forbidden(sprintf(
                    /* translators: %s: comma-separated field slugs */
                    __('No tienes permiso para editar los campos: %s', 'imagina-crm'),
                    implode(', ', $touched),
                ));
            }
        }

        $result = $this->service->update($list, $id, $values);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }
        return new WP_REST_Response(['data' => $result]);
    }

    public function deleteItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->resolveAccessibleList($request);
        if ($list instanceof WP_Error) {
            return $list;
        }

        $id      = (int) $request->get_param('id');
        $current = $this->service->find($list, $id);
        if ($current === null) {
            return $this->notFound();
        }
        $user = wp_get_current_user();
        if (! $this->permissions->userCanDeleteRecord($user, $list, $current)) {
            if (! $this->permissions->userCanViewRecord($user, $list, $current)) {
                return $this->notFound();
            }
            return $this->forbidden(__('No tienes permiso para eliminar este registro.', 'imagina-crm'));
        }

        $purge  = (bool) $request->get_param('purge');
        $result = $this->service->delete($list, $id, $purge);
        if (! $result->isValid()) {
            return $this->validationError($result);
        }
        return new WP_REST_Response(['data' => ['id' => $id, 'purged' => $purge]]);
    }

    /**
     * GET /lists/{list}/records/groups?group_by=<field_id>&filter=...&search=...
     *
     * Devuelve buckets agregados para alimentar la vista de tabla con
     * grouping (toolbar "Agrupar por"). Cada bucket trae el valor del
     * grupo y el count. La expansión lazy de cada grupo reutiliza el
     * endpoint normal `/records` pasando el filtro `eq` correspondiente.
     */
    public function getGroups(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->resolveAccessibleList($request);
        if ($list instanceof WP_Error) {
            return $list;
        }

        $groupBy = (int) $request->get_param('group_by');
        if ($groupBy <= 0) {
            return new WP_Error(
                'imcrm_bad_group_by',
                __('Falta el parámetro group_by con el id del campo.', 'imagina-crm'),
                ['status' => 400]
            );
        }

        // Per-field permissions (Fase 16.A — fix bug S4): el user
        // no puede agrupar por un field oculto para su rol. Sino
        // los valores agregados (counts, sums) revelan información
        // sobre los valores del campo aunque el campo en sí no se
        // exponga.
        $groupByField = $this->fields->find($groupBy);
        if ($groupByField !== null) {
            $sanitizer = $this->permissions->sanitizerFor(wp_get_current_user(), $list);
            if (! $sanitizer->canSeeField($groupByField->slug)) {
                return $this->forbidden(__('No tenés permiso para agrupar por este campo.', 'imagina-crm'));
            }
        }

        $filters    = $request->get_param('filter');
        $filters    = is_array($filters) ? $filters : [];
        $filterTree = $this->parseFilterTree($request->get_param('filter_tree'));

        $search = $request->get_param('search');
        $search = is_string($search) ? $search : null;

        $result = $this->service->groups($list, $groupBy, $filters, $search, $filterTree);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }

        return new WP_REST_Response($result);
    }

    /**
     * Bundle endpoint: una sola request retorna (buckets + counts) +
     * (records de cada bucket expandido) + (aggregates de cada bucket
     * expandido). Antes la vista agrupada necesitaba 1 + N + N
     * requests; ahora 1.
     *
     * Query params:
     *   - `group_by`: field id por el que se agrupa (requerido).
     *   - `filter_tree`: filtro base (igual shape que /records).
     *   - `expanded[]`: bucket values que el cliente tiene abiertos
     *     (NULL como string `__null__`). Para cada uno trae records
     *     y aggregates. Buckets no listados solo retornan count.
     *   - `per_page`: records por bucket (default 50, max 500).
     *   - `aggregate_fields`: CSV de field IDs a sumar/avg en cada
     *     bucket. Vacío = skip aggregates.
     *   - `search`: búsqueda fulltext aplicada al filtro base.
     */
    public function getGroupedBundle(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->resolveAccessibleList($request);
        if ($list instanceof WP_Error) {
            return $list;
        }

        $groupBy = (int) $request->get_param('group_by');
        if ($groupBy <= 0) {
            return new WP_Error(
                'imcrm_bad_group_by',
                __('Falta el parámetro group_by con el id del campo.', 'imagina-crm'),
                ['status' => 400],
            );
        }

        $filters    = $request->get_param('filter');
        $filters    = is_array($filters) ? $filters : [];
        $filterTree = $this->parseFilterTree($request->get_param('filter_tree'));
        $search     = $request->get_param('search');
        $search     = is_string($search) ? $search : null;

        // Buckets expandidos. Los pasa el cliente como repeats:
        // `expanded[]=al_dia&expanded[]=__null__`. WP REST acepta
        // tanto array como CSV; normalizamos.
        $rawExpanded = $request->get_param('expanded');
        $expanded = [];
        if (is_array($rawExpanded)) {
            foreach ($rawExpanded as $v) {
                $expanded[] = is_string($v) && $v !== '' ? $v : null;
            }
        } elseif (is_string($rawExpanded) && $rawExpanded !== '') {
            foreach (explode(',', $rawExpanded) as $v) {
                $v = trim($v);
                $expanded[] = $v === '' ? null : $v;
            }
        }
        // Cap defensivo — el front solo expande lo visible, pero
        // un cliente abusivo podría pedir todos los buckets.
        if (count($expanded) > 50) {
            $expanded = array_slice($expanded, 0, 50);
        }

        $perPage = max(1, min(500, (int) ($request->get_param('per_page') ?? 50)));

        $rawFields = $request->get_param('aggregate_fields');
        $aggregateFieldIds = [];
        if (is_string($rawFields) && $rawFields !== '') {
            $aggregateFieldIds = array_values(array_filter(
                array_map('intval', explode(',', $rawFields)),
                static fn (int $id): bool => $id > 0,
            ));
        }

        // 1) Buckets meta (count por valor).
        $groupsResult = $this->service->groups($list, $groupBy, $filters, $search, $filterTree);
        if ($groupsResult instanceof ValidationResult) {
            return $this->validationError($groupsResult);
        }

        // 2) Para cada bucket en `expanded`, traer records + aggregates.
        // Reutiliza RecordService::list y RecordAggregator (ambos ya
        // existen y están testeados). Construimos el filter_tree
        // compuesto: árbol base + condición del bucket bajo AND.
        $expandedData = [];
        $groupByField = $this->findFieldInGroups($groupsResult, $groupBy);
        if ($groupByField !== null) {
            foreach ($expanded as $bucketValue) {
                $key = $bucketValue ?? '__null__';
                $bucketTree = $this->composeBucketFilterTree(
                    $filterTree,
                    $groupBy,
                    $groupByField['type'] ?? 'select',
                    $bucketValue,
                );
                // El scope de permisos se inyecta también dentro de
                // cada bucket — sino el grouped-bundle bypasea el ACL.
                $bucketScope = $this->permissions->recordsScopeWhere(wp_get_current_user(), $list);
                $bucketScope = $bucketScope['sql'] === '' ? null : $bucketScope;
                $records = $this->service->list(
                    $list,
                    [],
                    [],
                    [],
                    $search, // 0.30.7: aplica el ?search= dentro de cada bucket (antes solo filtraba la meta de buckets, no los records dentro).
                    1,
                    $perPage,
                    $bucketTree,
                    null,
                    $bucketScope,
                );
                if ($records instanceof ValidationResult) {
                    continue;
                }
                $bucketEntry = ['records' => $records];
                if ($aggregateFieldIds !== []) {
                    $bucketEntry['aggregates'] = $this->aggregator->aggregate(
                        $list,
                        $aggregateFieldIds,
                        $bucketTree,
                    );
                }
                $expandedData[$key] = $bucketEntry;
            }
        }

        return new WP_REST_Response([
            'data' => [
                'buckets'  => $groupsResult['data'] ?? [],
                'meta'     => $groupsResult['meta'] ?? [],
                'expanded' => $expandedData,
            ],
        ]);
    }

    /**
     * @param array<string, mixed> $groupsResult
     * @return array<string, mixed>|null
     */
    private function findFieldInGroups(array $groupsResult, int $groupByFieldId): ?array
    {
        $meta = $groupsResult['meta'] ?? null;
        if (! is_array($meta)) {
            return null;
        }
        // `groups` retorna meta con shape `{group_by_field_id, group_by_slug, group_by_type, ...}`.
        if ((int) ($meta['group_by_field_id'] ?? 0) !== $groupByFieldId) {
            return null;
        }
        return [
            'id'   => $groupByFieldId,
            'slug' => (string) ($meta['group_by_slug'] ?? ''),
            'type' => (string) ($meta['group_by_type'] ?? 'select'),
        ];
    }

    /**
     * Compone el filter_tree del bucket: árbol base AND condición
     * `groupByField op bucketValue`. Para multi_select usamos
     * `contains`; para los demás `eq`. NULL → `is_null`.
     *
     * @param array<string, mixed>|null $baseTree
     * @return array<string, mixed>
     */
    private function composeBucketFilterTree(
        ?array $baseTree,
        int $groupByFieldId,
        string $groupByType,
        ?string $bucketValue,
    ): array {
        $condition = [
            'type'     => 'condition',
            'field_id' => $groupByFieldId,
            'op'       => $bucketValue === null
                ? 'is_null'
                : ($groupByType === 'multi_select' ? 'contains' : 'eq'),
            'value'    => $bucketValue ?? true,
        ];
        if (! is_array($baseTree) || ($baseTree['type'] ?? '') !== 'group') {
            return [
                'type'     => 'group',
                'logic'    => 'and',
                'children' => [$condition],
            ];
        }
        $logic = strtolower((string) ($baseTree['logic'] ?? 'and'));
        if ($logic === 'and') {
            $children = isset($baseTree['children']) && is_array($baseTree['children'])
                ? $baseTree['children']
                : [];
            return [
                'type'     => 'group',
                'logic'    => 'and',
                'children' => array_merge([$condition], $children),
            ];
        }
        // Tree con OR root: envolvemos para que `bucket AND (existing
        // OR tree)`.
        return [
            'type'     => 'group',
            'logic'    => 'and',
            'children' => [$condition, $baseTree],
        ];
    }

    public function bulk(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->resolveAccessibleList($request);
        if ($list instanceof WP_Error) {
            return $list;
        }

        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }

        $action = (string) ($params['action'] ?? '');
        $ids    = is_array($params['ids'] ?? null) ? $params['ids'] : [];
        $values = is_array($params['values'] ?? null) ? $params['values'] : [];

        if (! in_array($action, ['delete', 'update'], true)) {
            return new WP_Error('imcrm_bad_action', __('action debe ser delete o update.', 'imagina-crm'), ['status' => 400]);
        }
        if ($ids === []) {
            return new WP_Error('imcrm_no_ids', __('Falta la lista de IDs.', 'imagina-crm'), ['status' => 400]);
        }

        // Filtramos los IDs a aquellos sobre los que el user tiene permiso
        // de la operación correspondiente. Los rechazados se reportan al
        // cliente para que pueda mostrar un warning, pero la operación
        // sigue con los aprobados (degradación graceful — mejor UX que
        // bloquear todo el batch por un mal record).
        $user = wp_get_current_user();
        $intIds = array_values(array_unique(array_map('intval', $ids)));
        $allowedIds = [];
        $deniedIds  = [];
        foreach ($intIds as $rid) {
            $rec = $this->service->find($list, $rid);
            if ($rec === null) {
                $deniedIds[] = $rid;
                continue;
            }
            $allowed = $action === 'delete'
                ? $this->permissions->userCanDeleteRecord($user, $list, $rec)
                : $this->permissions->userCanEditRecord($user, $list, $rec);
            if ($allowed) {
                $allowedIds[] = $rid;
            } else {
                $deniedIds[] = $rid;
            }
        }

        if ($allowedIds === []) {
            return $this->forbidden(__('No tienes permiso sobre ninguno de los registros seleccionados.', 'imagina-crm'));
        }

        $result = $this->service->bulk($list, $action, $allowedIds, $values);
        if ($deniedIds !== []) {
            $result['denied_ids'] = $deniedIds;
        }
        return new WP_REST_Response(['data' => $result]);
    }

    /**
     * Remueve los slugs hidden del array `fields` (y `relations`) de
     * cada record antes de serializar al cliente (Fase 10).
     *
     * @param list<array<string, mixed>> $records
     * @param list<string>               $hidden
     * @return list<array<string, mixed>>
     */
    private function stripHiddenFields(array $records, array $hidden): array
    {
        if ($hidden === []) {
            return $records;
        }
        $out = [];
        foreach ($records as $row) {
            $out[] = $this->stripHiddenFieldsFromRow($row, $hidden);
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $row
     * @param list<string>         $hidden
     * @return array<string, mixed>
     */
    private function stripHiddenFieldsFromRow(array $row, array $hidden): array
    {
        $hiddenSet = array_flip($hidden);
        if (isset($row['fields']) && is_array($row['fields'])) {
            $row['fields'] = array_diff_key($row['fields'], $hiddenSet);
        }
        if (isset($row['relations']) && is_array($row['relations'])) {
            $row['relations'] = array_diff_key($row['relations'], $hiddenSet);
        }
        return $row;
    }

    /**
     * @return array<string, mixed>
     */
    private function extractValues(WP_REST_Request $request): array
    {
        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }
        // Aceptamos `fields: {slug: value}` o el envelope plano (excluyendo
        // metadatos del sistema).
        if (isset($params['fields']) && is_array($params['fields'])) {
            return $params['fields'];
        }
        $reserved = ['list', 'id', 'page', 'per_page', 'search', 'filter', 'sort'];
        return array_diff_key($params, array_flip($reserved));
    }

    /**
     * Acepta `slug:dir,otro:asc` o simplemente `slug` (asc por defecto).
     *
     * @param mixed $raw
     * @return array<int, array{slug:string, dir:string}>
     */
    private function parseSort(mixed $raw): array
    {
        if (! is_string($raw) || $raw === '') {
            return [];
        }
        $out = [];
        foreach (explode(',', $raw) as $piece) {
            $piece = trim($piece);
            if ($piece === '') {
                continue;
            }
            $parts = explode(':', $piece, 2);
            $slug  = trim($parts[0] ?? '');
            $dir   = strtolower(trim($parts[1] ?? 'asc'));
            if ($slug !== '') {
                $out[] = ['slug' => $slug, 'dir' => $dir === 'desc' ? 'desc' : 'asc'];
            }
        }
        return $out;
    }

    /**
     * @param mixed $raw
     * @return array<int, string>
     */
    private function parseFields(mixed $raw): array
    {
        if (! is_string($raw) || $raw === '') {
            return [];
        }
        $out = [];
        foreach (explode(',', $raw) as $piece) {
            $piece = trim($piece);
            if ($piece !== '') {
                $out[] = $piece;
            }
        }
        return $out;
    }
}
