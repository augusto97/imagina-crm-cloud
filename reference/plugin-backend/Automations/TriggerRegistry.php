<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations;

use ImaginaCRM\Automations\Triggers\DueDateReachedTrigger;
use ImaginaCRM\Automations\Triggers\FieldChangedTrigger;
use ImaginaCRM\Automations\Triggers\RecordCreatedTrigger;
use ImaginaCRM\Automations\Triggers\RecordUpdatedTrigger;
use ImaginaCRM\Automations\Triggers\ScheduledTrigger;
use ImaginaCRM\Contracts\TriggerInterface;

/**
 * Registry de tipos de trigger. En MVP de Fase 2 incluye los dos
 * triggers WP-event: `record_created` y `record_updated`.
 *
 * Triggers programados (`scheduled`, `due_date_reached`) llegan en commit
 * posterior junto con la integración de Action Scheduler.
 *
 * Plugins de terceros pueden registrar más triggers via `register()` desde
 * el hook `imagina_crm/booted`.
 */
final class TriggerRegistry
{
    /** @var array<string, TriggerInterface> */
    private array $triggers = [];

    public function __construct()
    {
        $this->registerDefaults();
    }

    public function register(TriggerInterface $trigger): void
    {
        $this->triggers[$trigger->getSlug()] = $trigger;
    }

    public function has(string $slug): bool
    {
        return isset($this->triggers[$slug]);
    }

    public function get(string $slug): ?TriggerInterface
    {
        return $this->triggers[$slug] ?? null;
    }

    /**
     * @return array<string, TriggerInterface>
     */
    public function all(): array
    {
        return $this->triggers;
    }

    /**
     * Forma serializable usada por la REST API para construir UI.
     *
     * @return array<int, array<string, mixed>>
     */
    public function toArray(): array
    {
        $out = [];
        foreach ($this->triggers as $t) {
            $out[] = [
                'slug'          => $t->getSlug(),
                'label'         => $t->getLabel(),
                'event'         => $t->getEvent(),
                'config_schema' => $t->getConfigSchema(),
            ];
        }
        return $out;
    }

    private function registerDefaults(): void
    {
        $this->register(new RecordCreatedTrigger());
        $this->register(new RecordUpdatedTrigger());
        $this->register(new FieldChangedTrigger());
        $this->register(new ScheduledTrigger());
        $this->register(new DueDateReachedTrigger());
    }
}
