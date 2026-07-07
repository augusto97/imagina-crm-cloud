<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class SelectField extends AbstractFieldType
{
    public const SLUG = 'select';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Selección única', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        unset($config);
        return 'VARCHAR(64) NULL';
    }

    public function validate(mixed $value, array $config): ValidationResult
    {
        if ($required = $this->checkRequired($value, $config)) {
            return $required;
        }
        if ($this->isNullish($value)) {
            return ValidationResult::ok();
        }
        if (! is_string($value)) {
            return $this->invalidFailure(__('Se esperaba una opción.', 'imagina-crm'));
        }

        $allowed = $this->extractOptionValues($config);
        if ($allowed !== [] && ! in_array($value, $allowed, true)) {
            return $this->invalidFailure(__('Opción no válida para este campo.', 'imagina-crm'));
        }
        return ValidationResult::ok();
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($config);
        return $this->isNullish($value) ? null : (string) $value;
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
