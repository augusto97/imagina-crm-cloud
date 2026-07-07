<?php
declare(strict_types=1);

namespace ImaginaCRM\Comments;

use ImaginaCRM\Support\Database;

/**
 * Acceso a `wp_imcrm_comments`. No es `final` para permitir test doubles
 * en el suite unitario (mismo patrón que AutomationRepository).
 */
class CommentRepository
{
    public function __construct(private readonly Database $db)
    {
    }

    public function find(int $id): ?CommentEntity
    {
        $wpdb = $this->db->wpdb();
        $row  = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('comments') . ' WHERE id = %d AND deleted_at IS NULL',
                $id,
            ),
            ARRAY_A,
        );
        return is_array($row) ? CommentEntity::fromRow($row) : null;
    }

    /**
     * Lista cronológica (ascendente) de comentarios para un record. Sin
     * deleted, sin paginar — los hilos rara vez superan unos cuantos
     * cientos de mensajes; el frontend puede virtualizar si llega el caso.
     *
     * @return array<int, CommentEntity>
     */
    public function allForRecord(int $listId, int $recordId): array
    {
        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT * FROM ' . $this->db->systemTable('comments')
                . ' WHERE list_id = %d AND record_id = %d AND deleted_at IS NULL'
                . ' ORDER BY created_at ASC, id ASC',
                $listId,
                $recordId,
            ),
            ARRAY_A,
        );
        if (! is_array($rows)) {
            return [];
        }
        return array_map(static fn (array $r): CommentEntity => CommentEntity::fromRow($r), $rows);
    }

    /**
     * @param array<string, mixed> $data
     */
    public function insert(array $data): int
    {
        $now = current_time('mysql', true);
        $metadata = isset($data['metadata']) && is_array($data['metadata']) && $data['metadata'] !== []
            ? wp_json_encode($data['metadata'])
            : null;
        $this->db->wpdb()->insert(
            $this->db->systemTable('comments'),
            [
                'list_id'    => (int) $data['list_id'],
                'record_id'  => (int) $data['record_id'],
                'user_id'    => (int) $data['user_id'],
                'parent_id'  => isset($data['parent_id']) && $data['parent_id'] !== null ? (int) $data['parent_id'] : null,
                'content'    => (string) $data['content'],
                'metadata'   => is_string($metadata) ? $metadata : null,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            ['%d', '%d', '%d', '%d', '%s', '%s', '%s', '%s'],
        );
        return $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed>|null $metadata  null = no tocar el campo;
     *                                              [] = limpiarlo a NULL.
     */
    public function updateContent(int $id, string $content, ?array $metadata = null): bool
    {
        $now = current_time('mysql', true);
        $data   = ['content' => $content, 'updated_at' => $now];
        $format = ['%s', '%s'];
        if ($metadata !== null) {
            $data['metadata'] = $metadata === [] ? null : wp_json_encode($metadata);
            $format[]          = '%s';
        }
        $result = $this->db->wpdb()->update(
            $this->db->systemTable('comments'),
            $data,
            ['id' => $id, 'deleted_at' => null],
            $format,
            ['%d', '%s'],
        );
        return $result !== false && $result > 0;
    }

    public function softDelete(int $id): bool
    {
        $now = current_time('mysql', true);
        $result = $this->db->wpdb()->update(
            $this->db->systemTable('comments'),
            ['deleted_at' => $now, 'updated_at' => $now],
            ['id' => $id],
            ['%s', '%s'],
            ['%d'],
        );
        return $result !== false && $result > 0;
    }
}
