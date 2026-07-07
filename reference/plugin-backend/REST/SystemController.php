<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Activity\ActivityEntity;
use ImaginaCRM\Activity\ActivityLogger;
use ImaginaCRM\Activity\ActivityRepository;
use ImaginaCRM\Automations\ActionRegistry;
use ImaginaCRM\Automations\TriggerRegistry;
use ImaginaCRM\Fields\FieldTypeRegistry;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Plugin;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * Endpoints utilitarios: `/me`, `/field-types`, `/triggers` y `/actions`.
 *
 * Estos cuatro endpoints son catálogos de solo lectura que el frontend
 * consume para construir UI dinámica (selectores de tipo, builder de
 * automatizaciones, etc.). Se sirven desde los registries reales.
 */
final class SystemController extends AbstractController
{
    public function __construct(
        private readonly FieldTypeRegistry $fieldTypes,
        private readonly TriggerRegistry $triggers,
        private readonly ActionRegistry $actions,
        private readonly ActivityRepository $activity,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        register_rest_route($this->namespace, '/me', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'me'],
            'permission_callback' => [$this, 'checkAdminPermissions'],
        ]);

        register_rest_route($this->namespace, '/field-types', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'fieldTypes'],
            'permission_callback' => [$this, 'checkAdminPermissions'],
        ]);

        register_rest_route($this->namespace, '/triggers', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'triggerTypes'],
            'permission_callback' => [$this, 'checkAdminPermissions'],
        ]);

        register_rest_route($this->namespace, '/actions', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'actionTypes'],
            'permission_callback' => [$this, 'checkAdminPermissions'],
        ]);

        register_rest_route($this->namespace, '/me/mentions', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'myMentions'],
            'permission_callback' => [$this, 'checkAdminPermissions'],
            'args'                => [
                'limit'  => ['type' => 'integer', 'default' => 50],
                'offset' => ['type' => 'integer', 'default' => 0],
            ],
        ]);

        register_rest_route($this->namespace, '/me/users-search', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'usersSearch'],
            'permission_callback' => [$this, 'checkAdminPermissions'],
            'args'                => [
                'q'     => ['type' => 'string', 'default' => ''],
                'limit' => ['type' => 'integer', 'default' => 8],
            ],
        ]);

        // Lookup de un user específico por ID — usado por UserPicker
        // para mostrar el chip del valor actual (display_name + avatar)
        // sin tener que hacer un search por nombre. Devuelve el mismo
        // shape que `/me/users-search` + `avatar_url`.
        register_rest_route($this->namespace, '/me/users/(?P<id>\d+)', [
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => [$this, 'userLookup'],
            'permission_callback' => [$this, 'checkAdminPermissions'],
        ]);

        // Firma de email per-usuario. Se inserta en el body del email
        // automatizado vía el merge tag `{{signature}}` y vía el botón
        // "+ Agregar firma" del editor.
        register_rest_route($this->namespace, '/me/email-signature', [
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getEmailSignature'],
                'permission_callback' => [$this, 'checkAdminPermissions'],
            ],
            [
                'methods'             => WP_REST_Server::EDITABLE,
                'callback'            => [$this, 'updateEmailSignature'],
                'permission_callback' => [$this, 'checkAdminPermissions'],
            ],
        ]);
    }

    public function getEmailSignature(WP_REST_Request $request): WP_REST_Response
    {
        unset($request);
        $sig = get_user_meta(get_current_user_id(), 'imcrm_email_signature', true);
        return new WP_REST_Response([
            'data' => ['signature' => is_string($sig) ? $sig : ''],
        ]);
    }

    public function updateEmailSignature(WP_REST_Request $request): WP_REST_Response
    {
        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }
        $sig = isset($params['signature']) ? (string) $params['signature'] : '';
        // Limitamos a algo razonable para evitar abusos. Una firma de
        // 8KB cubre cualquier caso real (incluyendo HTML enriquecido).
        if (strlen($sig) > 8192) {
            $sig = substr($sig, 0, 8192);
        }
        // Sanitización: permitimos HTML básico (kses_post) — los emails
        // se envían con merge tag aplicado, así que el filtro garantiza
        // que el cliente del email reciba HTML seguro.
        $sig = $sig === '' ? '' : (string) wp_kses_post($sig);
        update_user_meta(get_current_user_id(), 'imcrm_email_signature', $sig);
        return new WP_REST_Response([
            'data' => ['signature' => $sig],
        ]);
    }

    public function me(WP_REST_Request $request): WP_REST_Response
    {
        unset($request);
        $user = wp_get_current_user();

        return new WP_REST_Response([
            'data' => [
                'id'           => $user->ID,
                'display_name' => $user->display_name,
                'email'        => $user->user_email,
                'locale'       => get_user_locale($user),
                'roles'        => array_values($user->roles),
                'capabilities' => array_merge(
                    [
                        // Back-compat con clientes del endpoint que aún
                        // miran `manage_options`.
                        'manage_options' => current_user_can('manage_options'),
                    ],
                    CapabilityRegistry::currentUserCapabilitiesMap(),
                ),
            ],
        ]);
    }

    public function fieldTypes(WP_REST_Request $request): WP_REST_Response
    {
        unset($request);
        return new WP_REST_Response(['data' => $this->fieldTypes->toArray()]);
    }

    public function triggerTypes(WP_REST_Request $request): WP_REST_Response
    {
        unset($request);
        return new WP_REST_Response(['data' => $this->triggers->toArray()]);
    }

    public function actionTypes(WP_REST_Request $request): WP_REST_Response
    {
        unset($request);
        return new WP_REST_Response(['data' => $this->actions->toArray()]);
    }

    public function myMentions(WP_REST_Request $request): WP_REST_Response
    {
        $limit  = max(1, min(200, (int) ($request->get_param('limit') ?? 50)));
        $offset = max(0, (int) ($request->get_param('offset') ?? 0));

        $items = array_map(
            static fn (ActivityEntity $a): array => $a->toArray(),
            $this->activity->recentForUser(
                get_current_user_id(),
                ActivityLogger::ACTION_MENTION_RECEIVED,
                $limit,
                $offset,
            ),
        );
        return new WP_REST_Response(['data' => $items]);
    }

    /**
     * Búsqueda de usuarios para alimentar el autocomplete de menciones.
     * Match por user_login (prefix) y display_name (contains). Sin
     * exponer email ni roles — solo {id, login, display_name}.
     */
    public function usersSearch(WP_REST_Request $request): WP_REST_Response
    {
        $q     = trim((string) $request->get_param('q'));
        $limit = max(1, min(20, (int) ($request->get_param('limit') ?? 8)));

        if ($q === '') {
            return new WP_REST_Response(['data' => []]);
        }

        $query = new \WP_User_Query([
            'search'         => '*' . esc_attr($q) . '*',
            'search_columns' => ['user_login', 'display_name', 'user_nicename'],
            'number'         => $limit,
            'fields'         => ['ID', 'user_login', 'display_name'],
            'orderby'        => 'display_name',
            'order'          => 'ASC',
        ]);

        $rows = $query->get_results();
        $data = [];
        foreach ($rows as $row) {
            // Soporta tanto objects (default) como arrays según la
            // versión/configuración de WP. Defensivo.
            $id = is_object($row)
                ? (int) ($row->ID ?? 0)
                : (int) ($row['ID'] ?? 0);
            $login = is_object($row)
                ? (string) ($row->user_login ?? '')
                : (string) ($row['user_login'] ?? '');
            $displayName = is_object($row)
                ? (string) ($row->display_name ?? '')
                : (string) ($row['display_name'] ?? '');

            if ($id <= 0) continue;

            $data[] = [
                'id'           => $id,
                'login'        => $login,
                'display_name' => $displayName,
                'avatar_url'   => get_avatar_url($id, ['size' => 48]) ?: '',
            ];
        }
        return new WP_REST_Response(['data' => $data]);
    }

    /**
     * Lookup de un user por ID. Devuelve el shape mínimo que el
     * `UserPicker` necesita para mostrar el chip del valor actual.
     * Si el user no existe (borrado), devuelve 404.
     */
    public function userLookup(WP_REST_Request $request): WP_REST_Response
    {
        $id = (int) $request->get_param('id');
        if ($id <= 0) {
            return new WP_REST_Response(['code' => 'not_found'], 404);
        }
        $user = get_userdata($id);
        if (! $user) {
            return new WP_REST_Response(['code' => 'not_found'], 404);
        }
        return new WP_REST_Response([
            'data' => [
                'id'           => (int) $user->ID,
                'login'        => (string) $user->user_login,
                'display_name' => (string) $user->display_name,
                'avatar_url'   => get_avatar_url($user->ID, ['size' => 48]) ?: '',
            ],
        ]);
    }
}
