<?php
declare(strict_types=1);

namespace ImaginaCRM\Dashboards;

use ImaginaCRM\Support\Database;

/**
 * DAL contra `wp_imcrm_dashboards`. No es `final` para permitir test
 * doubles unitarios (mismo patrón que repos similares).
 */
class DashboardRepository
{
    public function __construct(private readonly Database $db)
    {
    }

    public function find(int $id): ?DashboardEntity
    {
        $wpdb = $this->db->wpdb();
        $row  = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('dashboards')
                . ' WHERE id = %d AND deleted_at IS NULL',
                $id,
            ),
            ARRAY_A,
        );
        return is_array($row) ? DashboardEntity::fromRow($row) : null;
    }

    /**
     * Devuelve los dashboards visibles para `$userId`: tanto los suyos
     * (user_id = $userId) como los compartidos (user_id NULL). Los
     * compartidos primero por convención (orden default = position asc,
     * luego por id).
     *
     * @return array<int, DashboardEntity>
     */
    public function visibleFor(int $userId): array
    {
        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('dashboards')
                . ' WHERE deleted_at IS NULL AND (user_id IS NULL OR user_id = %d)'
                . ' ORDER BY user_id IS NULL DESC, position ASC, id ASC',
                $userId,
            ),
            ARRAY_A,
        );
        if (! is_array($rows)) {
            return [];
        }
        return array_map(static fn (array $r): DashboardEntity => DashboardEntity::fromRow($r), $rows);
    }

    /**
     * Todos los dashboards activos (no soft-deleted), independientemente
     * del usuario. Usado para tareas de housekeeping (e.g. limpiar
     * widgets que referencian un field recién borrado).
     *
     * @return array<int, DashboardEntity>
     */
    public function allActive(): array
    {
        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_results(
            'SELECT * FROM ' . $this->db->systemTable('dashboards') . ' WHERE deleted_at IS NULL',
            ARRAY_A,
        );
        if (! is_array($rows)) {
            return [];
        }
        return array_map(static fn (array $r): DashboardEntity => DashboardEntity::fromRow($r), $rows);
    }

    /**
     * @param array<string, mixed> $data
     */
    public function insert(array $data): int
    {
        $now = current_time('mysql', true);
        $this->db->wpdb()->insert(
            $this->db->systemTable('dashboards'),
            [
                'user_id'     => isset($data['user_id']) && $data['user_id'] !== null ? (int) $data['user_id'] : null,
                'name'        => (string) $data['name'],
                'description' => $data['description'] ?? null,
                'widgets'     => (string) wp_json_encode($data['widgets'] ?? []),
                'is_default'  => ! empty($data['is_default']) ? 1 : 0,
                'position'    => isset($data['position']) ? (int) $data['position'] : 0,
                'created_by'  => (int) ($data['created_by'] ?? get_current_user_id()),
                'created_at'  => $now,
                'updated_at'  => $now,
            ],
            ['%d', '%s', '%s', '%s', '%d', '%d', '%d', '%s', '%s'],
        );
        return $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $data
     */
    public function update(int $id, array $data): bool
    {
        $allowed = ['name', 'description', 'widgets', 'is_default', 'position'];
        $update  = ['updated_at' => current_time('mysql', true)];
        $format  = ['%s'];

        foreach ($allowed as $key) {
            if (! array_key_exists($key, $data)) {
                continue;
            }
            switch ($key) {
                case 'widgets':
                    $update[$key] = (string) wp_json_encode($data[$key] ?? []);
                    $format[]     = '%s';
                    break;
                case 'is_default':
                case 'position':
                    $update[$key] = (int) ($data[$key] ?? 0);
                    $format[]     = '%d';
                    break;
                default:
                    $update[$key] = $data[$key] === null ? null : (string) $data[$key];
                    $format[]     = '%s';
            }
        }

        $result = $this->db->wpdb()->update(
            $this->db->systemTable('dashboards'),
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
            $this->db->systemTable('dashboards'),
            ['deleted_at' => $now, 'updated_at' => $now],
            ['id' => $id],
            ['%s', '%s'],
            ['%d'],
        );
        return $result !== false && $result > 0;
    }
}
