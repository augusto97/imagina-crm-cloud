<?php
declare(strict_types=1);

namespace ImaginaCRM\Search;

/**
 * Contrato del motor de búsqueda. Implementaciones:
 *
 *  - `MysqlSearchEngine` (fallback): LIKE %q% sobre columnas
 *    searchables. Costo O(rows * cols) — solo viable para listas
 *    pequeñas/medianas. Sin orden por relevancia.
 *
 *  - `InvertedIndexEngine`: índice invertido propio + BM25. Costo
 *    O(matched_docs * tokens_in_query). Escala a millones de filas.
 *    Requiere indexar (push hooks + reindex jobs).
 *
 * El switch entre engines lo hace `SearchService` mirando el flag
 * `search_index_enabled` de la lista.
 */
interface SearchEngineInterface
{
    /**
     * Devuelve los record_ids que matchean `query` para `listId`,
     * ordenados por relevancia descendente. La key es record_id, el
     * valor es score (mayor = mejor match). El consumidor (RecordService)
     * usa los keys como filtro `WHERE id IN (...)` y respeta el orden
     * mapeando record_id → score.
     *
     * Si `query` es vacío o no produce tokens, devuelve `[]` y el
     * consumidor debe interpretarlo como "no aplicar filtro de search".
     *
     * @return array<int, float>  record_id => score (orden de inserción
     *                            preserva ranking)
     */
    public function search(int $listId, string $query, int $recordLimit = 1000): array;
}
