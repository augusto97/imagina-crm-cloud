<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields;

use ImaginaCRM\Support\Cache;
use ImaginaCRM\Support\Database;

/**
 * Acceso a `wp_imcrm_fields`. Solo persistencia.
 *
 * Lecturas hot (`find`, `allForList`) van por `Cache` — beneficio
 * brutal con drop-in persistente (Redis/Memcached); fallback a
 * per-request sin él. Las escrituras (insert/update/delete) NO
 * cachean — los hooks `imagina_crm/field_*` se encargan de
 * invalidar todo el grupo automáticamente
 * (`Cache::registerInvalidationHooks`).
 */
final class FieldRepository
{
    public function __construct(
        private readonly Database $db,
        private readonly ?Cache $cache = null,
    ) {
    }

    public function find(int $id): ?FieldEntity
    {
        $loader = function () use ($id): ?FieldEntity {
            $wpdb = $this->db->wpdb();
            $row  = $wpdb->get_row(
                $wpdb->prepare(
                    'SELECT * FROM ' . $this->db->systemTable('fields')
                    . ' WHERE id = %d AND deleted_at IS NULL',
                    $id
                ),
                ARRAY_A
            );
            return is_array($row) ? FieldEntity::fromRow($row) : null;
        };
        if ($this->cache === null) {
            return $loader();
        }
        return $this->cache->remember(
            $this->cache->key('field', $id),
            $loader,
        );
    }

    public function findBySlug(int $listId, string $slug): ?FieldEntity
    {
        $loader = function () use ($listId, $slug): ?FieldEntity {
            $wpdb = $this->db->wpdb();
            $row  = $wpdb->get_row(
                $wpdb->prepare(
                    'SELECT * FROM ' . $this->db->systemTable('fields')
                    . ' WHERE list_id = %d AND slug = %s AND deleted_at IS NULL',
                    $listId,
                    $slug
                ),
                ARRAY_A
            );
            return is_array($row) ? FieldEntity::fromRow($row) : null;
        };
        if ($this->cache === null) {
            return $loader();
        }
        return $this->cache->remember(
            $this->cache->key('field_by_slug', "{$listId}:{$slug}"),
            $loader,
        );
    }

    /**
     * @return array<int, FieldEntity>
     */
    public function allForList(int $listId): array
    {
        $loader = function () use ($listId): array {
            $wpdb = $this->db->wpdb();
            $rows = $wpdb->get_results(
                $wpdb->prepare(
                    'SELECT * FROM ' . $this->db->systemTable('fields')
                    . ' WHERE list_id = %d AND deleted_at IS NULL'
                    . ' ORDER BY position ASC, id ASC',
                    $listId
                ),
                ARRAY_A
            );
            if (! is_array($rows)) {
                return [];
            }
            return array_map(static fn (array $r): FieldEntity => FieldEntity::fromRow($r), $rows);
        };
        if ($this->cache === null) {
            return $loader();
        }
        return $this->cache->remember(
            $this->cache->key('fields_for_list', $listId),
            $loader,
        );
    }

    /**
     * @param array<string, mixed> $data
     */
    public function insert(array $data): int
    {
        $wpdb = $this->db->wpdb();
        $wpdb->insert(
            $this->db->systemTable('fields'),
            [
                'list_id'     => (int) $data['list_id'],
                'slug'        => (string) $data['slug'],
                'column_name' => (string) $data['column_name'],
                'label'       => (string) $data['label'],
                'type'        => (string) $data['type'],
                'config'      => wp_json_encode($data['config'] ?? []),
                'is_required' => ! empty($data['is_required']) ? 1 : 0,
                'is_unique'   => ! empty($data['is_unique']) ? 1 : 0,
                'is_primary'  => ! empty($data['is_primary']) ? 1 : 0,
                'is_indexed'  => ! empty($data['is_indexed']) ? 1 : 0,
                'position'    => (int) ($data['position'] ?? 0),
                'created_at'  => (string) $data['created_at'],
                'updated_at'  => (string) $data['updated_at'],
            ],
            ['%d', '%s', '%s', '%s', '%s', '%s', '%d', '%d', '%d', '%d', '%d', '%s', '%s']
        );

        return $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $data Solo los campos a actualizar.
     */
    public function update(int $id, array $data): bool
    {
        $allowed = ['label', 'config', 'is_required', 'is_unique', 'is_primary', 'is_indexed', 'position'];
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
                case 'is_required':
                case 'is_unique':
                case 'is_primary':
                case 'is_indexed':
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
            $this->db->systemTable('fields'),
            $update,
            ['id' => $id],
            $format,
            ['%d']
        );

        return $result !== false;
    }

    public function softDelete(int $id): bool
    {
        $now    = current_time('mysql', true);
        $result = $this->db->wpdb()->update(
            $this->db->systemTable('fields'),
            ['deleted_at' => $now, 'updated_at' => $now],
            ['id' => $id],
            ['%s', '%s'],
            ['%d']
        );

        return $result !== false && $result > 0;
    }

    /**
     * Reordena campos en bulk. `$order` es `[fieldId => position]`.
     *
     * @param array<int, int> $order
     */
    public function reorder(int $listId, array $order): void
    {
        $wpdb = $this->db->wpdb();
        $now  = current_time('mysql', true);
        foreach ($order as $fieldId => $position) {
            $wpdb->update(
                $this->db->systemTable('fields'),
                ['position' => (int) $position, 'updated_at' => $now],
                ['id' => (int) $fieldId, 'list_id' => $listId],
                ['%d', '%s'],
                ['%d', '%d']
            );
        }
    }
}
