<?php
declare(strict_types=1);

namespace ImaginaCRM\Admin;

use ImaginaCRM\Plugin;
use ImaginaCRM\Standalone\StandalonePage;

/**
 * Registra la entrada del plugin en el menú de wp-admin.
 *
 * Desde 0.13.0 el SPA vive en una página standalone fuera de wp-admin
 * (`/imagina-crm/`) — sin chrome, sin styles bleed, más rápido. El
 * menú lateral de WP es solo un launcher que redirige al SPA.
 *
 * El redirect se engancha al hook `load-{hookname}` que dispara WP
 * ANTES de incluir `admin-header.php` (es decir, antes de cualquier
 * output). Así `wp_safe_redirect` siempre puede setear headers — sin
 * caer al fallback HTML "click aquí" como pasaba con render callbacks
 * tardíos.
 */
final class AdminMenu
{
    public function register(): void
    {
        add_action('admin_menu', [$this, 'registerMenu']);
    }

    public function registerMenu(): void
    {
        $hook = add_menu_page(
            __('Imagina CRM', 'imagina-crm'),
            __('Imagina CRM', 'imagina-crm'),
            Plugin::ADMIN_CAPABILITY,
            Plugin::ADMIN_PAGE,
            '__return_null',           // No-op: el load-hook hace exit antes.
            'dashicons-rest-api',
            58,
        );

        if (is_string($hook) && $hook !== '') {
            add_action("load-{$hook}", [$this, 'redirectToStandalone']);
        }
    }

    /**
     * Engachado a `load-{hookname}`: corre antes de admin-header.php,
     * así el redirect funciona siempre. Si por alguna razón los
     * headers ya se enviaron (output buffering raro, plugin que printea
     * en `init`), caemos al fallback HTML.
     */
    public function redirectToStandalone(): void
    {
        if (! current_user_can(Plugin::ADMIN_CAPABILITY)) {
            wp_die(esc_html__('No tienes permiso para acceder a Imagina CRM.', 'imagina-crm'));
        }

        $target = StandalonePage::url();

        if (! headers_sent()) {
            wp_safe_redirect($target);
            exit;
        }

        // Fallback defensivo: meta-refresh + JS + link manual. Si
        // llegamos acá es porque otro plugin printeó algo antes — el
        // user ve un mensaje breve y rebotamos cliente-side.
        printf(
            '<meta http-equiv="refresh" content="0;url=%1$s">'
            . '<script>window.location.replace(%2$s);</script>'
            . '<div class="wrap"><h1>%3$s</h1><p><a href="%1$s">%4$s</a></p></div>',
            esc_url($target),
            wp_json_encode($target),
            esc_html__('Abriendo Imagina CRM…', 'imagina-crm'),
            esc_html__('Click aquí si no eres redirigido', 'imagina-crm'),
        );
        exit;
    }
}
