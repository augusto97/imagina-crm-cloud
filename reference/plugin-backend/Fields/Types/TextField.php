<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class TextField extends AbstractFieldType
{
    public const SLUG          = 'text';
    public const DEFAULT_MAX   = 255;
    public const MAX_ALLOWED   = 255;

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Texto', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        $max = (int) ($config['max_length'] ?? self::DEFAULT_MAX);
        if ($max < 1 || $max > self::MAX_ALLOWED) {
            $max = self::DEFAULT_MAX;
        }
        return "VARCHAR({$max}) NULL";
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
        if (! is_scalar($value)) {
            return $this->invalidFailure(__('Se esperaba texto.', 'imagina-crm'));
        }

        $string = (string) $value;
        $max    = (int) ($config['max_length'] ?? self::DEFAULT_MAX);
        if ($max < 1 || $max > self::MAX_ALLOWED) {
            $max = self::DEFAULT_MAX;
        }

        if (mb_strlen($string) > $max) {
            return $this->invalidFailure(
                sprintf(
                    /* translators: %d: max length */
                    __('Excede el máximo de %d caracteres.', 'imagina-crm'),
                    $max
                )
            );
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
            'max_length' => [
                'type'    => 'integer',
                'default' => self::DEFAULT_MAX,
                'min'     => 1,
                'max'     => self::MAX_ALLOWED,
            ],
        ];
    }
}
