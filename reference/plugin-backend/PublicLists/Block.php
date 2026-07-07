<?php
declare(strict_types=1);

namespace ImaginaCRM\PublicLists;

/**
 * Bloque Gutenberg `imagina-crm/list` (Fase 8 — 2.D).
 *
 * Server-rendered: el bloque persiste solo sus atributos en el contenido
 * del post (`<!-- wp:imagina-crm/list {"slug":"precios"} /-->`); el HTML
 * se genera en cada request via `render_callback` reutilizando el
 * `Shortcode::render`. Eso evita duplicar el render entre shortcode y
 * bloque, y garantiza que cualquier mejora futura del shortcode aplique
 * al bloque sin cambios.
 *
 * UI en el editor: por ahora usamos la UI de inspector que WP genera
 * automáticamente a partir de la `attributes` schema (un input por
 * atributo). Una iteración futura puede agregar un JS de editor con
 * autocomplete de slugs y preview en vivo.
 */
final class Block
{
    public const NAME = 'imagina-crm/list';

    public function __construct(private readonly Shortcode $shortcode)
    {
    }

    public function register(): void
    {
        // El bloque solo puede registrarse desde `init` o más tarde.
        add_action('init', [$this, 'registerBlock']);
    }

    public function registerBlock(): void
    {
        if (! function_exists('register_block_type')) {
            return; // WP < 5.0 — improbable dado nuestros requisitos.
        }

        register_block_type(self::NAME, [
            // PHPStan-WordPress (stubs) declara api_version como string;
            // WP core también acepta integer pero string evita el error.
            'api_version'      => '3',
            'title'            => __('Lista Imagina CRM', 'imagina-crm'),
            'description'      => __('Inserta una lista pública del CRM en el contenido.', 'imagina-crm'),
            'category'         => 'widgets',
            'icon'             => 'database-view',
            'keywords'         => ['crm', 'lista', 'list', 'imagina'],
            'attributes'       => [
                'slug' => [
                    'type'    => 'string',
                    'default' => '',
                ],
                'perPage' => [
                    'type' => 'integer',
                ],
                'extraClass' => [
                    'type'    => 'string',
                    'default' => '',
                ],
            ],
            'supports'         => [
                'html'             => false,
                'customClassName'  => true,
                'align'            => ['wide', 'full'],
            ],
            'render_callback'  => [$this, 'renderBlock'],
        ]);
    }

    /**
     * Callback de render. Recibe los atributos del bloque y delega al
     * shortcode, que ya tiene el render server-side completo. Si el
     * usuario no llenó el slug, devuelve un placeholder amigable para
     * que sepa que falta configurar.
     *
     * @param array<string, mixed> $attributes
     */
    public function renderBlock(array $attributes): string
    {
        $slug = isset($attributes['slug']) && is_string($attributes['slug'])
            ? trim($attributes['slug'])
            : '';

        if ($slug === '') {
            // Placeholder visible solo a usuarios que pueden editar
            // (admins) — en frontend público devolvemos vacío para no
            // mostrar mensajes técnicos a visitantes.
            if (function_exists('current_user_can') && current_user_can('edit_posts')) {
                return '<div class="imcrm-public-list imcrm-public-list--placeholder">'
                    . esc_html__('Configura el slug de la lista en el panel lateral del bloque.', 'imagina-crm')
                    . '</div>';
            }
            return '';
        }

        $atts = ['slug' => $slug];
        if (isset($attributes['perPage']) && is_numeric($attributes['perPage'])) {
            $atts['per_page'] = (string) (int) $attributes['perPage'];
        }
        if (isset($attributes['extraClass']) && is_string($attributes['extraClass']) && $attributes['extraClass'] !== '') {
            $atts['class'] = $attributes['extraClass'];
        }

        return $this->shortcode->render($atts);
    }
}
