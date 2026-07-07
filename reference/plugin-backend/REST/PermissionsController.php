<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Permissions\CustomRoleService;
use ImaginaCRM\Permissions\ListPermissions;
use ImaginaCRM\Permissions\RoleInstaller;
use ImaginaCRM\Support\ValidationResult;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * Endpoints para gestionar el ACL por lista (Fase 7 — iteración 1.B).
 *
 *  - `GET /imagina-crm/v1/lists/{id_or_slug}/permissions` →
 *      shape `{permissions: {...}, assignment_field_id: int|null,
 *      roles: [{slug, label}]}`.
 *      Útil para el List Builder: precarga la matriz `rol × operación`.
 *
 *  - `PATCH /imagina-crm/v1/lists/{id_or_slug}/permissions` →
 *      reemplaza el shape `settings.permissions` + `settings.assignment_field_id`.
 *      Sólo toca esas dos claves: el resto de `settings` queda intacto.
 *
 *  - `GET /imagina-crm/v1/roles` →
 *      catálogo de los 5 roles del plugin + sus caps default.
 *      El List Builder lo usa para listar columnas en la matriz.
 *
 * Cap requerida: `imcrm_manage_lists` (sólo admins gestionan ACL).
 */
final class PermissionsController extends AbstractController
{
    private const VALID_OPS = ['view', 'edit', 'delete'];

    public function __construct(
        private readonly ListService $lists,
        private readonly CustomRoleService $customRoles,
        private readonly RoleInstaller $roleInstaller,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        register_rest_route($this->namespace, '/lists/(?P<id_or_slug>[a-zA-Z0-9_-]+)/permissions', [
            'args' => [
                'id_or_slug' => [
                    'type'        => 'string',
                    'description' => 'ID numérico o slug actual de la lista.',
                ],
            ],
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getItem'],
                'permission_callback' => [$this, 'checkManageListsPermission'],
            ],
            [
                'methods'             => WP_REST_Server::EDITABLE,
                'callback'            => [$this, 'updateItem'],
                'permission_callback' => [$this, 'checkManageListsPermission'],
                'args'                => [
                    'permissions' => [
                        'type'        => 'object',
                        'required'    => false,
                        'description' => 'Shape rol → {view, create, edit, delete, fields_hidden}.',
                    ],
                    'assignment_field_id' => [
                        'type'        => ['integer', 'null'],
                        'required'    => false,
                        'description' => 'ID del field (tipo user) usado para resolver scope=assigned. Null para limpiar.',
                    ],
                ],
            ],
        ]);

        register_rest_route($this->namespace, '/roles', [
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'listRoles'],
                'permission_callback' => [$this, 'checkAdminPermissions'],
            ],
            [
                // POST crea un rol custom nuevo o actualiza uno
                // existente con el mismo slug. Cap: manage_lists.
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => [$this, 'saveCustomRole'],
                'permission_callback' => [$this, 'checkManageListsPermission'],
                'args'                => [
                    'slug'         => ['type' => 'string', 'required' => true],
                    'label'        => ['type' => 'string', 'required' => true],
                    'capabilities' => ['type' => 'array', 'required' => true],
                ],
            ],
        ]);

        register_rest_route($this->namespace, '/roles/(?P<slug>[a-z0-9_]+)', [
            'methods'             => WP_REST_Server::DELETABLE,
            'callback'            => [$this, 'deleteCustomRole'],
            'permission_callback' => [$this, 'checkManageListsPermission'],
        ]);
    }

    /**
     * Permission callback específico: requiere `imcrm_manage_lists`. El base
     * `checkAdminPermissions` sólo exige `imcrm_access_admin`, que es más
     * laxo (managers/agentes lo tienen).
     */
    public function checkManageListsPermission(WP_REST_Request $request): bool|WP_Error
    {
        unset($request);

        if (! current_user_can(CapabilityRegistry::CAP_MANAGE_LISTS)) {
            return new WP_Error(
                'imcrm_forbidden',
                __('No tienes permiso para gestionar permisos de listas.', 'imagina-crm'),
                ['status' => rest_authorization_required_code()]
            );
        }
        return true;
    }

    public function getItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('id_or_slug'));
        if ($list === null) {
            return $this->notFound();
        }

        $acl = ListPermissions::fromListSettings($list->settings);

        return new WP_REST_Response([
            'data' => [
                'list_id'             => $list->id,
                'permissions'         => $this->expandForUi($acl),
                'assignment_field_id' => $acl->assignmentFieldId,
                'roles'               => $this->rolesShape(),
            ],
        ]);
    }

    public function updateItem(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('id_or_slug'));
        if ($list === null) {
            return $this->notFound();
        }

        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }

        /** @var array<string, string> $errors */
        $errors = [];

        // Permissions shape.
        $rawPerms = $params['permissions'] ?? null;
        $cleanPerms = null;
        if ($rawPerms !== null) {
            if (! is_array($rawPerms)) {
                $errors['permissions'] = __('Debe ser un objeto.', 'imagina-crm');
            } else {
                $cleanPerms = $this->validatePermissionsShape($rawPerms, $errors);
            }
        }

        // assignment_field_id.
        $hasAssignmentKey = array_key_exists('assignment_field_id', $params);
        $assignmentFieldId = null;
        if ($hasAssignmentKey && $params['assignment_field_id'] !== null) {
            $val = $params['assignment_field_id'];
            if (! is_numeric($val) || (int) $val <= 0) {
                $errors['assignment_field_id'] = __('Debe ser un ID positivo o null.', 'imagina-crm');
            } else {
                $assignmentFieldId = (int) $val;
            }
        }

        if ($errors !== []) {
            return $this->validationError(ValidationResult::fail($errors));
        }

        // Mergeamos el sub-shape en el settings existente sin tocar otras claves.
        $settings = $list->settings;
        if ($cleanPerms !== null) {
            $settings['permissions'] = $cleanPerms;
        }
        if ($hasAssignmentKey) {
            if ($assignmentFieldId === null) {
                unset($settings['assignment_field_id']);
            } else {
                $settings['assignment_field_id'] = $assignmentFieldId;
            }
        }

        $result = $this->lists->update($list->id, ['settings' => $settings]);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }

        $acl = ListPermissions::fromListSettings($result->settings);

        return new WP_REST_Response([
            'data' => [
                'list_id'             => $result->id,
                'permissions'         => $this->expandForUi($acl),
                'assignment_field_id' => $acl->assignmentFieldId,
            ],
        ]);
    }

    public function listRoles(WP_REST_Request $request): WP_REST_Response
    {
        unset($request);
        // El api.ts wrapper expone solo `envelope.data` al cliente.
        // Por eso anidamos todo dentro de `data` — sino el front no
        // ve `custom_roles` ni `capabilities`.
        return new WP_REST_Response([
            'data' => [
                'roles'        => $this->rolesShape(),
                'custom_roles' => $this->customRoles->all(),
                'capabilities' => CapabilityRegistry::allCapabilities(),
            ],
        ]);
    }

    /**
     * POST /imagina-crm/v1/roles
     *
     * Crea o actualiza un rol personalizado (Fase 10). Después de
     * persistir, llama a `RoleInstaller::sync()` para que el rol
     * exista en wp_roles inmediatamente.
     */
    public function saveCustomRole(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }
        $slug = isset($params['slug']) && is_string($params['slug']) ? $params['slug'] : '';
        $label = isset($params['label']) && is_string($params['label']) ? $params['label'] : '';
        $caps = isset($params['capabilities']) && is_array($params['capabilities'])
            ? $params['capabilities']
            : [];

        $result = $this->customRoles->save($slug, $label, $caps);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }

        // Resync: hace add_role/update inmediato para que el rol esté
        // listo para asignarse a users desde wp-admin → Users.
        $this->roleInstaller->sync();

        return new WP_REST_Response([
            'data' => $this->customRoles->all(),
        ]);
    }

    /**
     * DELETE /imagina-crm/v1/roles/{slug}
     *
     * Borra un rol custom. Resync remueve el WP role del registry.
     * Los users que tenían ese rol pierden las caps pero NO se
     * desactivan — el admin los gestiona manualmente.
     */
    public function deleteCustomRole(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $slug = (string) $request->get_param('slug');
        $result = $this->customRoles->delete($slug);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }
        $this->roleInstaller->sync();
        return new WP_REST_Response(['data' => $this->customRoles->all()]);
    }

    /**
     * Devuelve el shape de permissions con TODOS los roles del plugin
     * (excepto `crm_admin` y `crm_client`) presentes, llenando defaults
     * cuando un rol no aparece en `byRole`. El UI siempre ve la matriz
     * completa.
     *
     * @return array<string, array{view: string, create: bool, edit: string, delete: string, fields_hidden: list<string>}>
     */
    private function expandForUi(ListPermissions $acl): array
    {
        $roles = [
            CapabilityRegistry::ROLE_MANAGER,
            CapabilityRegistry::ROLE_AGENT,
            CapabilityRegistry::ROLE_VIEWER,
        ];
        $out = [];
        foreach ($roles as $role) {
            $out[$role] = $acl->forRole($role);
        }
        return $out;
    }

    /**
     * @return list<array{slug: string, label: string, can_configure: bool}>
     */
    private function rolesShape(): array
    {
        $labels = CapabilityRegistry::roles();
        $out = [];
        foreach ($labels as $slug => $label) {
            // `crm_admin` y `crm_client` no aparecen en la matriz UI:
            //  - admin tiene bypass total (no se restringe por lista).
            //  - client solo va al portal (Fase 9), no a listas del admin.
            $configurable = ! in_array($slug, [
                CapabilityRegistry::ROLE_ADMIN,
                CapabilityRegistry::ROLE_CLIENT,
            ], true);
            $out[] = [
                'slug'          => $slug,
                'label'         => $label,
                'can_configure' => $configurable,
            ];
        }
        return $out;
    }

    /**
     * Valida y normaliza el shape recibido. Cada entrada inválida agrega
     * un error con path `permissions.{role}.{field}`. Si todo es válido,
     * retorna el shape limpio listo para persistir.
     *
     * @param array<string, mixed>  $input
     * @param array<string, string> $errors  By-ref accumulator.
     * @return array<string, array{view: string, create: bool, edit: string, delete: string, fields_hidden: list<string>}>|null
     */
    private function validatePermissionsShape(array $input, array &$errors): ?array
    {
        $validRoles = array_keys(CapabilityRegistry::roles());
        // Por consistencia con `expandForUi`: solo configuramos los 3
        // roles "configurables". `crm_admin` y `crm_client` se ignoran
        // silenciosamente si vienen — su comportamiento es fijo.
        $configurable = [
            CapabilityRegistry::ROLE_MANAGER,
            CapabilityRegistry::ROLE_AGENT,
            CapabilityRegistry::ROLE_VIEWER,
        ];

        $out = [];
        foreach ($input as $roleSlug => $cfg) {
            if (! is_string($roleSlug) || ! in_array($roleSlug, $validRoles, true)) {
                $errors['permissions'] = sprintf(
                    /* translators: %s: role slug */
                    __('Rol desconocido: %s', 'imagina-crm'),
                    is_string($roleSlug) ? $roleSlug : '(no-string)'
                );
                continue;
            }
            if (! in_array($roleSlug, $configurable, true)) {
                continue; // ignora crm_admin/crm_client silenciosamente
            }
            if (! is_array($cfg)) {
                $errors["permissions.{$roleSlug}"] = __('Debe ser un objeto.', 'imagina-crm');
                continue;
            }
            $entry = [
                'view'          => ListPermissions::SCOPE_NONE,
                'create'        => false,
                'edit'          => ListPermissions::SCOPE_NONE,
                'delete'        => ListPermissions::SCOPE_NONE,
                'fields_hidden' => [],
            ];

            foreach (self::VALID_OPS as $op) {
                $val = $cfg[$op] ?? null;
                if ($val !== null && ListPermissions::normalizeScope($val) !== $val) {
                    // El usuario envió un valor que normalizeScope() degrada
                    // a `none` por no reconocerlo — explícito mejor que silencioso.
                    if (! in_array($val, [
                        ListPermissions::SCOPE_ALL,
                        ListPermissions::SCOPE_OWN,
                        ListPermissions::SCOPE_ASSIGNED,
                        ListPermissions::SCOPE_NONE,
                    ], true)) {
                        $errors["permissions.{$roleSlug}.{$op}"] = __('Scope inválido. Valores válidos: all, own, assigned, none.', 'imagina-crm');
                        continue;
                    }
                }
                $entry[$op] = ListPermissions::normalizeScope($val ?? ListPermissions::SCOPE_NONE);
            }

            if (array_key_exists('create', $cfg)) {
                $entry['create'] = (bool) $cfg['create'];
            } else {
                $entry['create'] = false;
            }

            if (array_key_exists('fields_hidden', $cfg)) {
                $hidden = $cfg['fields_hidden'];
                if (! is_array($hidden)) {
                    $errors["permissions.{$roleSlug}.fields_hidden"] = __('Debe ser un array de slugs.', 'imagina-crm');
                } else {
                    $clean = [];
                    foreach ($hidden as $h) {
                        if (is_string($h) && $h !== '') {
                            $clean[] = $h;
                        }
                    }
                    $entry['fields_hidden'] = array_values(array_unique($clean));
                }
            }

            $out[$roleSlug] = $entry;
        }

        return $errors === [] ? $out : null;
    }
}
