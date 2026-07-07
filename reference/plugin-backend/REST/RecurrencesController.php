<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Recurrences\RecurrenceRepository;
use ImaginaCRM\Recurrences\RecurrenceService;
use ImaginaCRM\Support\ValidationResult;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * REST controller para recurrencias por record.
 *
 * Endpoints:
 *   GET    /lists/{list}/records/{id}/recurrences     — lista las recurrencias del record
 *   POST   /lists/{list}/records/{id}/recurrences     — crea/actualiza (upsert por date_field_id)
 *   DELETE /lists/{list}/records/{id}/recurrences/{rid} — elimina
 *
 * Upsert con UNIQUE(record_id, date_field_id) — POST con un date_field
 * que ya tiene recurrencia la actualiza en su lugar (idempotente desde
 * el frontend).
 */
final class RecurrencesController extends AbstractController
{
    public function __construct(
        private readonly RecurrenceService $service,
        private readonly RecurrenceRepository $repo,
        private readonly ListService $lists,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        $base = 'lists/(?P<list>[a-zA-Z0-9_-]+)/records/(?P<id>\d+)/recurrences';

        // Lectura: cap de ver records (recurrencias son metadata de records).
        // Mutación: cap de editar records.
        $canRead = $this->requireAnyCapability(
            CapabilityRegistry::CAP_VIEW_RECORDS,
            CapabilityRegistry::CAP_VIEW_OWN_RECORDS,
        );
        $canWrite = $this->requireAnyCapability(
            CapabilityRegistry::CAP_EDIT_RECORDS,
            CapabilityRegistry::CAP_EDIT_OWN_RECORDS,
        );

        register_rest_route($this->namespace, '/' . $base, [
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getCollection'],
                'permission_callback' => $canRead,
            ],
            [
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => [$this, 'createOrUpdate'],
                'permission_callback' => $canWrite,
            ],
        ]);

        register_rest_route($this->namespace, '/' . $base . '/(?P<rid>\d+)', [
            'methods'             => WP_REST_Server::DELETABLE,
            'callback'            => [$this, 'deleteItem'],
            'permission_callback' => $canWrite,
        ]);

        // Batch endpoint: trae las recurrencias de N records de un
        // solo shot. Reemplaza el N+1 que existía cuando cada celda
        // de fecha pegaba a `/recurrences` independientemente.
        register_rest_route(
            $this->namespace,
            '/lists/(?P<list>[a-zA-Z0-9_-]+)/recurrences',
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getBatch'],
                'permission_callback' => $canRead,
            ],
        );
    }

    /**
     * Devuelve `{record_id: Recurrence[]}` para los IDs pedidos.
     * Una sola query con `WHERE record_id IN (...)` en lugar de N
     * queries individuales. El frontend pide esto una vez por
     * página de records visible y dispatch los iconos por celda.
     */
    public function getBatch(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $rawIds = (string) ($request->get_param('ids') ?? '');
        $ids = array_values(array_filter(
            array_map('intval', explode(',', $rawIds)),
            static fn (int $id): bool => $id > 0,
        ));
        // Hard cap: pedir 5000 ids de una sola es ridículo, casi
        // seguro un bug del cliente. WHERE IN con 5k items también
        // es incómodo para MySQL.
        if (count($ids) > 1000) {
            $ids = array_slice($ids, 0, 1000);
        }
        if ($ids === []) {
            return new WP_REST_Response(['data' => []]);
        }
        $byRecord = $this->repo->batchForRecords($ids);
        $out = [];
        foreach ($byRecord as $rid => $recurrences) {
            $out[(string) $rid] = array_map(static fn ($r) => $r->toArray(), $recurrences);
        }
        return new WP_REST_Response(['data' => $out]);
    }

    public function getCollection(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $recordId = (int) $request->get_param('id');
        $items = $this->repo->listForRecord($recordId);
        return new WP_REST_Response([
            'data' => array_map(static fn ($r) => $r->toArray(), $items),
        ]);
    }

    public function createOrUpdate(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $recordId = (int) $request->get_param('id');

        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }

        $result = $this->service->upsert($list->id, $recordId, $params);
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
        $rid = (int) $request->get_param('rid');
        $this->service->delete($rid);
        return new WP_REST_Response(['data' => ['id' => $rid]]);
    }
}
