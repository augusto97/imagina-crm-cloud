<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

final class UserField extends AbstractFieldType
{
    public const SLUG = 'user';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Usuario', 'imagina-crm');
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
            return $this->invalidFailure(__('ID de usuario inválido.', 'imagina-crm'));
        }
        // Verificación opcional: si se pide enforce, comprobamos que el
        // usuario exista realmente en wp_users.
        if (($config['must_exist'] ?? true) && ! get_userdata((int) $value)) {
            return $this->invalidFailure(__('El usuario no existe.', 'imagina-crm'));
        }
        return ValidationResult::ok();
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($config);
        if ($this->isNullish($value)) {
            return null;
        }
        return is_numeric($value) ? (int) $value : null;
    }

    public function unserialize(mixed $value, array $config): mixed
    {
        unset($config);
        return $value === null ? null : (int) $value;
    }

    public function getConfigSchema(): array
    {
        return [
            'must_exist' => ['type' => 'boolean', 'default' => true],
        ];
    }
}
