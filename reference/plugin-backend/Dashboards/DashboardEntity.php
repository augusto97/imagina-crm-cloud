<?php
declare(strict_types=1);

namespace ImaginaCRM\Dashboards;

/**
 * Snapshot inmutable de un dashboard.
 *
 * Cada widget es una spec serializable con `id`, `type` (`kpi`,
 * `chart_bar`, `chart_line`), `list_id`, `config` específico del tipo,
 * `title` y `layout` de grid. La evaluación (qué números mostrar) la
 * hace `WidgetEvaluator` en otra fase — aquí sólo persistimos.
 */
final class DashboardEntity
{
    /**
     * @param array<int, array<string, mixed>> $widgets
     */
    public function __construct(
        public readonly int $id,
        public readonly ?int $userId,
        public readonly string $name,
        public readonly ?string $description,
        public readonly array $widgets,
        public readonly bool $isDefault,
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
        $raw = $row['widgets'] ?? '[]';
        $widgets = is_string($raw) ? json_decode($raw, true) : null;

        return new self(
            id:          (int) ($row['id'] ?? 0),
            userId:      isset($row['user_id']) && $row['user_id'] !== null ? (int) $row['user_id'] : null,
            name:        (string) ($row['name'] ?? ''),
            description: isset($row['description']) ? (string) $row['description'] : null,
            widgets:     self::normalizeWidgets($widgets),
            isDefault:   ! empty($row['is_default']),
            position:    (int) ($row['position'] ?? 0),
            createdBy:   (int) ($row['created_by'] ?? 0),
            createdAt:   (string) ($row['created_at'] ?? ''),
            updatedAt:   (string) ($row['updated_at'] ?? ''),
            deletedAt:   isset($row['deleted_at']) ? (string) $row['deleted_at'] : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'id'          => $this->id,
            'user_id'     => $this->userId,
            'name'        => $this->name,
            'description' => $this->description,
            'widgets'     => $this->widgets,
            'is_default'  => $this->isDefault,
            'position'    => $this->position,
            'created_by'  => $this->createdBy,
            'created_at'  => $this->createdAt,
            'updated_at'  => $this->updatedAt,
        ];
    }

    /**
     * Normaliza el array de widgets tras decode JSON: descarta items
     * que no son objetos o sin tipo. El validador real (que verifica
     * list_id, fields, etc.) vive en `DashboardService`.
     *
     * @param mixed $raw
     * @return array<int, array<string, mixed>>
     */
    private static function normalizeWidgets(mixed $raw): array
    {
        if (! is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $item) {
            if (! is_array($item)) {
                continue;
            }
            if (! isset($item['type']) || ! is_string($item['type']) || $item['type'] === '') {
                continue;
            }
            $out[] = $item;
        }
        return $out;
    }
}
