<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Exports\CsvExporter;
use ImaginaCRM\Exports\ExportJobEntity;
use ImaginaCRM\Exports\ExportJobRepository;
use ImaginaCRM\Exports\ExportJobService;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Permissions\PermissionService;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * REST controller para export de records.
 *
 * Endpoints (Fase 17.A):
 *   POST /lists/{slug}/export                — sync (legacy) o async opt-in
 *   GET  /lists/{slug}/export                — alias GET (browser-friendly)
 *   GET  /export/jobs/{id}                   — status del job async
 *   GET  /export/jobs/{id}/download?token=…  — descarga del archivo
 *
 * Modos:
 *  - **Sync** (legacy, default): el endpoint stream-ea el CSV con
 *    headers correctos. Aplica a listas chicas (≤ 5k records) donde
 *    el round-trip es aceptable.
 *  - **Async** (Fase 17.A): cuando el cliente pasa `?async=1`, el
 *    request crea un job en Action Scheduler y devuelve `202 Accepted`
 *    con `{ job_id }`. El user polea `/export/jobs/{id}` para status
 *    y descarga con `/export/jobs/{id}/download?token=...`.
 *
 * El cliente decide qué modo usar según el `meta.total` que ya
 * conoce de la vista de records. Heurística: > 5000 records → async.
 */
final class ExportController extends AbstractController
{
    public function __construct(
        private readonly CsvExporter $exporter,
        private readonly ListService $lists,
        private readonly PermissionService $permissions,
        private readonly FieldRepository $fields,
        private readonly ExportJobService $jobService,
        private readonly ExportJobRepository $jobRepo,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        $cap = $this->requireCapability(CapabilityRegistry::CAP_EXPORT_RECORDS);

        register_rest_route($this->namespace, '/lists/(?P<list>[a-zA-Z0-9_-]+)/export', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'export'],
            'permission_callback' => $cap,
        ]);

        register_rest_route($this->namespace, '/export/jobs/(?P<id>\d+)', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'getJob'],
            'permission_callback' => $cap,
        ]);

        // El download usa el token como auth, NO el cap normal — el
        // token incluye user_id + expires firmado con wp_salt y se
        // valida en el handler. Permission callback siempre true; la
        // validación real corre en el handler.
        register_rest_route($this->namespace, '/export/jobs/(?P<id>\d+)/download', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'downloadJob'],
            'permission_callback' => '__return_true',
            'args' => [
                'token' => ['type' => 'string', 'required' => true],
            ],
        ]);

        register_rest_route($this->namespace, '/export/jobs', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'listMyJobs'],
            'permission_callback' => $cap,
        ]);
    }

    public function export(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $user = wp_get_current_user();
        if (! $this->permissions->userCanSeeList($user, $list)) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }

        $params = $this->resolveExportParams($request, $list, $user);
        if ($params instanceof WP_Error) {
            return $params;
        }

        $async = $request->get_param('async') === '1'
            || $request->get_param('async') === true;

        if ($async) {
            $jobId = $this->jobService->createJob($list->id, (int) $user->ID, $params);
            if ($jobId === 0) {
                return new WP_Error(
                    'imcrm_job_create_failed',
                    __('No se pudo encolar el export.', 'imagina-crm'),
                    ['status' => 500],
                );
            }
            return new WP_REST_Response([
                'data' => [
                    'job_id' => $jobId,
                    'status' => ExportJobEntity::STATUS_PENDING,
                    'poll_url' => rest_url($this->namespace . '/export/jobs/' . $jobId),
                ],
            ], 202);
        }

        // Sync legacy: stream directo.
        $csv = $this->exporter->export(
            $list,
            $params['fieldIds'] ?? null,
            $params['filterTree'] ?? null,
            $params['additionalWhere'] ?? null,
            $params['delimiter'] ?? ',',
            ! empty($params['withBom']),
        );

        $filename = sprintf('%s-%s.csv', $list->slug, gmdate('Ymd-His'));
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Cache-Control: no-store');
        header('Content-Length: ' . strlen($csv));
        echo $csv;
        exit;
    }

    public function getJob(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $jobId = (int) $request->get_param('id');
        $job = $this->jobRepo->find($jobId);
        if ($job === null) {
            return $this->notFound(__('Job no encontrado.', 'imagina-crm'));
        }
        $user = wp_get_current_user();
        if ($job->userId !== (int) $user->ID && ! $this->permissions->userIsPluginAdmin($user)) {
            return $this->forbidden();
        }

        $data = $job->toArray();
        if ($job->status === ExportJobEntity::STATUS_READY) {
            $token = $this->jobService->downloadToken($job);
            $data['download_url'] = rest_url(
                $this->namespace . '/export/jobs/' . $job->id . '/download'
            ) . '?token=' . rawurlencode($token);
        }
        return new WP_REST_Response(['data' => $data]);
    }

    public function downloadJob(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $jobId = (int) $request->get_param('id');
        $token = (string) $request->get_param('token');
        $user = wp_get_current_user();

        $job = $this->jobService->verifyDownloadToken($jobId, $token, $user);
        if ($job === null || $job->filePath === null) {
            return $this->forbidden(__('Token inválido o expirado.', 'imagina-crm'));
        }

        $list = $this->lists->findByIdOrSlug((string) $job->listId);
        $listSlug = $list?->slug ?? 'export';
        $filename = sprintf('%s-%s.csv', $listSlug, gmdate('Ymd-His', strtotime((string) $job->createdAt) ?: time()));

        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Cache-Control: no-store');
        header('Content-Length: ' . (string) filesize($job->filePath));
        readfile($job->filePath);
        exit;
    }

    public function listMyJobs(WP_REST_Request $request): WP_REST_Response
    {
        unset($request);
        $user = wp_get_current_user();
        $jobs = $this->jobRepo->recentForUser((int) $user->ID, 20);
        $out = [];
        foreach ($jobs as $j) {
            $row = $j->toArray();
            if ($j->status === ExportJobEntity::STATUS_READY) {
                $token = $this->jobService->downloadToken($j);
                $row['download_url'] = rest_url(
                    $this->namespace . '/export/jobs/' . $j->id . '/download'
                ) . '?token=' . rawurlencode($token);
            }
            $out[] = $row;
        }
        return new WP_REST_Response(['data' => $out]);
    }

    /**
     * Resuelve y normaliza los params del request a un shape que
     * tanto el flow sync como el job worker pueden usar. Centraliza
     * el guard de per-field permissions (Fase 16.A).
     *
     * @return array<string, mixed>|WP_Error
     */
    private function resolveExportParams(WP_REST_Request $request, ListEntity $list, \WP_User $user): array|WP_Error
    {
        $rawFieldIds = $request->get_param('fields');
        $fieldIds    = null;
        if (is_string($rawFieldIds) && $rawFieldIds !== '') {
            $fieldIds = array_values(array_filter(
                array_map('intval', explode(',', $rawFieldIds)),
                static fn (int $id): bool => $id > 0,
            ));
        }

        $sanitizer = $this->permissions->sanitizerFor($user, $list);
        if (! $sanitizer->isNoop()) {
            $idToSlug = [];
            foreach ($this->fields->allForList($list->id) as $f) {
                $idToSlug[$f->id] = $f->slug;
            }
            if ($fieldIds !== null) {
                $allowed = $sanitizer->filterAllowedFieldIds($fieldIds, $idToSlug);
                if ($allowed === []) {
                    return $this->forbidden(__('Los campos solicitados están ocultos para tu rol.', 'imagina-crm'));
                }
                $fieldIds = $allowed;
            } else {
                $allIds = array_keys($idToSlug);
                $fieldIds = $sanitizer->filterAllowedFieldIds($allIds, $idToSlug);
            }
        }

        $rawTree    = $request->get_param('filter_tree');
        $filterTree = null;
        if (is_string($rawTree) && $rawTree !== '') {
            $decoded = json_decode($rawTree, true);
            if (is_array($decoded) && ($decoded['type'] ?? '') === 'group') {
                $filterTree = $decoded;
            }
        }

        $scope = $this->permissions->recordsScopeWhere($user, $list);
        $additionalWhere = $scope['sql'] === '' ? null : $scope;

        return [
            'fieldIds'        => $fieldIds,
            'filterTree'      => $filterTree,
            'additionalWhere' => $additionalWhere,
            'delimiter'       => (string) ($request->get_param('delimiter') ?? ','),
            'withBom'         => $request->get_param('with_bom') === '1'
                || $request->get_param('with_bom') === true,
        ];
    }
}
