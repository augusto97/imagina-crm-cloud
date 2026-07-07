<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class LongTextField extends AbstractFieldType
{
    public const SLUG = 'long_text';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Texto largo', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        unset($config);
        return 'TEXT NULL';
    }

    public function validate(mixed $value, array $config): ValidationResult
    {
        if ($required = $this->checkRequired($value, $config)) {
            return $required;
        }
        if ($this->isNullish($value)) {
            return ValidationResult::ok();
        }
        if (! is_scalar($value)) {
            return $this->invalidFailure(__('Se esperaba texto.', 'imagina-crm'));
        }
        return ValidationResult::ok();
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($config);
        return $this->isNullish($value) ? null : (string) $value;
    }
}
