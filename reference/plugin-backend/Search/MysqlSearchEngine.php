<?php
declare(strict_types=1);

namespace ImaginaCRM\Search;

use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Support\Database;

/**
 * Engine fallback con LIKE %q% sobre las columnas searchables de la
 * tabla dinámica.
 *
 * Sin orden por relevancia (todos los matches reciben score 1.0).
 * Limitado a `$recordLimit` para que no devuelva una lista enorme.
 *
 * Es lo que hacía RecordService antes de 0.30.0 — encapsulado acá
 * para que `RecordService::list()` pueda alternar entre engines de
 * forma uniforme.
 */
final class MysqlSearchEngine implements SearchEngineInterface
{
    private const SEARCHABLE_TYPES = ['text', 'long_text', 'email', 'url'];

    public function __construct(
        private readonly Database $db,
        private readonly ListRepository $lists,
        private readonly FieldRepository $fields,
    ) {
    }

    /**
     * @return array<int, float>
     */
    public function search(int $listId, string $query, int $recordLimit = 1000): array
    {
        $query = trim($query);
        if ($query === '') {
            return [];
        }

        $list = $this->lists->find($listId);
        if ($list === null) {
            return [];
        }

        $fields = $this->fields->allForList($listId);
        $cols   = [];
        foreach ($fields as $field) {
            if (in_array($field->type, self::SEARCHABLE_TYPES, true)) {
                $cols[] = $field->columnName;
            }
        }
        if ($cols === []) {
            return [];
        }

        $wpdb  = $this->db->wpdb();
        $table = $this->db->dataTable($list->tableSuffix);

        $clauses = [];
        $args    = [];
        foreach ($cols as $col) {
            // esc_sql() declara return type array|string en los stubs de
            // WP — acá siempre recibe string ($col es un columnName).
            // Cast defensivo para satisfacer PHPStan sin perder runtime
            // safety.
            $escaped = esc_sql($col);
            $clauses[] = '`' . (is_string($escaped) ? $escaped : '') . '` LIKE %s';
            $args[]    = '%' . $wpdb->esc_like($query) . '%';
        }
        $args[]   = max(1, min(10000, $recordLimit));
        $sql      = "SELECT id FROM `{$table}` WHERE deleted_at IS NULL AND ("
            . implode(' OR ', $clauses) . ') LIMIT %d';

        /** @phpstan-ignore-next-line */
        $prepared = $wpdb->prepare($sql, $args);
        if (! is_string($prepared)) {
            return [];
        }
        $rows = $wpdb->get_col($prepared);
        if (! is_array($rows)) {
            return [];
        }

        $out = [];
        foreach ($rows as $id) {
            $out[(int) $id] = 1.0;
        }
        return $out;
    }
}
