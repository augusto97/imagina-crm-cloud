<?php
declare(strict_types=1);

namespace ImaginaCRM\Search;

use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Records\RecordRepository;

/**
 * Facade que orquesta el motor de búsqueda + indexer + push hooks.
 *
 * El frontend nunca habla con `InvertedIndexEngine` ni `MysqlSearchEngine`
 * directamente: pasa por aquí. Esto nos permite cambiar el motor por
 * lista mirando el flag `search_index_enabled` sin que el caller tenga
 * que saberlo.
 *
 * El indexador (`indexRecord`/`removeRecord`) es no-op cuando la lista
 * tiene `search_index_enabled = false`. Así, listas pequeñas que no
 * activaron búsqueda avanzada no pagan el costo de indexar en cada
 * write.
 */
final class SearchService
{
    public function __construct(
        private readonly InvertedIndexEngine $invertedEngine,
        private readonly MysqlSearchEngine $mysqlEngine,
        private readonly ListRepository $lists,
        private readonly RecordRepository $records,
    ) {
    }

    /**
     * Ejecuta la búsqueda con el engine apropiado.
     *
     * @return array<int, float>
     */
    public function search(int $listId, string $query, int $recordLimit = 1000): array
    {
        $list = $this->lists->find($listId);
        if ($list === null) {
            return [];
        }
        if ($this->isIndexed($list)) {
            return $this->invertedEngine->search($listId, $query, $recordLimit);
        }
        return $this->mysqlEngine->search($listId, $query, $recordLimit);
    }

    /**
     * Determina si una lista usa el índice invertido. Default OFF —
     * el opt-in es explícito por lista. Esto evita tablas de tokens
     * gigantes para listas que no las necesitan.
     */
    public function isIndexed(ListEntity $list): bool
    {
        $settings = $list->settings;
        return ! empty($settings['search_index_enabled']);
    }

    /**
     * Push hook: cuando se crea/actualiza un record y la lista está
     * indexada, refrescamos su entrada. No-op si la lista no está
     * indexada.
     *
     * @param array<string, mixed> $values  Fila cruda (column_name => value).
     */
    public function indexRecord(int $listId, int $recordId, array $values): void
    {
        $list = $this->lists->find($listId);
        if ($list === null || ! $this->isIndexed($list)) {
            return;
        }
        $this->invertedEngine->indexRecord($list, $recordId, $values);
    }

    public function removeRecord(int $listId, int $recordId): void
    {
        $list = $this->lists->find($listId);
        if ($list === null || ! $this->isIndexed($list)) {
            return;
        }
        $this->invertedEngine->removeRecord($listId, $recordId);
    }

    /**
     * Activa el índice invertido para una lista. Persiste el flag y
     * dispara reindex inicial — sin esto el flag estaría ON pero el
     * índice vacío. Usa Action Scheduler si está disponible para
     * lotear; sino indexa síncrono (puede ser lento en listas grandes).
     */
    public function enableIndex(int $listId): void
    {
        $list = $this->lists->find($listId);
        if ($list === null) {
            return;
        }
        $settings = $list->settings;
        $settings['search_index_enabled'] = true;
        $this->lists->update($listId, ['settings' => $settings]);
        $this->scheduleReindex($listId);
    }

    public function disableIndex(int $listId): void
    {
        $list = $this->lists->find($listId);
        if ($list === null) {
            return;
        }
        $settings = $list->settings;
        $settings['search_index_enabled'] = false;
        $this->lists->update($listId, ['settings' => $settings]);
        $this->invertedEngine->clearList($listId);
    }

    /**
     * Lanza un reindex completo de la lista. Si Action Scheduler está
     * disponible, encadena jobs en lotes de 500 records (el cron del
     * AS los procesa). Si no está, indexa todo síncrono.
     */
    /**
     * Re-encola un reindex para cada lista que tiene el flag activado.
     * Llamado desde el cron periódico cada 6h.
     */
    public function scheduleResyncForAllIndexed(): void
    {
        foreach ($this->lists->all() as $list) {
            if ($this->isIndexed($list)) {
                $this->scheduleReindex($list->id);
            }
        }
    }

    public function scheduleReindex(int $listId): void
    {
        if (function_exists('as_enqueue_async_action')) {
            // Encolar el primer job; el handler encolará el siguiente
            // batch al terminar.
            as_enqueue_async_action(
                'imagina_crm/search_reindex_batch',
                ['list_id' => $listId, 'after_id' => 0, 'batch_size' => 500],
                'imagina-crm-search'
            );
            return;
        }
        // Fallback síncrono — solo razonable para listas chicas o
        // entornos de dev sin AS.
        $this->reindexBatchSync($listId, 0, 5000);
    }

    /**
     * Procesa un batch del reindex. Se llama desde Action Scheduler
     * (vía hook `imagina_crm/search_reindex_batch`). Re-encola el
     * siguiente batch si quedan records.
     */
    public function processReindexBatch(int $listId, int $afterId, int $batchSize): void
    {
        $list = $this->lists->find($listId);
        if ($list === null || ! $this->isIndexed($list)) {
            return;
        }

        // Primer batch limpia el índice de la lista.
        if ($afterId === 0) {
            $this->invertedEngine->clearList($listId);
        }

        $batch = $this->records->fetchBatchAfter($list->tableSuffix, $afterId, $batchSize);
        foreach ($batch as $row) {
            $id = (int) ($row['id'] ?? 0);
            if ($id <= 0) {
                continue;
            }
            $this->invertedEngine->indexRecord($list, $id, $row);
        }

        $count = count($batch);
        if ($count >= $batchSize && function_exists('as_enqueue_async_action')) {
            $lastId = (int) ($batch[$count - 1]['id'] ?? 0);
            as_enqueue_async_action(
                'imagina_crm/search_reindex_batch',
                ['list_id' => $listId, 'after_id' => $lastId, 'batch_size' => $batchSize],
                'imagina-crm-search'
            );
        }
    }

    private function reindexBatchSync(int $listId, int $afterId, int $cap): void
    {
        $list = $this->lists->find($listId);
        if ($list === null) {
            return;
        }
        $this->invertedEngine->clearList($listId);
        $cursor = 0;
        $done   = 0;
        do {
            $batch = $this->records->fetchBatchAfter($list->tableSuffix, $cursor, 500);
            foreach ($batch as $row) {
                $id = (int) ($row['id'] ?? 0);
                if ($id > 0) {
                    $this->invertedEngine->indexRecord($list, $id, $row);
                    $done++;
                    if ($done >= $cap) {
                        return;
                    }
                }
            }
            $count = count($batch);
            if ($count === 0) {
                return;
            }
            $cursor = (int) ($batch[$count - 1]['id'] ?? 0);
        } while ($count >= 500);
    }
}
