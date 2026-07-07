<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class UrlField extends AbstractFieldType
{
    public const SLUG    = 'url';
    public const SQL_LEN = 2048;

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('URL', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        unset($config);
        return 'VARCHAR(' . self::SQL_LEN . ') NULL';
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
            return $this->invalidFailure(__('Se esperaba una URL.', 'imagina-crm'));
        }
        if (mb_strlen($value) > self::SQL_LEN) {
            return $this->invalidFailure(__('La URL es demasiado larga.', 'imagina-crm'));
        }
        if (filter_var($value, FILTER_VALIDATE_URL) === false) {
            return $this->invalidFailure(__('URL inválida.', 'imagina-crm'));
        }
        return ValidationResult::ok();
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($config);
        return $this->isNullish($value) ? null : esc_url_raw((string) $value);
    }
}
