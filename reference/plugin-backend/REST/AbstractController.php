<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Plugin;
use ImaginaCRM\Support\ValidationResult;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;

/**
 * Base para todos los controllers REST del plugin.
 *
 * Establece el namespace `imagina-crm/v1`, helpers de capability check y
 * conversión `ValidationResult` → `WP_Error` con shape consistente
 * `{code, message, data: {status, errors?}}` (CLAUDE.md §9).
 *
 * Helpers de permisos (Fase 7 — 1.C):
 *   - `checkAdminPermissions`: cap base `imcrm_access_admin` — solo
 *     verifica que el user puede ENTRAR al SPA. Endpoints granulares
 *     deben usar callbacks específicos (más abajo).
 *   - `requireCapability(string $cap)`: cierra un callback granular
 *     que exige una cap específica. Devuelve un Closure que se pasa
 *     directo como `permission_callback`.
 *   - `requireAnyCapability(string ...$caps)`: idem pero satisface
 *     con cualquiera de las caps recibidas (OR).
 */
abstract class AbstractController extends WP_REST_Controller
{
    public const NAMESPACE = 'imagina-crm/v1';

    public function __construct()
    {
        $this->namespace = self::NAMESPACE;
    }

    /**
     * Permission callback base: el user puede acceder al admin SPA.
     * NO implica que puede operar — endpoints granulares deben usar
     * `requireCapability`/`requireAnyCapability` para chequear caps
     * específicas (manage_lists, view_records, etc.).
     *
     * @return bool|WP_Error
     */
    public function checkAdminPermissions(WP_REST_Request $request): bool|WP_Error
    {
        unset($request);

        if (! current_user_can(Plugin::ADMIN_CAPABILITY)) {
            return new WP_Error(
                'imcrm_forbidden',
                __('No tienes permiso para realizar esta acción.', 'imagina-crm'),
                ['status' => rest_authorization_required_code()]
            );
        }

        return true;
    }

    /**
     * Construye un `permission_callback` que exige una cap específica.
     *
     * Uso típico:
     * ```
     * 'permission_callback' => $this->requireCapability(
     *     CapabilityRegistry::CAP_MANAGE_LISTS
     * ),
     * ```
     *
     * @return \Closure(WP_REST_Request): (bool|WP_Error)
     */
    protected function requireCapability(string $cap): \Closure
    {
        return function (WP_REST_Request $request) use ($cap): bool|WP_Error {
            unset($request);
            if (! current_user_can($cap)) {
                return $this->forbidden();
            }
            return true;
        };
    }

    /**
     * Construye un `permission_callback` que exige al menos UNA de las
     * caps recibidas. Útil cuando varias caps habilitan el mismo
     * endpoint (ej. `view_records` o `view_own_records` → ambas
     * permiten GET /records, el scope se decide después en el service).
     *
     * @return \Closure(WP_REST_Request): (bool|WP_Error)
     */
    protected function requireAnyCapability(string ...$caps): \Closure
    {
        return function (WP_REST_Request $request) use ($caps): bool|WP_Error {
            unset($request);
            foreach ($caps as $cap) {
                if (current_user_can($cap)) {
                    return true;
                }
            }
            return $this->forbidden();
        };
    }

    protected function forbidden(string $message = ''): WP_Error
    {
        return new WP_Error(
            'imcrm_forbidden',
            $message !== '' ? $message : __('No tienes permiso para realizar esta acción.', 'imagina-crm'),
            ['status' => rest_authorization_required_code()]
        );
    }

    protected function validationError(ValidationResult $validation, int $status = 422): WP_Error
    {
        return new WP_Error(
            'imcrm_validation_failed',
            $validation->firstError() ?? __('Validación fallida.', 'imagina-crm'),
            [
                'status' => $status,
                'errors' => $validation->errors(),
            ]
        );
    }

    protected function notFound(string $message = ''): WP_Error
    {
        return new WP_Error(
            'imcrm_not_found',
            $message !== '' ? $message : __('Recurso no encontrado.', 'imagina-crm'),
            ['status' => 404]
        );
    }

    protected function conflict(string $message): WP_Error
    {
        return new WP_Error('imcrm_conflict', $message, ['status' => 409]);
    }
}
