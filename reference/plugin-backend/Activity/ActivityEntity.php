<?php
declare(strict_types=1);

namespace ImaginaCRM\Activity;

/**
 * Snapshot inmutable de una entrada del log de actividad.
 *
 * `action` es un slug corto (ej. `record.updated`, `comment.created`,
 * `automation.run.failed`). El `changes` JSON contiene el diff o
 * payload específico del evento — su shape depende del action.
 */
final class ActivityEntity
{
    /**
     * @param array<string, mixed> $changes
     */
    public function __construct(
        public readonly int $id,
        public readonly int $listId,
        public readonly ?int $recordId,
        public readonly ?int $userId,
        public readonly string $action,
        public readonly array $changes,
        public readonly string $createdAt,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(array $row): self
    {
        $changesRaw = $row['changes'] ?? null;
        $changes    = is_string($changesRaw) ? json_decode($changesRaw, true) : null;

        return new self(
            id:        (int) ($row['id'] ?? 0),
            listId:    (int) ($row['list_id'] ?? 0),
            recordId:  isset($row['record_id']) && $row['record_id'] !== null ? (int) $row['record_id'] : null,
            userId:    isset($row['user_id']) && $row['user_id'] !== null ? (int) $row['user_id'] : null,
            action:    (string) ($row['action'] ?? ''),
            changes:   is_array($changes) ? $changes : [],
            createdAt: (string) ($row['created_at'] ?? ''),
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
            'action'     => $this->action,
            'changes'    => $this->changes,
            'created_at' => $this->createdAt,
        ];
    }
}
