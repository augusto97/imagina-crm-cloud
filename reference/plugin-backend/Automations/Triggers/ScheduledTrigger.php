<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations\Triggers;

use ImaginaCRM\Automations\TriggerContext;

/**
 * Dispara según un cron interno. A diferencia de los triggers que escuchan
 * eventos de WP, este es invocado por una tarea recurrente de Action
 * Scheduler que recorre los registros de la lista (con filtros opcionales)
 * y encola un run por cada uno que matchee.
 *
 * Config:
 * - `frequency`: 'hourly' | 'twicedaily' | 'daily' | 'weekly'. Mapea a
 *   intervalos de Action Scheduler. Default: 'daily'.
 * - `field_filters`: igual que en otros triggers; aplica al snapshot del
 *   registro al momento de la evaluación.
 *
 * El despacho real lo orquesta `ScheduledRunner` (sigue en commit posterior
 * cuando entreguemos el bin). Este trigger sólo declara la intención y
 * filtra registros vía `matches()`.
 *
 * `getEvent()` retorna un evento sintético `imagina_crm/scheduled_tick`
 * que el engine reconoce para no confundirlo con record_*.
 */
final class ScheduledTrigger extends AbstractTrigger
{
    public const SLUG  = 'scheduled';
    public const EVENT = 'imagina_crm/scheduled_tick';

    /** @var array<int, string> */
    public const FREQUENCIES = ['hourly', 'twicedaily', 'daily', 'weekly'];

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('En un horario programado', 'imagina-crm');
    }

    public function getEvent(): string
    {
        return self::EVENT;
    }

    public function matches(TriggerContext $context, array $config): bool
    {
        if ($context->event !== self::EVENT) {
            return false;
        }
        return $this->evaluateFilters($context, $config);
    }

    public function getConfigSchema(): array
    {
        return [
            'frequency'     => ['type' => 'string', 'enum' => self::FREQUENCIES, 'default' => 'daily'],
            'field_filters' => ['type' => 'object', 'default' => []],
        ];
    }

    /**
     * Mapea la frecuencia configurada a segundos. Útil para programar el
     * próximo tick con `as_schedule_recurring_action()`.
     */
    public static function frequencyToSeconds(string $frequency): int
    {
        return match ($frequency) {
            'hourly'     => HOUR_IN_SECONDS,
            'twicedaily' => 12 * HOUR_IN_SECONDS,
            'weekly'     => 7 * DAY_IN_SECONDS,
            default      => DAY_IN_SECONDS, // 'daily' o desconocido.
        };
    }
}
