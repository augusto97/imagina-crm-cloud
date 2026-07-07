<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations\Triggers;

use ImaginaCRM\Automations\TriggerContext;

/**
 * Dispara cuando un registro de la lista se actualiza.
 *
 * Config soportada:
 * - `field_filters`: `[slug => valor]` aplicados al estado NUEVO.
 * - `changed_fields`: `[slug, ...]` — al menos uno de estos debe haber
 *   cambiado entre el estado previo y el nuevo. Si vacío o ausente,
 *   cualquier cambio dispara.
 *
 * Ejemplo: "cuando un cliente cambia status a 'lost', notificar al admin"
 *   → field_filters: {status: 'lost'}, changed_fields: ['status'].
 */
final class RecordUpdatedTrigger extends AbstractTrigger
{
    public const SLUG  = 'record_updated';
    public const EVENT = 'imagina_crm/record_updated';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Cuando se actualiza un registro', 'imagina-crm');
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
        if (! $this->evaluateFilters($context, $config)) {
            return false;
        }

        $changedFields = $config['changed_fields'] ?? null;
        if (! is_array($changedFields) || $changedFields === []) {
            return true;
        }

        // Si el contexto no trae estado previo, no podemos evaluar diff
        // confiablemente — fallamos cerrado para evitar disparos espurios.
        if ($context->previousRecord === null) {
            return false;
        }

        foreach ($changedFields as $slug) {
            if (! is_string($slug)) {
                continue;
            }
            $before = $context->previousFieldValue($slug);
            $after  = $context->fieldValue($slug);
            if (! $this->valuesEqual($before, $after)) {
                return true;
            }
        }
        return false;
    }

    public function getConfigSchema(): array
    {
        return [
            'field_filters'  => ['type' => 'object', 'default' => []],
            'changed_fields' => ['type' => 'array', 'items' => 'string', 'default' => []],
        ];
    }
}
