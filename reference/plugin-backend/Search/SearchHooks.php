<?php
declare(strict_types=1);

namespace ImaginaCRM\Search;

use ImaginaCRM\Lists\ListEntity;

/**
 * Conecta el SearchService con los eventos del plugin (record_created,
 * record_updated, record_deleted) — así el índice se mantiene fresco
 * sin que ningún caller tenga que llamar `indexRecord` explícitamente.
 *
 * También registra el handler de `imagina_crm/search_reindex_batch`
 * (Action Scheduler) y un cron diario que re-sincroniza el índice
 * cada 6h (defensivo contra writes bypaseados o corrupciones).
 */
final class SearchHooks
{
    public const ACTION_REINDEX_BATCH  = 'imagina_crm/search_reindex_batch';
    public const ACTION_RESYNC_PERIODIC = 'imagina_crm/search_resync_periodic';

    public function __construct(private readonly SearchService $service)
    {
    }

    public function register(): void
    {
        if (! function_exists('add_action')) {
            return;
        }

        // Push hooks: cuando un record cambia, re-indexamos.
        // Firmas (definidas en RecordService):
        //   record_created($list, $id, $created, $values)
        //   record_updated($list, $id, $updated, $previousRecord)
        //   record_deleted($list, $id, $purge)
        add_action('imagina_crm/record_created', function ($list, $id, $created): void {
            if ($list instanceof ListEntity && is_int($id) && is_array($created)) {
                $this->service->indexRecord($list->id, $id, $created);
            }
        }, 20, 3);

        add_action('imagina_crm/record_updated', function ($list, $id, $updated): void {
            if ($list instanceof ListEntity && is_int($id) && is_array($updated)) {
                $this->service->indexRecord($list->id, $id, $updated);
            }
        }, 20, 3);

        add_action('imagina_crm/record_deleted', function ($list, $id): void {
            if ($list instanceof ListEntity && is_int($id)) {
                $this->service->removeRecord($list->id, $id);
            }
        }, 20, 2);

        // Job handler para reindex en lotes via Action Scheduler.
        add_action(self::ACTION_REINDEX_BATCH, function ($args): void {
            if (! is_array($args)) {
                return;
            }
            $listId    = (int) ($args['list_id'] ?? 0);
            $afterId   = (int) ($args['after_id'] ?? 0);
            $batchSize = (int) ($args['batch_size'] ?? 500);
            if ($listId > 0) {
                $this->service->processReindexBatch($listId, $afterId, $batchSize);
            }
        }, 10, 1);

        // Re-sync periódico: defensivo. Si algún write evade los hooks
        // (e.g. SQL directo desde un dev externo, restore parcial), un
        // reindex completo cada 6h sincroniza. Costo mínimo para listas
        // chicas; sí impactante para listas grandes — el batching del
        // Action Scheduler reparte la carga.
        add_action(self::ACTION_RESYNC_PERIODIC, function (): void {
            $this->service->scheduleResyncForAllIndexed();
        }, 10, 0);
    }

    /**
     * Encola el cron periódico de re-sync (cada 6h). Se llama desde
     * activación + en cada bootstrap (idempotente — Action Scheduler
     * dedupea por hook + scheduled_time).
     */
    public function ensureResyncScheduled(): void
    {
        if (! function_exists('as_has_scheduled_action') || ! function_exists('as_schedule_recurring_action')) {
            return;
        }
        if (as_has_scheduled_action(self::ACTION_RESYNC_PERIODIC, [], 'imagina-crm-search')) {
            return;
        }
        as_schedule_recurring_action(
            time() + 60,
            6 * HOUR_IN_SECONDS,
            self::ACTION_RESYNC_PERIODIC,
            [],
            'imagina-crm-search'
        );
    }
}
