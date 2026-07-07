<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations;

use ImaginaCRM\Lists\ListEntity;

/**
 * Información que el engine pasa al evaluar un trigger y al ejecutar las
 * acciones. Inmutable, serializable a JSON para auditoría.
 *
 * - `event`: nombre del evento que disparó (`record_created`,
 *   `record_updated`, etc.). Útil para que el engine encamine.
 * - `record`: payload del registro. Para record_created es el creado;
 *   para record_updated es el estado nuevo.
 * - `previousRecord`: solo presente en `record_updated`/`field_changed`.
 *   Permite a los triggers comparar diffs.
 * - `extra`: cajón para cosas específicas del trigger
 *   (ej. `due_date_field` en due_date_reached, `cron` en scheduled).
 */
final class TriggerContext
{
    /**
     * @param array<string, mixed>|null $record
     * @param array<string, mixed>|null $previousRecord
     * @param array<string, mixed>      $extra
     */
    public function __construct(
        public readonly string $event,
        public readonly ListEntity $list,
        public readonly ?array $record,
        public readonly ?array $previousRecord = null,
        public readonly array $extra = [],
    ) {
    }

    public function recordId(): ?int
    {
        if ($this->record === null) {
            return null;
        }
        $id = $this->record['id'] ?? null;
        return is_numeric($id) ? (int) $id : null;
    }

    /**
     * Atajo: valor del campo en el registro actual (post-evento).
     * Maneja tanto la forma `{fields: {slug: value}}` (record completo
     * desde `RecordService`) como la forma plana `{slug: value}`.
     */
    public function fieldValue(string $slug): mixed
    {
        if ($this->record === null) {
            return null;
        }
        if (isset($this->record['fields']) && is_array($this->record['fields']) && array_key_exists($slug, $this->record['fields'])) {
            return $this->record['fields'][$slug];
        }
        return $this->record[$slug] ?? null;
    }

    public function previousFieldValue(string $slug): mixed
    {
        if ($this->previousRecord === null) {
            return null;
        }
        if (isset($this->previousRecord['fields']) && is_array($this->previousRecord['fields']) && array_key_exists($slug, $this->previousRecord['fields'])) {
            return $this->previousRecord['fields'][$slug];
        }
        return $this->previousRecord[$slug] ?? null;
    }

    /**
     * Forma serializable para guardar en `automation_runs.trigger_context`.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'event'    => $this->event,
            'list_id'  => $this->list->id,
            'record'   => $this->record,
            'previous' => $this->previousRecord,
            'extra'    => $this->extra,
        ];
    }
}
