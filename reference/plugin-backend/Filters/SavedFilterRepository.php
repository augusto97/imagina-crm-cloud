<?php
declare(strict_types=1);

namespace ImaginaCRM\Filters;

use ImaginaCRM\Support\Database;

/**
 * Acceso a `wp_imcrm_saved_filters`. CRUD básico — todo prepared
 * statement, scopeado por list_id.
 */
final class SavedFilterRepository
{
    public function __construct(private readonly Database $db)
    {
    }

    /**
     * @return array<int, SavedFilterEntity>
     */
    public function listForUser(int $listId, int $userId): array
    {
        $table = $this->db->systemTable('saved_filters');
        $wpdb  = $this->db->wpdb();
        // Devuelve los filtros del usuario + los compartidos (user_id NULL).
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$table} WHERE list_id = %d AND (user_id = %d OR user_id IS NULL) ORDER BY name ASC",
                $listId,
                $userId,
            ),
            ARRAY_A,
        );
        $rows = is_array($rows) ? $rows : [];
        return array_map(static fn (array $r): SavedFilterEntity => SavedFilterEntity::fromRow($r), $rows);
    }

    public function find(int $id): ?SavedFilterEntity
    {
        $table = $this->db->systemTable('saved_filters');
        $wpdb  = $this->db->wpdb();
        $row   = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$table} WHERE id = %d", $id),
            ARRAY_A,
        );
        return is_array($row) ? SavedFilterEntity::fromRow($row) : null;
    }

    /**
     * @param array<string, mixed> $filterTree
     */
    public function insert(int $listId, ?int $userId, string $name, array $filterTree): int
    {
        $now   = current_time('mysql', true);
        $table = $this->db->systemTable('saved_filters');
        $wpdb  = $this->db->wpdb();

        $sql = "INSERT INTO {$table} (list_id, user_id, name, filter_tree, created_at, updated_at)"
             . ' VALUES (%d, ' . ($userId === null ? 'NULL' : '%d') . ', %s, %s, %s, %s)';
        $args = $userId === null
            ? [$listId, $name, (string) wp_json_encode($filterTree), $now, $now]
            : [$listId, $userId, $name, (string) wp_json_encode($filterTree), $now, $now];
        $wpdb->query((string) $wpdb->prepare($sql, $args));

        return $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed>|null $filterTree
     */
    public function update(int $id, ?string $name, ?array $filterTree): bool
    {
        $sets = [];
        $args = [];
        if ($name !== null) {
            $sets[] = 'name = %s';
            $args[] = $name;
        }
        if ($filterTree !== null) {
            $sets[] = 'filter_tree = %s';
            $args[] = (string) wp_json_encode($filterTree);
        }
        if ($sets === []) {
            return true; // no-op
        }
        $sets[] = 'updated_at = %s';
        $args[] = current_time('mysql', true);
        $args[] = $id;

        $table = $this->db->systemTable('saved_filters');
        $wpdb  = $this->db->wpdb();
        $sql   = "UPDATE {$table} SET " . implode(', ', $sets) . ' WHERE id = %d';
        $result = $wpdb->query((string) $wpdb->prepare($sql, $args));
        return $result !== false;
    }

    public function delete(int $id): bool
    {
        $table = $this->db->systemTable('saved_filters');
        $wpdb  = $this->db->wpdb();
        $result = $wpdb->query(
            (string) $wpdb->prepare("DELETE FROM {$table} WHERE id = %d", $id),
        );
        return is_int($result) && $result > 0;
    }
}
