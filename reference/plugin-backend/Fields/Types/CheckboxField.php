<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class CheckboxField extends AbstractFieldType
{
    public const SLUG = 'checkbox';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Casilla', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        unset($config);
        return 'TINYINT(1) NOT NULL DEFAULT 0';
    }

    public function validate(mixed $value, array $config): ValidationResult
    {
        unset($config);
        // Cualquier valor booleano-coercible es aceptable. NUNCA falla por
        // required: ausencia de valor se interpreta como `false`.
        if ($value === null || is_bool($value) || is_int($value)) {
            return ValidationResult::ok();
        }
        if (is_string($value) && in_array(strtolower($value), ['1', '0', 'true', 'false', 'yes', 'no', ''], true)) {
            return ValidationResult::ok();
        }
        return $this->invalidFailure(__('Se esperaba un valor booleano.', 'imagina-crm'));
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($config);
        return $this->coerce($value) ? 1 : 0;
    }

    public function unserialize(mixed $value, array $config): mixed
    {
        unset($config);
        return (bool) $value;
    }

    private function coerce(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return $value === 1;
        }
        if (is_string($value)) {
            return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
        }
        return false;
    }
}
