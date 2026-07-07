<?php
declare(strict_types=1);

namespace ImaginaCRM\Activity;

use ImaginaCRM\Support\Database;

/**
 * Acceso a `wp_imcrm_activity`. Append-only por diseño — el log es
 * auditoría, no un recurso editable.
 *
 * No es `final` para permitir test doubles en el suite unitario.
 */
class ActivityRepository
{
    public function __construct(private readonly Database $db)
    {
    }

    /**
     * @param array<string, mixed> $data
     */
    public function insert(array $data): int
    {
        $now = current_time('mysql', true);
        $this->db->wpdb()->insert(
            $this->db->systemTable('activity'),
            [
                'list_id'    => (int) $data['list_id'],
                'record_id'  => isset($data['record_id']) && $data['record_id'] !== null ? (int) $data['record_id'] : null,
                'user_id'    => isset($data['user_id']) && $data['user_id'] !== null ? (int) $data['user_id'] : null,
                'action'     => (string) $data['action'],
                'changes'    => isset($data['changes']) ? (string) wp_json_encode($data['changes']) : null,
                'created_at' => $now,
            ],
            ['%d', '%d', '%d', '%s', '%s', '%s'],
        );
        return $this->db->lastInsertId();
    }

    /**
     * Listado más reciente primero, paginado por `limit`/`offset`. Útil
     * para timelines de panel lateral o tabla global de actividad.
     *
     * @return array<int, ActivityEntity>
     */
    public function recentForRecord(int $listId, int $recordId, int $limit = 100, int $offset = 0): array
    {
        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('activity')
                . ' WHERE list_id = %d AND record_id = %d'
                . ' ORDER BY created_at DESC, id DESC'
                . ' LIMIT %d OFFSET %d',
                $listId,
                $recordId,
                $limit,
                $offset,
            ),
            ARRAY_A,
        );
        if (! is_array($rows)) {
            return [];
        }
        return array_map(static fn (array $r): ActivityEntity => ActivityEntity::fromRow($r), $rows);
    }

    /**
     * Filtra por usuario y, opcionalmente, por action. Usado por
     * `/me/mentions` para listar comentarios donde fui mencionado.
     *
     * Nota: no hay índice por user_id en la tabla por defecto; en
     * volúmenes pequeños de actividad el escaneo es despreciable. Si
     * la tabla crece a millones de filas considerar añadir
     * `KEY idx_user (user_id)` vía Upgrader.
     *
     * @return array<int, ActivityEntity>
     */
    public function recentForUser(int $userId, ?string $action, int $limit = 100, int $offset = 0): array
    {
        $wpdb = $this->db->wpdb();
        $table = $this->db->systemTable('activity');

        if ($action !== null) {
            $rows = $wpdb->get_results(
                $wpdb->prepare(
                    'SELECT * FROM ' . $table
                    . ' WHERE user_id = %d AND action = %s'
                    . ' ORDER BY created_at DESC, id DESC'
                    . ' LIMIT %d OFFSET %d',
                    $userId,
                    $action,
                    $limit,
                    $offset,
                ),
                ARRAY_A,
            );
        } else {
            $rows = $wpdb->get_results(
                $wpdb->prepare(
                    'SELECT * FROM ' . $table
                    . ' WHERE user_id = %d'
                    . ' ORDER BY created_at DESC, id DESC'
                    . ' LIMIT %d OFFSET %d',
                    $userId,
                    $limit,
                    $offset,
                ),
                ARRAY_A,
            );
        }

        if (! is_array($rows)) {
            return [];
        }
        return array_map(static fn (array $r): ActivityEntity => ActivityEntity::fromRow($r), $rows);
    }

    /**
     * @return array<int, ActivityEntity>
     */
    public function recentForList(int $listId, int $limit = 100, int $offset = 0): array
    {
        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('activity')
                . ' WHERE list_id = %d'
                . ' ORDER BY created_at DESC, id DESC'
                . ' LIMIT %d OFFSET %d',
                $listId,
                $limit,
                $offset,
            ),
            ARRAY_A,
        );
        if (! is_array($rows)) {
            return [];
        }
        return array_map(static fn (array $r): ActivityEntity => ActivityEntity::fromRow($r), $rows);
    }
}
