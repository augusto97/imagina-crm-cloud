<?php
declare(strict_types=1);

namespace ImaginaCRM\Portal;

/**
 * Hook que detecta y consume tokens de magic link en cualquier
 * request del frontend (Fase 10 — pulidos).
 *
 * Se registra en `template_redirect` para correr ANTES del render
 * del template (el shortcode corre durante el render — demasiado
 * tarde para `wp_set_auth_cookie` que necesita modificar headers).
 *
 * Flujo cuando `?imcrm_token=...` está en la URL:
 *  1. Detecta el query param.
 *  2. Llama a `MagicLinkService::consume($token)`.
 *  3. Si exitoso: el user queda autenticado vía cookie. Redirige a
 *     la misma URL SIN el token (el browser history queda limpio,
 *     sin tokens reutilizables).
 *  4. Si falla: redirige a la misma URL sin el token igual — el
 *     shortcode mostrará el login card normalmente. No revelamos
 *     la causa exacta del fallo (data leak prevention).
 *
 * Solo se activa cuando el token está presente — para el resto del
 * frontend es no-op (un check de `isset($_GET[...])`).
 */
final class MagicLinkConsumer
{
    public function __construct(private readonly MagicLinkService $service)
    {
    }

    public function register(): void
    {
        // Priority 5 (antes del 10 default) para asegurar que el
        // template_redirect del plugin corre antes de cualquier
        // tema/plugin que pueda hacer output prematuro.
        add_action('template_redirect', [$this, 'maybeConsume'], 5);
    }

    public function maybeConsume(): void
    {
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended
        $rawToken = $_GET[MagicLinkService::QUERY_PARAM] ?? null;
        if (! is_string($rawToken) || $rawToken === '') {
            return;
        }
        // Saneamos antes de pasar al service. El service revalida
        // formato (ctype_xdigit + len=64) pero acá no costamos más.
        $token = preg_replace('/[^a-f0-9]/i', '', $rawToken);
        if ($token === null || $token === '') {
            $this->redirectWithoutToken();
            return;
        }

        $this->service->consume($token);

        // Sea el consume exitoso o no, redirigimos a la misma URL
        // sin el token. Si exitoso → el user queda logged-in y el
        // shortcode renderiza el portal. Si falla → el shortcode
        // muestra el login card (estado normal).
        $this->redirectWithoutToken();
    }

    /**
     * Redirige a la misma URL del request actual, removiendo solo
     * el query param del token. Usa `wp_safe_redirect` para evitar
     * open-redirect via host injection.
     */
    private function redirectWithoutToken(): void
    {
        if (! isset($_SERVER['REQUEST_URI']) || ! function_exists('home_url')) {
            return;
        }
        $current = (string) $_SERVER['REQUEST_URI'];
        // remove_query_arg está disponible en frontend, devuelve string
        // con el param removido conservando los demás.
        $clean = function_exists('remove_query_arg')
            ? remove_query_arg(MagicLinkService::QUERY_PARAM, $current)
            : $current;
        $target = home_url($clean);

        if (function_exists('wp_safe_redirect')) {
            wp_safe_redirect($target);
            exit;
        }
    }
}
