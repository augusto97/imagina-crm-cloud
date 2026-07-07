<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Automations\AutomationEntity;
use ImaginaCRM\Automations\AutomationRunRepository;
use ImaginaCRM\Automations\AutomationService;
use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Support\ValidationResult;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * REST controller para `/imagina-crm/v1/lists/{list}/automations` y
 * `/imagina-crm/v1/automations/{id}/runs`.
 *
 * El recurso `automations` siempre vive bajo una lista (cada automatización
 * pertenece a exactamente una lista). El recurso `runs` es de solo lectura
 * — los runs los crea el `AutomationEngine` en respuesta a eventos de
 * dominio, no la API.
 */
final class AutomationsController extends AbstractController
{
    public function __construct(
        private readonly AutomationService $service,
        private readonly AutomationRunRepository $runs,
        private readonly ListService $lists,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        $listBase = 'lists/(?P<list>[a-zA-Z0-9_-]+)/automations';

        register_rest_route($this->namespace, '/' . $listBase, [
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getCollection'],
                'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_AUTOMATIONS),
            ],
            [
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => [$this, 'createItem'],
                'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_AUTOMATIONS),
            ],
        ]);

        register_rest_route($this->namespace, '/' . $listBase . '/(?P<id>\d+)', [
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getItem'],
                'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_AUTOMATIONS),
            ],
            [
                'methods'             => WP_REST_Server::EDITABLE,
                'callback'            => [$this, 'updateItem'],
                'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_AUTOMATIONS),
            ],
            [
                'methods'             => WP_REST_Server::DELETABLE,
                'callback'            => [$this, 'deleteItem'],
                'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_AUTOMATIONS),
            ],
        ]);

        // Webhooks (Fase 15.C): vista cross-list de todas las
        // automatizaciones que tienen una action `call_webhook`. La
        // creación/edición sigue siendo via Automations — esta ruta
        // es solo lectura para el "Webhooks manager" del settings.
        register_rest_route($this->namespace, '/webhooks', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'listWebhooks'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_AUTOMATIONS),
        ]);

        // Runs vive en `/automations/{id}/runs` (sin pasar por la lista),
        // porque el run ya tiene la automation_id y la list_id grabados, y
        // el cliente sólo necesita el id de la automatización para auditar.
        register_rest_route($this->namespace, '/automations/(?P<id>\d+)/runs', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'listRuns'],
            'permission_callback' => [$this, 'checkAdminPermissions'],
            'args'                => [
                'limit' => ['type' => 'integer', 'default' => 50],
            ],
        ]);
    }

    public function getCollection(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }

        $items = array_map(
            static fn (AutomationEntity $a): array => $a->toArray(),
            $this->service->allForList($list->id),
        );
        return new WP_REST_Response(['data' => $items]);
    }

    public function getItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }

        $id        = (int) $request->get_param('id');
        $automation = $this->service->find($id);
        if ($automation === null || $automation->listId !== $list->id) {
            return $this->notFound(__('Automatización no encontrada.', 'imagina-crm'));
        }
        return new WP_REST_Response(['data' => $automation->toArray()]);
    }

    public function createItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }

        $params = $this->jsonParams($request);
        $result = $this->service->create($list->id, $params);
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

        $id        = (int) $request->get_param('id');
        $automation = $this->service->find($id);
        if ($automation === null || $automation->listId !== $list->id) {
            return $this->notFound(__('Automatización no encontrada.', 'imagina-crm'));
        }

        $params = $this->jsonParams($request);
        $result = $this->service->update($id, $params);
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

        $id        = (int) $request->get_param('id');
        $automation = $this->service->find($id);
        if ($automation === null || $automation->listId !== $list->id) {
            return $this->notFound(__('Automatización no encontrada.', 'imagina-crm'));
        }

        $result = $this->service->delete($id);
        if (! $result->isValid()) {
            return $this->validationError($result);
        }
        return new WP_REST_Response(['data' => ['id' => $id]]);
    }

    public function listRuns(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $id    = (int) $request->get_param('id');
        $limit = max(1, min(200, (int) ($request->get_param('limit') ?? 50)));

        if ($this->service->find($id) === null) {
            return $this->notFound(__('Automatización no encontrada.', 'imagina-crm'));
        }

        $rows = array_map(
            static fn (array $row): array => self::shapeRun($row),
            $this->runs->recentForAutomation($id, $limit),
        );
        return new WP_REST_Response(['data' => $rows]);
    }

    /**
     * @return array<string, mixed>
     */
    private function jsonParams(WP_REST_Request $request): array
    {
        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }
        return $params;
    }

    /**
     * Da forma a una fila de `wp_imcrm_automation_runs` para la API:
     * decode JSON de `trigger_context` y `actions_log`, casteo de tipos.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function shapeRun(array $row): array
    {
        $context = $row['trigger_context'] ?? null;
        $log     = $row['actions_log'] ?? null;
        return [
            'id'              => (int) ($row['id'] ?? 0),
            'automation_id'   => (int) ($row['automation_id'] ?? 0),
            'list_id'         => (int) ($row['list_id'] ?? 0),
            'record_id'       => isset($row['record_id']) ? (int) $row['record_id'] : null,
            'status'          => (string) ($row['status'] ?? ''),
            'trigger_context' => is_string($context) ? json_decode($context, true) : null,
            'actions_log'     => is_string($log) ? json_decode($log, true) : [],
            'error'           => $row['error'] ?? null,
            'retries'         => (int) ($row['retries'] ?? 0),
            'started_at'      => $row['started_at'] ?? null,
            'finished_at'     => $row['finished_at'] ?? null,
            'created_at'      => $row['created_at'] ?? null,
        ];
    }

    /**
     * GET /webhooks
     *
     * Lista todas las automatizaciones cross-list que contienen una
     * action `call_webhook`. El response enriquece cada item con
     * `list_name` + `list_slug` (porque la UI quiere mostrar a qué
     * lista pertenece sin hacer N+1 lookups por automation_id).
     *
     * El cliente solo recibe las URLs declaradas y el primer trigger
     * type — para detalles completos abre la automation en el editor.
     * (Fase 15.C)
     */
    public function listWebhooks(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        unset($request);
        $automations = $this->service->allWithActionType('call_webhook');

        $out = [];
        foreach ($automations as $a) {
            // Extraer URLs de las actions call_webhook del config.
            $urls = [];
            foreach ($a->actions as $action) {
                if (! is_array($action)) continue;
                if (($action['type'] ?? '') !== 'call_webhook') continue;
                $url = isset($action['config']['url']) ? (string) $action['config']['url'] : '';
                if ($url !== '') {
                    $urls[] = $url;
                }
            }

            $list = $this->lists->findByIdOrSlug((string) $a->listId);
            $out[] = [
                'id'           => $a->id,
                'name'         => $a->name,
                'list_id'      => $a->listId,
                'list_name'    => $list?->name ?? '',
                'list_slug'    => $list?->slug ?? '',
                'trigger_type' => $a->triggerType,
                'urls'         => $urls,
                'is_active'    => $a->isActive,
                'created_at'   => $a->createdAt,
            ];
        }

        return new WP_REST_Response(['data' => $out]);
    }
}
