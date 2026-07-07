<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class CurrencyField extends AbstractFieldType
{
    public const SLUG = 'currency';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Moneda', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        unset($config);
        return 'DECIMAL(18,4) NULL';
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
            return $this->invalidFailure(__('Se esperaba un valor monetario.', 'imagina-crm'));
        }
        return ValidationResult::ok();
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($config);
        return $this->isNullish($value) || ! is_numeric($value) ? null : (float) $value;
    }

    public function unserialize(mixed $value, array $config): mixed
    {
        unset($config);
        return $value === null ? null : (float) $value;
    }

    public function getConfigSchema(): array
    {
        return [
            // Moneda ISO-4217 a nivel campo, no por fila (CLAUDE.md §8).
            'currency' => ['type' => 'string', 'default' => 'COP', 'pattern' => '^[A-Z]{3}$'],
        ];
    }
}
