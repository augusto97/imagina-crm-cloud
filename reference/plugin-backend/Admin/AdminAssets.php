<?php
declare(strict_types=1);

namespace ImaginaCRM\Admin;

use ImaginaCRM\Permissions\CapabilityRegistry;
use ImaginaCRM\Plugin;

/**
 * Registra y enqueuea los assets del admin SPA generados por Vite.
 *
 * Lee `dist/.vite/manifest.json` para resolver entradas + chunks. Sólo se
 * enqueuean cuando estamos en la página del plugin (`?page=imagina-crm`),
 * cumpliendo el contrato de rendimiento "impacto ≤ 15ms en TTFB" del resto
 * del wp-admin.
 */
final class AdminAssets
{
    private const HANDLE   = 'imagina-crm-admin';
    private const ENTRY    = 'app/main.tsx';
    private const MANIFEST = 'dist/manifest.json';

    public function register(): void
    {
        add_action('admin_enqueue_scripts', [$this, 'maybeEnqueue']);
        // El bundle de Vite usa sintaxis ES modules (import/export).
        // `wp_script_add_data($handle, 'type', 'module')` NO modifica el
        // <script> tag en stock WP — el dato se ignora al renderizar.
        // Filtramos `script_loader_tag` para agregar `type="module"` a
        // nuestro handle, sin esto el browser falla con "Cannot use
        // import statement outside a module" y el SPA no monta.
        add_filter('script_loader_tag', [$this, 'addModuleTypeAttribute'], 10, 3);
        // Mismo opt-out de Cloudflare Rocket Loader para los styles
        // del admin — sin esto los CSS chunks pueden demorar.
        add_filter('style_loader_tag', [$this, 'addStyleCfasyncAttribute'], 10, 2);
    }

    public function maybeEnqueue(string $hookSuffix): void
    {
        if (! $this->isPluginPage($hookSuffix)) {
            return;
        }

        $manifest = $this->loadManifest();

        if ($manifest === null) {
            add_action('admin_notices', [$this, 'renderBuildMissingNotice']);
            return;
        }

        $entry = $manifest[self::ENTRY] ?? null;

        if (! is_array($entry) || ! isset($entry['file']) || ! is_string($entry['file'])) {
            add_action('admin_notices', [$this, 'renderBuildMissingNotice']);
            return;
        }

        $distUrl = trailingslashit(IMAGINA_CRM_URL . 'dist');

        wp_enqueue_script(
            self::HANDLE,
            $distUrl . $entry['file'],
            [],
            Plugin::VERSION,
            true
        );

        // Marca el handle para que `addModuleTypeAttribute` lo reconozca.
        // El dato propio no afecta el render — sólo lo usamos como flag
        // interno. (El cambio real lo hace el filtro registrado en
        // register().)
        wp_script_add_data(self::HANDLE, 'type', 'module');

        // Registra el handle como traducible: WordPress buscará archivos
        // `imagina-crm-<locale>-<handle>.json` en `languages/` para servir
        // las traducciones a `@wordpress/i18n` en el bundle.
        wp_set_script_translations(
            self::HANDLE,
            Plugin::TEXT_DOMAIN,
            IMAGINA_CRM_DIR . 'languages',
        );

        if (isset($entry['css']) && is_array($entry['css'])) {
            foreach ($entry['css'] as $index => $cssFile) {
                if (! is_string($cssFile)) {
                    continue;
                }
                wp_enqueue_style(
                    self::HANDLE . '-' . (int) $index,
                    $distUrl . $cssFile,
                    [],
                    Plugin::VERSION
                );
            }
        }

        wp_localize_script(self::HANDLE, 'IMAGINA_CRM_BOOT', $this->bootData());
    }

    /**
     * Filtra el `<script>` tag de nuestro handle para agregar
     * `type="module"` y `data-cfasync="false"`. WordPress no expone
     * estos atributos via API estable; el filtro `script_loader_tag`
     * es el camino correcto. Defensivo: si ya tiene un `type=` (otro
     * plugin lo añadió), no lo duplicamos.
     *
     * **`data-cfasync="false"`** — opt-out de **Cloudflare Rocket
     * Loader**. Rocket Loader intercepta los `<script>` y los
     * re-ejecuta de forma asíncrona desde su propio runtime, lo que
     * rompe los ES modules y los `import()` dinámicos que usa Vite.
     * Síntoma típico: chunks lazy (Kanban/Cards/Calendar) que se
     * quedan en "Cargando..." infinito al primer acceso porque el
     * dynamic import nunca resuelve, pero funciona al segundo intento
     * porque el chunk ya está en cache del browser. Más en
     * https://developers.cloudflare.com/fundamentals/speed/rocket-loader/
     * El atributo no afecta a usuarios sin Rocket Loader activo.
     */
    public function addModuleTypeAttribute(string $tag, string $handle, string $src): string
    {
        unset($src);
        if ($handle !== self::HANDLE) {
            return $tag;
        }
        if (str_contains($tag, ' type=')) {
            return $tag;
        }
        return preg_replace(
            '/<script\s/i',
            '<script type="module" data-cfasync="false" ',
            $tag,
            1
        ) ?? $tag;
    }

    /**
     * Filtra el `<link>` de los stylesheets enqueued por nosotros
     * para agregar `data-cfasync="false"` — mismo motivo que el
     * script: Rocket Loader puede demorar la carga de CSS si lo
     * trata como recurso third-party.
     */
    public function addStyleCfasyncAttribute(string $tag, string $handle): string
    {
        if (! str_starts_with($handle, self::HANDLE)) {
            return $tag;
        }
        if (str_contains($tag, 'data-cfasync=')) {
            return $tag;
        }
        return preg_replace(
            '/<link\s/i',
            '<link data-cfasync="false" ',
            $tag,
            1
        ) ?? $tag;
    }

    public function renderBuildMissingNotice(): void
    {
        echo '<div class="notice notice-error"><p>';
        echo esc_html__(
            'Imagina CRM: el bundle del admin no está construido. Ejecuta "npm install && npm run build" en el directorio del plugin.',
            'imagina-crm'
        );
        echo '</p></div>';
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
            'adminUrl'  => esc_url_raw(admin_url('admin.php?page=' . Plugin::ADMIN_PAGE)),
            'assetsUrl' => esc_url_raw(IMAGINA_CRM_URL . 'dist/'),
            'locale'    => str_replace('_', '-', get_user_locale()),
            'timezone'  => wp_timezone_string(),
            'user'      => [
                'id'           => $user->ID,
                'displayName'  => $user->display_name,
                'avatar'       => get_avatar_url($user->ID, ['size' => 64]) ?: '',
                'roles'        => array_values($user->roles),
                'capabilities' => array_merge(
                    [
                        // Back-compat: el SPA antes leía solo `manage_options`.
                        // Nuevo código del front (Fase 7+) debe usar las caps
                        // `imcrm_*` directamente.
                        'manage_options' => current_user_can('manage_options'),
                    ],
                    CapabilityRegistry::currentUserCapabilitiesMap(),
                ),
            ],
        ];
    }

    private function isPluginPage(string $hookSuffix): bool
    {
        if ($hookSuffix === 'toplevel_page_' . Plugin::ADMIN_PAGE) {
            return true;
        }

        return isset($_GET['page']) && $_GET['page'] === Plugin::ADMIN_PAGE; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
    }

    /**
     * @return array<string, array<string, mixed>>|null
     */
    private function loadManifest(): ?array
    {
        $path = IMAGINA_CRM_DIR . self::MANIFEST;

        if (! is_readable($path)) {
            return null;
        }

        $contents = file_get_contents($path);

        if ($contents === false) {
            return null;
        }

        $decoded = json_decode($contents, true);

        if (! is_array($decoded)) {
            return null;
        }

        /** @var array<string, array<string, mixed>> $decoded */
        return $decoded;
    }
}
