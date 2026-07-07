<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations;

/**
 * Resultado de ejecutar una acción dentro de una automatización.
 *
 * El `actions_log` de cada `automation_run` es un array de
 * `ActionResult::toArray()` — uno por cada acción ejecutada, en orden.
 *
 * Estados posibles:
 * - `success`: la acción se completó sin errores.
 * - `failed`: error recuperable (ej. webhook 5xx). El engine puede reintentar.
 * - `skipped`: la acción decidió no ejecutar (config inválida, condición
 *   no cumplida, etc.). No cuenta como fallo del run.
 */
final class ActionResult
{
    public const STATUS_SUCCESS = 'success';
    public const STATUS_FAILED  = 'failed';
    public const STATUS_SKIPPED = 'skipped';

    /**
     * @param array<string, mixed> $details
     */
    private function __construct(
        public readonly string $action,
        public readonly string $status,
        public readonly ?string $message,
        public readonly array $details,
    ) {
    }

    /**
     * @param array<string, mixed> $details
     */
    public static function success(string $action, ?string $message = null, array $details = []): self
    {
        return new self($action, self::STATUS_SUCCESS, $message, $details);
    }

    /**
     * @param array<string, mixed> $details
     */
    public static function failed(string $action, string $message, array $details = []): self
    {
        return new self($action, self::STATUS_FAILED, $message, $details);
    }

    /**
     * @param array<string, mixed> $details
     */
    public static function skipped(string $action, string $message, array $details = []): self
    {
        return new self($action, self::STATUS_SKIPPED, $message, $details);
    }

    public function isSuccess(): bool
    {
        return $this->status === self::STATUS_SUCCESS;
    }

    public function isFailed(): bool
    {
        return $this->status === self::STATUS_FAILED;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'action'  => $this->action,
            'status'  => $this->status,
            'message' => $this->message,
            'details' => $this->details,
        ];
    }
}
