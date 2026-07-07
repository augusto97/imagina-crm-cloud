<?php
declare(strict_types=1);

namespace ImaginaCRM\Exports;

use ImaginaCRM\Support\Database;

/**
 * Persistencia de los export jobs (Fase 17.A — DEFERRED #2).
 */
final class ExportJobRepository
{
    public function __construct(private readonly Database $db)
    {
    }

    public function find(int $id): ?ExportJobEntity
    {
        $wpdb = $this->db->wpdb();
        $row = $wpdb->get_row(
            (string) $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('export_jobs') . ' WHERE id = %d',
                $id,
            ),
            ARRAY_A,
        );
        return is_array($row) ? ExportJobEntity::fromRow($row) : null;
    }

    /**
     * @param array<string, mixed> $params
     */
    public function insert(int $listId, int $userId, array $params): int
    {
        $wpdb = $this->db->wpdb();
        $now = current_time('mysql', true);
        $ok = $wpdb->insert(
            $this->db->systemTable('export_jobs'),
            [
                'list_id'    => $listId,
                'user_id'    => $userId,
                'status'     => ExportJobEntity::STATUS_PENDING,
                'params'     => (string) wp_json_encode($params),
                'created_at' => $now,
            ],
            ['%d', '%d', '%s', '%s', '%s'],
        );
        if ($ok === false) {
            return 0;
        }
        return (int) $wpdb->insert_id;
    }

    public function markRunning(int $id): bool
    {
        return $this->updateRow($id, ['status' => ExportJobEntity::STATUS_RUNNING]);
    }

    public function markReady(int $id, string $filePath, int $rowCount): bool
    {
        return $this->updateRow($id, [
            'status'       => ExportJobEntity::STATUS_READY,
            'file_path'    => $filePath,
            'row_count'    => $rowCount,
            'completed_at' => current_time('mysql', true),
        ]);
    }

    public function markFailed(int $id, string $error): bool
    {
        return $this->updateRow($id, [
            'status'       => ExportJobEntity::STATUS_FAILED,
            'error'        => mb_substr($error, 0, 512),
            'completed_at' => current_time('mysql', true),
        ]);
    }

    /**
     * Jobs del usuario para listar en la UI ("mis exports recientes").
     * @return list<ExportJobEntity>
     */
    public function recentForUser(int $userId, int $limit = 20): array
    {
        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_results(
            (string) $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('export_jobs')
                . ' WHERE user_id = %d ORDER BY created_at DESC LIMIT %d',
                $userId,
                max(1, min(100, $limit)),
            ),
            ARRAY_A,
        );
        if (! is_array($rows)) {
            return [];
        }
        return array_map(static fn (array $r): ExportJobEntity => ExportJobEntity::fromRow($r), $rows);
    }

    /**
     * Cleanup: borra jobs (y sus archivos) más viejos que `$days`.
     * Devuelve count de jobs eliminados. Llamado por cron diario.
     */
    public function purgeOlderThan(int $days): int
    {
        $wpdb = $this->db->wpdb();
        $cutoff = gmdate('Y-m-d H:i:s', time() - $days * 86400);
        // Primero: leer los file_paths para borrar archivos del FS.
        $oldRows = $wpdb->get_results(
            (string) $wpdb->prepare(
                'SELECT id, file_path FROM ' . $this->db->systemTable('export_jobs')
                . ' WHERE created_at < %s',
                $cutoff,
            ),
            ARRAY_A,
        );
        if (is_array($oldRows)) {
            foreach ($oldRows as $r) {
                $path = isset($r['file_path']) ? (string) $r['file_path'] : '';
                if ($path !== '' && file_exists($path) && is_writable($path)) {
                    @unlink($path);
                }
            }
        }
        $deleted = $wpdb->query(
            (string) $wpdb->prepare(
                'DELETE FROM ' . $this->db->systemTable('export_jobs') . ' WHERE created_at < %s',
                $cutoff,
            ),
        );
        return is_int($deleted) ? $deleted : 0;
    }

    /**
     * @param array<string, mixed> $data
     */
    private function updateRow(int $id, array $data): bool
    {
        $wpdb = $this->db->wpdb();
        $formats = array_map(static function ($v): string {
            if (is_int($v)) return '%d';
            if (is_float($v)) return '%f';
            return '%s';
        }, array_values($data));
        $result = $wpdb->update(
            $this->db->systemTable('export_jobs'),
            $data,
            ['id' => $id],
            $formats,
            ['%d'],
        );
        return $result !== false;
    }
}
