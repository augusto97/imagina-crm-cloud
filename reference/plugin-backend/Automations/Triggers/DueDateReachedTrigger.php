<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations\Triggers;

use ImaginaCRM\Automations\TriggerContext;

/**
 * Dispara cuando un campo de tipo `date` o `datetime` alcanza un offset
 * relativo a "ahora": "1 día antes del vencimiento", "el día mismo",
 * "2 horas después", etc.
 *
 * Como `ScheduledTrigger`, depende de un tick recurrente — se evalúa
 * periódicamente recorriendo registros y comparando su `due_field` contra
 * `now()`. El runner real (próximo commit) hace la query SQL eficiente;
 * `matches()` aquí ejerce la lógica del offset sobre un registro ya
 * cargado para casos reproducibles en tests.
 *
 * Config:
 * - `due_field`: requerido. Slug del campo date/datetime.
 * - `offset_minutes`: requerido. Negativo = "antes", positivo = "después",
 *   0 = "el momento exacto" (con tolerancia de ±tolerancia_minutes).
 * - `tolerance_minutes`: opcional, default 30. Ventana alrededor del
 *   target para no perder ticks por jitter del cron.
 */
final class DueDateReachedTrigger extends AbstractTrigger
{
    public const SLUG  = 'due_date_reached';
    public const EVENT = 'imagina_crm/scheduled_tick';
    public const DEFAULT_TOLERANCE_MINUTES = 30;

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Cuando se alcanza una fecha del registro', 'imagina-crm');
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

        $field = isset($config['due_field']) && is_string($config['due_field']) ? $config['due_field'] : '';
        if ($field === '') {
            return false;
        }

        $offsetMinutes = isset($config['offset_minutes']) ? (int) $config['offset_minutes'] : 0;
        $tolerance     = isset($config['tolerance_minutes']) ? max(1, (int) $config['tolerance_minutes']) : self::DEFAULT_TOLERANCE_MINUTES;

        $value = $context->fieldValue($field);
        if (! is_string($value) || $value === '') {
            return false;
        }
        $dueTimestamp = strtotime($value);
        if ($dueTimestamp === false) {
            return false;
        }

        $targetTimestamp = $dueTimestamp + ($offsetMinutes * 60);
        $now             = $this->now($context);

        return abs($now - $targetTimestamp) <= ($tolerance * 60);
    }

    public function getConfigSchema(): array
    {
        return [
            'due_field'         => ['type' => 'string', 'required' => true],
            'offset_minutes'    => ['type' => 'integer', 'default' => 0, 'description' => 'Negativo = antes; positivo = después.'],
            'tolerance_minutes' => ['type' => 'integer', 'default' => self::DEFAULT_TOLERANCE_MINUTES],
        ];
    }

    /**
     * Permite a los tests inyectar un "ahora" determinístico vía
     * `extra.now` en el contexto. En runtime usa `time()`.
     */
    private function now(TriggerContext $context): int
    {
        $injected = $context->extra['now'] ?? null;
        if (is_int($injected)) {
            return $injected;
        }
        if (is_string($injected) && $injected !== '') {
            $ts = strtotime($injected);
            if ($ts !== false) {
                return $ts;
            }
        }
        return time();
    }
}
