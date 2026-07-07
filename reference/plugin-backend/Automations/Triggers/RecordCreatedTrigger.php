<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations\Triggers;

use ImaginaCRM\Automations\TriggerContext;

/**
 * Dispara cuando se crea un registro en la lista configurada.
 *
 * Config soportada:
 * - `field_filters`: `[slug => valor]` — todos deben coincidir en el
 *   registro recién creado para que el trigger dispare.
 *
 * Ejemplo: "cuando se crea un cliente CON status=active, hacer X".
 */
final class RecordCreatedTrigger extends AbstractTrigger
{
    public const SLUG  = 'record_created';
    public const EVENT = 'imagina_crm/record_created';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Cuando se crea un registro', 'imagina-crm');
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
            'field_filters' => [
                'type' => 'object',
                'description' => 'Pares slug → valor; todos deben coincidir.',
                'default' => [],
            ],
        ];
    }
}
