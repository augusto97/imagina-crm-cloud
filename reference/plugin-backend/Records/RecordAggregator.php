<?php
declare(strict_types=1);

namespace ImaginaCRM\Records;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Support\Database;

/**
 * Agregaciones de columnas para el footer de la tabla (estilo
 * ClickUp/Airtable). Calcula sum/avg/count/min/max por columna
 * respetando el filter_tree activo y opcionalmente agrupando por
 * un campo (para los footers de cada bucket en la vista agrupada).
 *
 * Decisiones de scope:
 *  - Number/currency       → sum (default), avg, count, min, max
 *  - Date/datetime         → min, max, count
 *  - Checkbox              → count_true, count_false
 *  - Text/select/multi/etc → count (filled), count_empty
 *
 * Una sola query por agregación: para N columnas hace una sola
 * SELECT con N agregados. El footer del frontend pide solo las
 * columnas visibles, no todas.
 */
final class RecordAggregator
{
    private const IDENT_REGEX = '/^[a-z][a-z0-9_]{0,62}$/';

    public function __construct(
        private readonly Database $db,
        private readonly FieldRepository $fields,
        private readonly QueryBuilder $queryBuilder,
    ) {
    }

    /**
     * Agrupado: devuelve un map `{bucketValue: {fieldSlug: agg}}`.
     * `null` como bucketValue representa "(sin valor)".
     *
     * @param array<int, int>           $fieldIds Campos a agregar.
     * @param array<string, mixed>|null $filterTree
     * @return array{
     *     totals: array<string, array<string, mixed>>,
     *     groups: array<int, array{value: string|null, aggregates: array<string, array<string, mixed>>}>
     * }
     */
    /**
     * @param list<int>                                       $fieldIds
     * @param array<string, mixed>|null                       $filterTree
     * @param array{sql:string, args:array<int, mixed>}|null  $additionalWhere
     *   Cláusula adicional appendeable al WHERE (AND). Generada por
     *   `PermissionService::recordsScopeWhere` o
     *   `PortalScopeService::recordsScopeWhere`. Permite limitar los
     *   agregados al scope del usuario sin tocar el `filterTree`.
     *
     * @return array<string, mixed>
     */
    public function aggregate(
        ListEntity $list,
        array $fieldIds,
        ?array $filterTree = null,
        ?int $groupByFieldId = null,
        ?array $additionalWhere = null,
    ): array {
        $allFields = $this->fields->allForList($list->id);
        $byId      = [];
        foreach ($allFields as $f) {
            $byId[$f->id] = $f;
        }

        // Resolvemos los campos pedidos (solo los que existen y tienen
        // columna física — `relation`/`computed` no se agregan).
        $targets = [];
        foreach ($fieldIds as $id) {
            $field = $byId[$id] ?? null;
            if ($field === null) {
                continue;
            }
            if (! $this->isAggregatable($field)) {
                continue;
            }
            if (! $this->validIdent($field->columnName)) {
                continue;
            }
            $targets[] = $field;
        }

        $groupByField = $groupByFieldId !== null ? ($byId[$groupByFieldId] ?? null) : null;
        if ($groupByField !== null && ! $this->validIdent($groupByField->columnName)) {
            $groupByField = null;
        }

        $filterCtx = $this->queryBuilder->compileTreeWhereForList(
            $list->id,
            $allFields,
            $filterTree,
            null,
            false,
        );

        // Inyección del scope (Fase 7 — 1.D / Fase 9 — 3.E): el caller
        // pasa una cláusula adicional `{sql, args}` que se appendea con
        // AND al WHERE. Se usa para limitar los agregados al scope del
        // usuario (PermissionService::recordsScopeWhere o
        // PortalScopeService::recordsScopeWhere).
        if ($additionalWhere !== null && isset($additionalWhere['sql']) && $additionalWhere['sql'] !== '') {
            $scopeSql = (string) $additionalWhere['sql'];
            $scopeArgs = isset($additionalWhere['args']) && is_array($additionalWhere['args'])
                ? $additionalWhere['args']
                : [];
            if ($filterCtx['where'] === '') {
                // Sin WHERE previo, el "AND " del scope se convierte en "WHERE ".
                $filterCtx['where'] = 'WHERE ' . preg_replace('/^AND\s+/i', '', $scopeSql);
            } else {
                $filterCtx['where'] .= ' ' . $scopeSql;
            }
            foreach ($scopeArgs as $a) {
                $filterCtx['args'][] = $a;
            }
        }

        $totals = $this->runAggregates($list->tableSuffix, $targets, $filterCtx);

        $groups = [];
        if ($groupByField !== null) {
            $groups = $this->runGroupedAggregates(
                $list->tableSuffix,
                $targets,
                $groupByField,
                $filterCtx,
            );
        }

        return ['totals' => $totals, 'groups' => $groups];
    }

    /**
     * @param array<int, FieldEntity> $targets
     * @param array{where:string, args:array<int,mixed>} $filterCtx
     * @return array<string, array<string, mixed>>
     */
    private function runAggregates(string $tableSuffix, array $targets, array $filterCtx): array
    {
        if ($targets === []) {
            return [];
        }
        $table = $this->dataTable($tableSuffix);

        $exprs = [];
        $aliasMap = []; // alias → [slug, kind]
        foreach ($targets as $field) {
            foreach ($this->aggregateExprs($field) as $alias => $sql) {
                $exprs[]            = $sql . ' AS `' . $alias . '`';
                $aliasMap[$alias]   = [$field->slug, $this->aliasKind($alias)];
            }
        }
        if ($exprs === []) {
            return [];
        }
        $sql = 'SELECT ' . implode(', ', $exprs) . ' FROM ' . $table . ' ' . $filterCtx['where'];
        $args = $filterCtx['args'];
        $prepared = $args === [] ? $sql : (string) $this->db->wpdb()->prepare($sql, $args);
        $row = $this->db->wpdb()->get_row($prepared, ARRAY_A);
        return $this->shapeRow(is_array($row) ? $row : [], $aliasMap);
    }

    /**
     * @param array<int, FieldEntity> $targets
     * @param array{where:string, args:array<int,mixed>} $filterCtx
     * @return array<int, array{value: string|null, aggregates: array<string, array<string, mixed>>}>
     */
    private function runGroupedAggregates(
        string $tableSuffix,
        array $targets,
        FieldEntity $groupByField,
        array $filterCtx,
    ): array {
        $table = $this->dataTable($tableSuffix);
        $groupCol = '`' . $groupByField->columnName . '`';

        $exprs = [$groupCol . ' AS bucket_value'];
        $aliasMap = [];
        foreach ($targets as $field) {
            foreach ($this->aggregateExprs($field) as $alias => $sql) {
                $exprs[]          = $sql . ' AS `' . $alias . '`';
                $aliasMap[$alias] = [$field->slug, $this->aliasKind($alias)];
            }
        }

        $sql = 'SELECT ' . implode(', ', $exprs)
             . ' FROM ' . $table . ' ' . $filterCtx['where']
             . ' GROUP BY ' . $groupCol;
        $args = $filterCtx['args'];
        $prepared = $args === [] ? $sql : (string) $this->db->wpdb()->prepare($sql, $args);
        $rows = $this->db->wpdb()->get_results($prepared, ARRAY_A);
        $rows = is_array($rows) ? $rows : [];

        $out = [];
        foreach ($rows as $row) {
            $bucket = $row['bucket_value'] ?? null;
            unset($row['bucket_value']);
            $out[] = [
                'value'      => $bucket === null ? null : (string) $bucket,
                'aggregates' => $this->shapeRow($row, $aliasMap),
            ];
        }
        return $out;
    }

    /**
     * Devuelve `[alias => SQL expression]` para los agregados de un
     * campo, según su tipo. El alias es lo que usamos como nombre de
     * la columna en el SELECT y luego mapeamos a (slug, kind) en el
     * shape final.
     *
     * @return array<string, string>
     */
    private function aggregateExprs(FieldEntity $field): array
    {
        $col = '`' . $field->columnName . '`';
        $base = preg_replace('/[^a-z0-9_]/', '_', $field->slug) ?? $field->slug;
        $base = (string) $base;

        switch ($field->type) {
            case 'number':
            case 'currency':
                return [
                    $base . '__sum'          => 'SUM(' . $col . ')',
                    $base . '__avg'          => 'AVG(' . $col . ')',
                    $base . '__count'        => 'COUNT(' . $col . ')',
                    $base . '__count_unique' => 'COUNT(DISTINCT ' . $col . ')',
                    $base . '__count_empty'  => 'SUM(CASE WHEN ' . $col . ' IS NULL THEN 1 ELSE 0 END)',
                    $base . '__min'          => 'MIN(' . $col . ')',
                    $base . '__max'          => 'MAX(' . $col . ')',
                ];
            case 'date':
            case 'datetime':
                return [
                    $base . '__min'          => 'MIN(' . $col . ')',
                    $base . '__max'          => 'MAX(' . $col . ')',
                    $base . '__count'        => 'COUNT(' . $col . ')',
                    $base . '__count_unique' => 'COUNT(DISTINCT ' . $col . ')',
                    $base . '__count_empty'  => 'SUM(CASE WHEN ' . $col . ' IS NULL THEN 1 ELSE 0 END)',
                ];
            case 'checkbox':
                return [
                    $base . '__count_true'  => 'SUM(CASE WHEN ' . $col . ' = 1 THEN 1 ELSE 0 END)',
                    $base . '__count_false' => 'SUM(CASE WHEN ' . $col . ' = 0 THEN 1 ELSE 0 END)',
                    $base . '__count'       => 'COUNT(' . $col . ')',
                ];
            default:
                // text / select / multi_select / email / url / user / file
                return [
                    $base . '__count'        => 'COUNT(' . $col . ')',
                    $base . '__count_unique' => 'COUNT(DISTINCT ' . $col . ')',
                    $base . '__count_empty'  => 'SUM(CASE WHEN ' . $col . ' IS NULL OR ' . $col . " = '' THEN 1 ELSE 0 END)",
                ];
        }
    }

    private function aliasKind(string $alias): string
    {
        $parts = explode('__', $alias, 2);
        return $parts[1] ?? 'count';
    }

    /**
     * @param array<string, mixed> $row
     * @param array<string, array{0:string, 1:string}> $aliasMap
     * @return array<string, array<string, mixed>>
     */
    private function shapeRow(array $row, array $aliasMap): array
    {
        $out = [];
        foreach ($row as $alias => $value) {
            $meta = $aliasMap[$alias] ?? null;
            if ($meta === null) {
                continue;
            }
            [$slug, $kind] = $meta;
            if (! isset($out[$slug])) {
                $out[$slug] = [];
            }
            // Normalización: count* a int, sum/avg/min/max numéricos a
            // float, min/max de fechas a string ISO.
            if (str_starts_with($kind, 'count')) {
                $out[$slug][$kind] = (int) $value;
            } elseif (in_array($kind, ['sum', 'avg', 'min', 'max'], true)) {
                if ($value === null) {
                    $out[$slug][$kind] = null;
                } elseif (is_numeric($value)) {
                    $out[$slug][$kind] = (float) $value;
                } else {
                    $out[$slug][$kind] = (string) $value;
                }
            } else {
                $out[$slug][$kind] = $value;
            }
        }
        return $out;
    }

    private function isAggregatable(FieldEntity $field): bool
    {
        return $field->type !== 'relation'
            && $field->type !== 'computed'
            && $field->deletedAt === null;
    }

    private function validIdent(string $ident): bool
    {
        return (bool) preg_match(self::IDENT_REGEX, $ident);
    }

    private function dataTable(string $tableSuffix): string
    {
        $name = $this->db->dataTable($tableSuffix);
        return '`' . str_replace('`', '', $name) . '`';
    }
}
