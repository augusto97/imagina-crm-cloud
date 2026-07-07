<?php
declare(strict_types=1);

namespace ImaginaCRM\Comments;

/**
 * Snapshot inmutable de un comentario en `wp_imcrm_comments`.
 *
 * El campo `content` es el texto crudo (con menciones `@usuario` aún sin
 * resolver). El renderizado a HTML / la resolución de menciones a IDs de
 * usuario se hace en el frontend; el backend sólo persiste el string.
 *
 * `metadata` (0.33.0+): JSON arbitrario asociado al comentario. Lo usa
 * el composer multi-modo para guardar `kind` (note/call/email/meeting)
 * y per-mode info — duración de llamada, asunto/destinatario de email,
 * asistentes de reunión, etc. Backend agnostic respecto a su shape.
 */
final class CommentEntity
{
    /**
     * @param array<string, mixed> $metadata
     */
    public function __construct(
        public readonly int $id,
        public readonly int $listId,
        public readonly int $recordId,
        public readonly int $userId,
        public readonly ?int $parentId,
        public readonly string $content,
        public readonly array $metadata,
        public readonly string $createdAt,
        public readonly string $updatedAt,
        public readonly ?string $deletedAt,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(array $row): self
    {
        $metadataRaw = $row['metadata'] ?? null;
        $metadata = [];
        if (is_string($metadataRaw) && $metadataRaw !== '') {
            $decoded = json_decode($metadataRaw, true);
            if (is_array($decoded)) {
                $metadata = $decoded;
            }
        }

        return new self(
            id:        (int) ($row['id'] ?? 0),
            listId:    (int) ($row['list_id'] ?? 0),
            recordId:  (int) ($row['record_id'] ?? 0),
            userId:    (int) ($row['user_id'] ?? 0),
            parentId:  isset($row['parent_id']) && $row['parent_id'] !== null ? (int) $row['parent_id'] : null,
            content:   (string) ($row['content'] ?? ''),
            metadata:  $metadata,
            createdAt: (string) ($row['created_at'] ?? ''),
            updatedAt: (string) ($row['updated_at'] ?? ''),
            deletedAt: isset($row['deleted_at']) ? (string) $row['deleted_at'] : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'id'         => $this->id,
            'list_id'    => $this->listId,
            'record_id'  => $this->recordId,
            'user_id'    => $this->userId,
            'parent_id'  => $this->parentId,
            'content'    => $this->content,
            'metadata'   => $this->metadata,
            'created_at' => $this->createdAt,
            'updated_at' => $this->updatedAt,
        ];
    }
}
