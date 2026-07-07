<?php
declare(strict_types=1);

namespace ImaginaCRM\Filters;

/**
 * Filtro guardado (ClickUp-style): un set nombrado de condiciones
 * reusable entre vistas de la misma lista. `user_id = null` indica
 * que es compartido con todo el "entorno de trabajo".
 *
 * `filter_tree` es el shape `FilterTree` del frontend serializado en
 * JSON: `{type: 'group', logic: 'and|or', children: [...]}`.
 */
final class SavedFilterEntity
{
    /**
     * @param array<string, mixed> $filterTree
     */
    public function __construct(
        public readonly int $id,
        public readonly int $listId,
        public readonly ?int $userId,
        public readonly string $name,
        public readonly array $filterTree,
        public readonly string $createdAt,
        public readonly string $updatedAt,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(array $row): self
    {
        $treeRaw = $row['filter_tree'] ?? '{}';
        $tree    = is_string($treeRaw) ? json_decode($treeRaw, true) : $treeRaw;

        return new self(
            id:         (int) ($row['id'] ?? 0),
            listId:     (int) ($row['list_id'] ?? 0),
            userId:     isset($row['user_id']) && $row['user_id'] !== null ? (int) $row['user_id'] : null,
            name:       (string) ($row['name'] ?? ''),
            filterTree: is_array($tree) ? $tree : [],
            createdAt:  (string) ($row['created_at'] ?? ''),
            updatedAt:  (string) ($row['updated_at'] ?? ''),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'id'          => $this->id,
            'list_id'     => $this->listId,
            'user_id'     => $this->userId,
            'name'        => $this->name,
            'filter_tree' => $this->filterTree,
            'created_at'  => $this->createdAt,
            'updated_at'  => $this->updatedAt,
        ];
    }
}
