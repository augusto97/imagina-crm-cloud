<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Licensing\LicenseManager;
use ImaginaCRM\Licensing\UpdaterClient;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Support\ValidationResult;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * REST endpoints para gestionar la licencia (CLAUDE.md §14).
 *
 *     GET    /license
 *     POST   /license/activate    { key: "..." }
 *     POST   /license/deactivate
 *     POST   /license/refresh     -- revalida y limpia cache de updates
 *
 * La clave se enmascara en todas las respuestas (`••••...••••`).
 */
final class LicenseController extends AbstractController
{
    public function __construct(
        private readonly LicenseManager $manager,
        private readonly UpdaterClient $updater,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        register_rest_route($this->namespace, '/license', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'getState'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
        ]);

        register_rest_route($this->namespace, '/license/activate', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'activate'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
            'args'                => [
                'key' => ['type' => 'string', 'required' => true],
            ],
        ]);

        register_rest_route($this->namespace, '/license/deactivate', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'deactivate'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
        ]);

        register_rest_route($this->namespace, '/license/refresh', [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'refresh'],
            'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
        ]);
    }

    public function getState(WP_REST_Request $request): WP_REST_Response
    {
        unset($request);
        return new WP_REST_Response(['data' => $this->manager->getState()->toPublicArray()]);
    }

    public function activate(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }
        $key = isset($params['key']) ? (string) $params['key'] : '';

        $result = $this->manager->activate($key);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }

        // Tras un cambio de licencia, refrescamos la caché de updates.
        $this->updater->flushCache();
        return new WP_REST_Response(['data' => $result->toPublicArray()]);
    }

    public function deactivate(WP_REST_Request $request): WP_REST_Response
    {
        unset($request);
        $state = $this->manager->deactivate();
        $this->updater->flushCache();
        return new WP_REST_Response(['data' => $state->toPublicArray()]);
    }

    public function refresh(WP_REST_Request $request): WP_REST_Response
    {
        unset($request);
        $state = $this->manager->refresh();
        $this->updater->flushCache();
        return new WP_REST_Response(['data' => $state->toPublicArray()]);
    }
}
