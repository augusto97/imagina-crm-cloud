<?php
declare(strict_types=1);

namespace ImaginaCRM\Dashboards;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Records\QueryBuilder;
use ImaginaCRM\Support\Database;
use ImaginaCRM\Support\ValidationResult;

/**
 * Calcula el valor de un widget contra MySQL real. Lo invoca el REST
 * controller cuando el frontend pide los datos de un widget concreto.
 *
 * Output por tipo:
 * - `kpi`:        `['value' => float|int, 'label' => string|null]`
 * - `chart_bar`:  `['data' => [['label' => string, 'value' => int], ...]]`
 * - `chart_line`: `['data' => [['label' => 'YYYY-MM', 'value' => int], ...]]`
 *
 * Usa `column_name` (no `slug`) para el SQL — por construcción ese campo
 * es inmutable y vetted por SlugManager (ver CLAUDE.md §7.5). Validamos
 * con `IDENT_REGEX` de defensa en profundidad antes de envolver con
 * backticks.
 *
 * Filtros por widget: el config del widget puede traer un array
 * `filters` con la misma forma que `/records?filter[...]` — el evaluador
 * lo pasa por `QueryBuilder::compileWhereForList()` para generar un
 * fragmento WHERE seguro y mergearlo con la lógica específica de cada
 * tipo de widget.
 */
final class WidgetEvaluator
{
    private const IDENT_REGEX = '/^[a-z][a-z0-9_]{0,62}$/';

    /**
     * TTL del cache de resultados de widgets. 5 min es un buen
     * balance: cambios disparan invalidación automática vía version
     * bump, pero el TTL existe como safety net para casos edge
     * (writes directos a la DB, jobs async que no disparen hooks).
     */
    private const CACHE_TTL_SECONDS = 300;

    public function __construct(
        private readonly Database $db,
        private readonly ListRepository $lists,
        private readonly FieldRepository $fields,
        private readonly QueryBuilder $queryBuilder,
        private readonly \ImaginaCRM\Records\RecordsETag $etag,
    ) {
    }

    /**
     * @return array<string, mixed>|ValidationResult
     */
    public function evaluate(DashboardEntity $dashboard, string $widgetId): array|ValidationResult
    {
        $widget = $this->findWidget($dashboard, $widgetId);
        if ($widget === null) {
            return ValidationResult::failWith('id', __('Widget no encontrado.', 'imagina-crm'));
        }

        $list = $this->lists->find((int) ($widget['list_id'] ?? 0));
        if ($list === null) {
            return ValidationResult::failWith('list_id', __('La lista del widget ya no existe.', 'imagina-crm'));
        }
        if (! $this->validIdent($list->tableSuffix)) {
            return ValidationResult::failWith('list_id', __('Nombre de tabla inválido.', 'imagina-crm'));
        }

        $type   = (string) $widget['type'];
        $config = is_array($widget['config'] ?? null) ? $widget['config'] : [];

        // Cache lookup: la key incluye la versión de la lista (bumpea
        // en cada record_*/import_* hook) + el config completo del
        // widget. Cualquier cambio invalida automáticamente. TTL 5
        // min como safety net por si algún write se saltó hooks.
        $cacheKey = $this->cacheKey($list->id, $widgetId, $config);
        if (function_exists('get_transient')) {
            $cached = get_transient($cacheKey);
            if (is_array($cached)) {
                return $cached;
            }
        }

        // Compilamos la cláusula WHERE de los filtros del widget UNA
        // sola vez. Es la misma para todas las queries que cada tipo
        // de evaluador ejecute (count, sum, group-by, etc.). Si el
        // widget no tiene `filters`, el WHERE queda en la base de
        // soft-delete (`WHERE deleted_at IS NULL`).
        //
        // Forma nueva (ClickUp-style): `config.filter_tree` con AND/OR
        // y grupos anidados. Si está presente, tiene prioridad sobre
        // `filters` (forma legacy plana).
        //
        // Adicionalmente, si el widget tiene un `period` (atajo de
        // rango relativo dedicado), lo envolvemos en un grupo AND
        // junto al filter_tree antes de compilar — así una sola
        // pasada produce el WHERE final con período + filtros.
        $listFields = $this->fields->allForList($list->id);
        $tree       = $config['filter_tree'] ?? null;
        $tree       = $this->mergePeriodIntoTree($config['period'] ?? null, $tree);
        if (is_array($tree) && ($tree['type'] ?? '') === 'group') {
            $filterCtx = $this->queryBuilder->compileTreeWhereForList(
                $list->id,
                $listFields,
                $tree,
                null,
                false,
            );
        } else {
            $rawFilters = is_array($config['filters'] ?? null) ? $config['filters'] : [];
            $filterCtx  = $this->queryBuilder->compileWhereForList($list->id, $listFields, $rawFilters);
        }

        $result = match ($type) {
            'kpi'        => $this->evaluateKpi($list->tableSuffix, $list->id, $config, $filterCtx),
            'chart_bar', 'chart_pie', 'funnel'
                         => $this->evaluateChartBar($list->tableSuffix, $list->id, $config, $filterCtx),
            'chart_line', 'chart_area'
                         => $this->evaluateChartLine($list->tableSuffix, $list->id, $config, $filterCtx),
            'stat_delta' => $this->evaluateStatDelta($list->tableSuffix, $list->id, $config, $filterCtx),
            'table'      => $this->evaluateTable($list->tableSuffix, $list->id, $config, $filterCtx),
            default      => ValidationResult::failWith('type', __('Tipo de widget no soportado.', 'imagina-crm')),
        };

        // Solo cacheamos resultados válidos — un ValidationResult
        // tipo "Widget no encontrado" se dispararía cada vez de
        // todos modos.
        if (is_array($result) && function_exists('set_transient')) {
            set_transient($cacheKey, $result, self::CACHE_TTL_SECONDS);
        }

        return $result;
    }

    /**
     * Genera una key estable para el cache de transient. Incluye:
     *  - La versión actual de la lista (bumpea en cada record_*
     *    hook → invalida cache automáticamente).
     *  - El widget id (en caso de N widgets con mismo config).
     *  - El config completo del widget (filter_tree, period, etc.).
     *
     * Si CUALQUIERA de los tres cambia, la key cambia y el cache
     * miss → se recalcula. Sin necesidad de iterar transients para
     * borrarlos.
     *
     * @param array<string, mixed> $config
     */
    private function cacheKey(int $listId, string $widgetId, array $config): string
    {
        $version = $this->etag->getVersion($listId);
        $hash = md5((string) wp_json_encode([$widgetId, $config, $version]));
        return "imcrm_widget_{$listId}_{$hash}";
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findWidget(DashboardEntity $dashboard, string $widgetId): ?array
    {
        foreach ($dashboard->widgets as $widget) {
            if (($widget['id'] ?? '') === $widgetId) {
                return $widget;
            }
        }
        return null;
    }

    /**
     * @param array<string, mixed>                              $config
     * @param array{where: string, args: array<int, mixed>}     $filterCtx
     * @return array<string, mixed>|ValidationResult
     */
    private function evaluateKpi(string $tableSuffix, int $listId, array $config, array $filterCtx): array|ValidationResult
    {
        $resolved = $this->resolveMetric($listId, $config);
        if ($resolved instanceof ValidationResult) {
            return $resolved;
        }
        ['expr' => $aggSql, 'metric' => $metric, 'kind' => $kind] = $resolved;
        $table = $this->dataTable($tableSuffix);
        $where = $filterCtx['where'];
        $args  = $filterCtx['args'];
        $sql   = 'SELECT ' . $aggSql . ' FROM ' . $table . ' ' . $where;
        $prepared = $args === [] ? $sql : (string) $this->db->wpdb()->prepare($sql, $args);
        $raw = $this->db->wpdb()->get_var($prepared);
        return [
            'value'  => $this->castMetricValue($raw, $kind),
            'metric' => $metric,
        ];
    }

    /**
     * Resuelve la expresión SQL del agregado de un widget. Soporta el
     * set completo de métricas que ya calcula `RecordAggregator`
     * (footer aggregations) — espejo de aquella matriz por tipo de
     * campo:
     *
     *   - `count`  + field_id=0 → `COUNT(*)`
     *   - `count`  + field_id>0 → `COUNT(col)` (no-null)
     *   - `count_unique`        → `COUNT(DISTINCT col)`
     *   - `count_empty`         → `SUM(CASE WHEN col IS NULL [OR =''] THEN 1 ELSE 0 END)`
     *   - `sum`/`avg`/`min`/`max` → la función SQL homónima
     *   - `count_true` (checkbox) → `SUM(CASE WHEN col=1 THEN 1 ELSE 0 END)`
     *   - `count_false` (checkbox) → `SUM(CASE WHEN col=0 THEN 1 ELSE 0 END)`
     *
     * Valida que la métrica sea aplicable al tipo del campo
     * (`sum`/`avg` requieren number/currency; `count_true/false`
     * requieren checkbox). Si no, devuelve ValidationResult.
     *
     * Devuelve `['expr' => string, 'metric' => string, 'kind' => 'int'|'float'|'string']`.
     * El `kind` indica cómo castear el resultado en el caller.
     *
     * @param array<string, mixed> $config
     * @return array{expr:string, metric:string, kind:string}|ValidationResult
     */
    private function resolveMetric(int $listId, array $config): array|ValidationResult
    {
        $metric = isset($config['metric']) ? (string) $config['metric'] : 'count';
        $allowed = [
            'count', 'count_unique', 'count_empty',
            'sum', 'avg', 'min', 'max',
            'count_true', 'count_false',
        ];
        if (! in_array($metric, $allowed, true)) {
            return ValidationResult::failWith('metric', __('Métrica desconocida.', 'imagina-crm'));
        }

        $fieldId = isset($config['metric_field_id']) ? (int) $config['metric_field_id'] : 0;

        // count + sin campo = COUNT(*) sobre todos los registros.
        if ($metric === 'count' && $fieldId === 0) {
            return ['expr' => 'COUNT(*)', 'metric' => 'count', 'kind' => 'int'];
        }

        $field = $this->fields->find($fieldId);
        if (
            $field === null
            || $field->listId !== $listId
            || ! $this->validIdent($field->columnName)
        ) {
            return ValidationResult::failWith('metric_field_id', __('Campo de métrica inválido.', 'imagina-crm'));
        }

        // Validar que la métrica sea aplicable al tipo. Espejo del
        // catálogo `metricsForFieldType()` del frontend.
        $type = $field->type;
        $isNumeric = in_array($type, ['number', 'currency'], true);
        $isDate    = in_array($type, ['date', 'datetime'], true);
        $isCheckbox = $type === 'checkbox';

        $applicable = match ($metric) {
            'sum', 'avg'                  => $isNumeric,
            'min', 'max'                  => $isNumeric || $isDate,
            'count_true', 'count_false'   => $isCheckbox,
            default                       => true, // count, count_unique, count_empty para todo
        };
        if (! $applicable) {
            return ValidationResult::failWith('metric', sprintf(
                /* translators: 1: metric kind, 2: field type */
                __('La métrica "%1$s" no aplica a campos de tipo %2$s.', 'imagina-crm'),
                $metric,
                $type,
            ));
        }

        $col = '`' . $field->columnName . '`';
        return match ($metric) {
            'count'        => ['expr' => 'COUNT(' . $col . ')',          'metric' => 'count',        'kind' => 'int'],
            'count_unique' => ['expr' => 'COUNT(DISTINCT ' . $col . ')', 'metric' => 'count_unique', 'kind' => 'int'],
            'count_empty'  => [
                // text/url/email guardan '' como vacío; el resto solo NULL.
                'expr'   => 'SUM(CASE WHEN ' . $col . ' IS NULL'
                    . (in_array($type, ['text', 'email', 'url'], true) ? " OR " . $col . " = ''" : '')
                    . ' THEN 1 ELSE 0 END)',
                'metric' => 'count_empty',
                'kind'   => 'int',
            ],
            'sum'          => ['expr' => 'SUM(' . $col . ')', 'metric' => 'sum', 'kind' => 'float'],
            'avg'          => ['expr' => 'AVG(' . $col . ')', 'metric' => 'avg', 'kind' => 'float'],
            'min'          => ['expr' => 'MIN(' . $col . ')', 'metric' => 'min', 'kind' => $isDate ? 'string' : 'float'],
            'max'          => ['expr' => 'MAX(' . $col . ')', 'metric' => 'max', 'kind' => $isDate ? 'string' : 'float'],
            'count_true'   => ['expr' => 'SUM(CASE WHEN ' . $col . ' = 1 THEN 1 ELSE 0 END)', 'metric' => 'count_true',  'kind' => 'int'],
            'count_false'  => ['expr' => 'SUM(CASE WHEN ' . $col . ' = 0 THEN 1 ELSE 0 END)', 'metric' => 'count_false', 'kind' => 'int'],
        };
    }

    /**
     * Cast del valor crudo del agregado al tipo correcto según `kind`.
     * SUM/AVG/MIN/MAX sobre tabla vacía devuelven NULL — los
     * normalizamos a 0/'' para que el frontend pueda renderizar sin
     * guards.
     */
    private function castMetricValue(mixed $raw, string $kind): int|float|string
    {
        if ($raw === null) {
            return $kind === 'string' ? '' : ($kind === 'float' ? 0.0 : 0);
        }
        return match ($kind) {
            'int'    => (int) $raw,
            'float'  => (float) $raw,
            'string' => (string) $raw,
            default  => (int) $raw,
        };
    }

    /** Tipos de campo que se pueden usar como dimensión en chart_bar / chart_pie. */
    private const GROUPABLE_TYPES = [
        'select', 'multi_select',
        'text', 'email', 'url',
        'date', 'datetime',
        'checkbox',
    ];

    /**
     * @param array<string, mixed>                              $config
     * @param array{where: string, args: array<int, mixed>}     $filterCtx
     * @return array<string, mixed>|ValidationResult
     */
    private function evaluateChartBar(string $tableSuffix, int $listId, array $config, array $filterCtx): array|ValidationResult
    {
        $fieldId = isset($config['group_by_field_id']) ? (int) $config['group_by_field_id'] : 0;
        $field   = $this->fields->find($fieldId);
        if (
            $field === null
            || $field->listId !== $listId
            || ! in_array($field->type, self::GROUPABLE_TYPES, true)
        ) {
            return ValidationResult::failWith('group_by_field_id', __('Campo de agrupación inválido.', 'imagina-crm'));
        }
        if (! $this->validIdent($field->columnName)) {
            return ValidationResult::failWith('group_by_field_id', __('Columna de agrupación inválida.', 'imagina-crm'));
        }

        // 0.36.9: el set de métricas del chart se amplió al mismo que
        // RecordAggregator soporta (count/count_unique/count_empty + sum/avg/
        // min/max + count_true/false según tipo del campo de métrica).
        // resolveMetric() valida y devuelve la expresión SQL del agregado
        // junto con el `kind` para castear la salida.
        $resolved = $this->resolveMetric($listId, $config);
        if ($resolved instanceof ValidationResult) {
            return $resolved;
        }
        $aggSql = $resolved['expr'];
        $kind   = $resolved['kind'];

        $table = $this->dataTable($tableSuffix);
        $col   = '`' . $field->columnName . '`';
        $limit = 25; // hard cap para no devolver charts enormes con text fields
        $where = $filterCtx['where'];
        $args  = $filterCtx['args'];
        $wpdb  = $this->db->wpdb();

        $runQuery = function (string $sql) use ($wpdb, $args): array {
            $prepared = $args === [] ? $sql : (string) $wpdb->prepare($sql, $args);
            $rows = $wpdb->get_results($prepared, ARRAY_A);
            return is_array($rows) ? $rows : [];
        };

        $castValue = fn (mixed $v): int|float|string => $this->castMetricValue($v, $kind);

        // multi_select: la columna almacena JSON. Hacemos UNNEST en PHP.
        // El acumulador `+=` funciona matemáticamente para count y sum
        // (additivos). Para avg/min/max/count_unique no es exacto cuando
        // una row tiene múltiples tags, pero el resultado sigue siendo
        // útil como aproximación. Para min/max sobre fechas (kind=string)
        // bloqueamos porque no se puede sumar: forzamos al usuario a
        // elegir otra métrica para multi_select.
        if ($field->type === 'multi_select') {
            if ($kind === 'string') {
                return ValidationResult::failWith(
                    'metric',
                    __('Mín/Máx de fecha no soportado al agrupar por un campo multi_select. Elige otra métrica o agrupa por otro campo.', 'imagina-crm'),
                );
            }
            $rows = $runQuery(
                'SELECT ' . $col . ' AS bucket, ' . $aggSql . ' AS total FROM ' . $table
                . ' ' . $where . ' AND ' . $col . ' IS NOT NULL'
                . ' GROUP BY ' . $col,
            );
            $totals = [];
            foreach ($rows as $row) {
                $raw   = $row['bucket'] ?? null;
                $total = $row['total'] ?? 0;
                $arr   = is_string($raw) ? json_decode($raw, true) : null;
                if (! is_array($arr)) {
                    continue;
                }
                $num = is_numeric($total) ? (float) $total : 0.0;
                foreach ($arr as $v) {
                    if (! is_string($v) || $v === '') {
                        continue;
                    }
                    $totals[$v] = ($totals[$v] ?? 0.0) + $num;
                }
            }
            $labelByValue = $this->labelMapForSelect($field);
            arsort($totals);
            $data = [];
            foreach (array_slice($totals, 0, $limit, true) as $value => $total) {
                $data[] = [
                    'label' => $labelByValue[$value] ?? $value,
                    'value' => $kind === 'int' ? (int) $total : (float) $total,
                ];
            }
            return ['data' => $data];
        }

        // date / datetime: granularidad configurable vía `time_bucket`
        // (day/week/month/quarter/year). Default: month.
        if ($field->type === 'date' || $field->type === 'datetime') {
            $bucket = $this->bucketExpression($col, (string) ($config['time_bucket'] ?? 'month'));
            $rows = $runQuery(
                'SELECT ' . $bucket . ' AS bucket, ' . $aggSql . ' AS total'
                . ' FROM ' . $table
                . ' ' . $where . ' AND ' . $col . ' IS NOT NULL'
                . ' GROUP BY bucket ORDER BY bucket DESC LIMIT ' . $limit,
            );
            return $this->bucketsAsData($rows, $kind);
        }

        // checkbox: 0/1. Mapeamos a labels reconocibles.
        if ($field->type === 'checkbox') {
            $rows = $runQuery(
                'SELECT ' . $col . ' AS bucket, ' . $aggSql . ' AS total FROM ' . $table
                . ' ' . $where
                . ' GROUP BY ' . $col,
            );
            $data = [];
            foreach ($rows as $row) {
                $v = $row['bucket'] ?? null;
                $label = $v === '1' || $v === 1 ? __('Sí', 'imagina-crm')
                    : ($v === '0' || $v === 0 ? __('No', 'imagina-crm') : __('(sin valor)', 'imagina-crm'));
                $data[] = ['label' => $label, 'value' => $castValue($row['total'] ?? 0)];
            }
            return ['data' => $data];
        }

        // text / email / url / select: top N distintos por frecuencia.
        $rows = $runQuery(
            'SELECT ' . $col . ' AS bucket, ' . $aggSql . ' AS total FROM ' . $table
            . ' ' . $where
            . ' GROUP BY ' . $col
            . ' ORDER BY total DESC, bucket ASC LIMIT ' . $limit,
        );

        $labelByValue = $field->type === 'select' ? $this->labelMapForSelect($field) : [];
        $data = [];
        foreach ($rows as $row) {
            $value = $row['bucket'] ?? null;
            $label = $value === null || $value === ''
                ? __('(sin valor)', 'imagina-crm')
                : ($labelByValue[(string) $value] ?? (string) $value);
            $data[] = [
                'label' => $label,
                'value' => $castValue($row['total'] ?? 0),
            ];
        }
        return ['data' => $data];
    }

    /**
     * @param mixed $rows
     * @return array<string, mixed>
     */
    private function bucketsAsData(mixed $rows, string $kind = 'int'): array
    {
        $data = [];
        foreach (is_array($rows) ? $rows : [] as $row) {
            $bucket = $row['bucket'] ?? null;
            if ($bucket === null) {
                continue;
            }
            $data[] = [
                'label' => (string) $bucket,
                'value' => $this->castMetricValue($row['total'] ?? null, $kind),
            ];
        }
        return ['data' => $data];
    }

    /**
     * @param array<string, mixed>                              $config
     * @param array{where: string, args: array<int, mixed>}     $filterCtx
     * @return array<string, mixed>|ValidationResult
     */
    private function evaluateChartLine(string $tableSuffix, int $listId, array $config, array $filterCtx): array|ValidationResult
    {
        $fieldId = isset($config['date_field_id']) ? (int) $config['date_field_id'] : 0;
        $field   = $this->fields->find($fieldId);
        if (
            $field === null
            || $field->listId !== $listId
            || ! in_array($field->type, ['date', 'datetime'], true)
        ) {
            return ValidationResult::failWith('date_field_id', __('Campo de fecha inválido.', 'imagina-crm'));
        }
        if (! $this->validIdent($field->columnName)) {
            return ValidationResult::failWith('date_field_id', __('Columna de fecha inválida.', 'imagina-crm'));
        }

        // 0.36.9: line/area soporta el set completo de métricas
        // (paridad con KPI / bar). resolveMetric() valida y devuelve la
        // expresión SQL del agregado más el `kind` para castear.
        $resolved = $this->resolveMetric($listId, $config);
        if ($resolved instanceof ValidationResult) {
            return $resolved;
        }
        $aggSql = $resolved['expr'];
        $kind   = $resolved['kind'];

        $col   = '`' . $field->columnName . '`';
        $where = $filterCtx['where'];
        $args  = $filterCtx['args'];
        $wpdb  = $this->db->wpdb();
        $bucket = $this->bucketExpression($col, (string) ($config['time_bucket'] ?? 'month'));
        $sql   = 'SELECT ' . $bucket . ' AS bucket, ' . $aggSql . ' AS total'
               . ' FROM ' . $this->dataTable($tableSuffix)
               . ' ' . $where . ' AND ' . $col . ' IS NOT NULL'
               . ' GROUP BY bucket ORDER BY bucket ASC';
        $prepared = $args === [] ? $sql : (string) $wpdb->prepare($sql, $args);
        $rows     = $wpdb->get_results($prepared, ARRAY_A);
        $rows     = is_array($rows) ? $rows : [];
        $data     = [];
        foreach ($rows as $row) {
            $bucket = $row['bucket'] ?? null;
            if ($bucket === null) {
                continue;
            }
            $data[] = [
                'label' => (string) $bucket,
                'value' => $this->castMetricValue($row['total'] ?? null, $kind),
            ];
        }
        return ['data' => $data];
    }

    /**
     * `stat_delta`: KPI con comparación vs período anterior. Config:
     *  - metric: 'count' | 'sum' | 'avg'
     *  - metric_field_id: requerido para sum/avg
     *  - date_field_id: campo date/datetime que delimita los períodos
     *  - period_days: longitud del período actual (default 30)
     *
     * Devuelve `{value, previous, delta_pct, period_days, metric}`.
     *
     * @param array<string, mixed>                              $config
     * @param array{where: string, args: array<int, mixed>}     $filterCtx
     * @return array<string, mixed>|ValidationResult
     */
    private function evaluateStatDelta(string $tableSuffix, int $listId, array $config, array $filterCtx): array|ValidationResult
    {
        // 0.36.9: stat_delta también soporta el set completo de métricas.
        $resolved = $this->resolveMetric($listId, $config);
        if ($resolved instanceof ValidationResult) {
            return $resolved;
        }
        $aggSql = $resolved['expr'];
        $kind   = $resolved['kind'];
        $metric = $resolved['metric'];

        $periodDays = max(1, min(365, (int) ($config['period_days'] ?? 30)));

        $dateFieldId = isset($config['date_field_id']) ? (int) $config['date_field_id'] : 0;
        $dateField   = $this->fields->find($dateFieldId);
        if (
            $dateField === null
            || $dateField->listId !== $listId
            || ! in_array($dateField->type, ['date', 'datetime'], true)
            || ! $this->validIdent($dateField->columnName)
        ) {
            return ValidationResult::failWith('date_field_id', __('Campo de fecha inválido.', 'imagina-crm'));
        }

        $table   = $this->dataTable($tableSuffix);
        $dateCol = '`' . $dateField->columnName . '`';
        $wpdb    = $this->db->wpdb();
        $where   = $filterCtx['where'];
        $whereArgs = $filterCtx['args'];

        // Período actual: [now - N días, now]. Período previo:
        // [now - 2N días, now - N días). Las dos subqueries comparten
        // el WHERE de los filtros del widget — los args se duplican
        // porque cada subquery los consume independientemente.
        $sql = 'SELECT'
            . ' (SELECT ' . $aggSql . ' FROM ' . $table
                . ' ' . $where . ' AND ' . $dateCol . ' >= DATE_SUB(NOW(), INTERVAL %d DAY)) AS curr,'
            . ' (SELECT ' . $aggSql . ' FROM ' . $table
                . ' ' . $where . ' AND ' . $dateCol . ' >= DATE_SUB(NOW(), INTERVAL %d DAY)'
                . ' AND ' . $dateCol . ' < DATE_SUB(NOW(), INTERVAL %d DAY)) AS prev';

        $args = array_merge(
            $whereArgs,            // primera subquery
            [$periodDays],
            $whereArgs,            // segunda subquery
            [$periodDays * 2, $periodDays],
        );
        $prepared = (string) $wpdb->prepare($sql, $args);
        $row      = $wpdb->get_row($prepared, ARRAY_A);

        $currRaw = is_array($row) ? ($row['curr'] ?? null) : null;
        $prevRaw = is_array($row) ? ($row['prev'] ?? null) : null;
        $currVal = $this->castMetricValue($currRaw, $kind);
        $prevVal = $this->castMetricValue($prevRaw, $kind);

        // delta_pct sólo aplica a métricas numéricas. Para métricas
        // string (min/max de fecha) lo dejamos null — el widget de
        // delta no tiene sentido conceptual para "fecha más reciente
        // del período".
        $deltaPct = null;
        if (is_numeric($currVal) && is_numeric($prevVal)) {
            $currNum = (float) $currVal;
            $prevNum = (float) $prevVal;
            if ($prevNum != 0.0) {
                $deltaPct = (($currNum - $prevNum) / abs($prevNum)) * 100.0;
            } elseif ($currNum != 0.0) {
                $deltaPct = 100.0;
            }
        }

        return [
            'value'       => $currVal,
            'previous'    => $prevVal,
            'delta_pct'   => $deltaPct,
            'period_days' => $periodDays,
            'metric'      => $metric,
        ];
    }

    /**
     * `table`: top N records ordenados por un campo. Config:
     *  - sort_field_id: id del campo a ordenar
     *  - sort_dir: 'asc' | 'desc' (default 'desc')
     *  - limit: 1..50 (default 10)
     *  - visible_field_ids: lista de IDs de campos a mostrar
     *
     * Devuelve `{rows: [{id, fields:[{label, value}]}], columns: [{label, type}]}`.
     *
     * @param array<string, mixed>                              $config
     * @param array{where: string, args: array<int, mixed>}     $filterCtx
     * @return array<string, mixed>
     */
    private function evaluateTable(string $tableSuffix, int $listId, array $config, array $filterCtx): array
    {
        $limit   = max(1, min(50, (int) ($config['limit'] ?? 10)));
        $sortDir = (string) ($config['sort_dir'] ?? 'desc');
        $sortDir = $sortDir === 'asc' ? 'ASC' : 'DESC';

        $sortFieldId = isset($config['sort_field_id']) ? (int) $config['sort_field_id'] : 0;
        $sortCol     = 'created_at';
        if ($sortFieldId > 0) {
            $sortField = $this->fields->find($sortFieldId);
            if (
                $sortField !== null
                && $sortField->listId === $listId
                && $this->validIdent($sortField->columnName)
            ) {
                $sortCol = $sortField->columnName;
            }
        }

        $rawVisible = $config['visible_field_ids'] ?? [];
        if (! is_array($rawVisible)) {
            $rawVisible = [];
        }
        /** @var array<int, FieldEntity> $visibleFields */
        $visibleFields = [];
        foreach ($rawVisible as $vid) {
            $vf = $this->fields->find((int) $vid);
            if (
                $vf !== null
                && $vf->listId === $listId
                && $vf->type !== 'relation'
                && $this->validIdent($vf->columnName)
            ) {
                $visibleFields[] = $vf;
            }
        }
        // Si el caller no especificó columnas, mostramos las primeras 4
        // del list (sin relations) para no devolver una tabla vacía.
        if ($visibleFields === []) {
            foreach ($this->fields->allForList($listId) as $f) {
                if ($f->type === 'relation' || ! $this->validIdent($f->columnName)) {
                    continue;
                }
                $visibleFields[] = $f;
                if (count($visibleFields) >= 4) {
                    break;
                }
            }
        }

        $cols = ['id'];
        foreach ($visibleFields as $vf) {
            $cols[] = '`' . $vf->columnName . '`';
        }
        $colsSql = implode(', ', $cols);

        $where     = $filterCtx['where'];
        $whereArgs = $filterCtx['args'];
        $sql = 'SELECT ' . $colsSql . ' FROM ' . $this->dataTable($tableSuffix)
             . ' ' . $where
             . ' ORDER BY `' . $sortCol . '` ' . $sortDir
             . ' LIMIT %d';
        $args     = array_merge($whereArgs, [$limit]);
        $prepared = (string) $this->db->wpdb()->prepare($sql, $args);
        $rows     = $this->db->wpdb()->get_results($prepared, ARRAY_A);
        $rows     = is_array($rows) ? $rows : [];

        $columns = array_map(
            static fn (FieldEntity $f): array => [
                'label' => $f->label,
                'slug'  => $f->slug,
                'type'  => $f->type,
            ],
            $visibleFields,
        );

        $outRows = [];
        foreach ($rows as $row) {
            $values = [];
            foreach ($visibleFields as $vf) {
                $values[$vf->slug] = $row[$vf->columnName] ?? null;
            }
            $outRows[] = [
                'id'     => (int) ($row['id'] ?? 0),
                'fields' => $values,
            ];
        }

        return [
            'columns' => $columns,
            'rows'    => $outRows,
        ];
    }

    /**
     * Mapa `valor → label` derivado del config de un select.
     *
     * @return array<string, string>
     */
    private function labelMapForSelect(FieldEntity $field): array
    {
        $options = $field->config['options'] ?? null;
        if (! is_array($options)) {
            return [];
        }
        $map = [];
        foreach ($options as $opt) {
            if (! is_array($opt)) {
                continue;
            }
            $value = isset($opt['value']) ? (string) $opt['value'] : '';
            $label = isset($opt['label']) ? (string) $opt['label'] : $value;
            if ($value !== '') {
                $map[$value] = $label;
            }
        }
        return $map;
    }

    private function validIdent(string $ident): bool
    {
        return (bool) preg_match(self::IDENT_REGEX, $ident);
    }

    /**
     * Si el widget definió un `period` (atajo dedicado de rango
     * relativo), devuelve un nuevo árbol de filtros que combina la
     * condición del período con el árbol existente bajo un grupo AND.
     * Si no hay período, devuelve el árbol original sin tocar.
     *
     * El período se persiste como `{field_id, preset}` (no como
     * fechas) — acá lo convertimos a una condición `between_relative`
     * que `QueryBuilder::compileFilter` resuelve contra `wp_timezone()`
     * en cada query. Eso garantiza que "este mes" se recalcule cada
     * vez que se carga el dashboard.
     *
     * @param mixed $period
     * @param array<string, mixed>|null $tree
     * @return array<string, mixed>|null
     */
    private function mergePeriodIntoTree(mixed $period, ?array $tree): ?array
    {
        if (! is_array($period)) {
            return $tree;
        }
        $fieldId = isset($period['field_id']) ? (int) $period['field_id'] : 0;
        $preset  = isset($period['preset']) ? (string) $period['preset'] : '';
        if ($fieldId <= 0 || $preset === '') {
            return $tree;
        }

        $periodCondition = [
            'type'     => 'condition',
            'field_id' => $fieldId,
            'op'       => 'between_relative',
            'value'    => $preset,
        ];

        // Si no hay árbol previo, el grupo wrapper basta.
        if (! is_array($tree) || ($tree['type'] ?? '') !== 'group') {
            return [
                'type'     => 'group',
                'logic'    => 'and',
                'children' => [$periodCondition],
            ];
        }

        // Caso común: el filter_tree ya es AND raíz. Insertamos la
        // condición como primer hijo (más visible al inspeccionar SQL
        // logs) sin crear un grupo wrapper innecesario.
        $logic = strtolower((string) ($tree['logic'] ?? 'and'));
        if ($logic === 'and') {
            $children = isset($tree['children']) && is_array($tree['children']) ? $tree['children'] : [];
            return [
                'type'     => 'group',
                'logic'    => 'and',
                'children' => array_merge([$periodCondition], $children),
            ];
        }

        // El root es OR — envolvemos para que el período se aplique
        // SIEMPRE (period AND (existing OR tree)).
        return [
            'type'     => 'group',
            'logic'    => 'and',
            'children' => [$periodCondition, $tree],
        ];
    }

    /**
     * Devuelve la expresión SQL que agrupa una columna de fecha por la
     * granularidad solicitada. El bucket queda como string ordenable
     * cronológicamente y legible para el frontend.
     *
     * - day      → 'YYYY-MM-DD'
     * - week     → 'YYYY-Www'  (ISO week)
     * - month    → 'YYYY-MM'
     * - quarter  → 'YYYY-Qn'   (ej. '2026-Q2')
     * - year     → 'YYYY'
     *
     * `$col` ya viene quoteado con backticks (ej. "`due_date`"). El
     * bucket no recibe input del usuario salvo el slug, que validamos
     * contra la lista cerrada acá.
     */
    private function bucketExpression(string $col, string $bucket): string
    {
        return match ($bucket) {
            'day'     => "DATE_FORMAT({$col}, '%Y-%m-%d')",
            'week'    => "DATE_FORMAT({$col}, '%x-W%v')",
            'quarter' => "CONCAT(YEAR({$col}), '-Q', QUARTER({$col}))",
            'year'    => "DATE_FORMAT({$col}, '%Y')",
            default   => "DATE_FORMAT({$col}, '%Y-%m')",
        };
    }

    private function dataTable(string $tableSuffix): string
    {
        // Database::dataTable() ya prepende el prefijo correcto y
        // garantiza que el sufijo viene de SlugManager. Aquí lo
        // envolvemos en backticks tras validar el patrón nuevamente.
        $name = $this->db->dataTable($tableSuffix);
        // Backtick: el prefijo de WP puede contener `_` pero no
        // caracteres peligrosos.
        return '`' . str_replace('`', '', $name) . '`';
    }
}
