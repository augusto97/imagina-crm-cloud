<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class MultiSelectField extends AbstractFieldType
{
    public const SLUG = 'multi_select';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Selección múltiple', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        unset($config);
        return 'JSON NULL';
    }

    public function validate(mixed $value, array $config): ValidationResult
    {
        if ($required = $this->checkRequired($value, $config)) {
            return $required;
        }
        if ($this->isNullish($value)) {
            return ValidationResult::ok();
        }
        if (! is_array($value)) {
            return $this->invalidFailure(__('Se esperaba una lista de opciones.', 'imagina-crm'));
        }

        $allowed = $this->extractOptionValues($config);
        foreach ($value as $item) {
            if (! is_string($item)) {
                return $this->invalidFailure(__('Cada opción debe ser texto.', 'imagina-crm'));
            }
            if ($allowed !== [] && ! in_array($item, $allowed, true)) {
                return $this->invalidFailure(__('Una opción no es válida.', 'imagina-crm'));
            }
        }
        return ValidationResult::ok();
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($config);
        if ($this->isNullish($value)) {
            return null;
        }
        if (! is_array($value)) {
            return null;
        }
        // Eliminamos duplicados para que la persistencia sea idempotente.
        $clean = array_values(array_unique(array_filter(
            $value,
            static fn ($v): bool => is_string($v) && $v !== ''
        )));
        return wp_json_encode($clean);
    }

    public function unserialize(mixed $value, array $config): mixed
    {
        unset($config);
        if ($value === null || $value === '') {
            return [];
        }
        if (is_array($value)) {
            return $value;
        }
        if (! is_string($value)) {
            return [];
        }
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }

    public function getConfigSchema(): array
    {
        return [
            'options' => [
                'type'  => 'array',
                'items' => ['value' => 'string', 'label' => 'string', 'color' => 'string'],
            ],
        ];
    }

    /**
     * @param array<string, mixed> $config
     * @return array<int, string>
     */
    private function extractOptionValues(array $config): array
    {
        $options = $config['options'] ?? [];
        if (! is_array($options)) {
            return [];
        }
        $values = [];
        foreach ($options as $opt) {
            if (is_array($opt) && isset($opt['value']) && is_string($opt['value'])) {
                $values[] = $opt['value'];
            }
            if (is_string($opt)) {
                $values[] = $opt;
            }
        }
        return $values;
    }
}
