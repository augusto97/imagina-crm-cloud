<?php
declare(strict_types=1);

namespace ImaginaCRM\Dashboards;

use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Support\ValidationResult;

/**
 * Casos de uso de Dashboards.
 *
 * Tipos de widget soportados:
 * - `kpi`: un número grande con label. Config: `metric` ∈
 *   {count, sum, avg}; para sum/avg también `metric_field_id`
 *   (debe ser `number` o `currency`).
 * - `chart_bar`: barras agrupadas por las options de un campo `select`.
 *   Config: `group_by_field_id`.
 * - `chart_line`: serie temporal por mes/día sobre un campo `date` o
 *   `datetime`. Config: `date_field_id`.
 *
 * Filtros opcionales `filters` por widget se aceptan tal cual; el
 * `WidgetEvaluator` (commit posterior) los pasará al QueryBuilder.
 *
 * Permisos: dashboards privados (con user_id) sólo los puede editar/
 * borrar el dueño. Dashboards compartidos (user_id NULL) los
 * gestiona cualquier `manage_options` — el REST controller decide.
 */
final class DashboardService
{
    public const ALLOWED_WIDGET_TYPES = [
        'kpi',
        'chart_bar', 'chart_pie',
        'chart_line', 'chart_area',
        'stat_delta',
        'table',
        // 0.57.40 — embudo de etapas (mismo evaluador que chart_bar;
        // el frontend lo renderiza como funnel ordenado por las
        // options del select).
        'funnel',
    ];
    /**
     * Métricas válidas para KPI / charts. Sincronizado con el set que
     * `WidgetEvaluator::resolveMetric` acepta — antes este const solo
     * tenía count/sum/avg y rechazaba al GUARDAR widgets con
     * count_unique/min/max/etc. que el evaluador y el frontend ya
     * soportaban desde 0.36.9.
     */
    public const ALLOWED_KPI_METRICS  = [
        'count', 'count_unique', 'count_empty',
        'sum', 'avg', 'min', 'max',
        'count_true', 'count_false',
    ];
    public const NUMERIC_FIELD_TYPES  = ['number', 'currency'];
    public const DATE_FIELD_TYPES     = ['date', 'datetime'];

    /** Tipos permitidos como dimensión de chart_bar / chart_pie. */
    public const GROUPABLE_FIELD_TYPES = [
        'select', 'multi_select',
        'text', 'email', 'url',
        'date', 'datetime',
        'checkbox',
    ];

    public function __construct(
        private readonly DashboardRepository $repo,
        private readonly ListRepository $lists,
        private readonly FieldRepository $fields,
    ) {
    }

    /**
     * @return array<int, DashboardEntity>
     */
    public function visibleFor(int $userId): array
    {
        return $this->repo->visibleFor($userId);
    }

    public function find(int $id): ?DashboardEntity
    {
        return $this->repo->find($id);
    }

    /**
     * @param array<string, mixed> $input
     */
    public function create(array $input, int $userId): DashboardEntity|ValidationResult
    {
        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '') {
            return ValidationResult::failWith('name', __('El nombre es obligatorio.', 'imagina-crm'));
        }

        $widgets = $this->validateWidgets($input['widgets'] ?? []);
        if ($widgets instanceof ValidationResult) {
            return $widgets;
        }

        $isShared = ! empty($input['is_shared']);
        $id       = $this->repo->insert([
            'user_id'     => $isShared ? null : $userId,
            'name'        => $name,
            'description' => isset($input['description']) ? (string) $input['description'] : null,
            'widgets'     => $widgets,
            'is_default'  => ! empty($input['is_default']),
            'position'    => isset($input['position']) ? (int) $input['position'] : 0,
            'created_by'  => $userId,
        ]);

        if ($id === 0) {
            return ValidationResult::failWith('database', __('No se pudo crear el dashboard.', 'imagina-crm'));
        }

        $created = $this->repo->find($id);
        if ($created === null) {
            return ValidationResult::failWith('database', __('Se creó pero no se pudo leer.', 'imagina-crm'));
        }
        do_action('imagina_crm/dashboard_created', $created);
        return $created;
    }

    /**
     * @param array<string, mixed> $patch
     */
    public function update(int $id, array $patch, int $userId, bool $isAdmin): DashboardEntity|ValidationResult
    {
        $current = $this->repo->find($id);
        if ($current === null) {
            return ValidationResult::failWith('id', __('El dashboard no existe.', 'imagina-crm'));
        }
        if (! $this->canEdit($current, $userId, $isAdmin)) {
            return ValidationResult::failWith('forbidden', __('No tienes permiso para editar este dashboard.', 'imagina-crm'));
        }

        if (isset($patch['name'])) {
            $patch['name'] = trim((string) $patch['name']);
            if ($patch['name'] === '') {
                return ValidationResult::failWith('name', __('El nombre no puede estar vacío.', 'imagina-crm'));
            }
        }

        if (array_key_exists('widgets', $patch)) {
            $widgets = $this->validateWidgets($patch['widgets']);
            if ($widgets instanceof ValidationResult) {
                return $widgets;
            }
            $patch['widgets'] = $widgets;
        }

        $ok = $this->repo->update($id, $patch);
        if (! $ok) {
            return ValidationResult::failWith('database', __('No se pudo actualizar el dashboard.', 'imagina-crm'));
        }

        $updated = $this->repo->find($id);
        if ($updated === null) {
            return ValidationResult::failWith('database', __('No se pudo releer el dashboard.', 'imagina-crm'));
        }
        do_action('imagina_crm/dashboard_updated', $updated, $current);
        return $updated;
    }

    /**
     * Housekeeping: cuando un field se borra, recorre todos los
     * dashboards activos y elimina los widgets que lo referencian
     * (en `metric_field_id`, `group_by_field_id`, `date_field_id`,
     * `sort_field_id`). Se llama desde el hook
     * `imagina_crm/field_deleted`. Sin esto, los dashboards quedaban
     * con widgets orphaned mostrando placeholder de error.
     */
    public function pruneFieldReferences(int $fieldId): void
    {
        if ($fieldId <= 0) {
            return;
        }
        foreach ($this->repo->allActive() as $dash) {
            $next = [];
            $changed = false;
            foreach ($dash->widgets as $w) {
                if (! is_array($w) || ! isset($w['config']) || ! is_array($w['config'])) {
                    $next[] = $w;
                    continue;
                }
                $config = $w['config'];
                $references = [
                    (int) ($config['metric_field_id'] ?? 0),
                    (int) ($config['group_by_field_id'] ?? 0),
                    (int) ($config['date_field_id'] ?? 0),
                    (int) ($config['sort_field_id'] ?? 0),
                ];
                if (in_array($fieldId, $references, true)) {
                    $changed = true;
                    continue; // skip = drop widget
                }
                $next[] = $w;
            }
            if ($changed) {
                $this->repo->update($dash->id, ['widgets' => $next]);
            }
        }
    }

    public function delete(int $id, int $userId, bool $isAdmin): ValidationResult
    {
        $current = $this->repo->find($id);
        if ($current === null) {
            return ValidationResult::failWith('id', __('El dashboard no existe.', 'imagina-crm'));
        }
        if (! $this->canEdit($current, $userId, $isAdmin)) {
            return ValidationResult::failWith('forbidden', __('No tienes permiso para eliminar este dashboard.', 'imagina-crm'));
        }
        if (! $this->repo->softDelete($id)) {
            return ValidationResult::failWith('database', __('No se pudo eliminar el dashboard.', 'imagina-crm'));
        }
        do_action('imagina_crm/dashboard_deleted', $current);
        return ValidationResult::ok();
    }

    /**
     * Valida y normaliza el array de widgets. Devuelve el array normalizado
     * o un ValidationResult con el primer error encontrado.
     *
     * @param mixed $raw
     * @return array<int, array<string, mixed>>|ValidationResult
     */
    private function validateWidgets(mixed $raw): array|ValidationResult
    {
        if ($raw === null || $raw === '') {
            return [];
        }
        if (! is_array($raw)) {
            return ValidationResult::failWith('widgets', __('Los widgets deben ser un array.', 'imagina-crm'));
        }
        $out = [];
        foreach ($raw as $i => $item) {
            $idx = (int) $i;
            if (! is_array($item)) {
                return ValidationResult::failWith(
                    'widgets',
                    sprintf(
                        /* translators: %d: widget index */
                        __('Widget inválido en posición %d.', 'imagina-crm'),
                        $idx,
                    ),
                );
            }

            $type = isset($item['type']) ? (string) $item['type'] : '';
            if (! in_array($type, self::ALLOWED_WIDGET_TYPES, true)) {
                return ValidationResult::failWith(
                    'widgets',
                    sprintf(
                        /* translators: 1: type, 2: widget index */
                        __('Tipo de widget desconocido "%1$s" en posición %2$d.', 'imagina-crm'),
                        $type,
                        $idx,
                    ),
                );
            }

            $listId = isset($item['list_id']) ? (int) $item['list_id'] : 0;
            if ($listId <= 0) {
                return ValidationResult::failWith(
                    'widgets',
                    sprintf(
                        /* translators: %d: widget index */
                        __('Falta la lista del widget en posición %d.', 'imagina-crm'),
                        $idx,
                    ),
                );
            }
            $listExists = $this->lists->find($listId) !== null;

            $config = isset($item['config']) && is_array($item['config']) ? $item['config'] : [];
            // Si la lista referenciada ya no existe (fue borrada),
            // saltamos la validación de config — el widget queda
            // orphaned pero el dashboard se puede seguir editando/
            // borrando. El evaluator mostrará un placeholder.
            if ($listExists) {
                $configError = $this->validateWidgetConfig($type, $listId, $config);
                if ($configError !== null) {
                    return ValidationResult::failWith('widgets', $configError);
                }
            }

            $out[] = [
                'id'     => isset($item['id']) && is_string($item['id']) ? $item['id'] : ('w_' . $idx),
                'type'   => $type,
                'list_id' => $listId,
                'title'  => isset($item['title']) ? (string) $item['title'] : '',
                'config' => $config,
                'layout' => $this->normalizeLayout($item['layout'] ?? null),
            ];
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $config
     */
    private function validateWidgetConfig(string $type, int $listId, array $config): ?string
    {
        // Tolerancia con field refs faltantes: si un campo referenciado
        // ya no existe (e.g. el user borró la columna), NO bloqueamos
        // el save — el widget queda persistido con su config original
        // y el `WidgetEvaluator` muestra un placeholder de error al
        // renderear. Sin esto, una vez que se borraba un campo
        // referenciado, el dashboard quedaba "atrapado" — no se podía
        // editar layout, agregar widgets, ni siquiera eliminar (el
        // grid dispara onLayoutChange que intenta save y fallaba).
        // Fix de 0.30.5 — antes era hard reject.
        $fieldExists = fn (int $id): bool =>
            $id > 0 && $this->fields->find($id) !== null;

        if ($type === 'kpi') {
            $metric = isset($config['metric']) ? (string) $config['metric'] : '';
            if (! in_array($metric, self::ALLOWED_KPI_METRICS, true)) {
                return __('Métrica de KPI no soportada.', 'imagina-crm');
            }
            if (in_array($metric, ['sum', 'avg'], true)) {
                $fieldId = isset($config['metric_field_id']) ? (int) $config['metric_field_id'] : 0;
                if ($fieldId <= 0) {
                    return __('Sum/Avg requieren un campo numérico.', 'imagina-crm');
                }
                if ($fieldExists($fieldId)) {
                    $field = $this->fields->find($fieldId);
                    if ($field !== null && ($field->listId !== $listId || ! in_array($field->type, self::NUMERIC_FIELD_TYPES, true))) {
                        return __('El campo de métrica debe ser tipo number o currency de la misma lista.', 'imagina-crm');
                    }
                }
            }
        }

        if ($type === 'chart_bar' || $type === 'chart_pie' || $type === 'funnel') {
            $fieldId = isset($config['group_by_field_id']) ? (int) $config['group_by_field_id'] : 0;
            if ($fieldId <= 0) {
                return __('El gráfico requiere un campo de agrupación.', 'imagina-crm');
            }
            if ($fieldExists($fieldId)) {
                $field = $this->fields->find($fieldId);
                if (
                    $field !== null
                    && ($field->listId !== $listId
                        || ! in_array($field->type, self::GROUPABLE_FIELD_TYPES, true))
                ) {
                    return __('El campo de agrupación debe ser de un tipo agrupable (select, multi_select, text, email, url, date, datetime o checkbox) de la misma lista.', 'imagina-crm');
                }
            }
        }

        if ($type === 'chart_line' || $type === 'chart_area') {
            $fieldId = isset($config['date_field_id']) ? (int) $config['date_field_id'] : 0;
            if ($fieldId <= 0) {
                return __('El gráfico de línea requiere un campo de fecha.', 'imagina-crm');
            }
            if ($fieldExists($fieldId)) {
                $field = $this->fields->find($fieldId);
                if ($field !== null && ($field->listId !== $listId || ! in_array($field->type, self::DATE_FIELD_TYPES, true))) {
                    return __('El campo de fecha debe ser tipo date o datetime de la misma lista.', 'imagina-crm');
                }
            }
        }

        if ($type === 'stat_delta') {
            $metric = (string) ($config['metric'] ?? 'count');
            if (! in_array($metric, self::ALLOWED_KPI_METRICS, true)) {
                return __('Métrica no soportada.', 'imagina-crm');
            }
            if (in_array($metric, ['sum', 'avg'], true)) {
                $mfId = (int) ($config['metric_field_id'] ?? 0);
                if ($fieldExists($mfId)) {
                    $mf = $this->fields->find($mfId);
                    if (
                        $mf !== null
                        && ($mf->listId !== $listId
                            || ! in_array($mf->type, self::NUMERIC_FIELD_TYPES, true))
                    ) {
                        return __('Sum/Avg requieren un campo numérico de la misma lista.', 'imagina-crm');
                    }
                } elseif ($mfId <= 0) {
                    return __('Sum/Avg requieren un campo numérico de la misma lista.', 'imagina-crm');
                }
            }
            $dfId = (int) ($config['date_field_id'] ?? 0);
            if ($dfId <= 0) {
                return __('El campo de fecha del comparador es requerido y debe ser date o datetime.', 'imagina-crm');
            }
            if ($fieldExists($dfId)) {
                $df = $this->fields->find($dfId);
                if (
                    $df !== null
                    && ($df->listId !== $listId
                        || ! in_array($df->type, self::DATE_FIELD_TYPES, true))
                ) {
                    return __('El campo de fecha del comparador es requerido y debe ser date o datetime.', 'imagina-crm');
                }
            }
        }

        if ($type === 'table') {
            $sortFieldId = (int) ($config['sort_field_id'] ?? 0);
            if ($fieldExists($sortFieldId)) {
                $sf = $this->fields->find($sortFieldId);
                if ($sf !== null && $sf->listId !== $listId) {
                    return __('El campo de ordenamiento de la tabla no pertenece a la lista.', 'imagina-crm');
                }
            }
        }

        return null;
    }

    /**
     * @param mixed $raw
     * @return array{x:int, y:int, w:int, h:int}
     */
    private function normalizeLayout(mixed $raw): array
    {
        $defaults = ['x' => 0, 'y' => 0, 'w' => 4, 'h' => 3];
        if (! is_array($raw)) {
            return $defaults;
        }
        return [
            'x' => isset($raw['x']) ? max(0, (int) $raw['x']) : $defaults['x'],
            'y' => isset($raw['y']) ? max(0, (int) $raw['y']) : $defaults['y'],
            'w' => isset($raw['w']) ? max(1, (int) $raw['w']) : $defaults['w'],
            'h' => isset($raw['h']) ? max(1, (int) $raw['h']) : $defaults['h'],
        ];
    }

    private function canEdit(DashboardEntity $dashboard, int $userId, bool $isAdmin): bool
    {
        // Admin puede editar todos.
        if ($isAdmin) {
            return true;
        }
        // Compartido (user_id NULL) — solo admin (caso ya cubierto).
        if ($dashboard->userId === null) {
            return false;
        }
        // Privado — sólo el dueño.
        return $dashboard->userId === $userId;
    }
}
