<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations\Triggers;

use ImaginaCRM\Automations\ConditionEvaluator;
use ImaginaCRM\Automations\TriggerContext;
use ImaginaCRM\Contracts\TriggerInterface;

/**
 * Helpers comunes a todos los triggers.
 *
 * `evaluateFilters()` aplica los filtros del config (`field_filters`)
 * sobre el contexto delegando en `ConditionEvaluator` — misma semántica
 * que las condiciones por-acción del engine.
 */
abstract class AbstractTrigger implements TriggerInterface
{
    public function getConfigSchema(): array
    {
        return [];
    }

    /**
     * Aplica los filtros declarados en `config.field_filters` (`[slug => valor]`).
     * Devuelve `true` si todos pasan, `false` si alguno falla.
     *
     * @param array<string, mixed> $config
     */
    protected function evaluateFilters(TriggerContext $context, array $config): bool
    {
        $filters = $config['field_filters'] ?? null;
        return ConditionEvaluator::matches(
            $context,
            is_array($filters) ? $filters : null,
        );
    }

    /**
     * Comparación laxa reutilizable por triggers concretos (ej.
     * `FieldChangedTrigger` compara before/after). Delega al evaluator
     * compartido para no duplicar la regla de equality.
     */
    protected function valuesEqual(mixed $a, mixed $b): bool
    {
        return ConditionEvaluator::valuesEqual($a, $b);
    }
}
