<?php
declare(strict_types=1);

namespace ImaginaCRM\Portal;

use ImaginaCRM\Plugin;

/**
 * Enqueue lazy de los assets del portal (Fase 9 — 3.B + 3.D).
 *
 * Solo carga CSS+JS en páginas que contienen el shortcode
 * `[imcrm-client-portal]`. Impacto cero en TTFB para el resto del
 * sitio.
 *
 * Mismo patrón que `PublicAssets` de Fase 8 — lee `dist/manifest.json`
 * para resolver el hash del bundle.
 */
final class PortalAssets
{
    public const HANDLE_CSS    = 'imagina-crm-portal';
    public const HANDLE_JS     = 'imagina-crm-portal-js';
    public const MANIFEST_PATH = 'dist/manifest.json';
    public const ENTRY_KEY     = 'app/portal.tsx';

    public function register(): void
    {
        add_action('wp_enqueue_scripts', [$this, 'maybeEnqueue']);
        add_filter('script_loader_tag', [$this, 'addModuleTypeAttribute'], 10, 3);
    }

    public function maybeEnqueue(): void
    {
        if (! $this->currentPageNeedsAssets()) {
            return;
        }

        wp_enqueue_style(
            self::HANDLE_CSS,
            IMAGINA_CRM_URL . 'assets/portal.css',
            [],
            Plugin::VERSION,
        );

        $manifest = $this->loadManifest();
        if ($manifest === null) {
            return;
        }
        $entry = $manifest[self::ENTRY_KEY] ?? null;
        if (! is_array($entry) || ! isset($entry['file']) || ! is_string($entry['file'])) {
            return;
        }

        $distUrl = trailingslashit(IMAGINA_CRM_URL . 'dist');

        // Deps del entry (chunk `vendor-react` compartido con admin + público).
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
            $distUrl . $entry['file'],
            $depHandles,
            Plugin::VERSION,
            true,
        );
        wp_script_add_data(self::HANDLE_JS, 'type', 'module');
    }

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
        return function_exists('has_shortcode') && has_shortcode($content, PortalShortcode::TAG);
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
