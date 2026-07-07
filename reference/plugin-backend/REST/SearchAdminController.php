<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Maintenance\CompositeIndexSuggester;
use ImaginaCRM\Maintenance\PurgeService;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Search\InvertedIndexEngine;
use ImaginaCRM\Search\SearchService;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * Endpoints administrativos para Tier 3 (search engine + composite
 * indexes + purge). Sirven al panel de "Mantenimiento" del admin.
 *
 *   GET   /lists/{id}/search/status           — flag, doc count, last_indexed
 *   POST  /lists/{id}/search/enable           — activa índice + reindex
 *   POST  /lists/{id}/search/disable          — desactiva + clear
 *   POST  /lists/{id}/search/reindex          — re-encola full reindex
 *
 *   GET   /lists/{id}/indexes/suggest         — sugerencias de composite
 *   POST  /lists/{id}/indexes/apply           — crea índice sugerido
 *   POST  /lists/{id}/indexes/drop            — elimina índice creado
 *
 *   POST  /system/maintenance/purge           — corre purge ad-hoc
 */
final class SearchAdminController extends AbstractController
{
    public function __construct(
        private readonly ListService $lists,
        private readonly SearchService $search,
        private readonly InvertedIndexEngine $invertedEngine,
        private readonly CompositeIndexSuggester $suggester,
        private readonly PurgeService $purge,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        $base = 'lists/(?P<list>[a-zA-Z0-9_-]+)';

        register_rest_route($this->namespace, '/' . $base . '/search/status', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'getSearchStatus'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
        ]);

        register_rest_route($this->namespace, '/' . $base . '/search/enable', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'enableSearch'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
        ]);

        register_rest_route($this->namespace, '/' . $base . '/search/disable', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'disableSearch'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
        ]);

        register_rest_route($this->namespace, '/' . $base . '/search/reindex', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'reindexSearch'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
        ]);

        register_rest_route($this->namespace, '/' . $base . '/indexes/suggest', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'suggestIndexes'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
        ]);

        register_rest_route($this->namespace, '/' . $base . '/indexes/apply', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'applyIndex'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
        ]);

        register_rest_route($this->namespace, '/' . $base . '/indexes/drop', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'dropIndex'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
        ]);

        register_rest_route($this->namespace, '/system/maintenance/purge', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'runPurge'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
        ]);
    }

    public function getSearchStatus(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound();
        }
        // 0.36.7: reportamos `reindexing` para que el frontend solo
        // pollee mientras hay trabajo activo. Antes el frontend
        // pollaba cada 5s indefinidamente con el panel abierto, aunque
        // no hubiera reindex pendiente. Action Scheduler enqueue cada
        // batch con `after_id` distinto, así que filtramos por hook +
        // grupo + status pendiente — los args cambian entre batches.
        $reindexing = false;
        if (function_exists('as_get_scheduled_actions')) {
            $pending = as_get_scheduled_actions([
                'hook'     => 'imagina_crm/search_reindex_batch',
                'group'    => 'imagina-crm-search',
                'status'   => ['pending', 'in-progress'],
                'per_page' => 1,
            ], 'ids');
            $reindexing = is_array($pending) && count($pending) > 0;
        }
        return new WP_REST_Response([
            'data' => [
                'enabled'    => $this->search->isIndexed($list),
                'doc_count'  => $this->invertedEngine->documentCount($list->id),
                'reindexing' => $reindexing,
            ],
        ]);
    }

    public function enableSearch(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound();
        }
        $this->search->enableIndex($list->id);
        return new WP_REST_Response(['data' => ['enabled' => true, 'reindex_scheduled' => true]]);
    }

    public function disableSearch(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound();
        }
        $this->search->disableIndex($list->id);
        return new WP_REST_Response(['data' => ['enabled' => false]]);
    }

    public function reindexSearch(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound();
        }
        if (! $this->search->isIndexed($list)) {
            return new WP_Error(
                'imcrm_search_disabled',
                __('La búsqueda avanzada está desactivada para esta lista.', 'imagina-crm'),
                ['status' => 400],
            );
        }
        $this->search->scheduleReindex($list->id);
        return new WP_REST_Response(['data' => ['reindex_scheduled' => true]]);
    }

    public function suggestIndexes(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound();
        }
        return new WP_REST_Response(['data' => $this->suggester->suggestForList($list->id)]);
    }

    public function applyIndex(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound();
        }
        $columns = $request->get_param('columns');
        $name    = (string) $request->get_param('index_name');
        if (! is_array($columns) || $columns === [] || $name === '') {
            return new WP_Error(
                'imcrm_bad_request',
                __('Faltan parámetros: columns[] e index_name.', 'imagina-crm'),
                ['status' => 400],
            );
        }
        $cols = array_values(array_filter(
            array_map(static fn ($c): string => is_string($c) ? $c : '', $columns),
            static fn (string $c): bool => $c !== '',
        ));
        $ok = $this->suggester->applySuggestion($list->id, $cols, $name);
        if (! $ok) {
            return new WP_Error(
                'imcrm_apply_failed',
                __('No se pudo crear el índice.', 'imagina-crm'),
                ['status' => 500],
            );
        }
        return new WP_REST_Response(['data' => ['applied' => true, 'index_name' => $name]]);
    }

    public function dropIndex(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound();
        }
        $name = (string) $request->get_param('index_name');
        if ($name === '') {
            return new WP_Error('imcrm_bad_request', __('Falta index_name.', 'imagina-crm'), ['status' => 400]);
        }
        $ok = $this->suggester->dropIndex($list->id, $name);
        return new WP_REST_Response(['data' => ['dropped' => $ok]]);
    }

    public function runPurge(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        unset($request);
        $deleted = $this->purge->run();
        return new WP_REST_Response(['data' => ['rows_deleted' => $deleted]]);
    }
}
