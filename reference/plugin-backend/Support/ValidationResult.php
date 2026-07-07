<?php
declare(strict_types=1);

namespace ImaginaCRM\Support;

/**
 * Resultado de una validación.
 *
 * Los errores están indexados por campo cuando aplica (ej. "slug", "name") o
 * por código (ej. "format", "reserved", "unique"). Mantenerlo simple y
 * serializable a JSON para que se pueda devolver tal cual desde la REST API.
 */
final class ValidationResult
{
    /** @var array<string, string> */
    private array $errors;

    /**
     * @param array<string, string> $errors
     */
    private function __construct(array $errors)
    {
        $this->errors = $errors;
    }

    public static function ok(): self
    {
        return new self([]);
    }

    /**
     * @param array<string, string> $errors
     */
    public static function fail(array $errors): self
    {
        return new self($errors);
    }

    public static function failWith(string $key, string $message): self
    {
        return new self([$key => $message]);
    }

    public function isValid(): bool
    {
        return $this->errors === [];
    }

    /**
     * @return array<string, string>
     */
    public function errors(): array
    {
        return $this->errors;
    }

    public function firstError(): ?string
    {
        if ($this->errors === []) {
            return null;
        }

        return reset($this->errors) ?: null;
    }
}
