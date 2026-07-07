<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields;

/**
 * Tabla de transiciones permitidas entre tipos de campo, con su nivel
 * de riesgo y la lógica de conversión de valor por registro.
 *
 * Filosofía:
 *  - `safe`        → ninguna pérdida de información posible.
 *  - `lossy`       → algunas filas pueden quedar truncadas o vacías
 *                    (ej. long_text → text trunca a 255 chars).
 *  - `destructive` → pérdida significativa esperada (ej. multi_select
 *                    → select solo conserva el primer valor).
 *
 * Para cambiar el tipo, `FieldService::changeType()` recorre toda la
 * tabla dinámica del list y aplica `migrateValue()` row-by-row,
 * después hace `ALTER TABLE MODIFY COLUMN` con el nuevo SQL.
 *
 * Las transiciones no listadas están prohibidas — el frontend solo
 * ofrece las permitidas en el dropdown, y el backend rechaza el resto
 * con `ValidationResult`.
 */
final class FieldTypeMigration
{
    public const RISK_SAFE        = 'safe';
    public const RISK_LOSSY       = 'lossy';
    public const RISK_DESTRUCTIVE = 'destructive';

    /**
     * Mapa `from => [to => risk]`. Solo las combinaciones listadas
     * son permitidas. El orden importa: para misma combinación de
     * `from` y `to` la primera entrada gana.
     *
     * @var array<string, array<string, string>>
     */
    private const MATRIX = [
        'text' => [
            'long_text' => self::RISK_SAFE,
            'email'     => self::RISK_LOSSY,
            'url'       => self::RISK_LOSSY,
        ],
        'long_text' => [
            'text' => self::RISK_LOSSY,
        ],
        'number' => [
            'currency' => self::RISK_SAFE,
        ],
        'currency' => [
            'number' => self::RISK_SAFE,
        ],
        'date' => [
            'datetime' => self::RISK_SAFE,
        ],
        'datetime' => [
            'date' => self::RISK_LOSSY,
        ],
        'select' => [
            'multi_select' => self::RISK_SAFE,
            'text'         => self::RISK_SAFE,
        ],
        'multi_select' => [
            'select' => self::RISK_DESTRUCTIVE,
        ],
        'email' => [
            'text' => self::RISK_SAFE,
            'url'  => self::RISK_LOSSY,
        ],
        'url' => [
            'text'  => self::RISK_SAFE,
            'email' => self::RISK_LOSSY,
        ],
    ];

    /**
     * @return array<int, array{type:string, risk:string}>
     */
    public static function allowedTransitions(string $from): array
    {
        $targets = self::MATRIX[$from] ?? [];
        $out     = [];
        foreach ($targets as $to => $risk) {
            $out[] = ['type' => $to, 'risk' => $risk];
        }
        return $out;
    }

    public static function isAllowed(string $from, string $to): bool
    {
        if ($from === $to) {
            return true; // identity — útil para no chequear cuando no hay cambio
        }
        return isset(self::MATRIX[$from][$to]);
    }

    public static function riskOf(string $from, string $to): ?string
    {
        return self::MATRIX[$from][$to] ?? null;
    }

    /**
     * Transforma un valor del tipo origen al tipo destino. Recibe el
     * valor tal como lo devuelve `$type->unserialize()` (formato app,
     * no SQL).
     *
     * Para tipos que no tienen riesgo de mutación (mismo tipo de SQL,
     * solo cambia config) devuelve el valor sin tocar.
     */
    public static function migrateValue(mixed $value, string $from, string $to): mixed
    {
        if ($from === $to) {
            return $value;
        }

        // --- text/long_text/email/url (todos string) ---
        if (in_array($from, ['text', 'long_text', 'email', 'url'], true)
            && in_array($to, ['text', 'long_text', 'email', 'url'], true)
        ) {
            if (! is_string($value) || $value === '') {
                return null;
            }
            // Trunca a 255 cuando el destino es VARCHAR(255). Para
            // text/email/url el max es 255; long_text es TEXT (sin
            // límite práctico). Si validamos email/url y el string
            // actual no es válido, dejamos null — el validator del
            // tipo destino lo hubiera rechazado igualmente.
            if (in_array($to, ['text', 'email', 'url'], true)) {
                $value = mb_substr($value, 0, 255);
            }
            if ($to === 'email' && ! is_email($value)) {
                return null;
            }
            if ($to === 'url' && ! filter_var($value, FILTER_VALIDATE_URL)) {
                return null;
            }
            return $value;
        }

        // --- date <-> datetime ---
        if ($from === 'date' && $to === 'datetime') {
            // 'YYYY-MM-DD' → 'YYYY-MM-DD 00:00:00' (UTC).
            if (! is_string($value) || $value === '') return null;
            return $value . ' 00:00:00';
        }
        if ($from === 'datetime' && $to === 'date') {
            // 'YYYY-MM-DD HH:MM:SS' → 'YYYY-MM-DD' (descarta hora).
            if (! is_string($value) || $value === '') return null;
            return substr($value, 0, 10);
        }

        // --- number <-> currency (mismo SQL DECIMAL(18,4)) ---
        if (in_array($from, ['number', 'currency'], true)
            && in_array($to, ['number', 'currency'], true)
        ) {
            return $value;
        }

        // --- select <-> multi_select ---
        if ($from === 'select' && $to === 'multi_select') {
            // VARCHAR(64) → JSON. Envolvemos el valor como array de
            // un solo elemento. Si está vacío, queda null.
            if (! is_string($value) || $value === '') return null;
            return [$value];
        }
        if ($from === 'select' && $to === 'text') {
            // VARCHAR(64) → VARCHAR(255). Solo cambia el tipo del
            // schema; el valor se preserva tal cual.
            return is_string($value) && $value !== '' ? $value : null;
        }
        if ($from === 'multi_select' && $to === 'select') {
            // JSON → VARCHAR(64). Solo el primer valor sobrevive.
            if (! is_array($value) || count($value) === 0) return null;
            $first = $value[0];
            return is_string($first) ? $first : null;
        }

        // Combinación no manejada — el validator/isAllowed debería
        // haberla bloqueado antes. Default conservador: descartamos.
        return null;
    }
}
