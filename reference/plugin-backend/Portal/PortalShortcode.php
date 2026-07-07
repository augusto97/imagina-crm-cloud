<?php
declare(strict_types=1);

namespace ImaginaCRM\Portal;

use ImaginaCRM\Permissions\CapabilityRegistry;

/**
 * Shortcode `[imcrm-client-portal]` (Fase 9 — 3.B).
 *
 * Coloca el portal del cliente en cualquier página del tema. Hace de
 * auth gate en el frontend:
 *
 *   1. User no logged-in → renderiza un "card" pidiendo login con
 *      botón a `wp_login_url(currentUrl)`. NO redirige (un shortcode
 *      no debe forzar wp_redirect — puede correr durante render del
 *      body).
 *   2. User logged-in pero sin cap `imcrm_access_portal` (ej. admin
 *      WP que cae acá por curiosear): mensaje "Esta página es para
 *      clientes" + link al admin.
 *   3. User logged-in con cap pero SIN record de cliente asociado:
 *      mensaje "Tu cuenta aún no está asociada. Contacta al admin."
 *   4. User logged-in con cap Y record asociado: render del portal.
 *      En 3.B renderizamos un placeholder informativo. En 3.F llega
 *      el bundle `app/portal.tsx` que hidrata con el template real.
 *
 * Atributos:
 *   - `template_id` (opcional): override del default_template_id de
 *     la lista de portal. Reservado para 3.C cuando el template editor
 *     soporte client_portal.
 */
final class PortalShortcode
{
    public const TAG = 'imcrm-client-portal';

    public function __construct(private readonly ClientResolverInterface $resolver)
    {
    }

    public function register(): void
    {
        if (function_exists('add_shortcode')) {
            add_shortcode(self::TAG, [$this, 'render']);
        }
    }

    /**
     * @param array<string, mixed>|string $atts
     */
    public function render(mixed $atts): string
    {
        $atts = is_array($atts) ? $atts : [];
        unset($atts); // template_id se usará en 3.F; sin uso por ahora.

        // Estado 1: no logged-in.
        if (! function_exists('is_user_logged_in') || ! is_user_logged_in()) {
            return $this->renderLoginCard();
        }

        // Estado 2: logged-in pero sin cap del portal.
        if (! current_user_can(CapabilityRegistry::CAP_ACCESS_PORTAL)) {
            return $this->renderNoAccessCard();
        }

        // Estado 3: logged-in con cap pero sin record asociado.
        $user = wp_get_current_user();
        $portalList = $this->resolver->portalList();
        if ($portalList === null) {
            return $this->renderMisconfiguredCard();
        }
        $clientRecord = $this->resolver->clientRecordFor($user);
        if ($clientRecord === null) {
            return $this->renderUnlinkedCard();
        }

        // Estado 4: render del portal. En 3.B placeholder informativo
        // + marcas data-* preparadas para que el bundle de 3.F hidrate.
        return $this->renderPortalRoot($user, $portalList, $clientRecord);
    }

    private function renderLoginCard(): string
    {
        $loginUrl = function_exists('wp_login_url') ? wp_login_url($this->currentUrl()) : '';
        ob_start();
        ?>
        <div class="imcrm-portal-card imcrm-portal-card--login">
            <h2 class="imcrm-portal-card__title">
                <?php echo esc_html__('Acceso al portal', 'imagina-crm'); ?>
            </h2>
            <p class="imcrm-portal-card__body">
                <?php echo esc_html__('Inicia sesión para ver tus datos.', 'imagina-crm'); ?>
            </p>
            <?php if ($loginUrl !== ''): ?>
                <a href="<?php echo esc_url($loginUrl); ?>" class="imcrm-portal-card__btn">
                    <?php echo esc_html__('Iniciar sesión', 'imagina-crm'); ?>
                </a>
            <?php endif; ?>
        </div>
        <?php
        return (string) ob_get_clean();
    }

    private function renderNoAccessCard(): string
    {
        $adminUrl = function_exists('admin_url') ? admin_url() : '';
        ob_start();
        ?>
        <div class="imcrm-portal-card imcrm-portal-card--no-access">
            <h2 class="imcrm-portal-card__title">
                <?php echo esc_html__('Esta página es para clientes', 'imagina-crm'); ?>
            </h2>
            <p class="imcrm-portal-card__body">
                <?php echo esc_html__('Tu cuenta no es de tipo cliente.', 'imagina-crm'); ?>
            </p>
            <?php if ($adminUrl !== ''): ?>
                <a href="<?php echo esc_url($adminUrl); ?>" class="imcrm-portal-card__btn">
                    <?php echo esc_html__('Ir al panel', 'imagina-crm'); ?>
                </a>
            <?php endif; ?>
        </div>
        <?php
        return (string) ob_get_clean();
    }

    private function renderMisconfiguredCard(): string
    {
        // Solo visible a admins en debug — visitantes anónimos no
        // deberían llegar acá (ya pasaron los filtros previos). Si
        // un admin curioseando ve el shortcode sin lista de portal,
        // le decimos qué falta.
        ob_start();
        ?>
        <div class="imcrm-portal-card imcrm-portal-card--misconfigured">
            <h2 class="imcrm-portal-card__title">
                <?php echo esc_html__('El portal no está configurado', 'imagina-crm'); ?>
            </h2>
            <p class="imcrm-portal-card__body">
                <?php echo esc_html__('Ninguna lista del CRM está marcada como lista de portal.', 'imagina-crm'); ?>
            </p>
        </div>
        <?php
        return (string) ob_get_clean();
    }

    private function renderUnlinkedCard(): string
    {
        ob_start();
        ?>
        <div class="imcrm-portal-card imcrm-portal-card--unlinked">
            <h2 class="imcrm-portal-card__title">
                <?php echo esc_html__('Tu cuenta aún no tiene portal', 'imagina-crm'); ?>
            </h2>
            <p class="imcrm-portal-card__body">
                <?php echo esc_html__('Contacta al administrador para que asocie tu cuenta con un registro de cliente.', 'imagina-crm'); ?>
            </p>
        </div>
        <?php
        return (string) ob_get_clean();
    }

    /**
     * Render del root del portal. En 3.B es un placeholder simple
     * que muestra el nombre del cliente — el bundle JS de 3.F lo
     * reemplazará con el template configurado.
     *
     * @param array<string, mixed> $clientRecord
     */
    private function renderPortalRoot(\WP_User $user, \ImaginaCRM\Lists\ListEntity $portalList, array $clientRecord): string
    {
        $bootData = [
            'rest_root' => function_exists('rest_url') ? rest_url('imagina-crm/v1') : '',
            'rest_nonce' => function_exists('wp_create_nonce') ? wp_create_nonce('wp_rest') : '',
            'list_slug' => $portalList->slug,
            'user_id'   => (int) $user->ID,
            'record_id' => isset($clientRecord['id']) ? (int) $clientRecord['id'] : 0,
        ];
        ob_start();
        ?>
        <div
            class="imcrm-portal-root"
            data-imcrm-portal="<?php echo esc_attr($portalList->slug); ?>"
            data-imcrm-portal-boot="<?php echo esc_attr((string) wp_json_encode($bootData)); ?>"
        >
            <header class="imcrm-portal-header">
                <h1 class="imcrm-portal-title">
                    <?php
                    echo esc_html(sprintf(
                        /* translators: %s: client display name */
                        __('Hola, %s', 'imagina-crm'),
                        $user->display_name !== '' ? $user->display_name : __('cliente', 'imagina-crm'),
                    ));
                    ?>
                </h1>
                <a href="<?php echo esc_url(function_exists('wp_logout_url') ? wp_logout_url($this->currentUrl()) : '#'); ?>" class="imcrm-portal-logout">
                    <?php echo esc_html__('Cerrar sesión', 'imagina-crm'); ?>
                </a>
            </header>
            <div class="imcrm-portal-body">
                <p>
                    <?php echo esc_html__('El portal está cargando…', 'imagina-crm'); ?>
                </p>
            </div>
        </div>
        <?php
        return (string) ob_get_clean();
    }

    /**
     * URL actual del request para redirects de login/logout. Hace lo
     * que `wp_safe_redirect` necesita: prefiere la canonical URL del
     * request, fallback a home_url.
     */
    private function currentUrl(): string
    {
        if (! isset($_SERVER['REQUEST_URI']) || ! function_exists('home_url')) {
            return function_exists('home_url') ? home_url('/') : '/';
        }
        $path = (string) $_SERVER['REQUEST_URI'];
        // Sanitización defensiva — evita open redirect via host injection.
        return home_url($path);
    }
}
