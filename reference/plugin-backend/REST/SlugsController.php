<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Lists\SlugManager;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Support\SlugContext;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * REST endpoints alrededor de slugs:
 *
 * - `GET /slugs/check?type=list|field&slug=...&list_id=...` → disponibilidad.
 * - `GET /slugs/history?type=list|field&entity_id=...` → historial completo.
 *
 * Estos endpoints alimentan al `<SlugEditor>` del frontend (validación
 * inline debounced) y al modal "Ver historial de slugs".
 */
final class SlugsController extends AbstractController
{
    protected $rest_base = 'slugs';

    public function __construct(private readonly SlugManager $slugs)
    {
        parent::__construct();
    }

    public function register_routes(): void
    {
        register_rest_route($this->namespace, '/' . $this->rest_base . '/check', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'check'],
            'permission_callback' => $this->requireAnyCapability(
                CapabilityRegistry::CAP_MANAGE_LISTS,
                CapabilityRegistry::CAP_MANAGE_FIELDS,
            ),
            'args'                => [
                'type'    => ['type' => 'string', 'required' => true, 'enum' => ['list', 'field']],
                'slug'    => ['type' => 'string', 'required' => true],
                'list_id' => ['type' => 'integer'],
            ],
        ]);

        register_rest_route($this->namespace, '/' . $this->rest_base . '/history', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'history'],
            'permission_callback' => $this->requireAnyCapability(
                CapabilityRegistry::CAP_MANAGE_LISTS,
                CapabilityRegistry::CAP_MANAGE_FIELDS,
            ),
            'args'                => [
                'type'      => ['type' => 'string', 'required' => true, 'enum' => ['list', 'field']],
                'entity_id' => ['type' => 'integer', 'required' => true],
            ],
        ]);
    }

    public function check(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $context = $this->resolveContext((string) $request->get_param('type'));
        if ($context === null) {
            return new WP_Error('imcrm_bad_type', __('type debe ser list o field.', 'imagina-crm'), ['status' => 400]);
        }

        $slug   = strtolower((string) $request->get_param('slug'));
        $listId = $request->get_param('list_id') !== null ? (int) $request->get_param('list_id') : null;

        $validation = $this->slugs->validate($slug, $context, $listId);

        return new WP_REST_Response([
            'data' => [
                'slug'      => $slug,
                'available' => $validation->isValid(),
                'errors'    => $validation->errors(),
            ],
        ]);
    }

    public function history(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $context = $this->resolveContext((string) $request->get_param('type'));
        if ($context === null) {
            return new WP_Error('imcrm_bad_type', __('type debe ser list o field.', 'imagina-crm'), ['status' => 400]);
        }

        $entityId = (int) $request->get_param('entity_id');
        if ($entityId <= 0) {
            return new WP_Error('imcrm_bad_id', __('entity_id inválido.', 'imagina-crm'), ['status' => 400]);
        }

        return new WP_REST_Response([
            'data' => $this->slugs->getHistory($context, $entityId),
        ]);
    }

    private function resolveContext(string $type): ?SlugContext
    {
        return match ($type) {
            'list'  => SlugContext::List_,
            'field' => SlugContext::Field,
            default => null,
        };
    }
}
