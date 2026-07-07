<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations;

use ImaginaCRM\Contracts\ActionInterface;

/**
 * Registry de tipos de acción. A diferencia de los triggers (sin
 * dependencias), las acciones suelen necesitar servicios inyectados
 * (RecordService para `update_field`, etc.), así que el registry no
 * crea instancias por sí mismo: el caller (Plugin.php) las construye y
 * las registra.
 */
final class ActionRegistry
{
    /** @var array<string, ActionInterface> */
    private array $actions = [];

    public function register(ActionInterface $action): void
    {
        $this->actions[$action->getSlug()] = $action;
    }

    public function has(string $slug): bool
    {
        return isset($this->actions[$slug]);
    }

    public function get(string $slug): ?ActionInterface
    {
        return $this->actions[$slug] ?? null;
    }

    /**
     * @return array<string, ActionInterface>
     */
    public function all(): array
    {
        return $this->actions;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function toArray(): array
    {
        $out = [];
        foreach ($this->actions as $a) {
            $out[] = [
                'slug'          => $a->getSlug(),
                'label'         => $a->getLabel(),
                'config_schema' => $a->getConfigSchema(),
            ];
        }
        return $out;
    }
}
