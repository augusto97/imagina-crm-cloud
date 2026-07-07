<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Contracts\FieldTypeInterface;
use ImaginaCRM\Support\ValidationResult;

/**
 * Implementación base con defaults sensatos: la mayoría de tipos sólo
 * sobre-escriben `getSqlDefinition`, `validate` y, opcionalmente,
 * `serialize`/`unserialize`.
 *
 * Helpers protegidos:
 * - `isNullish()` reconoce null, "" y arrays vacíos como ausencia de valor.
 * - `requiredFailure()` y `invalidFailure()` devuelven `ValidationResult`
 *   con códigos consistentes (`required`, `invalid`).
 */
abstract class AbstractFieldType implements FieldTypeInterface
{
    public function supportsUnique(): bool
    {
        return false;
    }

    public function hasColumn(): bool
    {
        return true;
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($config);

        if ($this->isNullish($value)) {
            return null;
        }

        return $value;
    }

    public function unserialize(mixed $value, array $config): mixed
    {
        unset($config);
        return $value;
    }

    public function getConfigSchema(): array
    {
        return [];
    }

    /**
     * Validación común a todos los tipos: si el campo es required y el
     * valor está vacío, falla. El subtipo decide si seguir validando o no.
     *
     * @param array<string, mixed> $config
     */
    protected function checkRequired(mixed $value, array $config): ?ValidationResult
    {
        if (! ($config['required'] ?? false)) {
            return null;
        }

        if ($this->isNullish($value)) {
            return $this->requiredFailure();
        }

        return null;
    }

    protected function isNullish(mixed $value): bool
    {
        if ($value === null) {
            return true;
        }
        if (is_string($value) && trim($value) === '') {
            return true;
        }
        if (is_array($value) && $value === []) {
            return true;
        }
        return false;
    }

    protected function requiredFailure(): ValidationResult
    {
        return ValidationResult::failWith('required', __('Este campo es obligatorio.', 'imagina-crm'));
    }

    protected function invalidFailure(string $message): ValidationResult
    {
        return ValidationResult::failWith('invalid', $message);
    }
}
