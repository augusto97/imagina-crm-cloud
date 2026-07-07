<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class NumberField extends AbstractFieldType
{
    public const SLUG = 'number';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Número', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        $precision = (int) ($config['precision'] ?? 4);

        if ($precision <= 0) {
            return 'BIGINT NULL';
        }

        $precision = min($precision, 8);
        return "DECIMAL(18,{$precision}) NULL";
    }

    public function validate(mixed $value, array $config): ValidationResult
    {
        if ($required = $this->checkRequired($value, $config)) {
            return $required;
        }
        if ($this->isNullish($value)) {
            return ValidationResult::ok();
        }
        if (! is_numeric($value)) {
            return $this->invalidFailure(__('Se esperaba un número.', 'imagina-crm'));
        }

        $num = (float) $value;
        if (isset($config['min']) && is_numeric($config['min']) && $num < (float) $config['min']) {
            return $this->invalidFailure(
                sprintf(
                    /* translators: %s: minimum value */
                    __('El valor mínimo permitido es %s.', 'imagina-crm'),
                    (string) $config['min']
                )
            );
        }
        if (isset($config['max']) && is_numeric($config['max']) && $num > (float) $config['max']) {
            return $this->invalidFailure(
                sprintf(
                    /* translators: %s: maximum value */
                    __('El valor máximo permitido es %s.', 'imagina-crm'),
                    (string) $config['max']
                )
            );
        }
        return ValidationResult::ok();
    }

    public function serialize(mixed $value, array $config): mixed
    {
        if ($this->isNullish($value)) {
            return null;
        }
        if (! is_numeric($value)) {
            return null;
        }
        $precision = (int) ($config['precision'] ?? 4);
        return $precision <= 0 ? (int) $value : (float) $value;
    }

    public function unserialize(mixed $value, array $config): mixed
    {
        if ($value === null) {
            return null;
        }
        $precision = (int) ($config['precision'] ?? 4);
        return $precision <= 0 ? (int) $value : (float) $value;
    }

    public function getConfigSchema(): array
    {
        return [
            'precision' => ['type' => 'integer', 'default' => 4, 'min' => 0, 'max' => 8],
            'min'       => ['type' => 'number'],
            'max'       => ['type' => 'number'],
        ];
    }
}
