<?php
declare(strict_types=1);

namespace ImaginaCRM\Licensing;

use RuntimeException;

/**
 * Errores originados por el cliente HTTP de licencias.
 *
 * Distinguimos dos tipos:
 *
 * - `network`  → fallo de transporte (timeout, DNS, 5xx). El caller decide
 *                si activar el grace period.
 * - `server`   → respuesta del servidor con `ok=false` y un status
 *                conocido (`invalid`, `expired`, `site_limit_reached`).
 *                El caller actualiza el LicenseState con ese status.
 */
final class LicenseException extends RuntimeException
{
    public const KIND_NETWORK = 'network';
    public const KIND_SERVER  = 'server';

    public function __construct(
        public readonly string $kind,
        string $message,
        public readonly ?string $serverStatus = null,
    ) {
        parent::__construct($message);
    }

    public static function network(string $message): self
    {
        return new self(self::KIND_NETWORK, $message);
    }

    public static function server(string $serverStatus, string $message): self
    {
        return new self(self::KIND_SERVER, $message, $serverStatus);
    }

    public function isNetwork(): bool
    {
        return $this->kind === self::KIND_NETWORK;
    }
}
