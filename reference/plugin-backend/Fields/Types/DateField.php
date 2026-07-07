<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class DateField extends AbstractFieldType
{
    public const SLUG   = 'date';
    public const FORMAT = 'Y-m-d';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Fecha', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        unset($config);
        return 'DATE NULL';
    }

    public function validate(mixed $value, array $config): ValidationResult
    {
        if ($required = $this->checkRequired($value, $config)) {
            return $required;
        }
        if ($this->isNullish($value)) {
            return ValidationResult::ok();
        }
        if (! is_string($value) || $this->parse($value) === null) {
            return $this->invalidFailure(__('Fecha inválida. Usa formato YYYY-MM-DD.', 'imagina-crm'));
        }
        return ValidationResult::ok();
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($config);
        if ($this->isNullish($value) || ! is_string($value)) {
            return null;
        }
        $parsed = $this->parse($value);
        return $parsed?->format(self::FORMAT);
    }

    public function unserialize(mixed $value, array $config): mixed
    {
        unset($config);
        return $value === null || $value === '' ? null : (string) $value;
    }

    private function parse(string $value): ?\DateTimeImmutable
    {
        $dt = \DateTimeImmutable::createFromFormat('!' . self::FORMAT, $value);
        if ($dt === false) {
            return null;
        }
        // Verificación de errores estrictos.
        $errors = \DateTimeImmutable::getLastErrors();
        if (is_array($errors) && (($errors['error_count'] ?? 0) > 0 || ($errors['warning_count'] ?? 0) > 0)) {
            return null;
        }
        return $dt;
    }
}
