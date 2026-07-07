<?php
declare(strict_types=1);

namespace ImaginaCRM\Lists;

use ImaginaCRM\Support\Cache;
use ImaginaCRM\Support\Database;

/**
 * Acceso a `wp_imcrm_lists`.
 *
 * Solo persistencia: nada de validación ni de DDL — eso vive en
 * `ListService`, `SlugManager` y `SchemaManager`.
 *
 * Lecturas hot (`find`, `findBySlug`, `all`) van por `Cache`. Las
 * escrituras NO cachean — los hooks `imagina_crm/list_*`
 * invalidan el group automáticamente
 * (`Cache::registerInvalidationHooks`).
 */
// No es `final` para permitir dobles de prueba en el suite unitario;
// ningún consumer del plugin debería extenderla en runtime.
class ListRepository
{
    public function __construct(
        private readonly Database $db,
        private readonly ?Cache $cache = null,
    ) {
    }

    public function find(int $id): ?ListEntity
    {
        $loader = function () use ($id): ?ListEntity {
            $wpdb = $this->db->wpdb();
            $row  = $wpdb->get_row(
                $wpdb->prepare(
                    'SELECT * FROM ' . $this->db->systemTable('lists')
                    . ' WHERE id = %d AND deleted_at IS NULL',
                    $id
                ),
                ARRAY_A
            );
            return is_array($row) ? ListEntity::fromRow($row) : null;
        };
        if ($this->cache === null) {
            return $loader();
        }
        return $this->cache->remember($this->cache->key('list', $id), $loader);
    }

    public function findBySlug(string $slug): ?ListEntity
    {
        $loader = function () use ($slug): ?ListEntity {
            $wpdb = $this->db->wpdb();
            $row  = $wpdb->get_row(
                $wpdb->prepare(
                    'SELECT * FROM ' . $this->db->systemTable('lists')
                    . ' WHERE slug = %s AND deleted_at IS NULL',
                    $slug
                ),
                ARRAY_A
            );
            return is_array($row) ? ListEntity::fromRow($row) : null;
        };
        if ($this->cache === null) {
            return $loader();
        }
        return $this->cache->remember($this->cache->key('list_by_slug', $slug), $loader);
    }

    /**
     * @return array<int, ListEntity>
     */
    public function all(): array
    {
        $loader = function (): array {
            $wpdb = $this->db->wpdb();
            $rows = $wpdb->get_results(
                'SELECT * FROM ' . $this->db->systemTable('lists')
                . ' WHERE deleted_at IS NULL ORDER BY position ASC, id ASC',
                ARRAY_A
            );
            if (! is_array($rows)) {
                return [];
            }
            return array_map(static fn (array $r): ListEntity => ListEntity::fromRow($r), $rows);
        };
        if ($this->cache === null) {
            return $loader();
        }
        return $this->cache->remember($this->cache->key('lists', 'all'), $loader);
    }

    /**
     * @param array<string, mixed> $data
     */
    public function insert(array $data): int
    {
        $wpdb = $this->db->wpdb();
        $wpdb->insert(
            $this->db->systemTable('lists'),
            [
                'slug'         => (string) $data['slug'],
                'table_suffix' => (string) $data['table_suffix'],
                'name'         => (string) $data['name'],
                'description'  => $data['description'] ?? null,
                'icon'         => $data['icon'] ?? null,
                'color'        => $data['color'] ?? null,
                'settings'     => wp_json_encode($data['settings'] ?? []),
                'position'     => (int) ($data['position'] ?? 0),
                'created_by'   => (int) ($data['created_by'] ?? get_current_user_id()),
                'created_at'   => (string) $data['created_at'],
                'updated_at'   => (string) $data['updated_at'],
            ],
            ['%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%d', '%s', '%s']
        );

        return $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $data Solo los campos a actualizar.
     */
    public function update(int $id, array $data): bool
    {
        $allowed = ['name', 'description', 'icon', 'color', 'settings', 'position'];
        $update  = ['updated_at' => current_time('mysql', true)];
        $format  = ['%s'];

        foreach ($allowed as $key) {
            if (! array_key_exists($key, $data)) {
                continue;
            }
            if ($key === 'settings') {
                $update[$key] = wp_json_encode($data[$key] ?? []);
                $format[]     = '%s';
                continue;
            }
            if ($key === 'position') {
                $update[$key] = (int) $data[$key];
                $format[]     = '%d';
                continue;
            }
            $update[$key] = $data[$key] === null ? null : (string) $data[$key];
            $format[]     = '%s';
        }

        $result = $this->db->wpdb()->update(
            $this->db->systemTable('lists'),
            $update,
            ['id' => $id],
            $format,
            ['%d']
        );

        return $result !== false;
    }

    /**
     * Soft delete: marca `deleted_at`. El service decide si además dropear
     * la tabla dinámica.
     */
    public function softDelete(int $id): bool
    {
        $now = current_time('mysql', true);
        $result = $this->db->wpdb()->update(
            $this->db->systemTable('lists'),
            ['deleted_at' => $now, 'updated_at' => $now],
            ['id' => $id],
            ['%s', '%s'],
            ['%d']
        );

        return $result !== false && $result > 0;
    }
}
