<?php
declare(strict_types=1);

namespace ImaginaCRM\Licensing;

/**
 * Snapshot inmutable del estado actual de la licencia.
 *
 * Stati posibles (CLAUDE.md §14):
 * - `inactive`            sin licencia activada
 * - `valid`               último check OK
 * - `expired`             licencia caducada
 * - `invalid`             clave incorrecta o revocada
 * - `site_limit_reached`  límite de activaciones excedido
 *
 * El campo `grace_until` se setea cuando el último check FALLA por causas
 * de red (no por respuesta `invalid` del servidor): la licencia sigue
 * considerándose válida durante `LicenseManager::GRACE_PERIOD_DAYS`. Si la
 * red sigue caída pasado ese período, `isValid()` devuelve `false` y los
 * updates se cortan, pero los datos del usuario NO se bloquean (ADR-007).
 */
final class LicenseState
{
    public const STATUS_INACTIVE             = 'inactive';
    public const STATUS_VALID                = 'valid';
    public const STATUS_EXPIRED              = 'expired';
    public const STATUS_INVALID              = 'invalid';
    public const STATUS_SITE_LIMIT_REACHED   = 'site_limit_reached';

    public function __construct(
        public readonly string $key,
        public readonly string $status,
        public readonly ?string $activatedAt,
        public readonly ?string $expiresAt,
        public readonly ?string $lastCheckAt,
        public readonly ?string $graceUntil,
        public readonly ?int $siteLimit,
        public readonly ?int $activationsCount,
        public readonly ?string $message,
    ) {
    }

    public static function inactive(): self
    {
        return new self('', self::STATUS_INACTIVE, null, null, null, null, null, null, null);
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromArray(array $row): self
    {
        return new self(
            key: (string) ($row['key'] ?? ''),
            status: self::normalizeStatus((string) ($row['status'] ?? self::STATUS_INACTIVE)),
            activatedAt: self::nullableString($row['activated_at'] ?? null),
            expiresAt: self::nullableString($row['expires_at'] ?? null),
            lastCheckAt: self::nullableString($row['last_check_at'] ?? null),
            graceUntil: self::nullableString($row['grace_until'] ?? null),
            siteLimit: isset($row['site_limit']) ? (int) $row['site_limit'] : null,
            activationsCount: isset($row['activations_count']) ? (int) $row['activations_count'] : null,
            message: self::nullableString($row['message'] ?? null),
        );
    }

    /**
     * `true` si el plugin debería tratar la licencia como activa para
     * decisiones tipo "permitir update" o "mostrar como verificada".
     *
     * Incluye el grace period: si la red está caída pero estamos dentro
     * del período de gracia, devolvemos `true` para no penalizar al
     * usuario por un fallo del servidor de licencias.
     */
    public function isValid(): bool
    {
        if ($this->status === self::STATUS_VALID) {
            return true;
        }
        if ($this->graceUntil !== null) {
            $until = strtotime($this->graceUntil);
            if ($until !== false && $until > time()) {
                return true;
            }
        }
        return false;
    }

    public function isActive(): bool
    {
        return $this->status !== self::STATUS_INACTIVE && $this->key !== '';
    }

    public function isInGrace(): bool
    {
        if ($this->graceUntil === null) {
            return false;
        }
        $until = strtotime($this->graceUntil);
        return $until !== false && $until > time();
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'key'                => $this->key,
            'status'             => $this->status,
            'activated_at'       => $this->activatedAt,
            'expires_at'         => $this->expiresAt,
            'last_check_at'      => $this->lastCheckAt,
            'grace_until'        => $this->graceUntil,
            'site_limit'         => $this->siteLimit,
            'activations_count'  => $this->activationsCount,
            'message'            => $this->message,
        ];
    }

    /**
     * Versión segura para enviar al frontend: clave enmascarada.
     *
     * @return array<string, mixed>
     */
    public function toPublicArray(): array
    {
        $arr = $this->toArray();
        $arr['key']        = $this->maskedKey();
        $arr['is_valid']   = $this->isValid();
        $arr['in_grace']   = $this->isInGrace();
        return $arr;
    }

    public function maskedKey(): string
    {
        if ($this->key === '') {
            return '';
        }
        if (strlen($this->key) <= 8) {
            return str_repeat('•', strlen($this->key));
        }
        return substr($this->key, 0, 4) . str_repeat('•', max(0, strlen($this->key) - 8)) . substr($this->key, -4);
    }

    private static function normalizeStatus(string $status): string
    {
        return in_array($status, [
            self::STATUS_INACTIVE,
            self::STATUS_VALID,
            self::STATUS_EXPIRED,
            self::STATUS_INVALID,
            self::STATUS_SITE_LIMIT_REACHED,
        ], true) ? $status : self::STATUS_INACTIVE;
    }

    private static function nullableString(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        return (string) $value;
    }
}
