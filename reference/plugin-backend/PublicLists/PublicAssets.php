<?php
declare(strict_types=1);

namespace ImaginaCRM\PublicLists;

use ImaginaCRM\Plugin;

/**
 * Enqueue de assets para el shortcode/bloque `[imcrm-list]` (Fase 8 — 2.B/2.C).
 *
 * Estrategia para no penalizar el TTFB del frontend:
 *
 *  1. Registramos el hook en `wp_enqueue_scripts` (cheap — solo
 *     declara el callback, no carga nada).
 *  2. Usamos `wp_enqueue_*` solo si la página contiene el shortcode o
 *     el bloque. Esto se detecta perezosamente vía `has_shortcode` /
 *     `has_block`.
 *  3. Para páginas que no consumen el shortcode, NADA se carga →
 *     impacto cero en TTFB.
 *
 * Assets cargados (cuando aplica):
 *   - CSS base `assets/public-list.css` (sin Tailwind, override-able
 *     por el tema vía variables `--imcrm-public-*`).
 *   - Bundle JS público + sus deps (chunk `vendor-react` compartido).
 *     Vite emite `dist/manifest.json` con la lista de chunks de cada
 *     entry — la leemos en runtime para resolver los hashes.
 */
final class PublicAssets
{
    public const HANDLE_CSS    = 'imagina-crm-public-list';
    public const HANDLE_JS     = 'imagina-crm-public';
    public const MANIFEST_PATH = 'dist/manifest.json';
    public const ENTRY_KEY     = 'app/public.tsx';

    public function register(): void
    {
        add_action('wp_enqueue_scripts', [$this, 'maybeEnqueue']);
        // Igual que AdminAssets: el bundle Vite usa ES modules
        // (`import`/`export`). El tag `<script>` necesita `type="module"`
        // para que el browser lo parse correctamente.
        add_filter('script_loader_tag', [$this, 'addModuleTypeAttribute'], 10, 3);
    }

    public function maybeEnqueue(): void
    {
        if (! $this->currentPageNeedsAssets()) {
            return;
        }

        // CSS siempre — funciona sin JS para el first paint del shortcode.
        wp_enqueue_style(
            self::HANDLE_CSS,
            IMAGINA_CRM_URL . 'assets/public-list.css',
            [],
            Plugin::VERSION,
        );

        // JS: solo si el manifest está disponible y el entry resuelve.
        // Sin manifest seguimos sirviendo el HTML server-side del
        // shortcode (sin interactividad), no se rompe nada.
        $manifest = $this->loadManifest();
        if ($manifest === null) {
            return;
        }
        $entry = $manifest[self::ENTRY_KEY] ?? null;
        if (! is_array($entry) || ! isset($entry['file']) || ! is_string($entry['file'])) {
            return;
        }

        $distUrl = trailingslashit(IMAGINA_CRM_URL . 'dist');
        $entryUrl = $distUrl . $entry['file'];

        // Vite emite cada chunk dependency como handle separado. Los
        // declaramos como deps del entry para que WP los emita antes
        // (orden importa por `import` resolution).
        $depHandles = [];
        if (isset($entry['imports']) && is_array($entry['imports'])) {
            foreach ($entry['imports'] as $depKey) {
                if (! is_string($depKey) || ! isset($manifest[$depKey]['file'])) {
                    continue;
                }
                $depFile = $manifest[$depKey]['file'];
                if (! is_string($depFile)) {
                    continue;
                }
                $handle = self::HANDLE_JS . '-' . sanitize_key(basename($depKey, '.js'));
                wp_enqueue_script($handle, $distUrl . $depFile, [], Plugin::VERSION, true);
                wp_script_add_data($handle, 'type', 'module');
                $depHandles[] = $handle;
            }
        }

        wp_enqueue_script(
            self::HANDLE_JS,
            $entryUrl,
            $depHandles,
            Plugin::VERSION,
            true,
        );
        wp_script_add_data(self::HANDLE_JS, 'type', 'module');
    }

    /**
     * Marca el `<script>` de nuestros handles como `type="module"`. Sin
     * esto el browser falla al parsear los `import`. Igual estrategia
     * que `AdminAssets::addModuleTypeAttribute`.
     */
    public function addModuleTypeAttribute(string $tag, string $handle, string $src): string
    {
        unset($src);
        if (! str_starts_with($handle, self::HANDLE_JS)) {
            return $tag;
        }
        if (str_contains($tag, ' type=')) {
            return $tag;
        }
        return preg_replace('/<script\s/i', '<script type="module" ', $tag, 1) ?? $tag;
    }

    /**
     * `true` si la página actual contiene el shortcode `[imcrm-list]` o
     * el bloque Gutenberg `imagina-crm/list` (este último llega en 2.D).
     */
    private function currentPageNeedsAssets(): bool
    {
        if (! function_exists('get_post')) {
            return false;
        }
        $post = get_post();
        if ($post === null) {
            return false;
        }

        $content = (string) $post->post_content;
        if ($content === '') {
            return false;
        }

        $hasShortcode = function_exists('has_shortcode') && has_shortcode($content, Shortcode::TAG);
        $hasBlock = function_exists('has_block') && has_block('imagina-crm/list', $content);

        if (function_exists('apply_filters')) {
            $forced = (bool) apply_filters('imagina_crm/public_list/force_enqueue', false, $post);
            if ($forced) {
                return true;
            }
        }
        return $hasShortcode || $hasBlock;
    }

    /**
     * @return array<string, array<string, mixed>>|null
     */
    private function loadManifest(): ?array
    {
        $path = IMAGINA_CRM_DIR . self::MANIFEST_PATH;
        if (! is_readable($path)) {
            return null;
        }
        $raw = file_get_contents($path);
        if ($raw === false) {
            return null;
        }
        $decoded = json_decode($raw, true);
        if (! is_array($decoded)) {
            return null;
        }
        /** @var array<string, array<string, mixed>> $decoded */
        return $decoded;
    }
}
