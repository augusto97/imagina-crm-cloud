<?php
declare(strict_types=1);

namespace ImaginaCRM\Views;

use ImaginaCRM\Support\Database;

/**
 * Acceso a `wp_imcrm_saved_views`. Solo persistencia.
 */
final class SavedViewRepository
{
    public function __construct(private readonly Database $db)
    {
    }

    public function find(int $id): ?SavedViewEntity
    {
        $wpdb = $this->db->wpdb();
        $row  = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('saved_views') . ' WHERE id = %d',
                $id
            ),
            ARRAY_A
        );
        return is_array($row) ? SavedViewEntity::fromRow($row) : null;
    }

    /**
     * @return array<int, SavedViewEntity>
     */
    public function allForList(int $listId): array
    {
        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('saved_views')
                . ' WHERE list_id = %d ORDER BY position ASC, id ASC',
                $listId
            ),
            ARRAY_A
        );
        if (! is_array($rows)) {
            return [];
        }
        return array_map(static fn (array $r): SavedViewEntity => SavedViewEntity::fromRow($r), $rows);
    }

    /**
     * @param array<string, mixed> $data
     */
    public function insert(array $data): int
    {
        $this->db->wpdb()->insert(
            $this->db->systemTable('saved_views'),
            [
                'list_id'    => (int) $data['list_id'],
                'user_id'    => isset($data['user_id']) ? (int) $data['user_id'] : null,
                'name'       => (string) $data['name'],
                'type'       => (string) ($data['type'] ?? 'table'),
                'config'     => wp_json_encode($data['config'] ?? []),
                'is_default' => ! empty($data['is_default']) ? 1 : 0,
                'position'   => (int) ($data['position'] ?? 0),
                'created_at' => (string) $data['created_at'],
                'updated_at' => (string) $data['updated_at'],
            ],
            ['%d', '%d', '%s', '%s', '%s', '%d', '%d', '%s', '%s']
        );
        return $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $data
     */
    public function update(int $id, array $data): bool
    {
        $allowed = ['name', 'type', 'config', 'is_default', 'position'];
        $update  = ['updated_at' => current_time('mysql', true)];
        $format  = ['%s'];

        foreach ($allowed as $key) {
            if (! array_key_exists($key, $data)) {
                continue;
            }
            switch ($key) {
                case 'config':
                    $update[$key] = wp_json_encode($data[$key] ?? []);
                    $format[]     = '%s';
                    break;
                case 'is_default':
                    $update[$key] = empty($data[$key]) ? 0 : 1;
                    $format[]     = '%d';
                    break;
                case 'position':
                    $update[$key] = (int) $data[$key];
                    $format[]     = '%d';
                    break;
                default:
                    $update[$key] = (string) $data[$key];
                    $format[]     = '%s';
            }
        }

        $result = $this->db->wpdb()->update(
            $this->db->systemTable('saved_views'),
            $update,
            ['id' => $id],
            $format,
            ['%d']
        );
        return $result !== false;
    }

    public function delete(int $id): bool
    {
        $result = $this->db->wpdb()->delete(
            $this->db->systemTable('saved_views'),
            ['id' => $id],
            ['%d']
        );
        return $result !== false && $result > 0;
    }

    /**
     * Marca una vista como default y desmarca el resto de la misma lista.
     */
    public function setDefault(int $listId, int $viewId): void
    {
        $wpdb = $this->db->wpdb();
        $wpdb->query(
            (string) $wpdb->prepare(
                'UPDATE ' . $this->db->systemTable('saved_views')
                . ' SET is_default = 0 WHERE list_id = %d AND id <> %d',
                $listId,
                $viewId
            )
        );
        $wpdb->update(
            $this->db->systemTable('saved_views'),
            ['is_default' => 1, 'updated_at' => current_time('mysql', true)],
            ['id' => $viewId, 'list_id' => $listId],
            ['%d', '%s'],
            ['%d', '%d']
        );
    }
}
