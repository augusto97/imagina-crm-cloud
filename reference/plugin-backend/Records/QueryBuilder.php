<?php
declare(strict_types=1);

namespace ImaginaCRM\Records;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Lists\SlugManager;
use ImaginaCRM\Support\Database;
use ImaginaCRM\Support\SlugContext;
use ImaginaCRM\Support\ValidationResult;

/**
 * Traduce inputs de la API (filtros por slug, sort por slug, search) en SQL
 * seguro para la tabla dinámica de una lista.
 *
 * Reglas (CLAUDE.md §9.4, §12):
 *
 * - Whitelist estricta de columnas: cada referencia (slug o `field_<id>`)
 *   se resuelve a un `column_name` real consultando los `FieldEntity`
 *   pasados por el caller. Si no existe → la entrada se descarta.
 * - Slugs antiguos se siguen vía `SlugManager::resolveCurrentSlug()`.
 * - Identificadores se envuelven con backticks; valores van a
 *   `wpdb::prepare()`.
 * - Máximo `MAX_FILTERS` filtros activos por query.
 *
 * El caller es responsable de pasar los `fields` ya cargados (de modo que
 * `RecordService` los consulta una única vez por request).
 */
final class QueryBuilder
{
    /** @var array<int, string> */
    private const SCALAR_OPERATORS = [
        'eq', 'neq',
        'gt', 'gte', 'lt', 'lte',
        'contains', 'not_contains', 'starts_with', 'ends_with',
        'in', 'nin',
        'is_null', 'is_not_null',
        // Rango relativo dinámico — el valor es el slug del preset
        // (`this_month`, `last_30_days`, etc.) y se resuelve contra
        // `now()` en cada query, no se persiste como fecha fija.
        // Sólo aplicable a campos `date` / `datetime`.
        'between_relative',
    ];

    /** @var array<int, string> */
    private const SEARCHABLE_TYPES = ['text', 'long_text', 'email', 'url'];

    /** @var array<int, string> Tipos que no admiten WHERE en la columna física. */
    private const NON_FILTERABLE_TYPES = ['relation'];

    /** @var array<int, string> Tipos que admiten GROUP BY (toolbar "Agrupar por"). */
    public const GROUPABLE_TYPES = [
        'select', 'multi_select', 'user', 'checkbox', 'date', 'datetime',
    ];

    /** @var array<int, string> */
    private const BASE_COLUMNS = ['id', 'created_by', 'created_at', 'updated_at', 'deleted_at'];

    public function __construct(
        private readonly Database $db,
        private readonly SlugManager $slugs,
    ) {
    }

    /**
     * @param array<int, FieldEntity>                    $fields  Campos vivos de la lista.
     * @param array<string, mixed>                       $rawFilters
     * @param array<int, array{slug:string, dir:string}> $rawSort
     * @param array<int, string>                         $rawFields
     */
    public function normalize(
        int $listId,
        array $fields,
        array $rawFilters,
        array $rawSort,
        array $rawFields,
        ?string $search,
        int $page,
        int $perPage,
        bool $includeDeleted,
        ?int $cursor = null,
    ): QueryParams|ValidationResult {
        $page    = max(1, $page);
        $perPage = max(1, min($perPage, QueryParams::MAX_PER_PAGE));

        $fieldsById = $this->indexById($fields);

        $filters = [];
        foreach ($rawFilters as $key => $value) {
            $column = $this->resolveColumn((string) $key, $listId, $fieldsById);
            if ($column === null) {
                continue;
            }

            if (is_array($value)) {
                foreach ($value as $op => $opValue) {
                    if (! is_string($op)) {
                        continue;
                    }
                    $filters[] = ['column' => $column, 'operator' => $op, 'value' => $opValue];
                }
            } else {
                $filters[] = ['column' => $column, 'operator' => 'eq', 'value' => $value];
            }
        }

        if (count($filters) > QueryParams::MAX_FILTERS) {
            return ValidationResult::failWith(
                'filters',
                sprintf(
                    /* translators: %d: max filters */
                    __('Máximo %d filtros por consulta.', 'imagina-crm'),
                    QueryParams::MAX_FILTERS
                )
            );
        }

        $sort = [];
        foreach ($rawSort as $entry) {
            $column = $this->resolveColumn($entry['slug'] ?? '', $listId, $fieldsById);
            if ($column === null) {
                continue;
            }
            $direction = strtolower($entry['dir'] ?? 'asc') === 'desc' ? 'DESC' : 'ASC';
            $sort[] = ['column' => $column, 'direction' => $direction];
        }

        $projection = [];
        foreach ($rawFields as $entry) {
            $column = $this->resolveColumn((string) $entry, $listId, $fieldsById);
            if ($column !== null) {
                $projection[] = $column;
            }
        }

        $search = $search !== null ? trim($search) : null;
        if ($search === '') {
            $search = null;
        }

        return new QueryParams(
            page: $page,
            perPage: $perPage,
            filters: $filters,
            sort: $sort,
            fields: $projection,
            search: $search,
            includeDeleted: $includeDeleted,
            cursor: $cursor !== null && $cursor > 0 ? $cursor : null,
        );
    }

    /**
     * @param array<int, FieldEntity> $fields
     * @param array{where:string, args:array<int, mixed>}|null $whereOverride
     *   Si se pasa, sobrescribe la cláusula WHERE generada desde
     *   `$params->filters`. Lo usa el camino "tree" cuando los filtros
     *   son un árbol AND/OR anidado (no representable en `$params->filters`,
     *   que es plano).
     *
     * @param array{sql:string, args:array<int, mixed>}|null $additionalWhere
     *   Cláusula adicional que se appendea al WHERE final con AND. Es la
     *   vía por la que `PermissionService::recordsScopeWhere()` inyecta
     *   el filtro de scope (own/assigned) sin tocar los filtros del
     *   usuario. Shape: `{sql: "AND \`r\`.\`col\` = %d", args: [user_id]}`.
     *   `sql` debe empezar con "AND " — se concatena tal cual.
     *
     * @param array<int, \ImaginaCRM\Fields\FieldEntity> $fields
     * @param array{where:string, args:array<int, mixed>}|null $whereOverride
     * @param array<int, int>|null $idWhitelist
     *
     * @return array{
     *     sql:string,
     *     args:array<int, mixed>,
     *     count_sql:string,
     *     count_args:array<int, mixed>
     * }
     */
    public function buildSelect(
        string $tableSuffix,
        array $fields,
        QueryParams $params,
        ?array $whereOverride = null,
        ?array $idWhitelist = null,
        ?array $additionalWhere = null,
    ): array {
        $table     = '`' . esc_sql($this->db->dataTable($tableSuffix)) . '`';
        $columnSet = $this->columnsByName($fields);

        $select = $this->buildSelectClause($params, $columnSet, $table);
        if ($whereOverride !== null) {
            $where     = $whereOverride['where'];
            $whereArgs = $whereOverride['args'];
        } else {
            [$where, $whereArgs] = $this->buildWhere($params, $columnSet);
        }

        // Inyección de id whitelist (Tier 3 — search engine): cuando
        // RecordService delegó el search a InvertedIndexEngine, la
        // lista de ids matcheables se inyecta acá como `id IN (...)`.
        // Reemplaza al LIKE que hubiera generado buildWhere.
        if ($idWhitelist !== null) {
            if ($idWhitelist === []) {
                // Ninguna fila matchea — short-circuit limpio.
                $where     = ($where === '' ? 'WHERE 1=0' : $where . ' AND 1=0');
            } else {
                $idPlaceholders = implode(', ', array_fill(0, count($idWhitelist), '%d'));
                $clause         = "id IN ({$idPlaceholders})";
                $where          = ($where === '' ? "WHERE {$clause}" : "{$where} AND {$clause}");
                foreach ($idWhitelist as $id) {
                    $whereArgs[] = (int) $id;
                }
            }
        }

        // Inyección del scope de permisos (Fase 7 — 1.D): se appendea
        // como un AND adicional sin tocar los filtros del usuario.
        // PermissionService garantiza un shape preparado para concatenar
        // tal cual (sql empieza con "AND ").
        if ($additionalWhere !== null && isset($additionalWhere['sql']) && $additionalWhere['sql'] !== '') {
            $scopeSql = (string) $additionalWhere['sql'];
            $scopeArg = isset($additionalWhere['args']) && is_array($additionalWhere['args'])
                ? $additionalWhere['args']
                : [];
            if ($where === '') {
                // Sin WHERE previo: el "AND " del scope se convierte en
                // "WHERE ". Si scope era "AND 1=0", queda "WHERE 1=0".
                $where = 'WHERE ' . preg_replace('/^AND\s+/i', '', $scopeSql);
            } else {
                $where .= ' ' . $scopeSql;
            }
            foreach ($scopeArg as $a) {
                $whereArgs[] = $a;
            }
        }

        $sql      = "SELECT {$select} FROM {$table} {$where}";
        $countSql = "SELECT COUNT(*) AS total FROM {$table} {$where}";

        if ($params->sort !== []) {
            $orderParts = [];
            foreach ($params->sort as $s) {
                if (! $this->isAllowedColumn($s['column'], $columnSet)) {
                    continue;
                }
                $orderParts[] = '`' . esc_sql($s['column']) . '` ' . $s['direction'];
            }
            if ($orderParts !== []) {
                $sql .= ' ORDER BY ' . implode(', ', $orderParts);
            }
        } else {
            $sql .= ' ORDER BY id DESC';
        }

        // Keyset pagination opt-in (cursor): cuando el caller pasa
        // `cursor=<last_id>` Y no hay sort custom, agregamos
        // `WHERE id < cursor` y NO usamos OFFSET — costo constante a
        // cualquier profundidad (vs OFFSET que skippea N filas, lento
        // a 100k+). Para sort custom o page-jumps, fallback a OFFSET.
        $useCursor = $params->cursor !== null && $params->sort === [];
        if ($useCursor) {
            // Inyectamos el filtro `id < cursor` ANTES del LIMIT.
            // Como `$where` ya viene compilado, lo extendemos
            // appendeando una condición — `WHERE` o `AND` según si
            // el where actual es vacío.
            $cursorClause = ' AND id < %d';
            if ($where === 'WHERE 1=1' || $where === '') {
                // Where vacío → reemplazar con cursor solo.
                $sql = str_replace($where, "WHERE id < %d", $sql);
                array_unshift($whereArgs, $params->cursor);
            } else {
                // Inyectar al final del WHERE: el lugar es justo antes
                // del " ORDER BY". Reconstruimos el SQL sin tocar
                // `$where` directamente para no afectar `countSql`.
                $orderPos = strpos($sql, ' ORDER BY');
                if ($orderPos !== false) {
                    $sql = substr($sql, 0, $orderPos) . $cursorClause . substr($sql, $orderPos);
                    $whereArgs[] = $params->cursor;
                }
            }
            $sql   .= ' LIMIT %d';
            $args   = $whereArgs;
            $args[] = $params->perPage;
            // No incluimos OFFSET ni count_sql modificado — el caller
            // se queda con el `total` original (que pidió a la BD una
            // sola vez al primer fetch) o lo ignora si solo le
            // interesa `has_more`.
        } else {
            $offset = ($params->page - 1) * $params->perPage;
            $sql   .= ' LIMIT %d OFFSET %d';

            $args   = $whereArgs;
            $args[] = $params->perPage;
            $args[] = $offset;
        }

        return [
            'sql'        => $sql,
            'args'       => $args,
            'count_sql'  => $countSql,
            'count_args' => $whereArgs,
        ];
    }

    /**
     * Compila la cláusula WHERE para una lista a partir de raw filters
     * (con la misma forma que `/records?filter[...]`). Reusa el pipeline
     * `normalize` + `buildWhere`. Útil para callers que NO necesitan
     * ejecutar un SELECT completo (ej. `WidgetEvaluator`) — sólo quieren
     * el "WHERE deleted_at IS NULL AND ..." con sus placeholders y args
     * para mergear con su propia query.
     *
     * Si los filtros no validan (ej. más del cap), devuelve `[where:
     * 'WHERE deleted_at IS NULL', args: []]` — fail-open silencioso para
     * no romper widgets si el usuario configura algo inválido.
     *
     * @param array<int, FieldEntity>     $fields
     * @param array<string, mixed>        $rawFilters
     *
     * @return array{where: string, args: array<int, mixed>}
     */
    public function compileWhereForList(
        int $listId,
        array $fields,
        array $rawFilters,
        ?string $search = null,
    ): array {
        $params = $this->normalize(
            $listId,
            $fields,
            $rawFilters,
            [],
            [],
            $search,
            1,
            1,
            includeDeleted: false,
        );
        if ($params instanceof ValidationResult) {
            return ['where' => 'WHERE deleted_at IS NULL', 'args' => []];
        }
        $columnSet = $this->columnsByName($fields);
        [$where, $args] = $this->buildWhere($params, $columnSet);
        return [
            'where' => $where !== '' ? $where : 'WHERE 1=1',
            'args'  => $args,
        ];
    }

    /**
     * Compila un árbol de filtros (forma nueva, ClickUp-style) en
     * fragment SQL. Soporta grupos AND/OR anidados, mientras que
     * `compileWhereForList` sólo armaba un AND plano.
     *
     * Shape del árbol:
     *   ['type' => 'group', 'logic' => 'and|or', 'children' => [...]]
     *   ['type' => 'condition', 'field_id' => N, 'op' => 'eq', 'value' => ...]
     *
     * Devuelve `WHERE deleted_at IS NULL [AND <tree>]` listo para
     * mergear, igual que `compileWhereForList`. Si el árbol es null o
     * vacío, devuelve solo el soft-delete check. Cualquier nodo
     * inválido (campo desconocido, operador inválido, etc.) se descarta
     * silenciosamente — fail-open para no romper la UI.
     *
     * @param array<int, FieldEntity> $fields
     * @param array<string, mixed>|null $tree
     *
     * @return array{where: string, args: array<int, mixed>}
     */
    public function compileTreeWhereForList(
        int $listId,
        array $fields,
        ?array $tree,
        ?string $search = null,
        bool $includeDeleted = false,
    ): array {
        $columnSet  = $this->columnsByName($fields);
        $fieldsById = $this->indexById($fields);

        $clauses = [];
        $args    = [];

        if (! $includeDeleted) {
            $clauses[] = 'deleted_at IS NULL';
        }

        if (is_array($tree)) {
            $compiled = $this->compileNode($tree, $columnSet, $fieldsById, $listId, 0);
            if ($compiled !== null) {
                $clauses[] = $compiled['sql'];
                foreach ($compiled['args'] as $a) {
                    $args[] = $a;
                }
            }
        }

        if ($search !== null && $search !== '') {
            $searchClauses = [];
            foreach ($columnSet as $name => $field) {
                if (! in_array($field->type, self::SEARCHABLE_TYPES, true)) {
                    continue;
                }
                $searchClauses[] = '`' . esc_sql($name) . '` LIKE %s';
                $args[]          = '%' . $this->escLike($search) . '%';
            }
            if ($searchClauses !== []) {
                $clauses[] = '(' . implode(' OR ', $searchClauses) . ')';
            } else {
                $clauses[] = '1 = 0';
            }
        }

        if ($clauses === []) {
            return ['where' => 'WHERE 1=1', 'args' => []];
        }

        return [
            'where' => 'WHERE ' . implode(' AND ', $clauses),
            'args'  => $args,
        ];
    }

    /**
     * Profundidad máxima del árbol. Defensivo contra payloads
     * abusivos/recursivos del frontend.
     */
    private const MAX_TREE_DEPTH = 8;

    /**
     * Recursión sobre el árbol. Devuelve null si el nodo no produce
     * ninguna cláusula útil (vacío o inválido).
     *
     * @param array<string, mixed>       $node
     * @param array<string, FieldEntity> $columnSet
     * @param array<int, FieldEntity>    $fieldsById
     *
     * @return array{sql: string, args: array<int, mixed>}|null
     */
    private function compileNode(
        array $node,
        array $columnSet,
        array $fieldsById,
        int $listId,
        int $depth,
    ): ?array {
        if ($depth > self::MAX_TREE_DEPTH) {
            return null;
        }
        $type = isset($node['type']) ? (string) $node['type'] : '';

        if ($type === 'group') {
            $logic = strtolower((string) ($node['logic'] ?? 'and'));
            $logic = $logic === 'or' ? 'OR' : 'AND';

            $children = isset($node['children']) && is_array($node['children']) ? $node['children'] : [];
            $parts    = [];
            $args     = [];
            foreach ($children as $child) {
                if (! is_array($child)) {
                    continue;
                }
                $compiled = $this->compileNode($child, $columnSet, $fieldsById, $listId, $depth + 1);
                if ($compiled === null) {
                    continue;
                }
                $parts[] = $compiled['sql'];
                foreach ($compiled['args'] as $a) {
                    $args[] = $a;
                }
            }
            if ($parts === []) {
                return null;
            }
            // Un solo hijo no necesita paréntesis ni el operador.
            if (count($parts) === 1) {
                return ['sql' => $parts[0], 'args' => $args];
            }
            return [
                'sql'  => '(' . implode(' ' . $logic . ' ', $parts) . ')',
                'args' => $args,
            ];
        }

        if ($type === 'condition') {
            $rawFieldId = $node['field_id'] ?? null;
            $rawOp      = isset($node['op']) ? (string) $node['op'] : '';
            $value      = $node['value'] ?? null;

            $column = null;
            $field  = null;
            if (is_int($rawFieldId) || (is_string($rawFieldId) && ctype_digit($rawFieldId))) {
                $fieldId = (int) $rawFieldId;
                if (isset($fieldsById[$fieldId])) {
                    $field  = $fieldsById[$fieldId];
                    $column = $field->columnName;
                }
            } elseif (is_string($rawFieldId)) {
                // Frontend podría mandar un slug o `field_<id>`.
                $column = $this->resolveColumn($rawFieldId, $listId, $fieldsById);
                foreach ($fieldsById as $f) {
                    if ($f->columnName === $column) {
                        $field = $f;
                        break;
                    }
                }
            }

            if ($column === null || $field === null) {
                return null;
            }
            if (in_array($field->type, self::NON_FILTERABLE_TYPES, true)) {
                return null;
            }
            if (! $this->isAllowedColumn($column, $columnSet)) {
                return null;
            }

            return $this->compileFilter($column, $rawOp, $value, $field);
        }

        return null;
    }

    /**
     * Convierte la forma plana legacy `{field: {op: value}}` a un árbol
     * con un único grupo AND raíz. Útil para que el endpoint REST acepte
     * ambas formas y pase siempre tree al QueryBuilder internamente.
     *
     * @param array<string, mixed> $rawFilters
     * @return array{type: string, logic: string, children: array<int, array<string, mixed>>}
     */
    public static function flatToTree(array $rawFilters): array
    {
        $children = [];
        foreach ($rawFilters as $key => $value) {
            $fieldRef = (string) $key;
            if (is_array($value)) {
                foreach ($value as $op => $opValue) {
                    if (! is_string($op)) {
                        continue;
                    }
                    $children[] = [
                        'type'     => 'condition',
                        'field_id' => $fieldRef,
                        'op'       => $op,
                        'value'    => $opValue,
                    ];
                }
            } else {
                $children[] = [
                    'type'     => 'condition',
                    'field_id' => $fieldRef,
                    'op'       => 'eq',
                    'value'    => $value,
                ];
            }
        }
        return ['type' => 'group', 'logic' => 'and', 'children' => $children];
    }

    /**
     * Compila SELECT (group_value, count) GROUP BY <group_field>, respetando
     * los mismos filtros / search / soft-deletes que `buildSelect`. Usado
     * por el endpoint `/records/groups` (toolbar "Agrupar por" estilo
     * ClickUp/Airtable).
     *
     * Para tipos escalares (select/user/checkbox/date/datetime) hace un
     * GROUP BY directo sobre la columna física.
     *
     * Para `multi_select` (columna JSON array) hace UNNEST con
     * `JSON_TABLE` (MySQL 8.0+, requisito del plugin) — cada valor del
     * array genera su propia fila en el resultado, así un record con
     * `["wpml","crocoblock"]` cuenta para ambos buckets. Los records
     * con array vacío o NULL agrupan en una fila con `value = NULL`.
     *
     * Orden: count DESC, value ASC. Los grupos sin valor (NULL/'')
     * siempre van al final independiente del count, porque "(Sin valor)"
     * es ruido visual cuando se mezcla con grupos reales.
     *
     * @param array<int, FieldEntity> $fields  Campos vivos de la lista (mismos que se pasan a buildSelect).
     * @param array{where: string, args: array<int, mixed>}|null $whereOverride
     *
     * @return array{sql:string, args:array<int, mixed>}
     */
    public function buildGroupQuery(
        string $tableSuffix,
        array $fields,
        FieldEntity $groupByField,
        QueryParams $params,
        ?array $whereOverride = null,
    ): array {
        $table     = '`' . esc_sql($this->db->dataTable($tableSuffix)) . '`';
        $columnSet = $this->columnsByName($fields);

        if ($whereOverride !== null) {
            $where = $whereOverride['where'];
            $args  = $whereOverride['args'];
        } else {
            [$where, $args] = $this->buildWhere($params, $columnSet);
        }
        $whereSql = $where !== '' ? $where : 'WHERE 1=1';

        $col = '`' . esc_sql($groupByField->columnName) . '`';

        if ($groupByField->type === 'multi_select') {
            // Bucket 1: valores reales unnesteados con JSON_TABLE.
            // Filtramos NULL/[] aquí porque JSON_TABLE no produciría
            // filas para arrays vacíos pero queremos ser explícitos.
            $unnestSql = "SELECT j.value AS group_value, COUNT(*) AS group_count "
                       . "FROM {$table} "
                       . "JOIN JSON_TABLE("
                       .   "IFNULL({$col}, JSON_ARRAY()), "
                       .   "'$[*]' COLUMNS (value VARCHAR(255) PATH '$')"
                       . ") AS j "
                       . $whereSql
                       . " AND {$col} IS NOT NULL AND {$col} <> '[]' "
                       . " GROUP BY j.value ";

            // Bucket 2: registros sin valor (un único grupo NULL).
            $nullSql = "SELECT NULL AS group_value, COUNT(*) AS group_count "
                     . "FROM {$table} "
                     . $whereSql
                     . " AND ({$col} IS NULL OR {$col} = '[]') "
                     . " HAVING group_count > 0 ";

            // Cada subquery usa el mismo set de args en el mismo orden.
            $finalSql = "SELECT g.group_value, g.group_count FROM ("
                      . "({$unnestSql}) UNION ALL ({$nullSql})"
                      . ") AS g "
                      . " ORDER BY (g.group_value IS NULL) ASC, g.group_count DESC, g.group_value ASC";

            return [
                'sql'  => $finalSql,
                'args' => array_merge($args, $args),
            ];
        }

        // Tipos escalares: GROUP BY directo. Tratamos '' como NULL para
        // evitar dos buckets redundantes (string vacío y NULL).
        $valueExpr = "NULLIF({$col}, '')";
        $sql       = "SELECT {$valueExpr} AS group_value, COUNT(*) AS group_count "
                   . "FROM {$table} "
                   . $whereSql
                   . " GROUP BY {$valueExpr} "
                   . " ORDER BY (group_value IS NULL) ASC, group_count DESC, group_value ASC";

        return ['sql' => $sql, 'args' => $args];
    }

    /**
     * @param array<string, FieldEntity> $columnSet
     */
    private function buildSelectClause(QueryParams $params, array $columnSet, string $table): string
    {
        if ($params->fields === []) {
            $cols = self::BASE_COLUMNS;
            foreach ($columnSet as $name => $_field) {
                $cols[] = $name;
            }
        } else {
            $cols = array_unique(array_merge(self::BASE_COLUMNS, $params->fields));
        }

        $parts = [];
        foreach ($cols as $col) {
            $parts[] = $table . '.`' . esc_sql($col) . '`';
        }
        return implode(', ', $parts);
    }

    /**
     * @param array<string, FieldEntity> $columnSet
     *
     * @return array{0:string, 1:array<int,mixed>}
     */
    private function buildWhere(QueryParams $params, array $columnSet): array
    {
        $clauses = [];
        $args    = [];

        if (! $params->includeDeleted) {
            $clauses[] = 'deleted_at IS NULL';
        }

        foreach ($params->filters as $filter) {
            if (! $this->isAllowedColumn($filter['column'], $columnSet)) {
                continue;
            }
            $field = $columnSet[$filter['column']] ?? null;
            if ($field !== null && in_array($field->type, self::NON_FILTERABLE_TYPES, true)) {
                continue;
            }

            $compiled = $this->compileFilter($filter['column'], $filter['operator'], $filter['value'], $field);
            if ($compiled === null) {
                continue;
            }
            $clauses[] = $compiled['sql'];
            foreach ($compiled['args'] as $arg) {
                $args[] = $arg;
            }
        }

        if ($params->search !== null) {
            $searchClauses = [];
            foreach ($columnSet as $name => $field) {
                if (! in_array($field->type, self::SEARCHABLE_TYPES, true)) {
                    continue;
                }
                $searchClauses[] = '`' . esc_sql($name) . '` LIKE %s';
                $args[]          = '%' . $this->escLike($params->search) . '%';
            }
            if ($searchClauses !== []) {
                $clauses[] = '(' . implode(' OR ', $searchClauses) . ')';
            } else {
                $clauses[] = '1 = 0';
            }
        }

        if ($clauses === []) {
            return ['', []];
        }
        return ['WHERE ' . implode(' AND ', $clauses), $args];
    }

    /**
     * @return array{sql:string, args:array<int,mixed>}|null
     */
    private function compileFilter(string $column, string $operator, mixed $value, ?FieldEntity $field): ?array
    {
        $operator = strtolower($operator);
        if (! in_array($operator, self::SCALAR_OPERATORS, true)) {
            return null;
        }

        $col   = '`' . esc_sql($column) . '`';

        // multi_select: la columna almacena JSON arrays
        // (ej. ["elementor_pro","crocoblock"]). Comparar con `=`
        // nunca matchearía una opción individual. Usamos
        // JSON_CONTAINS para eq/neq/contains y JSON_OVERLAPS para
        // in/nin. Esto es lo que el usuario espera al filtrar.
        if ($field !== null && $field->type === 'multi_select') {
            return $this->compileMultiSelectFilter($col, $operator, $value);
        }

        // Rango relativo: sólo tiene sentido sobre date/datetime. El
        // valor es el slug del preset (string). Se resuelve a `[from,
        // to]` en el momento de compilar la query usando `wp_timezone()`,
        // así "este mes" es realmente "este mes" cada vez que se
        // ejecuta la query (no la fecha fija que estaba al guardar).
        if ($operator === 'between_relative') {
            if ($field === null || ! in_array($field->type, ['date', 'datetime'], true)) {
                return null;
            }
            $preset = is_string($value) ? $value
                : (is_array($value) && isset($value['preset']) && is_string($value['preset']) ? $value['preset'] : '');
            $range = RelativeDateRange::compute($preset, $field->type);
            if ($range === null) {
                return null;
            }
            return [
                'sql'  => "({$col} >= %s AND {$col} <= %s)",
                'args' => [$range['from'], $range['to']],
            ];
        }

        $place = $field !== null ? $this->placeholder($field) : '%s';
        $cast  = $field !== null
            ? $this->castFilter($field, $value)
            : (is_scalar($value) ? (string) $value : '');

        return match ($operator) {
            'eq'  => ['sql' => "{$col} = {$place}",  'args' => [$cast]],
            'neq' => ['sql' => "{$col} <> {$place}", 'args' => [$cast]],
            'gt'  => ['sql' => "{$col} > {$place}",  'args' => [$cast]],
            'gte' => ['sql' => "{$col} >= {$place}", 'args' => [$cast]],
            'lt'  => ['sql' => "{$col} < {$place}",  'args' => [$cast]],
            'lte' => ['sql' => "{$col} <= {$place}", 'args' => [$cast]],
            'contains'     => ['sql' => "{$col} LIKE %s", 'args' => ['%' . $this->escLike((string) $value) . '%']],
            'not_contains' => ['sql' => "({$col} IS NULL OR {$col} NOT LIKE %s)", 'args' => ['%' . $this->escLike((string) $value) . '%']],
            'starts_with' => ['sql' => "{$col} LIKE %s", 'args' => [$this->escLike((string) $value) . '%']],
            'ends_with'   => ['sql' => "{$col} LIKE %s", 'args' => ['%' . $this->escLike((string) $value)]],
            'in'  => $this->compileInClause($col, $value, $field, false),
            'nin' => $this->compileInClause($col, $value, $field, true),
            'is_null'     => ['sql' => "{$col} IS NULL", 'args' => []],
            'is_not_null' => ['sql' => "{$col} IS NOT NULL", 'args' => []],
        };
    }

    /**
     * Filtros sobre columnas multi_select (JSON arrays). Mapeo:
     *  - eq / contains  → JSON_CONTAINS(col, JSON_QUOTE(value))
     *  - neq            → NOT JSON_CONTAINS(...)
     *  - in             → JSON_OVERLAPS(col, JSON_ARRAY(v1, v2, ...))
     *  - nin            → NOT JSON_OVERLAPS(...)
     *  - is_null / is_not_null → mismas
     *  - starts_with / ends_with → no aplica, retorna null
     *
     * @return array{sql:string, args:array<int,mixed>}|null
     */
    private function compileMultiSelectFilter(string $col, string $operator, mixed $value): ?array
    {
        if ($operator === 'is_null') {
            // multi_select se considera null si la columna es NULL O si
            // contiene un array vacío []. Ambos casos son "sin valor"
            // desde la perspectiva del usuario.
            return [
                'sql'  => "({$col} IS NULL OR {$col} = '[]')",
                'args' => [],
            ];
        }
        if ($operator === 'is_not_null') {
            return [
                'sql'  => "({$col} IS NOT NULL AND {$col} <> '[]')",
                'args' => [],
            ];
        }

        if ($operator === 'eq' || $operator === 'contains' || $operator === 'neq') {
            $needle = is_scalar($value) ? (string) $value : '';
            if ($needle === '') {
                return null;
            }
            $negate = $operator === 'neq';
            // JSON_QUOTE(?) → "valor" con escapes JSON. JSON_CONTAINS
            // verifica membership en el array. Para `neq` también
            // incluimos NULL: un registro sin valor "no contiene"
            // ningún ítem específico desde la perspectiva del usuario.
            return [
                'sql'  => $negate
                    ? "({$col} IS NULL OR NOT JSON_CONTAINS({$col}, JSON_QUOTE(%s)))"
                    : "JSON_CONTAINS({$col}, JSON_QUOTE(%s))",
                'args' => [$needle],
            ];
        }

        if ($operator === 'in' || $operator === 'nin') {
            $values = is_array($value) ? $value : [$value];
            $values = array_values(array_filter(
                array_map(static fn ($v) => is_scalar($v) ? (string) $v : '', $values),
                static fn (string $v): bool => $v !== '',
            ));
            if ($values === []) {
                return null;
            }
            $negate = $operator === 'nin';
            // JSON_ARRAY(?, ?, ?) construye un array JSON literal a
            // partir de strings PHP — auto-quotea cada uno (no usar
            // JSON_QUOTE adentro o se duplica el quoting).
            $placeholders = array_fill(0, count($values), '%s');
            $body = "JSON_OVERLAPS({$col}, JSON_ARRAY(" . implode(', ', $placeholders) . '))';
            return [
                'sql'  => $negate
                    ? "({$col} IS NULL OR NOT {$body})"
                    : $body,
                'args' => $values,
            ];
        }

        // gt/gte/lt/lte/starts_with/ends_with no tienen semántica
        // útil para multi_select. Devolvemos null para que el
        // QueryBuilder skipee este filtro (mejor que un ERROR del
        // usuario por uno mal armado).
        return null;
    }

    /**
     * @return array{sql:string, args:array<int,mixed>}|null
     */
    private function compileInClause(string $col, mixed $value, ?FieldEntity $field, bool $negate): ?array
    {
        $values = is_array($value) ? $value : [$value];
        if ($values === []) {
            return null;
        }
        $placeholders = [];
        $args         = [];
        foreach ($values as $v) {
            $placeholders[] = $field !== null ? $this->placeholder($field) : '%s';
            $args[]         = $field !== null ? $this->castFilter($field, $v) : (is_scalar($v) ? (string) $v : '');
        }
        $op = $negate ? 'NOT IN' : 'IN';
        return [
            'sql'  => "{$col} {$op} (" . implode(', ', $placeholders) . ')',
            'args' => $args,
        ];
    }

    private function placeholder(FieldEntity $field): string
    {
        return match ($field->type) {
            'number'   => $this->numberPlaceholder($field),
            'currency' => '%f',
            'checkbox', 'user', 'file' => '%d',
            default    => '%s',
        };
    }

    private function numberPlaceholder(FieldEntity $field): string
    {
        $precision = isset($field->config['precision']) ? (int) $field->config['precision'] : 4;
        return $precision <= 0 ? '%d' : '%f';
    }

    private function castFilter(FieldEntity $field, mixed $value): mixed
    {
        return match ($field->type) {
            'checkbox', 'user', 'file' => is_numeric($value) ? (int) $value : 0,
            'number'   => $this->numberPlaceholder($field) === '%d' ? (int) $value : (float) $value,
            'currency' => is_numeric($value) ? (float) $value : 0.0,
            default    => is_scalar($value) ? (string) $value : '',
        };
    }

    /**
     * @param array<int, FieldEntity> $fields
     * @return array<int, FieldEntity>
     */
    private function indexById(array $fields): array
    {
        $map = [];
        foreach ($fields as $f) {
            $map[$f->id] = $f;
        }
        return $map;
    }

    /**
     * @param array<int, FieldEntity> $fields
     * @return array<string, FieldEntity>
     */
    private function columnsByName(array $fields): array
    {
        $set = [];
        foreach ($fields as $f) {
            if (in_array($f->type, self::NON_FILTERABLE_TYPES, true)) {
                continue;
            }
            $set[$f->columnName] = $f;
        }
        return $set;
    }

    /**
     * @param array<string, FieldEntity> $columnSet
     */
    private function isAllowedColumn(string $name, array $columnSet): bool
    {
        return isset($columnSet[$name]) || in_array($name, self::BASE_COLUMNS, true);
    }

    /**
     * @param array<int, FieldEntity> $fieldsById
     */
    private function resolveColumn(string $reference, int $listId, array $fieldsById): ?string
    {
        $reference = trim($reference);
        if ($reference === '') {
            return null;
        }

        if (in_array($reference, self::BASE_COLUMNS, true)) {
            return $reference;
        }

        if (str_starts_with($reference, 'field_')) {
            $fieldId = (int) substr($reference, 6);
            return isset($fieldsById[$fieldId]) ? $fieldsById[$fieldId]->columnName : null;
        }

        foreach ($fieldsById as $f) {
            if ($f->columnName === $reference) {
                return $f->columnName;
            }
        }

        foreach ($fieldsById as $f) {
            if ($f->slug === $reference) {
                return $f->columnName;
            }
        }

        $resolved = $this->slugs->resolveCurrentSlug(SlugContext::Field, $reference, $listId);
        if ($resolved !== null) {
            foreach ($fieldsById as $f) {
                if ($f->slug === $resolved) {
                    return $f->columnName;
                }
            }
        }
        return null;
    }

    private function escLike(string $value): string
    {
        return $this->db->wpdb()->esc_like($value);
    }
}
