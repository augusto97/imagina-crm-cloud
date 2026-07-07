<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields;

/**
 * Snapshot inmutable de una fila de `wp_imcrm_fields`.
 *
 * `slug` es editable; `columnName` se decide al crear y nunca cambia
 * (CLAUDE.md §7).
 */
final class FieldEntity
{
    /**
     * @param array<string, mixed> $config
     */
    public function __construct(
        public readonly int $id,
        public readonly int $listId,
        public readonly string $slug,
        public readonly string $columnName,
        public readonly string $label,
        public readonly string $type,
        public readonly array $config,
        public readonly bool $isRequired,
        public readonly bool $isUnique,
        public readonly bool $isPrimary,
        public readonly int $position,
        public readonly string $createdAt,
        public readonly string $updatedAt,
        public readonly ?string $deletedAt,
        /**
         * `is_indexed` (0.28.0): toggle opt-in para que el plugin
         * cree un índice MySQL no-unique sobre la columna del field
         * — acelera filtros y sort de table scan a index seek.
         * Tradeoff: cada índice cuesta ~10% de storage de la tabla
         * y lentifica writes ~5%. Por eso es opt-in.
         */
        public readonly bool $isIndexed = false,
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
            id:          (int) ($row['id'] ?? 0),
            listId:      (int) ($row['list_id'] ?? 0),
            slug:        (string) ($row['slug'] ?? ''),
            columnName:  (string) ($row['column_name'] ?? ''),
            label:       (string) ($row['label'] ?? ''),
            type:        (string) ($row['type'] ?? ''),
            config:      is_array($config) ? $config : [],
            isRequired:  (bool) ($row['is_required'] ?? false),
            isUnique:    (bool) ($row['is_unique'] ?? false),
            isPrimary:   (bool) ($row['is_primary'] ?? false),
            position:    (int) ($row['position'] ?? 0),
            createdAt:   (string) ($row['created_at'] ?? ''),
            updatedAt:   (string) ($row['updated_at'] ?? ''),
            deletedAt:   isset($row['deleted_at']) ? (string) $row['deleted_at'] : null,
            isIndexed:   (bool) ($row['is_indexed'] ?? false),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(bool $includePhysical = false): array
    {
        $out = [
            'id'          => $this->id,
            'list_id'     => $this->listId,
            'slug'        => $this->slug,
            'label'       => $this->label,
            'type'        => $this->type,
            'config'      => $this->config,
            'is_required' => $this->isRequired,
            'is_unique'   => $this->isUnique,
            'is_primary'  => $this->isPrimary,
            'is_indexed'  => $this->isIndexed,
            'position'    => $this->position,
            'created_at'  => $this->createdAt,
            'updated_at'  => $this->updatedAt,
        ];

        if ($includePhysical) {
            $out['column_name'] = $this->columnName;
        }

        return $out;
    }
}
