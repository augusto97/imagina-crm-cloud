<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations;

use ImaginaCRM\Support\Database;

/**
 * Acceso a `wp_imcrm_automation_runs`. Cada ejecución del engine deja
 * una fila aquí — usada para auditoría y para reintentos del Action
 * Scheduler en commit posterior.
 */
// No es `final` para permitir dobles de prueba en el suite unitario; el
// engine la consume sólo como punto de extensión interno del plugin.
class AutomationRunRepository
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_RUNNING = 'running';
    public const STATUS_SUCCESS = 'success';
    public const STATUS_FAILED  = 'failed';

    public function __construct(private readonly Database $db)
    {
    }

    /**
     * @param array<string, mixed> $data
     */
    public function create(array $data): int
    {
        $now = current_time('mysql', true);
        $this->db->wpdb()->insert(
            $this->db->systemTable('automation_runs'),
            [
                'automation_id'    => (int) $data['automation_id'],
                'list_id'          => (int) $data['list_id'],
                'record_id'        => isset($data['record_id']) ? (int) $data['record_id'] : null,
                'status'           => (string) ($data['status'] ?? self::STATUS_PENDING),
                'trigger_context' => isset($data['trigger_context']) ? (string) wp_json_encode($data['trigger_context']) : null,
                'actions_log'      => null,
                'error'            => null,
                'retries'          => 0,
                'started_at'       => $data['started_at'] ?? null,
                'finished_at'      => null,
                'created_at'       => $now,
            ],
            ['%d', '%d', '%d', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s'],
        );
        return $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $patch
     */
    public function update(int $id, array $patch): bool
    {
        $allowed = ['status', 'actions_log', 'error', 'retries', 'started_at', 'finished_at'];
        $update  = [];
        $format  = [];
        foreach ($allowed as $key) {
            if (! array_key_exists($key, $patch)) {
                continue;
            }
            switch ($key) {
                case 'actions_log':
                    $update[$key] = wp_json_encode($patch[$key] ?? []);
                    $format[]     = '%s';
                    break;
                case 'retries':
                    $update[$key] = (int) $patch[$key];
                    $format[]     = '%d';
                    break;
                default:
                    $update[$key] = $patch[$key] === null ? null : (string) $patch[$key];
                    $format[]     = '%s';
            }
        }
        if ($update === []) {
            return false;
        }
        $result = $this->db->wpdb()->update(
            $this->db->systemTable('automation_runs'),
            $update,
            ['id' => $id],
            $format,
            ['%d'],
        );
        return $result !== false;
    }

    /**
     * @return array<string, mixed>|null Fila cruda; el caller decodifica los JSON
     *                                   columns (`trigger_context`, `actions_log`)
     *                                   según necesidad.
     */
    public function find(int $id): ?array
    {
        $wpdb = $this->db->wpdb();
        $row  = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('automation_runs') . ' WHERE id = %d',
                $id,
            ),
            ARRAY_A,
        );
        return is_array($row) ? $row : null;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function recentForAutomation(int $automationId, int $limit = 50): array
    {
        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('automation_runs')
                . ' WHERE automation_id = %d ORDER BY created_at DESC LIMIT %d',
                $automationId,
                $limit,
            ),
            ARRAY_A,
        );
        return is_array($rows) ? $rows : [];
    }
}
