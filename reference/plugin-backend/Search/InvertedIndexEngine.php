<?php
declare(strict_types=1);

namespace ImaginaCRM\Search;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Support\Database;

/**
 * Motor de búsqueda con índice invertido propio + ranking BM25.
 *
 * Tablas (creadas por SchemaManager):
 *
 *   `wp_imcrm_search_tokens` — fila por (list, token, record). Guarda
 *      tf (term frequency en ese record) — el índice invertido en sí.
 *
 *   `wp_imcrm_search_documents` — fila por (list, record). Guarda
 *      doc_length (suma de tf del record) e indexed_at. Necesario para
 *      el componente bias-by-length de BM25.
 *
 * Pipeline:
 *
 *   indexRecord()  — extrae texto de campos searchables del record,
 *                    tokeniza, calcula tf, persiste con REPLACE INTO.
 *   removeRecord() — borra entradas del record en ambas tablas.
 *   reindexList()  — borra todo de la lista y re-indexa por lotes.
 *   search()       — tokeniza query, busca en search_tokens con JOIN
 *                    a search_documents, calcula score BM25, devuelve
 *                    record_id => score ordenados.
 */
final class InvertedIndexEngine implements SearchEngineInterface
{
    private const SEARCHABLE_TYPES = ['text', 'long_text', 'email', 'url'];

    /**
     * Constantes BM25. k1 (saturación de tf) entre 1.2-2.0 funciona
     * bien para corpus mixtos; b (bias por longitud) en 0.75 es el
     * default canónico (Robertson/Spärck Jones).
     */
    private const BM25_K1 = 1.5;
    private const BM25_B  = 0.75;

    public function __construct(
        private readonly Database $db,
        private readonly FieldRepository $fields,
        private readonly Tokenizer $tokenizer,
    ) {
    }

    /**
     * Indexa un record. Idempotente: si ya estaba indexado, reemplaza.
     *
     * `$values` viene del repositorio (raw row); extraemos los campos
     * searchables y construimos un blob de texto. Si después cambian
     * los fields searchables (e.g. el user marca un long_text como no
     * searchable), un reindex de la lista lo refresca.
     *
     * @param array<string, mixed> $values  Fila cruda del record (key=column_name).
     */
    public function indexRecord(ListEntity $list, int $recordId, array $values): void
    {
        $fields = $this->fields->allForList($list->id);
        $blob   = $this->buildBlob($values, $fields);
        $tokens = $this->tokenizer->tokenize($blob);

        // Borramos siempre primero — si el record perdió todos sus
        // tokens, queda fuera del índice.
        $this->removeRecord($list->id, $recordId);

        if ($tokens === []) {
            return;
        }

        // Term frequency: contamos repeticiones por token.
        $tf = [];
        foreach ($tokens as $tok) {
            $tf[$tok] = ($tf[$tok] ?? 0) + 1;
        }

        $wpdb  = $this->db->wpdb();
        $tokenTable = $this->db->systemTable('search_tokens');
        $docTable   = $this->db->systemTable('search_documents');

        // Insert en lotes de 500 valores para evitar SQL gigante.
        $rows = [];
        foreach ($tf as $token => $count) {
            $rows[] = [$list->id, $recordId, $token, min(65535, $count)];
        }

        $chunkSize = 500;
        for ($i = 0, $n = count($rows); $i < $n; $i += $chunkSize) {
            $chunk = array_slice($rows, $i, $chunkSize);
            $this->insertTokenChunk($tokenTable, $chunk);
        }

        $docLength = array_sum($tf);
        $now       = current_time('mysql', true);
        // REPLACE INTO: si ya había una fila, se sobrescribe.
        $wpdb->query($this->safePrepare(
            "REPLACE INTO `{$docTable}` (list_id, record_id, doc_length, indexed_at) VALUES (%d, %d, %d, %s)",
            [$list->id, $recordId, $docLength, $now],
        ));
    }

    /**
     * Wrapper que normaliza `$wpdb->prepare()` a string (nunca null).
     * Los stubs declaran `prepare(): string|null`, pero en runtime con
     * un SQL válido y placeholders coincidentes siempre retorna string.
     * Este wrapper evita esparcir ignores de PHPStan por todo el
     * archivo. (Fase 13.D)
     *
     * @param array<int|string, mixed> $args
     */
    private function safePrepare(string $sql, array $args): string
    {
        $wpdb = $this->db->wpdb();
        $prepared = $wpdb->prepare($sql, $args);
        return is_string($prepared) ? $prepared : '';
    }

    /**
     * @param array<int, array{0:int,1:int,2:string,3:int}> $rows
     */
    private function insertTokenChunk(string $table, array $rows): void
    {
        if ($rows === []) {
            return;
        }
        $wpdb = $this->db->wpdb();

        $placeholders = [];
        $args         = [];
        foreach ($rows as $r) {
            $placeholders[] = '(%d, %d, %s, %d)';
            $args[]         = $r[0];
            $args[]         = $r[1];
            $args[]         = $r[2];
            $args[]         = $r[3];
        }
        $sql = "INSERT INTO `{$table}` (list_id, record_id, token, tf) VALUES "
            . implode(', ', $placeholders);

        $wpdb->query($this->safePrepare($sql, $args));
    }

    public function removeRecord(int $listId, int $recordId): void
    {
        $wpdb = $this->db->wpdb();
        $tokenTable = $this->db->systemTable('search_tokens');
        $docTable   = $this->db->systemTable('search_documents');

        $wpdb->query($this->safePrepare(
            "DELETE FROM `{$tokenTable}` WHERE list_id = %d AND record_id = %d",
            [$listId, $recordId],
        ));
        $wpdb->query($this->safePrepare(
            "DELETE FROM `{$docTable}` WHERE list_id = %d AND record_id = %d",
            [$listId, $recordId],
        ));
    }

    /**
     * Borra todo el índice de una lista (preludio a reindex). El caller
     * debe seguir con `indexRecord()` por cada record. Para volúmenes
     * grandes, ReindexJob hace esto via Action Scheduler en lotes.
     */
    public function clearList(int $listId): void
    {
        $wpdb = $this->db->wpdb();
        $wpdb->query($this->safePrepare(
            "DELETE FROM `{$this->db->systemTable('search_tokens')}` WHERE list_id = %d",
            [$listId],
        ));
        $wpdb->query($this->safePrepare(
            "DELETE FROM `{$this->db->systemTable('search_documents')}` WHERE list_id = %d",
            [$listId],
        ));
    }

    /**
     * Cuenta documentos indexados de una lista — usado por la UI de
     * status y por el suite de tests.
     */
    public function documentCount(int $listId): int
    {
        $wpdb = $this->db->wpdb();
        return (int) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM `{$this->db->systemTable('search_documents')}` WHERE list_id = %d", $listId),
        );
    }

    /**
     * @return array<int, float>
     */
    public function search(int $listId, string $query, int $recordLimit = 1000): array
    {
        $tokens = $this->tokenizer->tokenize($query);
        if ($tokens === []) {
            return [];
        }

        // Deduplicar tokens — repetir la misma búsqueda no aporta.
        $tokens = array_values(array_unique($tokens));

        $wpdb       = $this->db->wpdb();
        $tokenTable = $this->db->systemTable('search_tokens');
        $docTable   = $this->db->systemTable('search_documents');

        // Stats globales: total docs, avg doc length. Necesarios para
        // BM25. Vienen baratos — un solo COUNT/AVG sobre la tabla
        // documents (que tiene índice por list_id).
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT COUNT(*) AS n, IFNULL(AVG(doc_length), 0) AS avgdl FROM `{$docTable}` WHERE list_id = %d",
                $listId,
            ),
            ARRAY_A,
        );
        $totalDocs = is_array($row) ? (int) ($row['n'] ?? 0) : 0;
        $avgDl     = is_array($row) ? (float) ($row['avgdl'] ?? 0.0) : 0.0;
        if ($totalDocs === 0 || $avgDl <= 0) {
            return [];
        }

        // Fase 16.C — fix bug P2: antes la query principal incluía
        // una subquery correlacionada `(SELECT COUNT(*) FROM
        // search_tokens t2 WHERE t.token = t2.token)` que MySQL
        // ejecutaba POR CADA fila del JOIN. Para 5 tokens × 1000
        // matches = 5000 ejecuciones del subselect.
        //
        // Ahora: 2 queries. La primera calcula `df` por token en un
        // único scan agrupado. La segunda hace el JOIN sin subselect.
        // PHP combina ambos lookups in-memory antes de computar BM25.
        $placeholders = implode(',', array_fill(0, count($tokens), '%s'));

        $dfSql = "
            SELECT token, COUNT(DISTINCT record_id) AS df
            FROM `{$tokenTable}`
            WHERE list_id = %d AND token IN ({$placeholders})
            GROUP BY token
        ";
        $dfArgs = [$listId];
        foreach ($tokens as $tok) {
            $dfArgs[] = $tok;
        }
        $dfPrepared = $wpdb->prepare($dfSql, $dfArgs);
        if (! is_string($dfPrepared)) {
            return [];
        }
        $dfRows = $wpdb->get_results($dfPrepared, ARRAY_A);
        $dfByToken = [];
        if (is_array($dfRows)) {
            foreach ($dfRows as $dr) {
                $dfByToken[(string) $dr['token']] = (int) $dr['df'];
            }
        }
        if ($dfByToken === []) {
            // Ningún token está indexado para esta lista.
            return [];
        }

        $sql = "
            SELECT t.token, t.record_id, t.tf, d.doc_length
            FROM `{$tokenTable}` t
            INNER JOIN `{$docTable}` d
                ON d.list_id = t.list_id AND d.record_id = t.record_id
            WHERE t.list_id = %d AND t.token IN ({$placeholders})
        ";
        $args = [$listId];
        foreach ($tokens as $tok) {
            $args[] = $tok;
        }

        $prepared = $wpdb->prepare($sql, $args);
        if (! is_string($prepared)) {
            return [];
        }

        $rows = $wpdb->get_results($prepared, ARRAY_A);
        if (! is_array($rows)) {
            return [];
        }

        // BM25:  score(d) = sum_t idf(t) * (tf * (k1+1)) /
        //                                  (tf + k1*(1 - b + b*(dl/avgdl)))
        // idf(t) = ln( (N - df + 0.5) / (df + 0.5) + 1 )
        $k1 = self::BM25_K1;
        $b  = self::BM25_B;
        $scores = [];

        foreach ($rows as $r) {
            $token     = (string) $r['token'];
            $recordId  = (int) $r['record_id'];
            $tf        = (int) $r['tf'];
            $docLength = max(1, (int) $r['doc_length']);
            // df ahora se lookupea in-memory en lugar de subquery
            // correlacionada (Fase 16.C). Si por edge case un token
            // no figura en $dfByToken, cae a 1 (mismo fallback que
            // antes con `max(1, ...)`).
            $df        = max(1, $dfByToken[$token] ?? 1);

            $idf      = log((($totalDocs - $df + 0.5) / ($df + 0.5)) + 1.0);
            $denom    = $tf + $k1 * (1 - $b + $b * ($docLength / $avgDl));
            $contrib  = $idf * (($tf * ($k1 + 1)) / $denom);

            $scores[$recordId] = ($scores[$recordId] ?? 0.0) + $contrib;
        }

        if ($scores === []) {
            return [];
        }

        // Ordenar por score desc y truncar.
        arsort($scores);
        if (count($scores) > $recordLimit) {
            $scores = array_slice($scores, 0, $recordLimit, true);
        }
        return $scores;
    }

    /**
     * Concatena los valores de campos searchables del record en un
     * blob de texto. NULL/array vacío se ignoran.
     *
     * @param array<string, mixed>  $values
     * @param array<int, FieldEntity> $fields
     */
    private function buildBlob(array $values, array $fields): string
    {
        $parts = [];
        foreach ($fields as $field) {
            if (! in_array($field->type, self::SEARCHABLE_TYPES, true)) {
                continue;
            }
            $raw = $values[$field->columnName] ?? null;
            if ($raw === null || $raw === '') {
                continue;
            }
            if (is_array($raw)) {
                $parts[] = implode(' ', array_map('strval', $raw));
            } else {
                $parts[] = (string) $raw;
            }
        }
        return implode(' ', $parts);
    }
}
