<?php
declare(strict_types=1);

namespace ImaginaCRM\Recurrences;

/**
 * Recurrencia ClickUp-style sobre un campo `date`/`datetime` de un
 * record. Inmutable.
 *
 * Triggers:
 *   - `status_change`: cuando el campo `triggerStatusFieldId` del
 *     record cambia a `triggerStatusValue`, la fecha avanza.
 *   - `schedule`: el runner cron (Action Scheduler) avanza la fecha
 *     cuando `now >= currentDate`.
 *
 * Acciones al disparar:
 *   - `update`: muta el record actual (avanza la fecha del campo,
 *     opcionalmente reset del estado a `updateStatusValue`).
 *   - `clone`: crea un record nuevo copiando los fields del original
 *     con la fecha rodada. El original queda intacto.
 */
final class RecurrenceEntity
{
    public const FREQ_DAILY   = 'daily';
    public const FREQ_WEEKLY  = 'weekly';
    public const FREQ_MONTHLY = 'monthly';
    public const FREQ_YEARLY  = 'yearly';
    /**
     * "Días tras la finalización": semánticamente la fecha siguiente
     * se mueve a `now() + N días` cuando dispara el trigger — NO a
     * `currentValue + N días`. Tiene sentido solo con `trigger_type =
     * status_change` (la "finalización" es el cambio de estado al
     * valor target). El backend (`RecurrenceService::fire`) reemplaza
     * el seed por `now()` cuando detecta esta frecuencia.
     */
    public const FREQ_DAYS_AFTER = 'days_after';

    /** @var array<int, string> */
    public const FREQUENCIES = [
        self::FREQ_DAILY,
        self::FREQ_WEEKLY,
        self::FREQ_MONTHLY,
        self::FREQ_YEARLY,
        self::FREQ_DAYS_AFTER,
    ];

    public const MONTHLY_SAME_DAY  = 'same_day';   // ej. siempre día 14
    public const MONTHLY_FIRST_DAY = 'first_day';  // siempre día 1
    public const MONTHLY_LAST_DAY  = 'last_day';   // último del mes
    public const MONTHLY_WEEKDAY   = 'weekday';    // ej. 2do jueves

    public const TRIGGER_STATUS_CHANGE = 'status_change';
    public const TRIGGER_SCHEDULE      = 'schedule';

    public const ACTION_UPDATE = 'update';
    public const ACTION_CLONE  = 'clone';

    public function __construct(
        public readonly int $id,
        public readonly int $listId,
        public readonly int $recordId,
        public readonly int $dateFieldId,
        public readonly string $frequency,
        public readonly int $intervalN,
        public readonly ?string $monthlyPattern,
        public readonly string $triggerType,
        public readonly ?int $triggerStatusFieldId,
        public readonly ?string $triggerStatusValue,
        public readonly string $actionType,
        public readonly ?int $updateStatusFieldId,
        public readonly ?string $updateStatusValue,
        public readonly ?string $repeatUntil,
        public readonly ?string $lastFiredAt,
        public readonly string $createdAt,
        public readonly string $updatedAt,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(array $row): self
    {
        return new self(
            id:                    (int) ($row['id'] ?? 0),
            listId:                (int) ($row['list_id'] ?? 0),
            recordId:              (int) ($row['record_id'] ?? 0),
            dateFieldId:           (int) ($row['date_field_id'] ?? 0),
            frequency:             (string) ($row['frequency'] ?? self::FREQ_DAILY),
            intervalN:             max(1, (int) ($row['interval_n'] ?? 1)),
            monthlyPattern:        isset($row['monthly_pattern']) && $row['monthly_pattern'] !== ''
                ? (string) $row['monthly_pattern']
                : null,
            triggerType:           (string) ($row['trigger_type'] ?? self::TRIGGER_SCHEDULE),
            triggerStatusFieldId:  isset($row['trigger_status_field_id']) && $row['trigger_status_field_id'] !== null
                ? (int) $row['trigger_status_field_id']
                : null,
            triggerStatusValue:    isset($row['trigger_status_value']) && $row['trigger_status_value'] !== null
                ? (string) $row['trigger_status_value']
                : null,
            actionType:            (string) ($row['action_type'] ?? self::ACTION_UPDATE),
            updateStatusFieldId:   isset($row['update_status_field_id']) && $row['update_status_field_id'] !== null
                ? (int) $row['update_status_field_id']
                : null,
            updateStatusValue:     isset($row['update_status_value']) && $row['update_status_value'] !== null
                ? (string) $row['update_status_value']
                : null,
            repeatUntil:           isset($row['repeat_until']) && $row['repeat_until'] !== null && $row['repeat_until'] !== ''
                ? (string) $row['repeat_until']
                : null,
            lastFiredAt:           isset($row['last_fired_at']) && $row['last_fired_at'] !== null && $row['last_fired_at'] !== ''
                ? (string) $row['last_fired_at']
                : null,
            createdAt:             (string) ($row['created_at'] ?? ''),
            updatedAt:             (string) ($row['updated_at'] ?? ''),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'id'                       => $this->id,
            'list_id'                  => $this->listId,
            'record_id'                => $this->recordId,
            'date_field_id'            => $this->dateFieldId,
            'frequency'                => $this->frequency,
            'interval_n'               => $this->intervalN,
            'monthly_pattern'          => $this->monthlyPattern,
            'trigger_type'             => $this->triggerType,
            'trigger_status_field_id'  => $this->triggerStatusFieldId,
            'trigger_status_value'     => $this->triggerStatusValue,
            'action_type'              => $this->actionType,
            'update_status_field_id'   => $this->updateStatusFieldId,
            'update_status_value'      => $this->updateStatusValue,
            'repeat_until'             => $this->repeatUntil,
            'last_fired_at'            => $this->lastFiredAt,
            'created_at'               => $this->createdAt,
            'updated_at'               => $this->updatedAt,
        ];
    }
}
