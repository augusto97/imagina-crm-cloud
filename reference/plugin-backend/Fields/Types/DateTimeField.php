<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class DateTimeField extends AbstractFieldType
{
    public const SLUG       = 'datetime';
    public const SQL_FORMAT = 'Y-m-d H:i:s';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Fecha y hora', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        unset($config);
        return 'DATETIME NULL';
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
            return $this->invalidFailure(__('Fecha y hora inválidas. Usa ISO 8601.', 'imagina-crm'));
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
        // Persistimos siempre en UTC (CLAUDE.md §8 - "datetime: siempre en UTC").
        return $parsed?->setTimezone(new \DateTimeZone('UTC'))->format(self::SQL_FORMAT);
    }

    public function unserialize(mixed $value, array $config): mixed
    {
        unset($config);
        if ($value === null || $value === '') {
            return null;
        }
        // Devolvemos el string SQL tal cual; el frontend lo interpreta como UTC.
        return (string) $value;
    }

    private function parse(string $value): ?\DateTimeImmutable
    {
        try {
            return new \DateTimeImmutable($value);
        } catch (\Exception) {
            return null;
        }
    }
}
