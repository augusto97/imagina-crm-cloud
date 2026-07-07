<?php
declare(strict_types=1);

namespace ImaginaCRM\PublicLists;

use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Support\ValidationResult;

/**
 * Shortcode `[imcrm-list]` (Fase 8 — 2.B).
 *
 * Renderiza una lista pública del CRM dentro del frontend del tema.
 * El render es 100% server-side en esta iteración: HTML indexable por
 * buscadores + first paint sin necesidad de JS. La hidratación
 * (filtros/sort/paginación dinámicos) llega en 2.C con el bundle
 * `app/public.tsx`.
 *
 * Atributos:
 *   - `slug` (requerido): slug de la lista. Debe tener
 *     `settings.public.enabled = true`.
 *   - `per_page` (opcional): override del `per_page` del config.
 *     Clampeado a [1, 100].
 *   - `class` (opcional): clase CSS adicional para el wrapper.
 *
 * Si la lista no existe o no es pública: el shortcode devuelve string
 * vacío (no rompe el render del contenido). En modo debug podría
 * mostrar un comentario HTML — por ahora silencioso para no leakear
 * existencia.
 *
 * Marcas de hidratación: el bundle público leerá
 *   `data-imcrm-public-list` (slug)
 *   `data-imcrm-config`      (JSON con la config UI: per_page, sort
 *                             permitido, etc.)
 *   `data-imcrm-initial`     (JSON con la primera página + meta)
 * para hidratar el `<div>` con React preservando el primer paint.
 */
final class Shortcode
{
    public const TAG = 'imcrm-list';

    public function __construct(private readonly PublicListReader $service)
    {
    }

    public function register(): void
    {
        if (function_exists('add_shortcode')) {
            add_shortcode(self::TAG, [$this, 'render']);
        }
    }

    /**
     * @param array<string, string>|string $atts  Atributos del shortcode.
     */
    public function render(mixed $atts): string
    {
        $atts = is_array($atts) ? $atts : [];
        $slug = isset($atts['slug']) ? (string) $atts['slug'] : '';
        if ($slug === '') {
            return '';
        }

        $list = $this->service->findPublicList($slug);
        if ($list === null) {
            return '';
        }

        $config = $this->service->configFor($list);
        $extraClass = isset($atts['class']) && is_string($atts['class']) ? trim($atts['class']) : '';

        // Per-page override del shortcode, clampeado al máximo permitido.
        $perPage = $config->perPage;
        if (isset($atts['per_page']) && is_numeric($atts['per_page'])) {
            $perPage = max(1, min(PublicListConfig::MAX_PER_PAGE, (int) $atts['per_page']));
        }

        $initial = $this->service->fetchRecords($list, [
            'page'     => 1,
            'per_page' => $perPage,
            'sort'     => null,
            'search'   => null,
            'filter'   => [],
        ]);

        if ($initial instanceof ValidationResult) {
            // El service devolvió error de validación — probablemente un
            // mis-config en `fixed_filter_tree`. No queremos romper la
            // página del tema; devolvemos vacío.
            return '';
        }

        // Las columnas vienen de `metaFor()` que ya las proyecta solo a
        // las visibles, en el orden declarado por el admin en
        // `visible_field_slugs`. Esto evita acoplar el shortcode al
        // FieldRepository directamente.
        $meta = $this->service->metaFor($list);
        $columns = [];
        if (isset($meta['fields']) && is_array($meta['fields'])) {
            foreach ($meta['fields'] as $f) {
                if (! is_array($f)) {
                    continue;
                }
                $columns[] = [
                    'slug'   => (string) ($f['slug'] ?? ''),
                    'label'  => (string) ($f['label'] ?? ''),
                    'type'   => (string) ($f['type'] ?? 'text'),
                    // Config del field — útil para que el bundle JS arme
                    // dropdowns de filtro con las options correctas
                    // (select / multi_select) y no exponga nada sensible
                    // (es la misma config que se serializa al admin).
                    // Fase 12.E.
                    'config' => isset($f['config']) && is_array($f['config']) ? $f['config'] : [],
                ];
            }
        }

        $configForClient = [
            'slug'                 => $list->slug,
            'name'                 => $list->name,
            'description'          => $list->description,
            'per_page'             => $perPage,
            'viewer_filters'       => $config->viewerFiltersAllowed,
            'sort_allowed_slugs'   => $config->sortAllowedSlugs,
            'default_sort'         => $config->defaultSort,
            'search_enabled'       => $config->searchEnabled,
            'visible_field_slugs'  => $config->visibleFieldSlugs,
            // Columnas completas (slug, label, type) — el bundle JS
            // necesita el `type` para formatear celdas (checkbox, url,
            // email, etc.) en re-renders tras filtrar/paginar.
            'columns'              => $columns,
            'rest_root'            => function_exists('rest_url') ? rest_url('imagina-crm/v1') : '',
        ];

        ob_start();
        ?>
        <div
            class="<?php echo esc_attr(trim('imcrm-public-list ' . $extraClass)); ?>"
            data-imcrm-public-list="<?php echo esc_attr($list->slug); ?>"
            data-imcrm-config="<?php echo esc_attr((string) wp_json_encode($configForClient)); ?>"
            data-imcrm-initial="<?php echo esc_attr((string) wp_json_encode($initial)); ?>"
        >
            <?php if ($list->description !== null && $list->description !== ''): ?>
                <p class="imcrm-public-list__description">
                    <?php echo esc_html($list->description); ?>
                </p>
            <?php endif; ?>

            <?php if ($columns === [] || $initial['data'] === []): ?>
                <p class="imcrm-public-list__empty">
                    <?php echo esc_html__('No hay registros para mostrar.', 'imagina-crm'); ?>
                </p>
            <?php else: ?>
                <div class="imcrm-public-list__table-wrap">
                    <table class="imcrm-public-list__table">
                        <thead>
                            <tr>
                                <?php foreach ($columns as $col): ?>
                                    <th scope="col">
                                        <?php echo esc_html($col['label']); ?>
                                    </th>
                                <?php endforeach; ?>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($initial['data'] as $record): ?>
                                <tr>
                                    <?php foreach ($columns as $col): ?>
                                        <td data-label="<?php echo esc_attr($col['label']); ?>">
                                            <?php
                                            $value = $this->extractValue($record, $col);
                                            echo $this->formatCellHtml($value, $col);
                                            ?>
                                        </td>
                                    <?php endforeach; // phpcs:ignore ?>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>

                <?php $meta = $initial['meta']; ?>
                <?php if ($meta['total_pages'] > 1): ?>
                    <nav class="imcrm-public-list__pagination" aria-label="<?php echo esc_attr__('Paginación', 'imagina-crm'); ?>">
                        <span class="imcrm-public-list__page-info">
                            <?php
                            echo esc_html(sprintf(
                                /* translators: 1: current page, 2: total pages */
                                __('Página %1$d de %2$d', 'imagina-crm'),
                                $meta['page'],
                                $meta['total_pages'],
                            ));
                            ?>
                        </span>
                        <span class="imcrm-public-list__total">
                            <?php
                            echo esc_html(sprintf(
                                /* translators: %d: total records */
                                _n('%d registro', '%d registros', (int) $meta['total'], 'imagina-crm'),
                                $meta['total'],
                            ));
                            ?>
                        </span>
                    </nav>
                <?php endif; ?>
            <?php endif; ?>
        </div>
        <?php
        return (string) ob_get_clean();
    }

    /**
     * Extrae el valor del record para una columna concreta. Maneja la
     * diferencia entre fields normales (en `record.fields[slug]`) y
     * relation (en `record.relations[slug]`).
     *
     * @param array<string, mixed>            $record
     * @param array{slug:string, type:string, label:string} $col
     */
    private function extractValue(array $record, array $col): mixed
    {
        if ($col['type'] === 'relation') {
            $relations = is_array($record['relations'] ?? null) ? $record['relations'] : [];
            return $relations[$col['slug']] ?? null;
        }
        $fields = is_array($record['fields'] ?? null) ? $record['fields'] : [];
        return $fields[$col['slug']] ?? null;
    }

    /**
     * Renderiza el valor de una celda en HTML server-side. Paridad de
     * formato con `app/public/cellFormat.tsx` — el primer paint del
     * shortcode (PHP) muestra exactamente lo mismo que el render
     * hidratado de React, sin "flash" al cargar el bundle.
     *
     * @param array{slug:string, type:string, label:string, config:array<string,mixed>} $col
     */
    private function formatCellHtml(mixed $value, array $col): string
    {
        if ($value === null || $value === '') {
            return '<span class="imcrm-public-list__empty-cell">—</span>';
        }
        $cfg = is_array($col['config'] ?? null) ? $col['config'] : [];

        switch ($col['type']) {
            case 'url':
                $url = is_string($value) ? $value : '';
                $display = preg_replace('#^https?://#', '', rtrim($url, '/')) ?? $url;
                return sprintf(
                    '<a href="%1$s" target="_blank" rel="noopener noreferrer">%2$s</a>',
                    esc_url($url),
                    esc_html($display),
                );
            case 'email':
                $email = is_string($value) ? $value : '';
                return sprintf(
                    '<a href="mailto:%1$s">%2$s</a>',
                    esc_attr($email),
                    esc_html($email),
                );
            case 'checkbox':
                $truthy = $value === true || $value === 1 || $value === '1';
                return $truthy
                    ? '<span aria-label="' . esc_attr__('Sí', 'imagina-crm') . '" class="imcrm-public-list__check">✓</span>'
                    : '<span aria-label="' . esc_attr__('No', 'imagina-crm') . '" class="imcrm-public-list__empty-cell">—</span>';
            case 'select':
                return $this->renderChip((string) $value, $cfg);
            case 'multi_select':
                if (! is_array($value)) {
                    return esc_html((string) $value);
                }
                $chips = array_map(
                    fn ($v): string => $this->renderChip((string) $v, $cfg),
                    $value,
                );
                return '<span class="imcrm-public-list__chips">' . implode('', $chips) . '</span>';
            case 'date':
                if (! is_string($value)) {
                    return esc_html(is_scalar($value) ? (string) $value : '');
                }
                $ts = strtotime($value);
                if ($ts === false) return esc_html($value);
                // Locale del site para que coincida con
                // `Date.toLocaleDateString()` del cliente (aprox.).
                return esc_html(wp_date(get_option('date_format', 'Y-m-d'), $ts));
            case 'datetime':
                if (! is_string($value)) {
                    return esc_html(is_scalar($value) ? (string) $value : '');
                }
                // El backend devuelve UTC `YYYY-MM-DD HH:MM:SS`.
                $ts = strtotime($value . ' UTC');
                if ($ts === false) return esc_html($value);
                $fmt = get_option('date_format', 'Y-m-d') . ' ' . get_option('time_format', 'H:i');
                return esc_html(wp_date($fmt, $ts));
            case 'currency': {
                if (! is_numeric($value)) {
                    return esc_html((string) $value);
                }
                $num      = (float) $value;
                $currency = is_string($cfg['currency'] ?? null) ? $cfg['currency'] : 'COP';
                $decimals = is_int($cfg['decimals'] ?? null) ? $cfg['decimals'] : 0;
                $formatted = number_format(
                    $num,
                    $decimals,
                    // Locale-agnostic — usamos formato US default. El JS
                    // cliente usa Intl.NumberFormat con locale del browser
                    // y puede diferir en separadores; aceptamos el delta
                    // porque mantener parser idéntico requeriría una
                    // implementación intl en PHP que es over-kill.
                    '.',
                    ',',
                );
                return '<span class="imcrm-public-list__num">' . esc_html($currency . ' ' . $formatted) . '</span>';
            }
            case 'number': {
                if (! is_numeric($value)) {
                    return esc_html((string) $value);
                }
                $decimals = is_int($cfg['decimals'] ?? null) ? $cfg['decimals'] : 0;
                return '<span class="imcrm-public-list__num">' . esc_html(number_format((float) $value, $decimals, '.', ',')) . '</span>';
            }
            case 'long_text': {
                $escaped = esc_html(is_scalar($value) ? (string) $value : '');
                return '<span class="imcrm-public-list__long">' . nl2br($escaped) . '</span>';
            }
            case 'user':
                return '<span class="imcrm-public-list__empty-cell">@' . esc_html((string) $value) . '</span>';
            default:
                return esc_html(is_scalar($value) ? (string) $value : '');
        }
    }

    /**
     * Renderiza un chip de select/multi_select aplicando el color
     * configurado en la opción. Paridad con `chipStyle()` del JS.
     *
     * @param array<string, mixed> $fieldConfig
     */
    private function renderChip(string $value, array $fieldConfig): string
    {
        $options = is_array($fieldConfig['options'] ?? null) ? $fieldConfig['options'] : [];
        $opt = null;
        foreach ($options as $o) {
            if (is_array($o) && ($o['value'] ?? null) === $value) {
                $opt = $o;
                break;
            }
        }
        $label = is_array($opt) && is_string($opt['label'] ?? null) ? (string) $opt['label'] : $value;
        $color = is_array($opt) && is_string($opt['color'] ?? null) ? (string) $opt['color'] : '';

        $style = $this->chipStyleString($color);
        $styleAttr = $style !== '' ? ' style="' . esc_attr($style) . '"' : '';

        return '<span class="imcrm-public-list__chip"' . $styleAttr . '>' . esc_html($label) . '</span>';
    }

    private const PRESET_COLORS = [
        'gray', 'slate', 'rose', 'red', 'orange', 'amber', 'yellow', 'lime',
        'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
        'fuchsia', 'pink',
    ];

    /**
     * Genera el `style="..."` inline para un chip soft. Paridad con
     * `chipStyle()` del JS público (mismas variables CSS / alpha hex).
     */
    private function chipStyleString(string $color): string
    {
        if ($color === '') return '';
        if (in_array($color, self::PRESET_COLORS, true)) {
            $base = "var(--imcrm-public-opt-{$color})";
            $text = "var(--imcrm-public-opt-{$color}-text)";
            return "background-color: hsl({$base} / 0.14); border-color: hsl({$base} / 0.32); color: hsl({$text});";
        }
        if (preg_match('/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/', $color) === 1) {
            return "background-color: {$color}24; border-color: {$color}52; color: {$color};";
        }
        return '';
    }
}
