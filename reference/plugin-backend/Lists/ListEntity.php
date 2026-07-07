<?php
declare(strict_types=1);

namespace ImaginaCRM\Lists;

/**
 * Snapshot inmutable de una fila de `wp_imcrm_lists`.
 *
 * Se construye desde el repository y se devuelve hacia services y
 * controllers. El ID es la verdad: nunca confundirlo con el slug
 * (CLAUDE.md §7.9).
 */
final class ListEntity
{
    /**
     * @param array<string, mixed> $settings
     */
    public function __construct(
        public readonly int $id,
        public readonly string $slug,
        public readonly string $tableSuffix,
        public readonly string $name,
        public readonly ?string $description,
        public readonly ?string $icon,
        public readonly ?string $color,
        public readonly array $settings,
        public readonly int $position,
        public readonly int $createdBy,
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
        $settingsRaw = $row['settings'] ?? '{}';
        $settings    = is_string($settingsRaw) ? json_decode($settingsRaw, true) : [];

        return new self(
            id:          (int) ($row['id'] ?? 0),
            slug:        (string) ($row['slug'] ?? ''),
            tableSuffix: (string) ($row['table_suffix'] ?? ''),
            name:        (string) ($row['name'] ?? ''),
            description: isset($row['description']) ? (string) $row['description'] : null,
            icon:        isset($row['icon']) ? (string) $row['icon'] : null,
            color:       isset($row['color']) ? (string) $row['color'] : null,
            settings:    is_array($settings) ? $settings : [],
            position:    (int) ($row['position'] ?? 0),
            createdBy:   (int) ($row['created_by'] ?? 0),
            createdAt:   (string) ($row['created_at'] ?? ''),
            updatedAt:   (string) ($row['updated_at'] ?? ''),
            deletedAt:   isset($row['deleted_at']) ? (string) $row['deleted_at'] : null,
        );
    }

    /**
     * Forma serializable usada por la REST API.
     *
     * Nota: NO exponemos `table_suffix` por defecto en este shape (usuarios
     * técnicos lo verán en la sección "Configuración avanzada", §7.4).
     *
     * @return array<string, mixed>
     */
    public function toArray(bool $includePhysical = false): array
    {
        $out = [
            'id'          => $this->id,
            'slug'        => $this->slug,
            'name'        => $this->name,
            'description' => $this->description,
            'icon'        => $this->icon,
            'color'       => $this->color,
            'settings'    => $this->settings,
            'position'    => $this->position,
            'created_by'  => $this->createdBy,
            'created_at'  => $this->createdAt,
            'updated_at'  => $this->updatedAt,
        ];

        if ($includePhysical) {
            $out['table_suffix'] = $this->tableSuffix;
        }

        return $out;
    }
}
