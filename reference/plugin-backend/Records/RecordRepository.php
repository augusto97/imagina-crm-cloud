<?php
declare(strict_types=1);

namespace ImaginaCRM\Records;

use ImaginaCRM\Support\Database;

/**
 * Operaciones CRUD sobre la tabla dinámica `wp_imcrm_data_<table_suffix>`.
 *
 * No conoce slugs ni tipos: recibe `[columnName => value]` ya serializado
 * por `RecordValidator`. Toda la responsabilidad de prepared-statements y
 * sanitización de identificadores vive aquí.
 *
 * NULLs se inyectan como literal `NULL` en SQL (sin placeholder ni arg),
 * para que el conteo de placeholders y `wpdb::prepare()` siempre cuadre.
 */
final class RecordRepository
{
    /** @var array<int, string> Columnas base que toda data table tiene. */
    private const BASE_COLUMNS = ['id', 'created_by', 'created_at', 'updated_at', 'deleted_at'];

    public function __construct(private readonly Database $db)
    {
    }

    /**
     * @return array<string, mixed>|null Fila cruda (columnas físicas).
     */
    public function find(string $tableSuffix, int $id): ?array
    {
        $table = $this->qualifiedTable($tableSuffix);
        $wpdb  = $this->db->wpdb();
        $row   = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$table} WHERE id = %d AND deleted_at IS NULL", $id),
            ARRAY_A
        );
        return is_array($row) ? $row : null;
    }

    /**
     * @param array<string, mixed> $row [columnName => value]
     */
    public function insert(string $tableSuffix, array $row): int
    {
        $now = current_time('mysql', true);
        $row += [
            'created_by' => get_current_user_id(),
            'created_at' => $now,
            'updated_at' => $now,
        ];

        $columns      = [];
        $placeholders = [];
        $args         = [];
        foreach ($row as $col => $value) {
            $columns[] = '`' . esc_sql($col) . '`';
            if ($value === null) {
                $placeholders[] = 'NULL';
                continue;
            }
            $placeholders[] = $this->placeholderForValue($value);
            $args[]         = $value;
        }

        $table = $this->qualifiedTable($tableSuffix);
        $sql   = "INSERT INTO {$table} (" . implode(', ', $columns) . ') VALUES (' . implode(', ', $placeholders) . ')';

        $wpdb     = $this->db->wpdb();
        $prepared = $args === [] ? $sql : (string) $wpdb->prepare($sql, $args);
        $wpdb->query($prepared);

        return $this->db->lastInsertId();
    }

    /**
     * Insert masivo: una sola query con N filas. Para imports y
     * generación de fixtures donde el costo de N round-trips a MySQL
     * domina (5000 filas × 1ms RTT ≈ 5s solo en network).
     *
     * Importante: TODAS las filas deben tener exactamente el mismo
     * conjunto de columnas (orden y nombre). El caller es
     * responsable de normalizar antes de llamar acá. Si una fila
     * tiene columnas distintas, MySQL rechazaría el INSERT
     * incompleto.
     *
     * Devuelve el array de IDs creados, en el mismo orden que las
     * filas de entrada. Implementado vía `LAST_INSERT_ID()` + count
     * — MySQL garantiza que IDs auto_increment dentro de un INSERT
     * múltiple son consecutivos y empiezan en `LAST_INSERT_ID()`.
     *
     * @param array<int, array<string, mixed>> $rows
     * @return array<int, int> IDs creados, en orden
     */
    public function insertBatch(string $tableSuffix, array $rows): array
    {
        if ($rows === []) {
            return [];
        }
        $now = current_time('mysql', true);
        $userId = get_current_user_id();
        // 0.36.6 fix: unión de columnas a través de TODAS las rows.
        // Antes usábamos solo `$rows[0]` como contrato y silenciosamente
        // descartábamos cualquier columna ausente en el primer row pero
        // presente en los siguientes — en imports CSV donde el primer
        // record dejaba un campo vacío, ese campo se perdía para todos
        // los rows del batch (silent drop catastrófico). Ahora calculamos
        // el set completo y los rows que no tengan ese key se rellenan
        // con NULL en el placeholder loop (mismo efecto que el single
        // INSERT que omitiría la columna y dejaría el DB default).
        $columnsSet = [
            'created_by' => true,
            'created_at' => true,
            'updated_at' => true,
        ];
        foreach ($rows as $row) {
            foreach (array_keys($row) as $col) {
                $columnsSet[$col] = true;
            }
        }
        $columns = array_keys($columnsSet);
        $columnSql = implode(', ', array_map(static fn (string $c): string => '`' . esc_sql($c) . '`', $columns));

        $allPlaceholders = [];
        $args = [];
        foreach ($rows as $row) {
            $row += [
                'created_by' => $userId,
                'created_at' => $now,
                'updated_at' => $now,
            ];
            $rowPlaceholders = [];
            foreach ($columns as $col) {
                $value = $row[$col] ?? null;
                if ($value === null) {
                    $rowPlaceholders[] = 'NULL';
                    continue;
                }
                $rowPlaceholders[] = $this->placeholderForValue($value);
                $args[] = $value;
            }
            $allPlaceholders[] = '(' . implode(', ', $rowPlaceholders) . ')';
        }

        $table = $this->qualifiedTable($tableSuffix);
        $sql = "INSERT INTO {$table} ({$columnSql}) VALUES " . implode(', ', $allPlaceholders);

        $wpdb = $this->db->wpdb();
        $prepared = $args === [] ? $sql : (string) $wpdb->prepare($sql, $args);
        $wpdb->query($prepared);

        $firstId = $this->db->lastInsertId();
        if ($firstId === 0) {
            return [];
        }
        // IDs consecutivos: ranking InnoDB con auto_increment garantiza
        // que en un single INSERT múltiple, los IDs van firstId,
        // firstId+1, ..., firstId+count-1.
        $count = count($rows);
        $ids = [];
        for ($i = 0; $i < $count; $i++) {
            $ids[] = $firstId + $i;
        }
        return $ids;
    }

    /**
     * @param array<string, mixed> $row [columnName => value]
     */
    public function update(string $tableSuffix, int $id, array $row): bool
    {
        $row['updated_at'] = current_time('mysql', true);

        $sets = [];
        $args = [];
        foreach ($row as $col => $value) {
            $colSql = '`' . esc_sql($col) . '`';
            if ($value === null) {
                $sets[] = $colSql . ' = NULL';
                continue;
            }
            $sets[] = $colSql . ' = ' . $this->placeholderForValue($value);
            $args[] = $value;
        }

        $table  = $this->qualifiedTable($tableSuffix);
        $sql    = "UPDATE {$table} SET " . implode(', ', $sets) . ' WHERE id = %d AND deleted_at IS NULL';
        $args[] = $id;

        $wpdb     = $this->db->wpdb();
        $prepared = (string) $wpdb->prepare($sql, $args);
        $result   = $wpdb->query($prepared);
        return $result !== false;
    }

    /**
     * Bulk UPDATE para `RecordService::bulk('update', ...)` (Fase
     * 17.B — DEFERRED #3). Aplica los MISMOS column values a TODOS
     * los IDs en una sola query SQL.
     *
     * No incluye sync de relations — el caller debe garantizar que
     * `$row` solo contiene columnas físicas de la tabla dinámica
     * (sin slugs tipo `relation`). El RecordService verifica esto
     * antes de invocar.
     *
     * Devuelve filas afectadas. Importante: IDs ya soft-deleted o
     * inexistentes NO cuentan (el WHERE filtra por `deleted_at IS
     * NULL`). Si `$row === []`, retorna 0 sin query.
     *
     * @param list<int>            $ids
     * @param array<string, mixed> $row Columnas físicas (column_name
     *                                  → valor ya serializado).
     */
    public function bulkUpdate(string $tableSuffix, array $ids, array $row): int
    {
        if ($ids === [] || $row === []) {
            return 0;
        }
        $row['updated_at'] = current_time('mysql', true);

        $sets = [];
        $args = [];
        foreach ($row as $col => $value) {
            $colSql = '`' . esc_sql($col) . '`';
            if ($value === null) {
                $sets[] = $colSql . ' = NULL';
                continue;
            }
            $sets[] = $colSql . ' = ' . $this->placeholderForValue($value);
            $args[] = $value;
        }

        $table = $this->qualifiedTable($tableSuffix);
        $placeholders = implode(',', array_fill(0, count($ids), '%d'));
        $sql = "UPDATE {$table} SET " . implode(', ', $sets)
            . " WHERE id IN ({$placeholders}) AND deleted_at IS NULL";
        $args = array_merge($args, array_map('intval', $ids));

        $wpdb     = $this->db->wpdb();
        $prepared = (string) $wpdb->prepare($sql, $args);
        $result   = $wpdb->query($prepared);
        return is_int($result) ? $result : 0;
    }

    /**
     * Pre-fetch de N records por id en una sola query. Usado por
     * `RecordService::bulk('update', ...)` para obtener los snapshots
     * pre-update sin N find() separados (Fase 17.B).
     *
     * @param list<int> $ids
     * @return array<int, array<string, mixed>>  map idRecord → row
     *                                            (column_name → value).
     */
    public function findManyByIds(string $tableSuffix, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $table = $this->qualifiedTable($tableSuffix);
        $placeholders = implode(',', array_fill(0, count($ids), '%d'));
        $sql = "SELECT * FROM {$table} WHERE id IN ({$placeholders}) AND deleted_at IS NULL";
        $args = array_map('intval', $ids);

        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_results((string) $wpdb->prepare($sql, $args), ARRAY_A);
        if (! is_array($rows)) {
            return [];
        }
        $out = [];
        foreach ($rows as $r) {
            if (! isset($r['id'])) continue;
            $out[(int) $r['id']] = $r;
        }
        return $out;
    }

    public function softDelete(string $tableSuffix, int $id): bool
    {
        $table  = $this->qualifiedTable($tableSuffix);
        $now    = current_time('mysql', true);
        $sql    = "UPDATE {$table} SET deleted_at = %s, updated_at = %s WHERE id = %d AND deleted_at IS NULL";
        $wpdb   = $this->db->wpdb();
        $result = $wpdb->query((string) $wpdb->prepare($sql, [$now, $now, $id]));
        return is_int($result) && $result > 0;
    }

    /**
     * Bulk soft-delete: marca `deleted_at` para todos los IDs en una
     * sola query. Devuelve la cantidad de filas afectadas (los IDs
     * ya soft-deleted no cuentan porque el WHERE filtra
     * `deleted_at IS NULL`).
     *
     * Fase 16.B — fix del N+1 en `RecordService::bulk('delete', ...)`.
     * Antes el bulk de 500 IDs ejecutaba ~1000 queries (find +
     * softDelete por iteración). Ahora 1 query bulk.
     *
     * @param list<int> $ids
     */
    public function bulkSoftDelete(string $tableSuffix, array $ids): int
    {
        if ($ids === []) {
            return 0;
        }
        $table = $this->qualifiedTable($tableSuffix);
        $now   = current_time('mysql', true);
        $placeholders = implode(',', array_fill(0, count($ids), '%d'));
        $sql   = "UPDATE {$table} SET deleted_at = %s, updated_at = %s "
            . "WHERE id IN ({$placeholders}) AND deleted_at IS NULL";
        $wpdb  = $this->db->wpdb();
        $args  = array_merge([$now, $now], array_map('intval', $ids));
        $result = $wpdb->query((string) $wpdb->prepare($sql, $args));
        return is_int($result) ? $result : 0;
    }

    public function hardDelete(string $tableSuffix, int $id): bool
    {
        $table  = $this->qualifiedTable($tableSuffix);
        $wpdb   = $this->db->wpdb();
        $result = $wpdb->query(
            (string) $wpdb->prepare("DELETE FROM {$table} WHERE id = %d", $id)
        );
        return is_int($result) && $result > 0;
    }

    /**
     * Bulk hard-delete: DELETE FROM con WHERE id IN. Devuelve filas
     * afectadas. Fase 16.B.
     *
     * @param list<int> $ids
     */
    public function bulkHardDelete(string $tableSuffix, array $ids): int
    {
        if ($ids === []) {
            return 0;
        }
        $table = $this->qualifiedTable($tableSuffix);
        $placeholders = implode(',', array_fill(0, count($ids), '%d'));
        $sql   = "DELETE FROM {$table} WHERE id IN ({$placeholders})";
        $wpdb  = $this->db->wpdb();
        $result = $wpdb->query((string) $wpdb->prepare($sql, array_map('intval', $ids)));
        return is_int($result) ? $result : 0;
    }

    /**
     * Ejecuta SELECT y COUNT compilados por `QueryBuilder`.
     *
     * @param array<int, mixed> $args
     * @param array<int, mixed> $countArgs
     *
     * @return array{rows: array<int, array<string, mixed>>, total: int}
     */
    public function executeQuery(string $sql, array $args, string $countSql, array $countArgs): array
    {
        $wpdb = $this->db->wpdb();

        $preparedList  = $args === [] ? $sql : (string) $wpdb->prepare($sql, $args);
        $preparedCount = $countArgs === [] ? $countSql : (string) $wpdb->prepare($countSql, $countArgs);

        $rows  = $wpdb->get_results($preparedList, ARRAY_A);
        $total = (int) $wpdb->get_var($preparedCount);

        return [
            'rows'  => is_array($rows) ? $rows : [],
            'total' => $total,
        ];
    }

    /**
     * Ejecuta un SELECT simple (sin COUNT separado). Usado por el
     * endpoint de groups donde el resultado ya ES la agregación.
     *
     * @param array<int, mixed> $args
     *
     * @return array<int, array<string, mixed>>
     */
    public function executeSelect(string $sql, array $args): array
    {
        $wpdb     = $this->db->wpdb();
        $prepared = $args === [] ? $sql : (string) $wpdb->prepare($sql, $args);
        $rows     = $wpdb->get_results($prepared, ARRAY_A);
        return is_array($rows) ? $rows : [];
    }

    private function qualifiedTable(string $tableSuffix): string
    {
        return '`' . esc_sql($this->db->dataTable($tableSuffix)) . '`';
    }

    /**
     * Devuelve `[id => raw_value]` de una sola columna física, para
     * todos los records no borrados de la tabla dinámica. Usado por
     * `FieldService::changeType()` para migrar valores entre tipos.
     *
     * No paginar — el caller mantiene el array en memoria. Para
     * listas grandes (>10k records) considerar batching, pero el
     * cambio de tipo es operación rara y manual.
     *
     * @return array<int, mixed>
     */
    public function fetchColumnValuesById(string $tableSuffix, string $columnName): array
    {
        $table = $this->qualifiedTable($tableSuffix);
        $col   = '`' . esc_sql($columnName) . '`';
        $wpdb  = $this->db->wpdb();
        $rows  = $wpdb->get_results(
            "SELECT id, {$col} AS v FROM {$table} WHERE deleted_at IS NULL",
            ARRAY_A,
        );
        $out = [];
        if (is_array($rows)) {
            foreach ($rows as $row) {
                $out[(int) $row['id']] = $row['v'];
            }
        }
        return $out;
    }

    /**
     * Trae filas crudas con keyset paginación (id > $afterId), ordenadas
     * ASC. Pensado para jobs batch (reindex de search, exports, sync
     * con sistemas externos) donde se quiere recorrer la tabla entera
     * en lotes sin que OFFSET degrade en deep pages.
     *
     * @return array<int, array<string, mixed>>
     */
    public function fetchBatchAfter(string $tableSuffix, int $afterId, int $batchSize): array
    {
        $table = $this->qualifiedTable($tableSuffix);
        $wpdb  = $this->db->wpdb();
        $size  = max(1, min(2000, $batchSize));
        $rows  = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$table} WHERE id > %d AND deleted_at IS NULL ORDER BY id ASC LIMIT %d",
                $afterId,
                $size,
            ),
            ARRAY_A,
        );
        return is_array($rows) ? $rows : [];
    }

    /**
     * Devuelve los valores distintos de una columna ordenados por
     * frecuencia descendente, con conteo. Útil para autocomplete en
     * filtros y condiciones de automatización.
     *
     * `$columnName` debe venir YA validado por el caller (siempre
     * resuelto desde `wp_imcrm_fields.column_name`, que es inmutable
     * y pasó por SlugManager). Lo escapamos defensivamente igual.
     *
     * `$search` filtra por LIKE %search% case-insensitive si no es null.
     *
     * @return array<int, array{value: string, count: int}>
     */
    public function getDistinctValues(
        string $tableSuffix,
        string $columnName,
        ?string $search,
        int $limit,
    ): array {
        $table  = $this->qualifiedTable($tableSuffix);
        $column = '`' . esc_sql($columnName) . '`';
        $wpdb   = $this->db->wpdb();

        $sql = "SELECT {$column} AS value, COUNT(*) AS cnt "
             . "FROM {$table} "
             . "WHERE deleted_at IS NULL AND {$column} IS NOT NULL AND {$column} != ''";
        $args = [];

        if ($search !== null && $search !== '') {
            $sql   .= " AND {$column} LIKE %s";
            $args[] = '%' . $wpdb->esc_like($search) . '%';
        }

        $sql   .= " GROUP BY {$column} ORDER BY cnt DESC, value ASC LIMIT %d";
        $args[] = max(1, min(500, $limit));

        // $args nunca está vacío (siempre incluye el LIMIT) — siempre prepare.
        $prepared = (string) $wpdb->prepare($sql, $args);
        $rows     = $wpdb->get_results($prepared, ARRAY_A);
        if (! is_array($rows)) {
            return [];
        }

        $out = [];
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            $value = $row['value'] ?? null;
            if ($value === null) {
                continue;
            }
            $out[] = [
                'value' => (string) $value,
                'count' => (int) ($row['cnt'] ?? 0),
            ];
        }
        return $out;
    }

    private function placeholderForValue(mixed $value): string
    {
        if (is_int($value)) {
            return '%d';
        }
        if (is_float($value)) {
            return '%f';
        }
        return '%s';
    }

    /**
     * @return array<int, string>
     */
    public static function baseColumns(): array
    {
        return self::BASE_COLUMNS;
    }
}
