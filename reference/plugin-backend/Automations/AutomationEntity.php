<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations;

/**
 * Snapshot inmutable de una fila de `wp_imcrm_automations`.
 *
 * `actions` es un array ordenado de specs `{type, config}` que el
 * engine ejecuta en serie cuando el trigger dispara.
 */
final class AutomationEntity
{
    /**
     * @param array<string, mixed>                                $triggerConfig
     * @param array<int, array{type: string, config: array<string, mixed>, condition?: array<string, mixed>}> $actions
     */
    public function __construct(
        public readonly int $id,
        public readonly int $listId,
        public readonly string $name,
        public readonly ?string $description,
        public readonly string $triggerType,
        public readonly array $triggerConfig,
        public readonly array $actions,
        public readonly bool $isActive,
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
        $triggerConfigRaw = $row['trigger_config'] ?? '{}';
        $actionsRaw       = $row['actions'] ?? '[]';

        $triggerConfig = is_string($triggerConfigRaw) ? json_decode($triggerConfigRaw, true) : [];
        $actions       = is_string($actionsRaw) ? json_decode($actionsRaw, true) : [];

        return new self(
            id:            (int) ($row['id'] ?? 0),
            listId:        (int) ($row['list_id'] ?? 0),
            name:          (string) ($row['name'] ?? ''),
            description:   isset($row['description']) ? (string) $row['description'] : null,
            triggerType:   (string) ($row['trigger_type'] ?? ''),
            triggerConfig: is_array($triggerConfig) ? $triggerConfig : [],
            actions:       self::normalizeActions($actions),
            isActive:      (bool) ($row['is_active'] ?? true),
            createdBy:     (int) ($row['created_by'] ?? 0),
            createdAt:     (string) ($row['created_at'] ?? ''),
            updatedAt:     (string) ($row['updated_at'] ?? ''),
            deletedAt:     isset($row['deleted_at']) ? (string) $row['deleted_at'] : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'id'             => $this->id,
            'list_id'        => $this->listId,
            'name'           => $this->name,
            'description'    => $this->description,
            'trigger_type'   => $this->triggerType,
            'trigger_config' => $this->triggerConfig,
            'actions'        => $this->actions,
            'is_active'      => $this->isActive,
            'created_by'     => $this->createdBy,
            'created_at'     => $this->createdAt,
            'updated_at'     => $this->updatedAt,
        ];
    }

    /**
     * Normaliza el array de acciones tras decode JSON: cada item debe
     * tener `type` (string) y `config` (array). `condition` es opcional
     * (`{slug: valor}`). Items inválidos se descartan silenciosamente.
     *
     * @param mixed $raw
     * @return array<int, array{type: string, config: array<string, mixed>, condition?: array<string, mixed>}>
     */
    private static function normalizeActions(mixed $raw): array
    {
        if (! is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $item) {
            if (! is_array($item)) {
                continue;
            }
            $type   = isset($item['type']) && is_string($item['type']) ? $item['type'] : '';
            $config = isset($item['config']) && is_array($item['config']) ? $item['config'] : [];
            if ($type === '') {
                continue;
            }
            $entry = ['type' => $type, 'config' => $config];
            if (isset($item['condition']) && is_array($item['condition']) && $item['condition'] !== []) {
                $entry['condition'] = $item['condition'];
            }
            $out[] = $entry;
        }
        return $out;
    }
}
