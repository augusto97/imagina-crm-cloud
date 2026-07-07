<?php
declare(strict_types=1);

namespace ImaginaCRM\Maintenance;

use ImaginaCRM\Support\Database;

/**
 * Purga periódica de tablas append-only que crecen sin freno:
 *
 *   - `slug_history`     — cada rename suma 1 fila. Tras 1 año los
 *                          redirects ya no son razonables.
 *   - `activity`         — cada record write suma 1+ filas. Útil para
 *                          auditoría reciente; > 1 año = ruido.
 *   - `automation_runs`  — cada run de automation suma 1 fila. Después
 *                          de 1 año, debugging es poco probable.
 *
 * Default: corre diario via `imagina_crm/maintenance_purge` (Action
 * Scheduler). Borra en lotes de 5k para no cargar el server.
 *
 * Configurable: el admin puede cambiar `purge_retention_days` en
 * settings (default 365) y `purge_batch_size` (default 5000).
 */
final class PurgeService
{
    public const ACTION_PURGE = 'imagina_crm/maintenance_purge';

    /** Tablas con (columna timestamp) — la lista define qué se purga. */
    private const TABLES = [
        'slug_history'     => 'changed_at',
        'activity'         => 'created_at',
        'automation_runs'  => 'created_at',
    ];

    public function __construct(private readonly Database $db)
    {
    }

    /**
     * Ejecuta una pasada de purga sobre las 3 tablas. Devuelve el
     * total de filas borradas. Pensada para ser llamada desde un
     * Action Scheduler diario; correrla manualmente desde un admin
     * action también es válido.
     */
    public function run(int $retentionDays = 365, int $batchSize = 5000): int
    {
        $cutoff = gmdate('Y-m-d H:i:s', time() - ($retentionDays * 86400));
        $deleted = 0;
        foreach (self::TABLES as $table => $tsColumn) {
            $deleted += $this->purgeTable($table, $tsColumn, $cutoff, $batchSize);
        }
        return $deleted;
    }

    private function purgeTable(string $table, string $tsColumn, string $cutoff, int $batchSize): int
    {
        $wpdb  = $this->db->wpdb();
        $name  = $this->db->systemTable($table);
        $col   = '`' . esc_sql($tsColumn) . '`';
        $deleted = 0;
        $size  = max(100, min(20000, $batchSize));
        $maxIter = 50; // safety cap: 50 * 5000 = 250k por tabla por run.

        for ($i = 0; $i < $maxIter; $i++) {
            $result = $wpdb->query(
                /** @phpstan-ignore-next-line */
                $wpdb->prepare(
                    "DELETE FROM `{$name}` WHERE {$col} < %s LIMIT %d",
                    $cutoff,
                    $size,
                ),
            );
            if (! is_int($result) || $result <= 0) {
                break;
            }
            $deleted += $result;
            if ($result < $size) {
                break;
            }
        }
        return $deleted;
    }

    /**
     * Encola el cron diario si no está ya programado. Idempotente.
     */
    public function ensureScheduled(): void
    {
        if (! function_exists('as_has_scheduled_action') || ! function_exists('as_schedule_recurring_action')) {
            return;
        }
        if (as_has_scheduled_action(self::ACTION_PURGE, [], 'imagina-crm-maintenance')) {
            return;
        }
        as_schedule_recurring_action(
            time() + 600,
            DAY_IN_SECONDS,
            self::ACTION_PURGE,
            [],
            'imagina-crm-maintenance'
        );
    }

    /**
     * Engancha el handler del Action Scheduler. Llamado desde
     * Plugin::register() en cada bootstrap.
     */
    public function registerHandler(): void
    {
        if (! function_exists('add_action')) {
            return;
        }
        add_action(self::ACTION_PURGE, function (): void {
            $this->run();
        }, 10, 0);
    }
}
