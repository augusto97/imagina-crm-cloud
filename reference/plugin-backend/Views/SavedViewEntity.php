<?php
declare(strict_types=1);

namespace ImaginaCRM\Views;

/**
 * Vista guardada de una lista (CLAUDE.md §6.1, §10.3).
 *
 * `config` contiene referencias internas POR field_id (no por slug), de
 * modo que renombrar un slug no rompe la vista (ADR-008).
 *
 * Shape esperado por el frontend (no enforzado a nivel BD):
 *
 *     {
 *       "visible_fields": [12, 17, 33],
 *       "column_widths": {"12": 200, "17": 150},
 *       "filters": [{"field_id": 17, "op": "contains", "value": "acme"}],
 *       "sort": [{"field_id": 12, "dir": "asc"}],
 *       "search": ""
 *     }
 */
final class SavedViewEntity
{
    /**
     * @param array<string, mixed> $config
     */
    public function __construct(
        public readonly int $id,
        public readonly int $listId,
        public readonly ?int $userId,
        public readonly string $name,
        public readonly string $type,
        public readonly array $config,
        public readonly bool $isDefault,
        public readonly int $position,
        public readonly string $createdAt,
        public readonly string $updatedAt,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(array $row): self
    {
        $configRaw = $row['config'] ?? '{}';
        $config    = is_string($configRaw) ? json_decode($configRaw, true) : [];

        return new self(
            id:        (int) ($row['id'] ?? 0),
            listId:    (int) ($row['list_id'] ?? 0),
            userId:    isset($row['user_id']) && $row['user_id'] !== null ? (int) $row['user_id'] : null,
            name:      (string) ($row['name'] ?? ''),
            type:      (string) ($row['type'] ?? 'table'),
            config:    is_array($config) ? $config : [],
            isDefault: (bool) ($row['is_default'] ?? false),
            position:  (int) ($row['position'] ?? 0),
            createdAt: (string) ($row['created_at'] ?? ''),
            updatedAt: (string) ($row['updated_at'] ?? ''),
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
            'user_id'    => $this->userId,
            'name'       => $this->name,
            'type'       => $this->type,
            'config'     => $this->config,
            'is_default' => $this->isDefault,
            'position'   => $this->position,
            'created_at' => $this->createdAt,
            'updated_at' => $this->updatedAt,
        ];
    }
}
