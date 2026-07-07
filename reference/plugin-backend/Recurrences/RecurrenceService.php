<?php
declare(strict_types=1);

namespace ImaginaCRM\Recurrences;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Records\RecordService;
use ImaginaCRM\Support\ValidationResult;

/**
 * Casos de uso de recurrencias: validar input, persistir, y disparar
 * la rotación cuando trigger condiciones matchean.
 *
 * "Disparar" es: avanzar la fecha del campo (vía DateRoller) y, según
 * `action_type`, actualizar el record actual o clonarlo. Update está
 * listo en v1; clone también (vía RecordService::create con los fields
 * del original).
 */
final class RecurrenceService
{
    public function __construct(
        private readonly RecurrenceRepository $repo,
        private readonly ListRepository $lists,
        private readonly FieldRepository $fields,
        private readonly RecordService $records,
    ) {
    }

    /**
     * @param array<string, mixed> $input
     */
    public function upsert(int $listId, int $recordId, array $input): RecurrenceEntity|ValidationResult
    {
        $dateFieldId = isset($input['date_field_id']) ? (int) $input['date_field_id'] : 0;
        $dateField   = $this->fields->find($dateFieldId);
        if ($dateField === null
            || $dateField->listId !== $listId
            || ! in_array($dateField->type, ['date', 'datetime'], true)
        ) {
            return ValidationResult::failWith('date_field_id', __('Campo de fecha inválido.', 'imagina-crm'));
        }

        $frequency = isset($input['frequency']) ? (string) $input['frequency'] : '';
        if (! in_array($frequency, RecurrenceEntity::FREQUENCIES, true)) {
            return ValidationResult::failWith('frequency', __('Frecuencia inválida.', 'imagina-crm'));
        }

        $interval = max(1, (int) ($input['interval_n'] ?? 1));
        $monthlyPattern = $frequency === RecurrenceEntity::FREQ_MONTHLY
            ? (string) ($input['monthly_pattern'] ?? RecurrenceEntity::MONTHLY_SAME_DAY)
            : null;

        $triggerType = (string) ($input['trigger_type'] ?? RecurrenceEntity::TRIGGER_SCHEDULE);
        if (! in_array($triggerType, [RecurrenceEntity::TRIGGER_STATUS_CHANGE, RecurrenceEntity::TRIGGER_SCHEDULE], true)) {
            return ValidationResult::failWith('trigger_type', __('Trigger inválido.', 'imagina-crm'));
        }

        $triggerStatusFieldId = null;
        $triggerStatusValue   = null;
        if ($triggerType === RecurrenceEntity::TRIGGER_STATUS_CHANGE) {
            $sfId = isset($input['trigger_status_field_id']) ? (int) $input['trigger_status_field_id'] : 0;
            $sf   = $this->fields->find($sfId);
            if ($sf === null || $sf->listId !== $listId
                || ! in_array($sf->type, ['select', 'checkbox'], true)
            ) {
                return ValidationResult::failWith('trigger_status_field_id', __('Campo de estado inválido para el trigger.', 'imagina-crm'));
            }
            $triggerStatusFieldId = $sfId;
            $triggerStatusValue   = isset($input['trigger_status_value']) ? (string) $input['trigger_status_value'] : '';
        }

        $actionType = (string) ($input['action_type'] ?? RecurrenceEntity::ACTION_UPDATE);
        if (! in_array($actionType, [RecurrenceEntity::ACTION_UPDATE, RecurrenceEntity::ACTION_CLONE], true)) {
            return ValidationResult::failWith('action_type', __('Acción inválida.', 'imagina-crm'));
        }

        $updateStatusFieldId = null;
        $updateStatusValue   = null;
        if (isset($input['update_status_field_id']) && (int) $input['update_status_field_id'] > 0) {
            $usId = (int) $input['update_status_field_id'];
            $us   = $this->fields->find($usId);
            if ($us !== null && $us->listId === $listId
                && in_array($us->type, ['select', 'checkbox'], true)
            ) {
                $updateStatusFieldId = $usId;
                $updateStatusValue   = isset($input['update_status_value']) ? (string) $input['update_status_value'] : '';
            }
        }

        $repeatUntil = isset($input['repeat_until']) && $input['repeat_until'] !== ''
            ? (string) $input['repeat_until']
            : null;

        $payload = [
            'list_id'                  => $listId,
            'record_id'                => $recordId,
            'date_field_id'            => $dateFieldId,
            'frequency'                => $frequency,
            'interval_n'               => $interval,
            'monthly_pattern'          => $monthlyPattern,
            'trigger_type'             => $triggerType,
            'trigger_status_field_id'  => $triggerStatusFieldId,
            'trigger_status_value'     => $triggerStatusValue,
            'action_type'              => $actionType,
            'update_status_field_id'   => $updateStatusFieldId,
            'update_status_value'      => $updateStatusValue,
            'repeat_until'             => $repeatUntil,
        ];

        $existing = $this->repo->findByRecordField($recordId, $dateFieldId);
        if ($existing !== null) {
            $this->repo->update($existing->id, $payload);
            $updated = $this->repo->find($existing->id);
            return $updated ?? ValidationResult::failWith('database', __('Error al actualizar.', 'imagina-crm'));
        }

        $id = $this->repo->insert($payload);
        if ($id <= 0) {
            return ValidationResult::failWith('database', __('No se pudo guardar la recurrencia.', 'imagina-crm'));
        }
        $created = $this->repo->find($id);
        return $created ?? ValidationResult::failWith('database', __('Error al releer.', 'imagina-crm'));
    }

    public function delete(int $id): ValidationResult
    {
        $this->repo->delete($id);
        return ValidationResult::ok();
    }

    /**
     * Atajo para que el runner resuelva el slug de un field referenciado
     * por id (el record hidratado solo trae `fields[slug] => valor`).
     */
    public function resolveField(int $fieldId): ?FieldEntity
    {
        if ($fieldId <= 0) return null;
        return $this->fields->find($fieldId);
    }

    /**
     * Llamado desde el hook `imagina_crm/record_updated` cuando se
     * detecta que el campo de status_change cambió a su valor target.
     * Avanza la fecha y dispara la acción.
     *
     * No-op si la recurrencia ya fue disparada con la fecha actual o
     * si pasó `repeat_until`.
     */
    public function fire(RecurrenceEntity $rec): void
    {
        $list = $this->lists->find($rec->listId);
        if ($list === null) return;

        $record = $this->records->find($list, $rec->recordId);
        if ($record === null) return;

        $dateField = $this->fields->find($rec->dateFieldId);
        if ($dateField === null) return;

        $currentValue = $record['fields'][$dateField->slug] ?? null;
        if (! is_string($currentValue) || $currentValue === '') return;

        // Idempotencia: si la fecha ya está rodada respecto al
        // last_fired_at, no la rodes de nuevo.
        if ($rec->lastFiredAt !== null && $rec->lastFiredAt > $currentValue) {
            return;
        }

        // Para `days_after` ("N días tras la finalización") el seed es
        // el momento del trigger (now), no la fecha actual del campo.
        // Para datetime preservamos la hora real; para date solo el
        // YYYY-MM-DD. Las demás frecuencias usan `currentValue` como
        // siempre.
        $seed = $currentValue;
        if ($rec->frequency === RecurrenceEntity::FREQ_DAYS_AFTER) {
            $now    = current_time('mysql', true);
            $hasTime = str_contains($currentValue, ' ') || str_contains($currentValue, 'T');
            $seed   = $hasTime ? $now : substr($now, 0, 10);
        }

        $nextDate = DateRoller::nextOccurrence($seed, $rec);

        // Si pasó repeat_until, no disparar más.
        if ($rec->repeatUntil !== null && $nextDate > $rec->repeatUntil) {
            return;
        }

        if ($rec->actionType === RecurrenceEntity::ACTION_CLONE) {
            $this->cloneAction($list, $record, $dateField, $nextDate, $rec);
        } else {
            $this->updateAction($list, $rec->recordId, $dateField, $nextDate, $rec);
        }

        $this->repo->markFired($rec->id);
    }

    /**
     * @param array<int, RecurrenceEntity> $recurrences
     */
    public function fireAll(array $recurrences): void
    {
        foreach ($recurrences as $rec) {
            $this->fire($rec);
        }
    }

    /**
     * Ejecuta el barrido cron: para cada recurrencia con trigger=schedule,
     * comprueba si su fecha del campo ya pasó (now >= currentDate). Si sí,
     * dispara. Llamado desde Action Scheduler (mismo tick que `ScheduledRunner`).
     */
    public function tick(): void
    {
        $recs = $this->repo->listScheduleType();
        $now  = current_time('mysql', true);

        foreach ($recs as $rec) {
            $list = $this->lists->find($rec->listId);
            if ($list === null) continue;
            $record = $this->records->find($list, $rec->recordId);
            if ($record === null) continue;
            $dateField = $this->fields->find($rec->dateFieldId);
            if ($dateField === null) continue;

            $currentValue = $record['fields'][$dateField->slug] ?? null;
            if (! is_string($currentValue) || $currentValue === '') continue;

            // Si la fecha ya pasó y aún no la rodamos para este pase.
            if ($currentValue <= $now) {
                $this->fire($rec);
            }
        }
    }

    private function updateAction(
        ListEntity $list,
        int $recordId,
        FieldEntity $dateField,
        string $nextDate,
        RecurrenceEntity $rec,
    ): void {
        $patch = [$dateField->slug => $nextDate];

        if ($rec->updateStatusFieldId !== null && $rec->updateStatusValue !== null) {
            $statusField = $this->fields->find($rec->updateStatusFieldId);
            if ($statusField !== null && $statusField->listId === $list->id) {
                $patch[$statusField->slug] = $rec->updateStatusValue;
            }
        }

        $this->records->update($list, $recordId, $patch);
    }

    /**
     * @param array<string, mixed> $record  Hidratado: `{id, fields, ...}`
     */
    private function cloneAction(
        ListEntity $list,
        array $record,
        FieldEntity $dateField,
        string $nextDate,
        RecurrenceEntity $rec,
    ): void {
        $values = is_array($record['fields'] ?? null) ? $record['fields'] : [];
        $values[$dateField->slug] = $nextDate;

        if ($rec->updateStatusFieldId !== null && $rec->updateStatusValue !== null) {
            $statusField = $this->fields->find($rec->updateStatusFieldId);
            if ($statusField !== null && $statusField->listId === $list->id) {
                $values[$statusField->slug] = $rec->updateStatusValue;
            }
        }

        $this->records->create($list, $values);
    }
}
