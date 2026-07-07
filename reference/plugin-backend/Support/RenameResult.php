<?php
declare(strict_types=1);

namespace ImaginaCRM\Support;

/**
 * Resultado de un rename de slug. Contiene viejo/nuevo y el ValidationResult
 * crudo cuando el rename falla, para que el controller pueda devolver errores
 * 422 directamente sin re-validar.
 */
final class RenameResult
{
    private function __construct(
        public readonly bool $success,
        public readonly ?string $oldSlug,
        public readonly ?string $newSlug,
        public readonly ValidationResult $validation,
    ) {
    }

    public static function ok(string $oldSlug, string $newSlug): self
    {
        return new self(true, $oldSlug, $newSlug, ValidationResult::ok());
    }

    public static function fail(ValidationResult $validation): self
    {
        return new self(false, null, null, $validation);
    }

    public static function unchanged(string $slug): self
    {
        return new self(true, $slug, $slug, ValidationResult::ok());
    }
}
