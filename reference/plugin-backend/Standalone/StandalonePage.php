<?php
declare(strict_types=1);

namespace ImaginaCRM\Standalone;

use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Plugin;

/**
 * Página standalone del SPA, fuera del chrome de wp-admin.
 *
 * URL pública: `/<URL_PATH>/` (default: `imagina-crm`).
 *
 * Por qué standalone:
 * - Sin bleed de estilos / scripts de wp-admin → los bugs de
 *   "pastilla gris UA" no pueden reaparecer.
 * - First paint más rápido — sin jQuery, sin admin bar, sin
 *   `admin_head` de plugins terceros.
 * - El "fullscreen mode" deja de ser un overlay z-index hack.
 *
 * El menú de WP sigue existiendo en `/wp-admin/admin.php?page=imagina-crm`
 * pero el render callback redirige directo a esta URL — un solo
 * mental model.
 *
 * Auth: cookies de WP + nonce REST (mismo modelo que el embedded
 * admin). Si el usuario no está logged-in o no tiene
 * `manage_options`, redirect a wp-login con `redirect_to` apuntando
 * de vuelta acá.
 */
final class StandalonePage
{
    public const QUERY_VAR = 'imcrm_standalone';

    /** Path público (sin slashes). Editable si choca con un page slug. */
    public const URL_PATH = 'imagina-crm';

    /**
     * Bump cuando cambien las rewrite rules. La comparación contra
     * `imcrm_rewrite_version` en wp_options dispara un flush en
     * `wp_loaded` si difieren — cubre el caso "el usuario actualizó
     * el plugin sin re-activar" donde register_activation_hook NO
     * corre.
     */
    public const REWRITE_VERSION = '1';

    private const OPTION_REWRITE_VERSION = 'imcrm_rewrite_version';

    public function register(): void
    {
        // Hook PRINCIPAL: intercept directo en init priority 0 — match
        // por path del REQUEST_URI sin depender de rewrite rules ni
        // permalink structure ni flush. Funciona desde la primera
        // request post-instalación, en cualquier server (Apache/nginx),
        // con cualquier permalink config (incluso plain).
        add_action('init', [$this, 'maybeIntercept'], 0);

        // Hook secundario: el rewrite rule sigue registrándose para
        // que la URL `/imagina-crm/` aparezca en el rewrite cache de
        // WP (importante para SEO bots etc., aunque robots:noindex
        // ya bloquea). Si por alguna razón el intercept no captura
        // (ej. otro plugin se mete antes), el rewrite + query var es
        // la red de seguridad.
        add_action('init', [$this, 'registerRewriteRule']);
        add_filter('query_vars', [$this, 'registerQueryVar']);
        add_action('template_redirect', [$this, 'maybeRender'], 0);
        add_action('wp_loaded', [$this, 'maybeFlushRewriteRules']);
    }

    /**
     * Intercept del REQUEST_URI antes de que WP haga su parse_request.
     * Si el path matchea nuestra URL, renderizamos y exit — saltando
     * todo el ciclo de WP (parse → query → template). Esto significa:
     *  - No 404 si las rewrite rules no se flushearon todavía
     *  - No depende de permalink structure
     *  - No conflictúa con pages/posts que tengan el mismo slug
     *    porque corremos antes que parse_request
     */
    public function maybeIntercept(): void
    {
        if (! isset($_SERVER['REQUEST_URI'])) {
            return;
        }
        $uri = (string) $_SERVER['REQUEST_URI'];
        $path = (string) parse_url($uri, PHP_URL_PATH);
        $path = '/' . trim($path, '/');

        $expected = '/' . self::URL_PATH;
        $isExact  = $path === $expected;
        $isChild  = str_starts_with($path, $expected . '/');
        if (! $isExact && ! $isChild) {
            return;
        }

        // Skip si es una request al wp-admin o REST que happens to
        // contener el segmento — defensivo. Las URLs admin y REST
        // tienen su propio prefix así que esto rara vez aplica.
        if (str_starts_with($path, '/wp-admin') || str_starts_with($path, '/wp-json')) {
            return;
        }

        // Auth gate
        if (! is_user_logged_in()) {
            wp_safe_redirect(wp_login_url(self::url()));
            exit;
        }
        if (! current_user_can(Plugin::ADMIN_CAPABILITY)) {
            status_header(403);
            wp_die(esc_html__('No tienes permiso para acceder a Imagina CRM.', 'imagina-crm'));
        }

        $this->renderPage();
        exit;
    }

    public function maybeFlushRewriteRules(): void
    {
        $stored = get_option(self::OPTION_REWRITE_VERSION);
        if ((string) $stored === self::REWRITE_VERSION) {
            return;
        }
        flush_rewrite_rules(false);
        update_option(self::OPTION_REWRITE_VERSION, self::REWRITE_VERSION, false);
    }

    /**
     * URL canónica de la página standalone. En sites con pretty
     * permalinks devuelve `/imagina-crm/`. En sites con plain
     * permalinks (`?p=123`) cae a `/?imcrm_standalone=1` — la rewrite
     * rule no está disponible pero el query var sí.
     */
    public static function url(): string
    {
        if (get_option('permalink_structure')) {
            return home_url('/' . self::URL_PATH . '/');
        }
        return add_query_arg(self::QUERY_VAR, '1', home_url('/'));
    }

    public function registerRewriteRule(): void
    {
        // Cualquier path bajo /imagina-crm/ activa el SPA. La
        // navegación interna usa HashRouter (no toca rewrites).
        add_rewrite_rule(
            '^' . self::URL_PATH . '(/.*)?$',
            'index.php?' . self::QUERY_VAR . '=1',
            'top',
        );
    }

    /**
     * @param array<int, string> $vars
     * @return array<int, string>
     */
    public function registerQueryVar(array $vars): array
    {
        $vars[] = self::QUERY_VAR;
        return $vars;
    }

    public function maybeRender(): void
    {
        $flag = get_query_var(self::QUERY_VAR);
        if ($flag !== '1' && $flag !== 1) {
            return;
        }

        // Auth gate. Mismo capability check que el embedded admin.
        if (! is_user_logged_in()) {
            $here = home_url('/' . self::URL_PATH . '/');
            wp_safe_redirect(wp_login_url($here));
            exit;
        }
        if (! current_user_can(Plugin::ADMIN_CAPABILITY)) {
            status_header(403);
            wp_die(esc_html__('No tienes permiso para acceder a Imagina CRM.', 'imagina-crm'));
        }

        $this->renderPage();
        exit;
    }

    private function renderPage(): void
    {
        $assets = $this->resolveAssets();
        if ($assets === null) {
            $this->renderBuildMissing();
            return;
        }

        $bootData = $this->bootData();
        $bootJson = wp_json_encode($bootData, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_QUOT);
        if ($bootJson === false) {
            $bootJson = '{}';
        }

        status_header(200);
        nocache_headers();
        header('Content-Type: text/html; charset=utf-8');
        header('X-Frame-Options: SAMEORIGIN');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: strict-origin-when-cross-origin');

        $locale  = esc_attr(str_replace('_', '-', get_user_locale()));
        $version = esc_attr(Plugin::VERSION);
        ?>
<!DOCTYPE html>
<html lang="<?php echo $locale; ?>" data-imcrm-theme="light">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=1024, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Imagina CRM</title>
    <link rel="icon" href="data:image/svg+xml,<?php echo rawurlencode($this->faviconSvg()); ?>">
    <style id="imcrm-reset">
<?php echo $this->inlineReset(); ?>
    </style>
<?php foreach ($assets['css'] as $cssUrl): ?>
    <link rel="stylesheet" href="<?php echo esc_url($cssUrl); ?>">
<?php endforeach; ?>
    <script>window.IMAGINA_CRM_BOOT = <?php echo $bootJson; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped — JSON ya con HEX_TAG/AMP/QUOT ?>;</script>
</head>
<body>
    <div id="imcrm-root" class="imcrm-app-root" data-imcrm-version="<?php echo $version; ?>"></div>
    <noscript>
        <p style="padding: 2rem; text-align: center; font-family: system-ui, sans-serif;">
            <?php echo esc_html__('Imagina CRM requiere JavaScript para funcionar.', 'imagina-crm'); ?>
        </p>
    </noscript>
<?php foreach ($assets['js'] as $jsUrl): ?>
    <script type="module" src="<?php echo esc_url($jsUrl); ?>"></script>
<?php endforeach; ?>
</body>
</html>
        <?php
    }

    private function renderBuildMissing(): void
    {
        status_header(503);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Imagina CRM</title></head><body>';
        echo '<p style="font: 16px system-ui; padding: 2rem;">';
        echo esc_html__(
            'Imagina CRM: el bundle JS no está construido. Ejecuta "npm install && npm run build" en el directorio del plugin.',
            'imagina-crm',
        );
        echo '</p></body></html>';
    }

    /**
     * Reset CSS minimal — equivalente recortado a Tailwind preflight.
     * Necesario porque `corePlugins.preflight` está OFF (para no
     * romper wp-admin) y la página standalone no incluye los estilos
     * base de WP. Sin esto los `<button>`, `<input>`, `<a>` heredan
     * los UA defaults.
     */
    private function inlineReset(): string
    {
        return <<<'CSS'
*, *::before, *::after { box-sizing: border-box; border-width: 0; border-style: solid; }
html { line-height: 1.5; -webkit-text-size-adjust: 100%; tab-size: 4; }
body {
    margin: 0;
    font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    background: hsl(220 17% 97%);
    color: hsl(224 71% 4%);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
}
hr { height: 0; color: inherit; border-top-width: 1px; }
abbr[title] { text-decoration: underline dotted; }
h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; margin: 0; }
a { color: inherit; text-decoration: inherit; }
b, strong { font-weight: bolder; }
code, kbd, samp, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 1em; }
small { font-size: 80%; }
sub, sup { font-size: 75%; line-height: 0; position: relative; vertical-align: baseline; }
sub { bottom: -0.25em; }
sup { top: -0.5em; }
table { text-indent: 0; border-color: inherit; border-collapse: collapse; }
button, input, optgroup, select, textarea {
    font-family: inherit;
    font-feature-settings: inherit;
    font-variation-settings: inherit;
    font-size: 100%;
    font-weight: inherit;
    line-height: inherit;
    color: inherit;
    margin: 0;
    padding: 0;
}
button, select { text-transform: none; }
/*
 * STRIP COMPLETO de chrome UA en buttons. Tailwind preflight default
 * usa `-webkit-appearance: button` que MANTIENE el rendering nativo
 * (incluyendo hover gradient sutil que Safari/Chrome agregan). Para
 * un look totalmente custom usamos `appearance: none`. El cursor
 * pointer sigue siendo nuestro.
 */
button, input:where([type='button'], [type='reset'], [type='submit']) {
    appearance: none;
    -webkit-appearance: none;
    background-color: transparent;
    background-image: none;
    border-radius: 0;
}
button, [role='button'] { cursor: pointer; }
button:focus, [role='button']:focus { outline: none; }
:-moz-focusring { outline: auto; }
:-moz-ui-invalid { box-shadow: none; }
progress { vertical-align: baseline; }
::-webkit-inner-spin-button, ::-webkit-outer-spin-button { height: auto; }
[type='search'] { -webkit-appearance: textfield; outline-offset: -2px; }
::-webkit-search-decoration { -webkit-appearance: none; }
::-webkit-file-upload-button { -webkit-appearance: button; font: inherit; }
summary { display: list-item; }
blockquote, dl, dd, h1, h2, h3, h4, h5, h6, hr, figure, p, pre { margin: 0; }
fieldset { margin: 0; padding: 0; }
legend { padding: 0; }
ol, ul, menu { list-style: none; margin: 0; padding: 0; }
dialog { padding: 0; }
textarea { resize: vertical; }
input::placeholder, textarea::placeholder { opacity: 1; color: hsl(220 9% 50%); }
[role='button'], button { cursor: pointer; }
:disabled { cursor: default; }
img, svg, video, canvas, audio, iframe, embed, object {
    display: block;
    vertical-align: middle;
}
img, video { max-width: 100%; height: auto; }
[hidden] { display: none; }
CSS;
    }

    /**
     * @return array{js: array<int, string>, css: array<int, string>}|null
     */
    private function resolveAssets(): ?array
    {
        $manifestPath = IMAGINA_CRM_DIR . 'dist/manifest.json';
        if (! is_readable($manifestPath)) {
            return null;
        }
        $contents = file_get_contents($manifestPath);
        if ($contents === false) {
            return null;
        }
        $manifest = json_decode($contents, true);
        if (! is_array($manifest)) {
            return null;
        }
        $entry = $manifest['app/main.tsx'] ?? null;
        if (! is_array($entry) || ! isset($entry['file']) || ! is_string($entry['file'])) {
            return null;
        }

        $distUrl = trailingslashit(IMAGINA_CRM_URL . 'dist');
        $js  = [$distUrl . $entry['file']];
        $css = [];
        if (isset($entry['css']) && is_array($entry['css'])) {
            foreach ($entry['css'] as $cssFile) {
                if (is_string($cssFile)) {
                    $css[] = $distUrl . $cssFile;
                }
            }
        }
        return ['js' => $js, 'css' => $css];
    }

    /**
     * @return array<string, mixed>
     */
    private function bootData(): array
    {
        $user = wp_get_current_user();
        return [
            'version'   => Plugin::VERSION,
            'rootId'    => 'imcrm-root',
            'restRoot'  => esc_url_raw(rest_url('imagina-crm/v1')),
            'restNonce' => wp_create_nonce('wp_rest'),
            'adminUrl'  => esc_url_raw(admin_url()),
            'assetsUrl' => esc_url_raw(IMAGINA_CRM_URL . 'dist/'),
            'locale'    => str_replace('_', '-', get_user_locale()),
            'timezone'  => wp_timezone_string(),
            'standalone' => true,
            'user'      => [
                'id'           => $user->ID,
                'displayName'  => $user->display_name,
                'avatar'       => get_avatar_url($user->ID, ['size' => 64]) ?: '',
                'roles'        => array_values($user->roles),
                'capabilities' => array_merge(
                    [
                        'manage_options' => current_user_can('manage_options'),
                    ],
                    CapabilityRegistry::currentUserCapabilitiesMap(),
                ),
            ],
        ];
    }

    private function faviconSvg(): string
    {
        // Mismo gradient cyan que usa el sidebar logo, en SVG inline
        // como favicon — funciona como data URL en navegadores modernos.
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><radialGradient id="g" cx="30%" cy="30%"><stop offset="0%" stop-color="#3ed5e8"/><stop offset="70%" stop-color="#089aaf"/><stop offset="100%" stop-color="#1d6fc8"/></radialGradient></defs><circle cx="16" cy="16" r="14" fill="url(#g)"/><path d="M11 14l3 3 7-7" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
}
