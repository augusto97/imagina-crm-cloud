<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldService;
use ImaginaCRM\Fields\FieldTypeMigration;
use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Support\ValidationResult;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * REST controller para `/imagina-crm/v1/lists/{list}/fields`.
 *
 * `{list}` acepta ID o slug y se resuelve vía `ListService` (incluido el
 * historial de slugs). Los `{id_or_slug}` de campo siguen el mismo patrón.
 */
final class FieldsController extends AbstractController
{
    public function __construct(
        private readonly FieldService $service,
        private readonly ListService $lists,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        $base = 'lists/(?P<list>[a-zA-Z0-9_-]+)/fields';

        // GET: cualquier user con acceso al SPA puede leer el schema
        // (necesario para que el front renderice la tabla aunque sea
        // viewer). Mutaciones requieren manage_fields o manage_lists.
        $canRead = [$this, 'checkAdminPermissions'];
        $canManage = $this->requireAnyCapability(
            CapabilityRegistry::CAP_MANAGE_FIELDS,
            CapabilityRegistry::CAP_MANAGE_LISTS,
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
                'permission_callback' => $canManage,
            ],
        ]);

        register_rest_route($this->namespace, '/' . $base . '/reorder', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'reorder'],
            'permission_callback' => $canManage,
        ]);

        register_rest_route($this->namespace, '/' . $base . '/(?P<id_or_slug>[a-zA-Z0-9_-]+)', [
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getItem'],
                'permission_callback' => $canRead,
            ],
            [
                'methods'             => WP_REST_Server::EDITABLE,
                'callback'            => [$this, 'updateItem'],
                'permission_callback' => $canManage,
            ],
            [
                'methods'             => WP_REST_Server::DELETABLE,
                'callback'            => [$this, 'deleteItem'],
                'permission_callback' => $canManage,
                'args'                => [
                    'purge' => ['type' => 'boolean', 'default' => false],
                ],
            ],
        ]);

        register_rest_route(
            $this->namespace,
            '/' . $base . '/(?P<id_or_slug>[a-zA-Z0-9_-]+)/type-transitions',
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'typeTransitions'],
                'permission_callback' => $canManage,
            ],
        );

        // POST /lists/{list}/fields/{field}/options — agrega una opción
        // inline a un select/multi_select. Usado por el OptionPicker
        // del admin para creación de opciones on-the-fly.
        register_rest_route(
            $this->namespace,
            '/' . $base . '/(?P<id_or_slug>[a-zA-Z0-9_-]+)/options',
            [
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => [$this, 'appendOption'],
                'permission_callback' => $canManage,
                'args'                => [
                    'value' => ['type' => 'string', 'required' => true],
                    'label' => ['type' => 'string'],
                    'color' => ['type' => 'string'],
                ],
            ],
        );

        register_rest_route(
            $this->namespace,
            '/' . $base . '/(?P<id_or_slug>[a-zA-Z0-9_-]+)/values',
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'distinctValues'],
                // distinctValues lee valores del field — gating de read.
                // El scope de records aplicado en RecordsController no
                // se replica aquí (el catálogo de valores es por
                // diseño global para autocompletes).
                'permission_callback' => $this->requireAnyCapability(
                    CapabilityRegistry::CAP_VIEW_RECORDS,
                    CapabilityRegistry::CAP_VIEW_OWN_RECORDS,
                ),
                'args'                => [
                    'search' => ['type' => 'string'],
                    'limit'  => ['type' => 'integer', 'default' => 50],
                ],
            ],
        );
    }

    public function getCollection(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }

        $items = array_map(
            static fn (FieldEntity $f): array => $f->toArray(includePhysical: true),
            $this->service->allForList($list->id)
        );

        return new WP_REST_Response(['data' => $items]);
    }

    public function getItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }

        $idOrSlug = (string) $request->get_param('id_or_slug');
        $field    = $this->service->findByIdOrSlug($list->id, $idOrSlug);

        if ($field === null) {
            return $this->notFound();
        }

        $response = new WP_REST_Response(['data' => $field->toArray(includePhysical: true)]);

        if (! ctype_digit($idOrSlug) && strtolower($idOrSlug) !== $field->slug) {
            $response->header(
                'X-Imagina-CRM-Slug-Renamed',
                'old=' . strtolower($idOrSlug) . ',new=' . $field->slug
            );
        }
        return $response;
    }

    public function createItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }

        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }

        $payload = [
            'label'       => (string) ($params['label'] ?? ''),
            'type'        => (string) ($params['type'] ?? ''),
            'slug'        => isset($params['slug']) ? (string) $params['slug'] : '',
            'config'      => is_array($params['config'] ?? null) ? $params['config'] : [],
            'is_required' => ! empty($params['is_required']),
            'is_unique'   => ! empty($params['is_unique']),
            'is_primary'  => ! empty($params['is_primary']),
            'is_indexed'  => ! empty($params['is_indexed']),
        ];

        if (isset($params['position']) && is_numeric($params['position'])) {
            $payload['position'] = (int) $params['position'];
        }

        $result = $this->service->create($list->id, $payload);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }

        return new WP_REST_Response(['data' => $result->toArray(includePhysical: true)], 201);
    }

    public function updateItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }

        $idOrSlug = (string) $request->get_param('id_or_slug');
        $existing = $this->service->findByIdOrSlug($list->id, $idOrSlug);
        if ($existing === null) {
            return $this->notFound();
        }

        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }

        $renamed = null;
        if (isset($params['slug']) && is_string($params['slug'])) {
            $renameResult = $this->service->renameSlug($list->id, $existing->id, $params['slug']);
            if (! $renameResult->success) {
                return $this->validationError($renameResult->validation);
            }
            if ($renameResult->oldSlug !== $renameResult->newSlug) {
                $renamed = $renameResult;
            }
        }

        // Cambio de tipo: si viene `type` y difiere del actual, lo
        // rutamos a `changeType()` ANTES del update normal. La conversión
        // de valores y el ALTER COLUMN viven ahí. Si el caller no envió
        // `config` explícito, pasamos null para que el service construya
        // un config bridge (preserva options en select↔multi_select,
        // decimals en number↔currency, etc.).
        $entity = null;
        $newType = isset($params['type']) ? (string) $params['type'] : '';
        if ($newType !== '' && $newType !== $existing->type) {
            $newConfigForType = isset($params['config']) && is_array($params['config'])
                ? $params['config']
                : null;
            $changeResult = $this->service->changeType($list->id, $existing->id, $newType, $newConfigForType);
            if ($changeResult instanceof ValidationResult) {
                return $this->validationError($changeResult);
            }
            $entity = $changeResult;
        }

        $patch = array_intersect_key(
            $params,
            array_flip(['label', 'config', 'is_required', 'is_unique', 'is_primary', 'is_indexed', 'position'])
        );
        // Si cambiamos el tipo arriba, el config ya quedó aplicado por
        // `changeType()` — evitamos un segundo update redundante.
        if ($entity !== null) {
            unset($patch['config']);
        }

        if ($patch !== []) {
            $targetId = $entity?->id ?? $existing->id;
            $result = $this->service->update($list->id, $targetId, $patch);
            if ($result instanceof ValidationResult) {
                return $this->validationError($result);
            }
            $entity = $result;
        } elseif ($entity === null) {
            $entity = $this->service->findByIdOrSlug($list->id, (string) $existing->id);
            if ($entity === null) {
                return $this->notFound();
            }
        }

        $response = new WP_REST_Response(['data' => $entity->toArray(includePhysical: true)]);
        if ($renamed !== null) {
            $response->header(
                'X-Imagina-CRM-Slug-Renamed',
                'old=' . $renamed->oldSlug . ',new=' . $renamed->newSlug
            );
        }
        return $response;
    }

    /**
     * Devuelve las transiciones de tipo permitidas para este campo,
     * con su nivel de riesgo (`safe`/`lossy`/`destructive`). El
     * frontend usa esto para poblar el dropdown del editor cuando se
     * está modificando un campo existente.
     */
    public function typeTransitions(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $idOrSlug = (string) $request->get_param('id_or_slug');
        $field    = $this->service->findByIdOrSlug($list->id, $idOrSlug);
        if ($field === null) {
            return $this->notFound();
        }
        return new WP_REST_Response([
            'data' => [
                'current' => $field->type,
                'transitions' => FieldTypeMigration::allowedTransitions($field->type),
            ],
        ]);
    }

    /**
     * Agrega una opción inline a un select/multi_select field. El body
     * espera `{value, label?, color?}` — `label` defaultea a `value`,
     * `color` queda null si no se pasa (chip neutro).
     *
     * El frontend (OptionPicker) usa esto cuando el user escribe algo
     * en el search del dropdown que no matchea ninguna opción existente
     * y clickea "+ Crear".
     */
    public function appendOption(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $idOrSlug = (string) $request->get_param('id_or_slug');
        $field    = $this->service->findByIdOrSlug($list->id, $idOrSlug);
        if ($field === null) {
            return $this->notFound();
        }

        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }

        $result = $this->service->appendOption($list->id, $field->id, [
            'value' => (string) ($params['value'] ?? ''),
            'label' => (string) ($params['label'] ?? ''),
            'color' => isset($params['color']) ? (string) $params['color'] : '',
        ]);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }
        return new WP_REST_Response(['data' => $result->toArray(includePhysical: true)]);
    }

    public function deleteItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }

        $field = $this->service->findByIdOrSlug($list->id, (string) $request->get_param('id_or_slug'));
        if ($field === null) {
            return $this->notFound();
        }

        $purge  = (bool) $request->get_param('purge');
        $result = $this->service->delete($list->id, $field->id, $purge);

        if (! $result->isValid()) {
            return $this->validationError($result, 500);
        }

        return new WP_REST_Response(['data' => ['id' => $field->id, 'purged' => $purge]], 200);
    }

    public function reorder(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }

        $params = $request->get_json_params();
        if (! is_array($params) || ! isset($params['order']) || ! is_array($params['order'])) {
            return new WP_Error('imcrm_bad_payload', __('Falta el array order.', 'imagina-crm'), ['status' => 400]);
        }

        /** @var array<int, int> $order */
        $order  = [];
        foreach ($params['order'] as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $id  = isset($entry['id']) ? (int) $entry['id'] : 0;
            $pos = isset($entry['position']) ? (int) $entry['position'] : 0;
            if ($id > 0) {
                $order[$id] = $pos;
            }
        }

        $result = $this->service->reorder($list->id, $order);
        if (! $result->isValid()) {
            return $this->validationError($result);
        }

        return new WP_REST_Response(['data' => ['ok' => true, 'count' => count($order)]]);
    }

    /**
     * `GET /lists/{list}/fields/{field}/values?search=&limit=`
     *
     * Devuelve hasta `limit` valores distintos del campo, ordenados
     * por frecuencia descendente. Para autocomplete en filtros y
     * conditions de automatizaciones. Tipos sin sentido (select,
     * checkbox, date, etc.) devuelven `[]` — el FE lo ignora y
     * cae al picker específico del tipo.
     */
    public function distinctValues(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }

        $field = $this->service->findByIdOrSlug($list->id, (string) $request->get_param('id_or_slug'));
        if ($field === null) {
            return $this->notFound();
        }

        $rawSearch = $request->get_param('search');
        $search    = is_string($rawSearch) && $rawSearch !== '' ? $rawSearch : null;
        $limit     = (int) ($request->get_param('limit') ?? 50);

        $values = $this->service->distinctValues($list->id, $field->id, $search, $limit);
        return new WP_REST_Response(['data' => $values]);
    }
}
