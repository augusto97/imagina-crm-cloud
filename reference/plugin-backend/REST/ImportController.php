<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Imports\ImportService;
use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Permissions\CapabilityRegistry;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * REST controller para `/imagina-crm/v1/lists/{list}/import`.
 *
 * Dos endpoints (preview + run) — el cliente sube el CSV inline en
 * `body.csv`, no como `multipart/form-data` (más simple para parsear
 * desde `wp_unslash` y suficiente para CSVs típicos < 5 MB). Si en
 * algún momento aceptamos archivos enormes, conviene migrar a
 * `multipart` con upload en chunks.
 */
final class ImportController extends AbstractController
{
    public function __construct(
        private readonly ImportService $imports,
        private readonly ListService $lists,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        $base = 'lists/(?P<list>[a-zA-Z0-9_-]+)/import';

        register_rest_route($this->namespace, '/' . $base . '/preview', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'preview'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_IMPORT_RECORDS),
            'args'                => [
                'csv' => ['type' => 'string', 'required' => true],
            ],
        ]);

        register_rest_route($this->namespace, '/' . $base . '/run', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'run'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_IMPORT_RECORDS),
            'args'                => [
                'csv'        => ['type' => 'string', 'required' => true],
                'mapping'    => ['required' => true],
                'new_fields' => ['required' => false],
            ],
        ]);
    }

    public function preview(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $csv = (string) $request->get_param('csv');
        if ($csv === '') {
            return new WP_Error('imcrm_empty_csv', __('El CSV está vacío.', 'imagina-crm'), ['status' => 400]);
        }
        // Envoltorio `{data: ...}` — los demás controllers ya lo usan
        // y `app/lib/api.ts` extrae `payload.data` antes de devolver
        // la respuesta. Sin esto el frontend recibe `undefined`.
        return new WP_REST_Response(['data' => $this->imports->preview($list, $csv)]);
    }

    public function run(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('list'));
        if ($list === null) {
            return $this->notFound(__('Lista no encontrada.', 'imagina-crm'));
        }
        $csv = (string) $request->get_param('csv');
        if ($csv === '') {
            return new WP_Error('imcrm_empty_csv', __('El CSV está vacío.', 'imagina-crm'), ['status' => 400]);
        }

        $rawMapping = $request->get_param('mapping');
        if (! is_array($rawMapping)) {
            return new WP_Error(
                'imcrm_invalid_mapping',
                __('El mapping debe ser un objeto { column_index: field_slug }.', 'imagina-crm'),
                ['status' => 400],
            );
        }

        // El mapping llega como `{"0": "name", "1": "email", ...}` —
        // convertimos las keys a int.
        $mapping = [];
        foreach ($rawMapping as $colIdx => $slug) {
            if (! is_string($slug) || $slug === '') {
                continue;
            }
            $mapping[(int) $colIdx] = $slug;
        }

        // `new_fields` es opcional: array de objetos
        // `{csv_column_index, label, type}` con los campos que el
        // user pidió crear sobre la marcha. Sanitizamos cada item
        // — el Service hace la creación real vía FieldService.
        $rawNewFields = $request->get_param('new_fields');
        $newFields    = [];
        if (is_array($rawNewFields)) {
            foreach ($rawNewFields as $spec) {
                if (! is_array($spec)) {
                    continue;
                }
                $newFields[] = [
                    'csv_column_index' => (int) ($spec['csv_column_index'] ?? -1),
                    'label'            => isset($spec['label']) ? (string) $spec['label'] : '',
                    'type'             => isset($spec['type']) ? (string) $spec['type'] : 'text',
                ];
            }
        }

        return new WP_REST_Response(['data' => $this->imports->run($list, $csv, $mapping, $newFields)]);
    }
}
