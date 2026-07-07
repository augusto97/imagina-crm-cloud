<?php
declare(strict_types=1);

namespace ImaginaCRM\PublicLists;

use ImaginaCRM\Lists\ListRepository;

/**
 * Permalinks dedicados para listas públicas (Fase 10 — pulidos).
 *
 * Cuando una lista tiene `settings.public.permalink_base = "precios"`,
 * el plugin registra un rewrite rule `^precios/?$` que renderiza
 * la lista en una página con header + footer del tema activo. Sin
 * tener que crear una página WP con el shortcode manualmente.
 *
 * Convivencia con el sitio:
 *  - Si el slug elegido colisiona con una page/post existente, el
 *    rewrite rule del plugin gana (registrado con priority `top`).
 *  - Admin que quiere dejar de usar el permalink: vacía el campo en
 *    el List Builder → el rule se desregistra en el próximo flush.
 *  - Si el sitio usa permalinks "plain" (`?p=N`), las rules no
 *    funcionan — el feature requiere "pretty permalinks" activo.
 *
 * Flush automático:
 *   `imcrm_public_permalinks_signature` en wp_options guarda un hash
 *   del array `[list_slug => permalink_base]` actual. En cada
 *   `wp_loaded`, recomputamos la signature; si difiere, hacemos
 *   `flush_rewrite_rules(false)`. Cubre el caso "admin actualiza un
 *   permalink desde la UI" sin que tenga que ir a Settings →
 *   Permalinks → Save.
 */
final class PublicPermalinks
{
    public const QUERY_VAR        = 'imcrm_public_list';
    public const SIGNATURE_OPTION = 'imcrm_public_permalinks_signature';

    public function __construct(private readonly ListRepository $lists)
    {
    }

    public function register(): void
    {
        add_action('init', [$this, 'registerRewriteRules']);
        add_filter('query_vars', [$this, 'registerQueryVar']);
        add_action('wp_loaded', [$this, 'maybeFlush'], 20);
        // Priority 5: corre antes del render del tema. Si hay match
        // del query var, hacemos el render nuestro y exit (no llega
        // al template del tema con content vacío).
        add_action('template_redirect', [$this, 'maybeRender'], 5);
    }

    /**
     * Registra una rewrite rule por cada lista con permalink_base.
     * Se llama en `init`. La iteración usa ListRepository (cacheado)
     * — costo bajo por request.
     */
    public function registerRewriteRules(): void
    {
        if (! function_exists('add_rewrite_rule')) {
            return;
        }
        foreach ($this->listsWithPermalinks() as $list) {
            $config = PublicListConfig::fromListSettings($list->settings);
            if ($config->permalinkBase === null || ! $config->enabled) {
                continue;
            }
            add_rewrite_rule(
                '^' . preg_quote($config->permalinkBase, '/') . '/?$',
                'index.php?' . self::QUERY_VAR . '=' . rawurlencode($list->slug),
                'top',
            );
        }
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

    /**
     * Detecta el query var, resuelve la lista y renderiza la página
     * dedicada usando el template del tema. Usa el shortcode existente
     * para no duplicar el render — toda la lógica de hidratación,
     * security, etc. vive en `Shortcode::render`.
     */
    public function maybeRender(): void
    {
        $listSlug = get_query_var(self::QUERY_VAR);
        if (! is_string($listSlug) || $listSlug === '') {
            return;
        }

        $list = $this->lists->findBySlug($listSlug);
        if ($list === null) {
            // El permalink existe pero la lista fue borrada después.
            // Dejamos que WP devuelva 404 normal (no consumimos el request).
            return;
        }
        $config = PublicListConfig::fromListSettings($list->settings);
        if (! $config->enabled || $config->permalinkBase === null) {
            // El admin desactivó la lista pero el rewrite rule sigue
            // cacheado en .htaccess. Dejamos que WP siga con 404.
            return;
        }

        // Renderizamos con el template del tema: header + content +
        // footer. Esto preserva el chrome del sitio (logo, menú,
        // footer del tema) y la lista aparece "embebida" en la página
        // donde el visitante esperaría.
        status_header(200);
        nocache_headers();
        get_header();
        echo '<main class="imcrm-public-permalink-main">';
        // Reusamos el shortcode existente — toda la lógica de
        // render server-side, atributos data-* para hidratación y
        // estilos viven ahí.
        echo do_shortcode(sprintf('[imcrm-list slug="%s"]', esc_attr($list->slug)));
        echo '</main>';
        get_footer();
        exit;
    }

    /**
     * Si la firma actual del set de permalinks difiere de la
     * guardada en wp_options, hacemos flush. Cubre el caso "admin
     * añadió/quitó/cambió un permalink_base" sin requerir un flush
     * manual desde Settings → Permalinks.
     */
    public function maybeFlush(): void
    {
        if (! function_exists('flush_rewrite_rules')) {
            return;
        }
        $currentSig = $this->computeSignature();
        $storedSig  = get_option(self::SIGNATURE_OPTION, '');
        if ($currentSig === $storedSig) {
            return;
        }
        flush_rewrite_rules(false);
        update_option(self::SIGNATURE_OPTION, $currentSig, false);
    }

    /**
     * Hash determinístico del set actual de `[list_slug => permalink_base]`.
     * Si la signature cambia → necesitamos flush.
     */
    private function computeSignature(): string
    {
        $map = [];
        foreach ($this->listsWithPermalinks() as $list) {
            $cfg = PublicListConfig::fromListSettings($list->settings);
            if ($cfg->permalinkBase === null || ! $cfg->enabled) {
                continue;
            }
            $map[$list->slug] = $cfg->permalinkBase;
        }
        ksort($map);
        return md5((string) wp_json_encode($map));
    }

    /**
     * Iterador interno: lista todas las listas con `permalink_base`
     * declarado en settings.public. Itera vía `ListRepository::all()`
     * que va cacheada en object cache.
     *
     * @return iterable<\ImaginaCRM\Lists\ListEntity>
     */
    private function listsWithPermalinks(): iterable
    {
        foreach ($this->lists->all() as $list) {
            $raw = $list->settings['public'] ?? null;
            if (! is_array($raw) || ! isset($raw['permalink_base'])) {
                continue;
            }
            yield $list;
        }
    }
}
