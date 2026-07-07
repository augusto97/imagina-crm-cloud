<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations;

use ImaginaCRM\Support\Database;

// No es `final` para permitir dobles de prueba en el suite unitario; el
// engine la consume sólo como punto de extensión interno del plugin.
class AutomationRepository
{
    public function __construct(private readonly Database $db)
    {
    }

    public function find(int $id): ?AutomationEntity
    {
        $wpdb = $this->db->wpdb();
        $row  = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('automations')
                . ' WHERE id = %d AND deleted_at IS NULL',
                $id,
            ),
            ARRAY_A,
        );
        return is_array($row) ? AutomationEntity::fromRow($row) : null;
    }

    /**
     * @return array<int, AutomationEntity>
     */
    public function allForList(int $listId): array
    {
        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('automations')
                . ' WHERE list_id = %d AND deleted_at IS NULL ORDER BY created_at DESC',
                $listId,
            ),
            ARRAY_A,
        );
        if (! is_array($rows)) {
            return [];
        }
        return array_map(static fn (array $r): AutomationEntity => AutomationEntity::fromRow($r), $rows);
    }

    /**
     * Devuelve automatizaciones activas de la lista cuyo trigger_type
     * coincide. Es la query caliente que el engine consulta en cada
     * record_created/record_updated.
     *
     * @return array<int, AutomationEntity>
     */
    public function activeForListAndTrigger(int $listId, string $triggerType): array
    {
        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('automations')
                . ' WHERE list_id = %d AND trigger_type = %s'
                . ' AND is_active = 1 AND deleted_at IS NULL'
                . ' ORDER BY id ASC',
                $listId,
                $triggerType,
            ),
            ARRAY_A,
        );
        if (! is_array($rows)) {
            return [];
        }
        return array_map(static fn (array $r): AutomationEntity => AutomationEntity::fromRow($r), $rows);
    }

    /**
     * Trae todas las automatizaciones activas (de todas las listas) cuyo
     * `trigger_type` está en la lista dada. La query caliente del
     * `ScheduledRunner` cuando hace su tick periódico.
     *
     * @param array<int, string> $triggerTypes
     * @return array<int, AutomationEntity>
     */
    public function activeWithTriggers(array $triggerTypes): array
    {
        if ($triggerTypes === []) {
            return [];
        }
        $wpdb = $this->db->wpdb();
        // %s placeholders dinámicos según count.
        $placeholders = implode(',', array_fill(0, count($triggerTypes), '%s'));
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('automations')
                . ' WHERE is_active = 1 AND deleted_at IS NULL'
                . ' AND trigger_type IN (' . $placeholders . ')'
                . ' ORDER BY id ASC',
                ...$triggerTypes,
            ),
            ARRAY_A,
        );
        if (! is_array($rows)) {
            return [];
        }
        return array_map(static fn (array $r): AutomationEntity => AutomationEntity::fromRow($r), $rows);
    }

    /**
     * Devuelve todas las automatizaciones cross-list cuya `actions` JSON
     * contiene una action del tipo dado (ej. `call_webhook`). Útil para
     * la vista "Webhooks" del settings que muestra todas las conexiones
     * outgoing del workspace. (Fase 15.C)
     *
     * @return array<int, AutomationEntity>
     */
    public function allWithActionType(string $actionType): array
    {
        if ($actionType === '') {
            return [];
        }
        $wpdb = $this->db->wpdb();
        // Filtramos por substring en el JSON (no es óptimo pero es
        // un endpoint de admin con baja frecuencia — usamos LIKE
        // sobre el campo `actions` con un patrón seguro).
        $like = '%' . $wpdb->esc_like('"type":"' . $actionType . '"') . '%';
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('automations')
                . ' WHERE deleted_at IS NULL AND actions LIKE %s'
                . ' ORDER BY created_at DESC',
                $like,
            ),
            ARRAY_A,
        );
        if (! is_array($rows)) {
            return [];
        }
        return array_map(static fn (array $r): AutomationEntity => AutomationEntity::fromRow($r), $rows);
    }

    /**
     * @param array<string, mixed> $data
     */
    public function insert(array $data): int
    {
        $this->db->wpdb()->insert(
            $this->db->systemTable('automations'),
            [
                'list_id'        => (int) $data['list_id'],
                'name'           => (string) $data['name'],
                'description'    => $data['description'] ?? null,
                'trigger_type'   => (string) $data['trigger_type'],
                'trigger_config' => wp_json_encode($data['trigger_config'] ?? []),
                'actions'        => wp_json_encode($data['actions'] ?? []),
                'is_active'      => ! empty($data['is_active']) ? 1 : 0,
                'created_by'     => (int) ($data['created_by'] ?? get_current_user_id()),
                'created_at'     => (string) $data['created_at'],
                'updated_at'     => (string) $data['updated_at'],
            ],
            ['%d', '%s', '%s', '%s', '%s', '%s', '%d', '%d', '%s', '%s'],
        );
        return $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $data
     */
    public function update(int $id, array $data): bool
    {
        $allowed = ['name', 'description', 'trigger_type', 'trigger_config', 'actions', 'is_active'];
        $update  = ['updated_at' => current_time('mysql', true)];
        $format  = ['%s'];

        foreach ($allowed as $key) {
            if (! array_key_exists($key, $data)) {
                continue;
            }
            switch ($key) {
                case 'trigger_config':
                case 'actions':
                    $update[$key] = wp_json_encode($data[$key] ?? []);
                    $format[]     = '%s';
                    break;
                case 'is_active':
                    $update[$key] = empty($data[$key]) ? 0 : 1;
                    $format[]     = '%d';
                    break;
                default:
                    $update[$key] = $data[$key] === null ? null : (string) $data[$key];
                    $format[]     = '%s';
            }
        }

        $result = $this->db->wpdb()->update(
            $this->db->systemTable('automations'),
            $update,
            ['id' => $id],
            $format,
            ['%d'],
        );
        return $result !== false;
    }

    public function softDelete(int $id): bool
    {
        $now = current_time('mysql', true);
        $result = $this->db->wpdb()->update(
            $this->db->systemTable('automations'),
            ['deleted_at' => $now, 'updated_at' => $now, 'is_active' => 0],
            ['id' => $id],
            ['%s', '%s', '%d'],
            ['%d'],
        );
        return $result !== false && $result > 0;
    }
}
