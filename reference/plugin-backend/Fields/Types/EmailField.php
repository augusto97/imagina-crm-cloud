<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class EmailField extends AbstractFieldType
{
    public const SLUG    = 'email';
    public const SQL_LEN = 191;

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Email', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        unset($config);
        return 'VARCHAR(' . self::SQL_LEN . ') NULL';
    }

    public function supportsUnique(): bool
    {
        return true;
    }

    public function validate(mixed $value, array $config): ValidationResult
    {
        if ($required = $this->checkRequired($value, $config)) {
            return $required;
        }
        if ($this->isNullish($value)) {
            return ValidationResult::ok();
        }
        if (! is_string($value) || ! is_email($value)) {
            return $this->invalidFailure(__('Email inválido.', 'imagina-crm'));
        }
        if (mb_strlen($value) > self::SQL_LEN) {
            return $this->invalidFailure(__('El email es demasiado largo.', 'imagina-crm'));
        }
        return ValidationResult::ok();
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($config);
        return $this->isNullish($value) ? null : sanitize_email((string) $value);
    }
}
