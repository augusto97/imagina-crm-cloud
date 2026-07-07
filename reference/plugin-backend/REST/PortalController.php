<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Activity\ActivityEntity;
use ImaginaCRM\Activity\ActivityRepository;
use ImaginaCRM\Comments\CommentService;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Portal\ClientResolverInterface;
use ImaginaCRM\Portal\MagicLinkService;
use ImaginaCRM\Portal\PortalAccountManager;
use ImaginaCRM\Portal\PortalScopeService;
use ImaginaCRM\Portal\PortalTemplate;
use ImaginaCRM\Records\RecordAggregator;
use ImaginaCRM\Records\RecordService;
use ImaginaCRM\Support\ValidationResult;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * REST controllers del portal del cliente (Fase 9 — 3.B).
 *
 * Endpoints (todos requieren cap `imcrm_access_portal` — `crm_client`
 * la tiene por default desde Fase 7):
 *
 *   GET /imagina-crm/v1/portal/me
 *       Devuelve el record del cliente actual + metadata del portal
 *       (template_id por configurar, etc.). 404 si el user no tiene
 *       record asociado en la lista de portal.
 *
 *   GET /imagina-crm/v1/portal/lists/{slug}/records
 *       Records de una lista visibles para el cliente. El scope SQL
 *       de PortalScopeService se inyecta automáticamente — el cliente
 *       NO puede ver records ajenos aunque la lista sea conocida.
 *
 *   GET /imagina-crm/v1/portal/lists/{slug}/records/{id}
 *       Detalle de un record. 404 si no está en el scope del cliente.
 *
 * Esta superficie es la que la SPA del portal (`app/portal.tsx`,
 * llega en Fase 9 — 3.F) consume. NO usa los endpoints del admin
 * (`/v1/lists/.../records`) porque esos exigen capabilities que el
 * cliente no tiene.
 */
final class PortalController extends AbstractController
{
    public function __construct(
        private readonly ClientResolverInterface $resolver,
        private readonly PortalScopeService $scope,
        private readonly ListService $lists,
        private readonly RecordService $records,
        private readonly FieldRepository $fields,
        private readonly PortalAccountManager $accounts,
        private readonly RecordAggregator $aggregator,
        private readonly ActivityRepository $activity,
        private readonly MagicLinkService $magicLinks,
        private readonly CommentService $comments,
        private readonly \ImaginaCRM\Permissions\PermissionService $permissions,
    ) {
        parent::__construct();
    }

    public function register_routes(): void
    {
        $canAccess = $this->requireCapability(CapabilityRegistry::CAP_ACCESS_PORTAL);

        register_rest_route($this->namespace, '/portal/me', [
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getMe'],
                'permission_callback' => $canAccess,
            ],
            [
                'methods'             => WP_REST_Server::EDITABLE,
                'callback'            => [$this, 'updateMe'],
                'permission_callback' => $canAccess,
                'args'                => [
                    'fields' => [
                        'type'        => 'object',
                        'description' => 'Mapa slug → valor. Solo se aceptan slugs declarados en algún bloque editable_form del template.',
                    ],
                ],
            ],
        ]);

        register_rest_route(
            $this->namespace,
            '/portal/lists/(?P<slug>[a-zA-Z0-9_-]+)/records',
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getRecords'],
                'permission_callback' => $canAccess,
                'args'                => [
                    'slug'     => ['type' => 'string'],
                    'page'     => ['type' => 'integer', 'default' => 1],
                    'per_page' => ['type' => 'integer', 'default' => 20],
                    'sort'     => ['type' => 'string'],
                    'search'   => ['type' => 'string'],
                ],
            ],
        );

        register_rest_route(
            $this->namespace,
            '/portal/lists/(?P<slug>[a-zA-Z0-9_-]+)/records/(?P<id>\d+)',
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getRecord'],
                'permission_callback' => $canAccess,
            ],
        );

        // Activity timeline del record del cliente (bloque activity_timeline).
        register_rest_route(
            $this->namespace,
            '/portal/me/activity',
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getMyActivity'],
                'permission_callback' => $canAccess,
                'args'                => [
                    'limit'  => ['type' => 'integer', 'default' => 50],
                    'offset' => ['type' => 'integer', 'default' => 0],
                ],
            ],
        );

        // Comments del record del cliente (bloque comments_thread del
        // portal). El record_id viene del ClientResolver — el cliente
        // NUNCA ve ni puede crear comments sobre otros records.
        // Fase 12.D.
        register_rest_route(
            $this->namespace,
            '/portal/me/comments',
            [
                [
                    'methods'             => WP_REST_Server::READABLE,
                    'callback'            => [$this, 'getMyComments'],
                    'permission_callback' => $canAccess,
                ],
                [
                    'methods'             => WP_REST_Server::CREATABLE,
                    'callback'            => [$this, 'createMyComment'],
                    'permission_callback' => $canAccess,
                    'args'                => [
                        'content' => [
                            'type'        => 'string',
                            'required'    => true,
                            'description' => 'Contenido del comentario.',
                        ],
                    ],
                ],
            ],
        );

        // Aggregates de records relacionados al cliente (Fase 9 — 3.E).
        // Sirve a los bloques kpi_widget del template del portal. El
        // scope SQL del PortalScopeService se inyecta automáticamente
        // — el cliente nunca ve agregados sobre records ajenos.
        register_rest_route(
            $this->namespace,
            '/portal/lists/(?P<slug>[a-zA-Z0-9_-]+)/aggregates',
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getAggregates'],
                'permission_callback' => $canAccess,
                'args'                => [
                    'fields' => ['type' => 'string', 'description' => 'CSV de field IDs a agregar.'],
                ],
            ],
        );

        // Endpoint admin: crear cuenta WP para un cliente desde el CRM
        // (Fase 9 — 3.G). Requiere manage_lists — solo admins crean
        // accesos.
        register_rest_route(
            $this->namespace,
            '/portal/lists/(?P<slug>[a-zA-Z0-9_-]+)/records/(?P<id>\d+)/access',
            [
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => [$this, 'createAccess'],
                'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
                'args'                => [
                    'send_notification' => ['type' => 'boolean', 'default' => true],
                ],
            ],
        );

        // Auto-detect de la página del portal (Fase 12.F). Cap:
        // manage_lists. Busca la primera página publicada con el
        // shortcode [imcrm-client-portal] y devuelve su URL. Permite
        // al frontend ofrecer "Enviar magic link" sin que el admin
        // configure la URL manualmente.
        register_rest_route(
            $this->namespace,
            '/portal/page-url',
            [
                'methods'             => WP_REST_Server::READABLE,
                'callback'            => [$this, 'getPortalPageUrl'],
                'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
            ],
        );

        // Magic link para un cliente (Fase 10 — pulidos). Cap:
        // manage_lists. Genera URL con token one-time + opcionalmente
        // envía email al cliente.
        register_rest_route(
            $this->namespace,
            '/portal/lists/(?P<slug>[a-zA-Z0-9_-]+)/records/(?P<id>\d+)/magic-link',
            [
                'methods'             => WP_REST_Server::CREATABLE,
                'callback'            => [$this, 'createMagicLink'],
                'permission_callback' => $this->requireCapability(CapabilityRegistry::CAP_MANAGE_LISTS),
                'args'                => [
                    'target_url' => [
                        'type'        => 'string',
                        'required'    => true,
                        'description' => 'URL de la página WP con el shortcode [imcrm-client-portal].',
                    ],
                    'send_email' => ['type' => 'boolean', 'default' => true],
                ],
            ],
        );
    }

    /**
     * PATCH /portal/me
     *
     * Permite al cliente actualizar SU PROPIO record. Solo se aceptan
     * slugs declarados en algún bloque `editable_form` del template
     * configurado por el admin. Cualquier slug fuera de la whitelist
     * → 403.
     *
     * Es el endpoint de mutación más sensible del portal — un bug
     * acá significa que un cliente puede tamper con campos que no
     * debería tocar (ej. estado de un trámite que solo el admin
     * cambia).
     */
    public function updateMe(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $user = wp_get_current_user();
        $portalList = $this->resolver->portalList();
        if ($portalList === null) {
            return $this->notFound(__('El portal del cliente no está configurado.', 'imagina-crm'));
        }
        $clientRecord = $this->resolver->clientRecordFor($user);
        if ($clientRecord === null) {
            return $this->notFound();
        }
        $recordId = isset($clientRecord['id']) ? (int) $clientRecord['id'] : 0;
        if ($recordId <= 0) {
            return $this->notFound();
        }

        // Whitelist desde el template configurado (no el default —
        // el default no incluye `editable_form`, así que un cliente
        // sin template explícito no puede editar nada).
        $template = PortalTemplate::fromListSettings($portalList->settings);
        $allowed = array_flip($template->editableFieldSlugs());
        if ($allowed === []) {
            return $this->forbidden(__('Tu portal no permite edición de campos.', 'imagina-crm'));
        }

        $params = $request->get_json_params();
        if (! is_array($params)) {
            $params = $request->get_params();
        }
        $fieldsIn = is_array($params['fields'] ?? null) ? $params['fields'] : [];
        if ($fieldsIn === []) {
            return $this->validationError(ValidationResult::failWith(
                'fields',
                __('No se enviaron cambios.', 'imagina-crm'),
            ));
        }

        // Filtra: solo slugs en whitelist. Cualquier slug fuera lo
        // rechazamos con 403 — error explícito, no silencioso, para
        // evitar que un cliente piense que "guardó" un campo que el
        // backend ignoró.
        $cleanValues = [];
        foreach ($fieldsIn as $slug => $value) {
            if (! is_string($slug)) {
                continue;
            }
            if (! isset($allowed[$slug])) {
                return $this->forbidden(
                    /* translators: %s: field slug */
                    sprintf(__('No tienes permiso para editar el campo "%s".', 'imagina-crm'), $slug),
                );
            }
            $cleanValues[$slug] = $value;
        }
        if ($cleanValues === []) {
            return $this->validationError(ValidationResult::failWith(
                'fields',
                __('No se enviaron cambios válidos.', 'imagina-crm'),
            ));
        }

        $result = $this->records->update($portalList, $recordId, $cleanValues);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }

        return new WP_REST_Response(['data' => $result]);
    }

    /**
     * GET /portal/me/activity
     *
     * Timeline de actividad del record del cliente. Reusa
     * `ActivityRepository::recentForRecord` con list_id + record_id
     * resueltos desde el ClientResolver (no se aceptan IDs como
     * params — defensa contra spoofing).
     */
    public function getMyActivity(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $user = wp_get_current_user();
        $portalList = $this->resolver->portalList();
        if ($portalList === null) {
            return $this->notFound();
        }
        $clientRecord = $this->resolver->clientRecordFor($user);
        if ($clientRecord === null) {
            return $this->notFound();
        }
        $recordId = isset($clientRecord['id']) ? (int) $clientRecord['id'] : 0;
        if ($recordId <= 0) {
            return $this->notFound();
        }

        $limit  = max(1, min(200, (int) ($request->get_param('limit') ?? 50)));
        $offset = max(0, (int) ($request->get_param('offset') ?? 0));

        $items = array_map(
            static fn (ActivityEntity $a): array => $a->toArray(),
            $this->activity->recentForRecord($portalList->id, $recordId, $limit, $offset),
        );
        return new WP_REST_Response(['data' => $items]);
    }

    /**
     * GET /portal/me/comments
     *
     * Lista los comments del record del cliente. Como list_id +
     * record_id se resuelven desde el `ClientResolver`, NO se aceptan
     * IDs como params — protege contra spoofing.
     */
    public function getMyComments(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        unset($request);
        $user = wp_get_current_user();
        $portalList = $this->resolver->portalList();
        if ($portalList === null) {
            return $this->notFound();
        }
        $clientRecord = $this->resolver->clientRecordFor($user);
        if ($clientRecord === null) {
            return $this->notFound();
        }
        $recordId = isset($clientRecord['id']) ? (int) $clientRecord['id'] : 0;
        if ($recordId <= 0) {
            return $this->notFound();
        }

        $items = array_map(
            static fn ($c): array => $c->toArray(),
            $this->comments->allForRecord($portalList->id, $recordId),
        );
        return new WP_REST_Response(['data' => $items]);
    }

    /**
     * POST /portal/me/comments
     *
     * Crea un comment del cliente actual. user_id viene del JWT/session,
     * list_id + record_id se resuelven del ClientResolver. El composer
     * multi-modo del CRM (note/call/email/meeting) NO está disponible
     * en el portal — el cliente solo escribe notas simples.
     */
    public function createMyComment(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $user = wp_get_current_user();
        $portalList = $this->resolver->portalList();
        if ($portalList === null) {
            return $this->notFound();
        }
        $clientRecord = $this->resolver->clientRecordFor($user);
        if ($clientRecord === null) {
            return $this->notFound();
        }
        $recordId = isset($clientRecord['id']) ? (int) $clientRecord['id'] : 0;
        if ($recordId <= 0) {
            return $this->notFound();
        }

        $content = (string) ($request->get_param('content') ?? '');
        $result = $this->comments->create($portalList->id, $recordId, (int) $user->ID, [
            'content' => $content,
            // El portal no expone parent_id ni metadata custom — keep simple.
        ]);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }

        return new WP_REST_Response(['data' => $result->toArray()], 201);
    }

    /**
     * GET /portal/lists/{slug}/aggregates?fields=1,2,3
     *
     * Aggregates de records relacionados al cliente. Reutiliza el
     * `RecordAggregator` con el scope SQL del portal inyectado vía
     * `additionalWhere` — los totales son SIEMPRE solo del cliente
     * actual.
     */
    public function getAggregates(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('slug'));
        if ($list === null) {
            return $this->notFound();
        }

        $user = wp_get_current_user();
        $scope = $this->scope->recordsScopeWhere($user, $list);
        // El portal nunca otorga ver-todo; si por algún edge el scope
        // está vacío (no debería), bloqueamos como defensa adicional.
        if ($scope['sql'] === '') {
            return new WP_REST_Response(['data' => ['totals' => [], 'groups' => []]]);
        }

        $rawFields = (string) ($request->get_param('fields') ?? '');
        $fieldIds = array_values(array_filter(
            array_map('intval', explode(',', $rawFields)),
            static fn (int $id): bool => $id > 0,
        ));
        if ($fieldIds === []) {
            return new WP_REST_Response(['data' => ['totals' => [], 'groups' => []]]);
        }

        // Per-field permissions (Fase 16.A — fix bug S2): el cliente
        // no puede pedir agregados sobre campos ocultos para su rol.
        // Filtramos field IDs antes de pasar al aggregator.
        $sanitizer = $this->permissions->sanitizerFor($user, $list);
        if (! $sanitizer->isNoop()) {
            $idToSlug = [];
            foreach ($this->fields->allForList($list->id) as $f) {
                $idToSlug[$f->id] = $f->slug;
            }
            $fieldIds = $sanitizer->filterAllowedFieldIds($fieldIds, $idToSlug);
            if ($fieldIds === []) {
                return new WP_REST_Response(['data' => ['totals' => [], 'groups' => []]]);
            }
        }

        $result = $this->aggregator->aggregate(
            $list,
            $fieldIds,
            null,    // sin filterTree extra — solo el scope del portal.
            null,    // sin groupBy.
            $scope,
        );
        return new WP_REST_Response(['data' => $result]);
    }

    /**
     * POST /portal/lists/{slug}/records/{id}/access
     *
     * Crea (o reactiva) la cuenta WP del cliente y la asocia al record.
     * Cap requerida: imcrm_manage_lists.
     */
    public function createAccess(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('slug'));
        if ($list === null) {
            return $this->notFound();
        }
        $recordId = (int) $request->get_param('id');
        if ($recordId <= 0) {
            return $this->notFound();
        }
        $send = (bool) $request->get_param('send_notification');

        $result = $this->accounts->createAccessFor($list, $recordId, $send);
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }

        return new WP_REST_Response(['data' => $result], 201);
    }

    /**
     * POST /portal/lists/{slug}/records/{id}/magic-link
     *
     * Genera un magic link one-time para el cliente y opcionalmente
     * lo envía por email. Cap requerida: imcrm_manage_lists.
     *
     * Validaciones:
     *  - El record debe existir en la lista de portal.
     *  - El record debe tener un user_id asociado en su owner_field
     *    (cliente con cuenta creada previamente via /access).
     *  - target_url debe ser una URL válida.
     */
    public function createMagicLink(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('slug'));
        if ($list === null) {
            return $this->notFound();
        }
        $recordId = (int) $request->get_param('id');
        if ($recordId <= 0) {
            return $this->notFound();
        }
        $targetUrl = (string) $request->get_param('target_url');
        $sendEmail = (bool) $request->get_param('send_email');

        // Resolver el record + owner_field → user_id asociado.
        $portalList = $this->resolver->portalList();
        if ($portalList === null || $portalList->id !== $list->id) {
            return $this->validationError(ValidationResult::failWith(
                'list',
                __('Esta lista no es la lista de portal configurada.', 'imagina-crm'),
            ));
        }
        $ownerField = $this->resolver->ownerField($portalList);
        if ($ownerField === null) {
            return $this->validationError(ValidationResult::failWith(
                'list',
                __('La lista de portal no tiene un campo de usuario configurado.', 'imagina-crm'),
            ));
        }
        $row = $this->records->find($list, $recordId);
        if ($row === null) {
            return $this->notFound();
        }
        $fieldsMap = is_array($row['fields'] ?? null) ? $row['fields'] : [];
        $userId = isset($fieldsMap[$ownerField->slug]) ? (int) $fieldsMap[$ownerField->slug] : 0;
        if ($userId <= 0) {
            return $this->validationError(ValidationResult::failWith(
                'record',
                __('El registro no tiene una cuenta de cliente asociada. Crea el acceso primero.', 'imagina-crm'),
            ));
        }

        $generated = $this->magicLinks->generate($userId, $targetUrl);
        if ($generated instanceof ValidationResult) {
            return $this->validationError($generated);
        }

        if ($sendEmail) {
            $this->sendMagicLinkEmail($userId, $generated['url'], $generated['expires_at']);
        }

        return new WP_REST_Response([
            'data' => [
                'url'        => $generated['url'],
                'expires_at' => $generated['expires_at'],
                'sent_email' => $sendEmail,
            ],
        ], 201);
    }

    /**
     * GET /portal/page-url
     *
     * Auto-detect de la página del portal: busca la primera página
     * publicada con el shortcode `[imcrm-client-portal]` en su
     * contenido y devuelve su URL.
     *
     * Devuelve `{ url: string }` si encontró, `{ url: null }` si no.
     * El frontend usa este URL para `target_url` en
     * `POST .../magic-link` sin que el admin configure nada.
     *
     * Si hay múltiples páginas con el shortcode (raro), devuelve la
     * primera por `post_date DESC`. El admin puede pasar manualmente
     * un target_url alternativo al magic-link endpoint si necesita
     * una página específica.
     */
    public function getPortalPageUrl(WP_REST_Request $request): WP_REST_Response
    {
        unset($request);
        global $wpdb;
        $shortcode = '[' . \ImaginaCRM\Portal\PortalShortcode::TAG;
        $like = '%' . $wpdb->esc_like($shortcode) . '%';
        $sql = $wpdb->prepare(
            "SELECT ID FROM {$wpdb->posts} "
            . "WHERE post_status = %s "
            . "AND post_type IN ('page', 'post') "
            . "AND post_content LIKE %s "
            . "ORDER BY post_date DESC "
            . "LIMIT 1",
            'publish',
            $like,
        );
        $postId = $wpdb->get_var($sql);
        if ($postId === null) {
            return new WP_REST_Response(['data' => ['url' => null]]);
        }
        $url = get_permalink((int) $postId);
        return new WP_REST_Response([
            'data' => ['url' => $url === false ? null : $url],
        ]);
    }

    /**
     * Envía un email simple al cliente con el magic link. Texto plano +
     * HTML mínimo — el tema del sitio puede pisar el `wp_mail_*` filters
     * para customizar si necesita.
     */
    private function sendMagicLinkEmail(int $userId, string $url, int $expiresAt): void
    {
        if (! function_exists('wp_mail')) {
            return;
        }
        $user = get_user_by('id', $userId);
        if ($user === false || ! is_email($user->user_email)) {
            return;
        }
        $siteName = function_exists('get_bloginfo') ? get_bloginfo('name') : '';
        $expiresHuman = function_exists('wp_date')
            ? wp_date(get_option('date_format', 'Y-m-d') . ' ' . get_option('time_format', 'H:i'), $expiresAt)
            : gmdate('Y-m-d H:i', $expiresAt);

        $subject = sprintf(
            /* translators: %s: site name */
            __('Tu acceso a %s', 'imagina-crm'),
            $siteName,
        );
        $bodyText = sprintf(
            /* translators: 1: display name 2: site name 3: magic link URL 4: expires date */
            __("Hola %1\$s,\n\nUsa este enlace para acceder a tu portal en %2\$s:\n\n%3\$s\n\nEl enlace es válido hasta %4\$s y se puede usar una sola vez.\n\nSi no solicitaste este acceso, ignora este mensaje.", 'imagina-crm'),
            $user->display_name !== '' ? $user->display_name : $user->user_email,
            $siteName,
            $url,
            $expiresHuman,
        );

        wp_mail($user->user_email, $subject, $bodyText);
    }

    public function getMe(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        unset($request);
        $user = wp_get_current_user();

        $portalList = $this->resolver->portalList();
        if ($portalList === null) {
            return $this->notFound(__('El portal del cliente no está configurado.', 'imagina-crm'));
        }

        $clientRecord = $this->resolver->clientRecordFor($user);
        if ($clientRecord === null) {
            return $this->notFound(__('Tu cuenta aún no está asociada a un cliente.', 'imagina-crm'));
        }

        // Refetch hidratado vía RecordService para que el cliente
        // reciba fields + relations en el shape estándar.
        $clientId = isset($clientRecord['id']) ? (int) $clientRecord['id'] : 0;
        $hydrated = $clientId > 0 ? $this->records->find($portalList, $clientId) : null;
        if ($hydrated === null) {
            return $this->notFound();
        }

        // Per-field permissions (Fase 16.A — fix bug S2): aún en el
        // portal "su propio record", si el rol de la cuenta cliente
        // tiene fields ocultos, los strippeamos.
        $sanitizer = $this->permissions->sanitizerFor($user, $portalList);
        $hydrated = $sanitizer->stripRecord($hydrated);

        // Template del portal: si la lista de portal tiene
        // `settings.portal_template` configurado, lo usamos. Sino,
        // generamos uno default con los fields del record cliente
        // (cero-config, "out-of-the-box").
        $template = PortalTemplate::fromListSettings($portalList->settings);
        if ($template->isEmpty()) {
            $portalFields = $this->fields->allForList($portalList->id);
            $template = PortalTemplate::defaultFor($portalFields);
        }

        // Enriquecemos cada bloque editable_form con `editable_fields`:
        // [{slug, label, type, config}] resuelto desde los FieldEntity.
        // El bundle del portal lo usa para renderizar inputs específicos
        // por tipo (date picker, multi-select, checkbox, etc.) en vez
        // de un text genérico.
        $blocks = $this->enrichTemplateBlocks($template->toArray(), $portalList->id);

        // Metadata de fields de la lista del portal (label, type,
        // config). El frontend usa este mapa para renderear values con
        // labels correctos, opciones de select traducidas, fechas
        // formateadas, etc. Stripeados por el permission sanitizer
        // — los fields ocultos para el rol cliente no aparecen.
        $portalFieldsMeta = [];
        foreach ($this->fields->allForList($portalList->id) as $f) {
            if ($f->deletedAt !== null) continue;
            if (! $sanitizer->canSeeField($f->slug)) continue;
            $portalFieldsMeta[] = [
                'slug'   => $f->slug,
                'label'  => $f->label,
                'type'   => $f->type,
                'config' => $f->config,
            ];
        }

        return new WP_REST_Response([
            'data' => [
                'list'   => [
                    'id'   => $portalList->id,
                    'slug' => $portalList->slug,
                    'name' => $portalList->name,
                ],
                'record' => $hydrated,
                'fields' => $portalFieldsMeta,
                'user'   => [
                    'id'           => $user->ID,
                    'display_name' => $user->display_name,
                    'email'        => $user->user_email,
                ],
                'template' => ['blocks' => $blocks],
            ],
        ]);
    }

    public function getRecords(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('slug'));
        if ($list === null) {
            return $this->notFound();
        }

        $user = wp_get_current_user();
        $scope = $this->scope->recordsScopeWhere($user, $list);

        // Si el scope ya bloquea todo (1=0), igual seguimos la query —
        // el cliente recibe `data: []` y el meta apropiado. Más
        // predecible para el frontend que un 404.

        $page    = max(1, (int) ($request->get_param('page') ?? 1));
        $perPage = max(1, min(100, (int) ($request->get_param('per_page') ?? 20)));
        $sort    = $this->parseSort($request->get_param('sort'));
        $search  = $request->get_param('search');
        $search  = is_string($search) ? $search : null;

        $result = $this->records->list(
            list:            $list,
            filters:         [],
            sort:            $sort,
            fields:          [],
            search:          $search,
            page:            $page,
            perPage:         $perPage,
            filterTree:      null,
            cursor:          null,
            additionalWhere: $scope,
        );
        if ($result instanceof ValidationResult) {
            return $this->validationError($result);
        }

        // Per-field permissions (Fase 16.A — fix bug S2).
        $sanitizer = $this->permissions->sanitizerFor($user, $list);
        if (! $sanitizer->isNoop() && isset($result['data']) && is_array($result['data'])) {
            $result['data'] = $sanitizer->stripRecords($result['data']);
        }

        return new WP_REST_Response($result);
    }

    public function getRecord(WP_REST_Request $request): WP_REST_Response|WP_Error
    {
        $list = $this->lists->findByIdOrSlug((string) $request->get_param('slug'));
        if ($list === null) {
            return $this->notFound();
        }

        $recordId = (int) $request->get_param('id');
        if ($recordId <= 0) {
            return $this->notFound();
        }

        $user = wp_get_current_user();
        $scope = $this->scope->recordsScopeWhere($user, $list);

        // Estrategia para visibility per-record: cargamos el record
        // por id directamente y verificamos contra el scope. Más eficiente
        // que ejecutar list() con un filtro de id (que pasaría por todo
        // el pipeline). El scope se evalúa mentalmente:
        //  - Lista de portal: scope['args'][0] DEBE ser el id pedido.
        //  - Lista con user field: el record DEBE tener user_id == col.
        //  - Lista con relation: tenemos que mirar la tabla relations.
        //  - Lista sin vínculo: 1=0 → siempre 404.
        //
        // Para 3.B simplificamos: usamos `list()` con additionalWhere
        // del scope + un filtro extra `id=%d`. Es UN solo round-trip
        // y reusa toda la lógica del QueryBuilder.
        $additional = $this->mergeScopeWithIdFilter($scope, $recordId);
        $result = $this->records->list(
            list:            $list,
            filters:         [],
            sort:            [],
            fields:          [],
            search:          null,
            page:            1,
            perPage:         1,
            filterTree:      null,
            cursor:          null,
            additionalWhere: $additional,
        );
        if ($result instanceof ValidationResult || ! isset($result['data'][0])) {
            return $this->notFound();
        }

        // Per-field permissions (Fase 16.A — fix bug S2): el portal
        // también respeta `fields_hidden`. El cliente puede tener un
        // role custom con campos ocultos — ej. "Portal cliente" que
        // ve `nombre`/`email` pero no `notas_internas`.
        $sanitizer = $this->permissions->sanitizerFor($user, $list);
        $record = $sanitizer->stripRecord($result['data'][0]);

        return new WP_REST_Response(['data' => $record]);
    }

    /**
     * Concatena la cláusula del scope con un filtro de id específico.
     * Resultado: `AND id = %d <scope.sql>` con args `[id, ...scope.args]`.
     *
     * @param array{sql: string, args: list<mixed>} $scope
     * @return array{sql: string, args: list<mixed>}
     */
    /**
     * Enriquece los bloques del template antes de mandarlos al cliente.
     *
     * Hoy enriquece SOLO los `editable_form`: agrega `editable_fields`
     * (lista con {slug, label, type, config}) resuelto desde los
     * FieldEntity de la lista. Sin esto, el bundle del portal no
     * sabría qué tipo de input renderizar para cada slug — todos
     * caerían a `<input type="text">`.
     *
     * Slugs en `editable_field_slugs` que no resuelven a un field
     * vivo se omiten de `editable_fields` — el cliente no debe ver
     * inputs huérfanos.
     *
     * @param list<array{type:string, config:array<string, mixed>}> $blocks
     * @return list<array{type:string, config:array<string, mixed>}>
     */
    private function enrichTemplateBlocks(array $blocks, int $portalListId): array
    {
        // Precargamos los fields de la lista de portal una sola vez.
        $fieldsBySlug = [];
        foreach ($this->fields->allForList($portalListId) as $f) {
            if ($f->deletedAt !== null) continue;
            $fieldsBySlug[$f->slug] = $f;
        }

        $out = [];
        foreach ($blocks as $block) {
            if ($block['type'] !== 'editable_form') {
                $out[] = $block;
                continue;
            }
            $slugs = $block['config']['editable_field_slugs'] ?? [];
            if (! is_array($slugs)) {
                $out[] = $block;
                continue;
            }
            $editableFields = [];
            foreach ($slugs as $slug) {
                if (! is_string($slug) || ! isset($fieldsBySlug[$slug])) continue;
                $field = $fieldsBySlug[$slug];
                $editableFields[] = [
                    'slug'   => $field->slug,
                    'label'  => $field->label,
                    'type'   => $field->type,
                    'config' => $field->config,
                ];
            }
            $block['config']['editable_fields'] = $editableFields;
            $out[] = $block;
        }
        return $out;
    }

    /**
     * @param array{sql: string, args: list<mixed>} $scope
     * @return array{sql: string, args: list<mixed>}
     */
    private function mergeScopeWithIdFilter(array $scope, int $recordId): array
    {
        $sql = 'AND `id` = %d';
        $args = [$recordId];
        if ($scope['sql'] !== '') {
            $sql .= ' ' . $scope['sql'];
            foreach ($scope['args'] as $a) {
                $args[] = $a;
            }
        }
        return ['sql' => $sql, 'args' => $args];
    }

    /**
     * @param mixed $raw
     * @return list<array{slug:string, dir:string}>
     */
    private function parseSort(mixed $raw): array
    {
        if (! is_string($raw) || $raw === '') {
            return [];
        }
        $out = [];
        foreach (explode(',', $raw) as $piece) {
            $parts = explode(':', trim($piece), 2);
            $slug = trim($parts[0] ?? '');
            $dir = strtolower(trim($parts[1] ?? 'asc'));
            if ($slug !== '') {
                $out[] = ['slug' => $slug, 'dir' => $dir === 'desc' ? 'desc' : 'asc'];
            }
        }
        return $out;
    }
}
