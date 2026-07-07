<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Filters\SavedFilterEntity;
use ImaginaCRM\Filters\SavedFilterService;
use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Support\ValidationResult;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * REST controller para `/imagina-crm/v1/lists/{list}/saved-filters`.
 *
 * Endpoint estilo ClickUp: filtros nombrados reusables entre vistas.
 * Cada filtro pertenece a un `user_id` (personal) o tiene `user_id =
 * NULL` (compartido = "entorno de trabajo").
 */
final class SavedFiltersController extends AbstractController
{
    public function __construct(
        private readonly SavedFilterService $service,
        private readonly ListService $lists,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        $base = 'lists/(?P<list>[a-zA-Z0-9_-]+)/saved-filters';

        register_rest_route($this->namespace, '/' . $base, [
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getCollection'],
                'permission_callback' => [$this, 'checkAdminPermissions'],
            ],
            [
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => [$this, 'createItem'],
                'permission_callback' => [$this, 'checkAdminPermissions'],
            ],
        ]);

        register_rest_route($this->namespace, '/' . $base . '/(?P<id>\d+)', [
            [
                'methods'             => WP_REST_Server::EDITABLE,
                'callback'            => [$this, 'updateItem'],
                'permission_callback' => [$this, 'checkAdminPermissions'],
            ],
            [
                'methods'             => WP_REST_Server::DELETABLE,
                'callback'            => [$this, 'deleteItem'],
                'permission_callback' => [$this, 'checkAdminPermissions'],
            ],
        ]);
    }

    public function getCollection(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }

        $items = $this->service->listForUser($list->id, get_current_user_id());
        return new WP_REST_Response([
            'data' => array_map(static fn (SavedFilterEntity $f): array => $f->toArray(), $items),
        ]);
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

        $result = $this->service->create($list->id, get_current_user_id(), $params);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }
        return new WP_REST_Response(['data' => $result->toArray()], 201);
    }

    public function updateItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $id = (int) $request->get_param('id');

        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }

        $result = $this->service->update($id, get_current_user_id(), $params);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }
        return new WP_REST_Response(['data' => $result->toArray()]);
    }

    public function deleteItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $id     = (int) $request->get_param('id');
        $result = $this->service->delete($id, get_current_user_id());
        if (! $result->isValid()) {
            return $this->validationError($result);
        }
        return new WP_REST_Response(['data' => ['id' => $id]]);
    }
}
