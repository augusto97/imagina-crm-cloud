<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class FileField extends AbstractFieldType
{
    public const SLUG = 'file';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Archivo', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        unset($config);
        return 'BIGINT UNSIGNED NULL';
    }

    public function validate(mixed $value, array $config): ValidationResult
    {
        if ($required = $this->checkRequired($value, $config)) {
            return $required;
        }
        if ($this->isNullish($value)) {
            return ValidationResult::ok();
        }
        if (! is_numeric($value) || (int) $value < 1) {
            return $this->invalidFailure(__('ID de archivo inválido.', 'imagina-crm'));
        }
        $attachment = get_post((int) $value);
        if ($attachment === null || $attachment->post_type !== 'attachment') {
            return $this->invalidFailure(__('El archivo referenciado no existe.', 'imagina-crm'));
        }
        return ValidationResult::ok();
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($config);
        return $this->isNullish($value) || ! is_numeric($value) ? null : (int) $value;
    }

    public function unserialize(mixed $value, array $config): mixed
    {
        unset($config);
        return $value === null ? null : (int) $value;
    }
}
