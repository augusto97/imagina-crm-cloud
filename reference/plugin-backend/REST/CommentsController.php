<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Comments\CommentEntity;
use ImaginaCRM\Comments\CommentService;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Permissions\PermissionService;
use ImaginaCRM\Plugin;
use ImaginaCRM\Records\RecordService;
use ImaginaCRM\Support\ValidationResult;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * REST para `/imagina-crm/v1/lists/{list}/records/{record}/comments`.
 *
 * Permisos:
 * - Lectura/creación: `manage_options` (mismo umbral del resto del plugin
 *   en Fase 1; granularidad de roles llega en Fase futura).
 * - Edición/eliminación: el `CommentService` valida que sea autor o admin.
 *   Aquí en el controller `manage_options` ya implica "admin" para el
 *   service.
 */
final class CommentsController extends AbstractController
{
    public function __construct(
        private readonly CommentService $service,
        private readonly ListService $lists,
        private readonly RecordService $records,
        private readonly PermissionService $permissions,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        $base = 'lists/(?P<list>[a-zA-Z0-9_-]+)/records/(?P<record>\d+)/comments';

        // GET/POST: requiere view records (la visibilidad del record
        // específico se chequea en el handler).
        $canRead = $this->requireAnyCapability(
            CapabilityRegistry::CAP_VIEW_RECORDS,
            CapabilityRegistry::CAP_VIEW_OWN_RECORDS,
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
                'permission_callback' => $canRead,
            ],
        ]);

        register_rest_route($this->namespace, '/' . $base . '/(?P<id>\d+)', [
            [
                'methods'             => WP_REST_Server::EDITABLE,
                'callback'            => [$this, 'updateItem'],
                'permission_callback' => $canRead,
            ],
            [
                'methods'             => WP_REST_Server::DELETABLE,
                'callback'            => [$this, 'deleteItem'],
                'permission_callback' => $canRead,
            ],
        ]);
    }

    /**
     * Resuelve list + record validando visibilidad. 404 cuando el user
     * no puede ver la lista o el record concreto — no se distingue
     * "no existe" vs "no autorizado" para no revelar existencia.
     *
     * @return array{0: ListEntity, 1: array<string, mixed>}|WP_Error
     */
    private function resolveAccessibleRecord(WP_REST_Request $request): array|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $user = wp_get_current_user();
        if (! $this->permissions->userCanSeeList($user, $list)) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $recordId = (int) $request->get_param('record');
        $record = $this->records->find($list, $recordId);
        if ($record === null || ! $this->permissions->userCanViewRecord($user, $list, $record)) {
            return $this->notFound();
        }
        return [$list, $record];
    }

    public function getCollection(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $resolved = $this->resolveAccessibleRecord($request);
        if ($resolved instanceof WP_Error) {
            return $resolved;
        }
        [$list, $record] = $resolved;
        $recordId = (int) ($record['id'] ?? 0);

        $items = array_map(
            static fn (CommentEntity $c): array => $c->toArray(),
            $this->service->allForRecord($list->id, $recordId),
        );
        return new WP_REST_Response(['data' => $items]);
    }

    public function createItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $resolved = $this->resolveAccessibleRecord($request);
        if ($resolved instanceof WP_Error) {
            return $resolved;
        }
        [$list, $record] = $resolved;
        $recordId = (int) ($record['id'] ?? 0);

        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }

        $result = $this->service->create($list->id, $recordId, get_current_user_id(), $params);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }
        return new WP_REST_Response(['data' => $result->toArray()], 201);
    }

    public function updateItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $id      = (int) $request->get_param('id');
        $params  = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }
        $content  = isset($params['content']) ? (string) $params['content'] : '';
        $metadata = $params['metadata'] ?? null;

        $result = $this->service->update(
            $id,
            get_current_user_id(),
            current_user_can(Plugin::ADMIN_CAPABILITY),
            $content,
            $metadata,
        );
        if ($result instanceof ValidationResult) {
            return $this->serviceError($result);
        }
        return new WP_REST_Response(['data' => $result->toArray()]);
    }

    public function deleteItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $id = (int) $request->get_param('id');
        $result = $this->service->delete(
            $id,
            get_current_user_id(),
            current_user_can(Plugin::ADMIN_CAPABILITY),
        );
        if (! $result->isValid()) {
            return $this->serviceError($result);
        }
        return new WP_REST_Response(['data' => ['id' => $id]]);
    }

    /**
     * `forbidden` y `id` (not found) son shapes especiales: 403 / 404 en
     * lugar del 422 del validation error genérico.
     */
    private function serviceError(ValidationResult $result): WP_Error
    {
        if (array_key_exists('forbidden', $result->errors())) {
            return new WP_Error('imcrm_forbidden', $result->firstError() ?? '', ['status' => 403]);
        }
        if (array_key_exists('id', $result->errors())) {
            return $this->notFound($result->firstError() ?? '');
        }
        return $this->validationError($result);
    }
}
