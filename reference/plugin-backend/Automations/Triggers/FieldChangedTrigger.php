<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations\Triggers;

use ImaginaCRM\Automations\TriggerContext;

/**
 * Dispara cuando un campo específico cambia, opcionalmente con
 * condiciones sobre el valor previo o nuevo.
 *
 * A diferencia de `record_updated.changed_fields`, este trigger:
 * - Es discoverable por su propio slug en el catálogo `/triggers`.
 * - Soporta condiciones más expresivas (`from_value`, `to_value`).
 *
 * Config:
 * - `field`: requerido. Slug del campo a observar.
 * - `from_value`: opcional. Si está, sólo dispara cuando el valor previo
 *   coincide.
 * - `to_value`: opcional. Si está, sólo dispara cuando el valor nuevo
 *   coincide. Útil para "cuando status pasa de 'lead' a 'won'".
 *
 * Ambos valores aceptan literal o array. Comparación laxa.
 *
 * Comparte el evento `imagina_crm/record_updated` con `RecordUpdatedTrigger`
 * — el engine los evalúa a ambos en cada update; el operador elige cuál
 * configurar según el caso de uso.
 */
final class FieldChangedTrigger extends AbstractTrigger
{
    public const SLUG  = 'field_changed';
    public const EVENT = 'imagina_crm/record_updated';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Cuando un campo específico cambia', 'imagina-crm');
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

        $field = isset($config['field']) && is_string($config['field']) ? $config['field'] : '';
        if ($field === '') {
            return false;
        }

        // Sin snapshot previo no podemos verificar que cambió de algo a
        // algo — fallamos cerrado.
        if ($context->previousRecord === null) {
            return false;
        }

        $before = $context->previousFieldValue($field);
        $after  = $context->fieldValue($field);
        if ($this->valuesEqual($before, $after)) {
            return false;
        }

        if (array_key_exists('from_value', $config) && $config['from_value'] !== null) {
            if (! $this->valuesEqual($before, $config['from_value'])) {
                return false;
            }
        }

        if (array_key_exists('to_value', $config) && $config['to_value'] !== null) {
            if (! $this->valuesEqual($after, $config['to_value'])) {
                return false;
            }
        }

        return true;
    }

    public function getConfigSchema(): array
    {
        return [
            'field'      => ['type' => 'string', 'required' => true, 'description' => 'Slug del campo.'],
            'from_value' => ['type' => 'mixed', 'description' => 'Si está, exige que el valor previo coincida.'],
            'to_value'   => ['type' => 'mixed', 'description' => 'Si está, exige que el valor nuevo coincida.'],
        ];
    }
}
