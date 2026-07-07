<?php
declare(strict_types=1);

namespace ImaginaCRM\Recurrences;

use ImaginaCRM\Lists\ListEntity;

/**
 * Engancha los dos triggers de recurrencias al runtime:
 *
 *  - Status change: hook `imagina_crm/record_updated` — comparamos
 *    `previousRecord` vs `record` para detectar transiciones a un
 *    valor target en el campo `trigger_status_field_id`.
 *  - Schedule: hook `imagina_crm/scheduled_runner_tick` (el mismo
 *    tick horario de `ScheduledRunner`). Iteramos las recurrencias
 *    `trigger_type = schedule` y disparamos las que ya pasaron.
 */
final class RecurrenceRunner
{
    public function __construct(
        private readonly RecurrenceService $service,
        private readonly RecurrenceRepository $repo,
    ) {
    }

    public function register(): void
    {
        add_action('imagina_crm/record_updated', [$this, 'onRecordUpdated'], 20, 4);
        add_action(\ImaginaCRM\Automations\ScheduledRunner::HOOK_TICK, [$this, 'onTick'], 20);
    }

    /**
     * @param array<string, mixed>      $record
     * @param array<string, mixed>|null $previous
     */
    public function onRecordUpdated(ListEntity $list, int $recordId, array $record, ?array $previous): void
    {
        if ($previous === null) {
            return;
        }
        unset($list);

        $recurrences = $this->repo->listForRecord($recordId);
        if ($recurrences === []) {
            return;
        }

        foreach ($recurrences as $rec) {
            if ($rec->triggerType !== RecurrenceEntity::TRIGGER_STATUS_CHANGE) continue;
            if ($rec->triggerStatusFieldId === null || $rec->triggerStatusValue === null) continue;

            $statusField = $this->statusFieldSlug($rec, $record);
            if ($statusField === null) continue;

            $newVal = $record['fields'][$statusField] ?? null;
            $oldVal = $previous['fields'][$statusField] ?? null;
            if ($newVal === $oldVal) continue;

            // Transición a target: dispara.
            if ((string) $newVal === (string) $rec->triggerStatusValue) {
                $this->service->fire($rec);
            }
        }
    }

    public function onTick(): void
    {
        $this->service->tick();
    }

    /**
     * Resuelve el slug del campo status referenciado por `rec`. Lee el
     * mapa fields-by-id desde el Repository indirectamente (vía el
     * record hidratado).
     *
     * Como atajo: el hidratado del record incluye los fields como
     * `fields[<slug>] => valor`. Para encontrar el slug correcto,
     * usamos field id → slug del primer field cuyo id matchea. La
     * tabla pequeña de fields por record hace esto barato.
     *
     * @param array<string, mixed> $record
     */
    private function statusFieldSlug(RecurrenceEntity $rec, array $record): ?string
    {
        // Necesitamos resolver el slug del trigger_status_field_id —
        // el record hidratado solo trae fields[slug] => value, así
        // que delegamos a FieldRepository (vía service) en una
        // sola query rápida.
        $field = $this->service->resolveField($rec->triggerStatusFieldId ?? 0);
        if ($field === null) return null;
        return $field->slug;
    }
}
