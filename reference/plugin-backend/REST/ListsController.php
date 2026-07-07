<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Permissions\PermissionService;
use ImaginaCRM\Support\ValidationResult;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * REST controller para `/imagina-crm/v1/lists`.
 *
 * Acepta tanto IDs numéricos como slugs en `{id_or_slug}`. Cuando el slug
 * recibido fue renombrado, devuelve el recurso resuelto + header
 * `X-Imagina-CRM-Slug-Renamed: old=...,new=...` (CLAUDE.md §9.1).
 */
final class ListsController extends AbstractController
{
    protected $rest_base = 'lists';

    public function __construct(
        private readonly ListService $service,
        private readonly PermissionService $permissions,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        // GET: cualquier user con acceso al SPA puede pedir la colección;
        // el filtrado por visibilidad se aplica adentro.
        $canRead = [$this, 'checkAdminPermissions'];
        $canManage = $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS);

        register_rest_route($this->namespace, '/' . $this->rest_base, [
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getCollection'],
                'permission_callback' => $canRead,
            ],
            [
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => [$this, 'createItem'],
                'permission_callback' => $canManage,
                'args'                => $this->createArgs(),
            ],
        ]);

        register_rest_route($this->namespace, '/' . $this->rest_base . '/(?P<id_or_slug>[a-zA-Z0-9_-]+)', [
            'args' => [
                'id_or_slug' => [
                    'type'        => 'string',
                    'description' => 'ID numérico o slug actual de la lista.',
                ],
            ],
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
                    'purge' => [
                        'type'    => 'boolean',
                        'default' => false,
                    ],
                ],
            ],
        ]);
    }

    public function getCollection(WP_REST_Request $request): WP_REST_Response
    {
        unset($request);
        $user = wp_get_current_user();
        $lists = [];
        foreach ($this->service->all() as $list) {
            if (! $this->permissions->userCanSeeList($user, $list)) {
                continue;
            }
            $lists[] = $list->toArray();
        }
        return new WP_REST_Response(['data' => $lists]);
    }

    public function getItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $idOrSlug = (string) $request->get_param('id_or_slug');
        $list     = $this->service->findByIdOrSlug($idOrSlug);

        if ($list === null) {
            return $this->notFound();
        }

        // 404 si el user no puede VER esta lista — evita revelar su
        // existencia a roles sin acceso.
        if (! $this->permissions->userCanSeeList(wp_get_current_user(), $list)) {
            return $this->notFound();
        }

        return $this->respondList($list, $idOrSlug);
    }

    public function createItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }

        $payload = [
            'name'        => isset($params['name']) ? (string) $params['name'] : '',
            'slug'        => isset($params['slug']) ? (string) $params['slug'] : '',
            'description' => $params['description'] ?? null,
            'icon'        => $params['icon'] ?? null,
            'color'       => $params['color'] ?? null,
            'settings'    => is_array($params['settings'] ?? null) ? $params['settings'] : [],
        ];

        $result = $this->service->create($payload);

        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }

        return new WP_REST_Response(['data' => $result->toArray(includePhysical: true)], 201);
    }

    public function updateItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $idOrSlug = (string) $request->get_param('id_or_slug');
        $existing = $this->service->findByIdOrSlug($idOrSlug);

        if ($existing === null) {
            return $this->notFound();
        }

        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }

        $renamed = null;

        if (isset($params['slug']) && is_string($params['slug'])) {
            $renameResult = $this->service->renameSlug($existing->id, $params['slug']);
            if (! $renameResult->success) {
                return $this->validationError($renameResult->validation);
            }
            if ($renameResult->oldSlug !== $renameResult->newSlug) {
                $renamed = $renameResult;
            }
        }

        $patch = array_intersect_key(
            $params,
            array_flip(['name', 'description', 'icon', 'color', 'settings', 'position'])
        );

        if ($patch !== []) {
            $result = $this->service->update($existing->id, $patch);
            if ($result instanceof ValidationResult) {
                return $this->validationError($result);
            }
            $entity = $result;
        } else {
            $entity = $this->service->findByIdOrSlug((string) $existing->id);
            if ($entity === null) {
                return $this->notFound();
            }
        }

        $response = new WP_REST_Response(['data' => $entity->toArray()]);
        if ($renamed !== null) {
            $response->header(
                'X-Imagina-CRM-Slug-Renamed',
                'old=' . $renamed->oldSlug . ',new=' . $renamed->newSlug
            );
        }

        return $response;
    }

    public function deleteItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $idOrSlug = (string) $request->get_param('id_or_slug');
        $list     = $this->service->findByIdOrSlug($idOrSlug);

        if ($list === null) {
            return $this->notFound();
        }

        $purge  = (bool) $request->get_param('purge');
        $result = $this->service->delete($list->id, $purge);

        if (! $result->isValid()) {
            return $this->validationError($result, 500);
        }

        return new WP_REST_Response(['data' => ['id' => $list->id, 'purged' => $purge]], 200);
    }

    private function respondList(ListEntity $list, string $requested): WP_REST_Response
    {
        $response = new WP_REST_Response(['data' => $list->toArray()]);

        // Si el cliente pidió por slug y el slug actual difiere, lo avisamos.
        if (! ctype_digit($requested) && strtolower($requested) !== $list->slug) {
            $response->header(
                'X-Imagina-CRM-Slug-Renamed',
                'old=' . strtolower($requested) . ',new=' . $list->slug
            );
        }

        return $response;
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function createArgs(): array
    {
        return [
            'name' => [
                'type'     => 'string',
                'required' => true,
            ],
            'slug' => [
                'type'        => 'string',
                'description' => 'Slug opcional. Si no se envía, se deriva del name.',
            ],
            'description' => ['type' => 'string'],
            'icon'        => ['type' => 'string'],
            'color'       => ['type' => 'string'],
            'settings'    => ['type' => 'object'],
        ];
    }
}
