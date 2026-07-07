<?php
declare(strict_types=1);

namespace ImaginaCRM\Maintenance;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Support\Database;
use ImaginaCRM\Views\SavedViewRepository;

/**
 * Sugiere composite indexes (multi-column) basados en patrones de uso
 * derivados de las saved views.
 *
 * El single-column `is_indexed` (0.28.0) ya cubre casos triviales: filtra
 * por una columna, sort por otra. Pero MySQL puede ganar mucho más con
 * índices compuestos cuando una vista filtra por A y ordena por B —
 * el optimizer salta directo a las filas matcheables y sirve el ORDER
 * BY desde el índice (sin filesort).
 *
 * Ejemplo concreto: `WHERE status = 'won' ORDER BY due_date ASC` con
 * 100k filas:
 *   - Sin index: ~250ms (full scan + filesort).
 *   - Con `(status, due_date)`: ~5ms.
 *
 * Esta clase NO crea los índices automáticamente — solo los sugiere.
 * El admin decide qué aplicar (cada índice cuesta storage + writes
 * lentas). Los aplica con `applySuggestion()` cuando confirma.
 */
final class CompositeIndexSuggester
{
    public function __construct(
        private readonly Database $db,
        private readonly ListRepository $lists,
        private readonly FieldRepository $fields,
        private readonly SavedViewRepository $views,
    ) {
    }

    /**
     * Recorre las saved views de una lista y devuelve sugerencias
     * únicas, ordenadas por "frecuencia de uso" (cuántas vistas
     * justifican cada sugerencia).
     *
     * Una sugerencia consiste en una secuencia de columnas para crear
     * el índice. La primera columna es siempre la que viene de un
     * filtro (mayor selectividad esperada); las siguientes vienen del
     * sort (sirven el ORDER BY). El nombre del índice se deriva de las
     * columnas para idempotencia.
     *
     * @return list<array{
     *     columns: list<string>,
     *     index_name: string,
     *     reason: string,
     *     uses: int,
     *     ddl: string,
     *     already_exists: bool
     * }>
     */
    public function suggestForList(int $listId): array
    {
        $list = $this->lists->find($listId);
        if ($list === null) {
            return [];
        }

        $fields = $this->fields->allForList($listId);
        $byId   = [];
        foreach ($fields as $f) {
            $byId[$f->id] = $f;
        }

        $views = $this->views->allForList($listId);

        // Tally: composite_key => ['columns' => [...], 'uses' => N,
        //                          'reason' => str]
        $tally = [];

        foreach ($views as $view) {
            $config = $view->config;

            $filters = is_array($config['filters'] ?? null) ? $config['filters'] : [];
            $sort    = is_array($config['sort'] ?? null) ? $config['sort'] : [];

            // Recolectar columnas usadas en filtros (con selectividad
            // potencial, el orden importa: la más restrictiva primero).
            $filterCols = [];
            foreach ($filters as $f) {
                if (! is_array($f) || ! isset($f['field_id'])) {
                    continue;
                }
                $field = $byId[(int) $f['field_id']] ?? null;
                if ($field === null || ! $this->isIndexable($field)) {
                    continue;
                }
                $filterCols[] = $field->columnName;
            }

            // Sort: solo la primera columna (MySQL usa el index para
            // ORDER BY solo si las columnas del sort coinciden con el
            // tail del índice). Las siguientes columnas del sort no
            // ayudarían como tail del mismo índice (cardinalidad).
            $sortCol = null;
            foreach ($sort as $s) {
                if (! is_array($s) || ! isset($s['field_id'])) {
                    continue;
                }
                $field = $byId[(int) $s['field_id']] ?? null;
                if ($field !== null && $this->isIndexable($field)) {
                    $sortCol = $field->columnName;
                    break;
                }
            }

            // Sin filtros + sin sort: nada que indexar.
            if ($filterCols === [] && $sortCol === null) {
                continue;
            }

            $cols = array_values(array_unique($filterCols));
            if ($sortCol !== null && ! in_array($sortCol, $cols, true)) {
                $cols[] = $sortCol;
            }

            // Solo composite (2+). Single-column ya lo cubre `is_indexed`.
            if (count($cols) < 2) {
                continue;
            }

            $key = implode('|', $cols);
            if (! isset($tally[$key])) {
                $tally[$key] = [
                    'columns' => $cols,
                    'uses'    => 0,
                    'view'    => $view->name,
                ];
            }
            $tally[$key]['uses']++;
        }

        $existing = $this->existingIndexes($list->tableSuffix);

        $out = [];
        foreach ($tally as $entry) {
            $cols = $entry['columns'];
            $name = 'idx_imcrm_' . substr(md5(implode(',', $cols)), 0, 12);
            $ddl  = $this->buildDdl($list->tableSuffix, $name, $cols);
            $out[] = [
                'columns'        => $cols,
                'index_name'     => $name,
                'reason'         => sprintf(
                    /* translators: %s view name */
                    'Vista "%s" filtra/ordena por estas columnas',
                    $entry['view']
                ),
                'uses'           => $entry['uses'],
                'ddl'            => $ddl,
                'already_exists' => isset($existing[$name]),
            ];
        }

        usort($out, static fn (array $a, array $b): int => $b['uses'] - $a['uses']);
        return $out;
    }

    /**
     * Aplica una sugerencia: crea el índice si no existe. Devuelve
     * true si se creó (o ya existía), false si falló la query.
     *
     * @param list<string> $columns
     */
    public function applySuggestion(int $listId, array $columns, string $indexName): bool
    {
        $list = $this->lists->find($listId);
        if ($list === null || $columns === []) {
            return false;
        }

        $existing = $this->existingIndexes($list->tableSuffix);
        if (isset($existing[$indexName])) {
            return true;
        }

        $wpdb  = $this->db->wpdb();
        $table = $this->db->dataTable($list->tableSuffix);

        // Sanitización: cada columna validada contra el regex de
        // identificadores. Backticks + esc_sql defensivo.
        $colsSql = [];
        foreach ($columns as $c) {
            if (! preg_match('/^[a-z][a-z0-9_]{0,62}$/', $c)) {
                return false;
            }
            $colsSql[] = '`' . esc_sql($c) . '`';
        }
        $idx = '`' . esc_sql($indexName) . '`';
        $tbl = '`' . esc_sql($table) . '`';
        $sql = "CREATE INDEX {$idx} ON {$tbl} (" . implode(', ', $colsSql) . ')';

        return $wpdb->query($sql) !== false;
    }

    /**
     * Borra un índice creado previamente por el suggester. La UI lo
     * usa en "deshacer" si el admin se arrepiente.
     */
    public function dropIndex(int $listId, string $indexName): bool
    {
        $list = $this->lists->find($listId);
        if ($list === null) {
            return false;
        }
        $existing = $this->existingIndexes($list->tableSuffix);
        if (! isset($existing[$indexName])) {
            return true;
        }
        if (! preg_match('/^[a-z0-9_]{1,64}$/i', $indexName)) {
            return false;
        }

        $wpdb  = $this->db->wpdb();
        $table = $this->db->dataTable($list->tableSuffix);
        $idx   = '`' . esc_sql($indexName) . '`';
        $tbl   = '`' . esc_sql($table) . '`';
        return $wpdb->query("DROP INDEX {$idx} ON {$tbl}") !== false;
    }

    /**
     * @return array<string, true>  index_name => true
     */
    private function existingIndexes(string $tableSuffix): array
    {
        $wpdb  = $this->db->wpdb();
        $table = $this->db->dataTable($tableSuffix);
        $rows  = $wpdb->get_results(
            /** @phpstan-ignore-next-line */
            $wpdb->prepare("SHOW INDEX FROM `{$table}`"),
            ARRAY_A
        );
        if (! is_array($rows)) {
            return [];
        }
        $out = [];
        foreach ($rows as $r) {
            if (isset($r['Key_name'])) {
                $out[(string) $r['Key_name']] = true;
            }
        }
        return $out;
    }

    /**
     * @param list<string> $columns
     */
    private function buildDdl(string $tableSuffix, string $indexName, array $columns): string
    {
        $tbl  = $this->db->dataTable($tableSuffix);
        $cols = implode(', ', array_map(static fn (string $c): string => '`' . $c . '`', $columns));
        return "CREATE INDEX `{$indexName}` ON `{$tbl}` ({$cols});";
    }

    private function isIndexable(FieldEntity $field): bool
    {
        // Tipos que NO admiten índice no-unique con prefijo razonable
        // (LONGTEXT/JSON requieren prefix length explícito).
        return ! in_array($field->type, ['long_text', 'multi_select', 'relation', 'computed'], true);
    }
}
