<?php
declare(strict_types=1);

namespace ImaginaCRM\Records;

use DateTimeImmutable;
use DateTimeZone;

/**
 * Presets relativos (this_month, last_30_days, etc.) — el usuario
 * persiste el slug, y en cada lectura del registro/widget se computa
 * el rango contra `now()` para que "este mes" siga siendo "este mes"
 * dentro de un mes.
 *
 * Es el espejo PHP de `app/admin/records/dateRangePresets.ts`. Ambas
 * implementaciones DEBEN coincidir — la frontend usa este cálculo
 * para previsualizar el rango y la backend para la query real.
 *
 * El cálculo es local al timezone del sitio WP (`wp_timezone()`).
 * El usuario piensa "este mes" según su calendario, no UTC.
 */
final class RelativeDateRange
{
    /** @var array<int, string> */
    public const PRESETS = [
        'today',
        'yesterday',
        'this_week',
        'last_week',
        'this_month',
        'last_month',
        'last_7_days',
        'last_15_days',
        'last_30_days',
        'this_year',
        'last_year',
    ];

    public static function isPreset(string $value): bool
    {
        return in_array($value, self::PRESETS, true);
    }

    /**
     * Devuelve `[from, to]` formateados para el tipo de campo:
     *  - `date`     → 'YYYY-MM-DD' (extremos inclusive)
     *  - `datetime` → 'YYYY-MM-DD HH:mm:ss' con `from` 00:00:00 y
     *                 `to` 23:59:59 del día final
     *
     * Devuelve null si el preset es desconocido.
     *
     * @return array{from: string, to: string}|null
     */
    public static function compute(
        string $preset,
        string $fieldType,
        ?DateTimeImmutable $now = null,
    ): ?array {
        if (! self::isPreset($preset)) {
            return null;
        }
        $tz   = function_exists('wp_timezone') ? wp_timezone() : new DateTimeZone('UTC');
        $now  = ($now ?? new DateTimeImmutable('now', $tz))->setTimezone($tz);
        $today = $now->setTime(0, 0, 0);

        [$from, $to] = match ($preset) {
            'today'        => [$today, $today],
            'yesterday'    => [$today->modify('-1 day'), $today->modify('-1 day')],
            'this_week'    => self::weekRange($today, 0),
            'last_week'    => self::weekRange($today, -1),
            'this_month'   => [$today->modify('first day of this month'), $today->modify('last day of this month')],
            'last_month'   => [$today->modify('first day of last month'), $today->modify('last day of last month')],
            'last_7_days'  => [$today->modify('-6 days'), $today],
            'last_15_days' => [$today->modify('-14 days'), $today],
            'last_30_days' => [$today->modify('-29 days'), $today],
            'this_year'    => [
                $today->setDate((int) $today->format('Y'), 1, 1),
                $today->setDate((int) $today->format('Y'), 12, 31),
            ],
            'last_year'    => [
                $today->setDate((int) $today->format('Y') - 1, 1, 1),
                $today->setDate((int) $today->format('Y') - 1, 12, 31),
            ],
            // `isPreset()` de arriba garantiza que no caemos acá,
            // pero PHPStan no infiere ese narrowing — default
            // explícito para que el match sea exhaustivo.
            default        => [null, null],
        };

        if ($from === null || $to === null) {
            return null;
        }

        return [
            'from' => self::formatBoundary($from, 'start', $fieldType),
            'to'   => self::formatBoundary($to, 'end', $fieldType),
        ];
    }

    /**
     * ISO week (lunes = inicio). offset=0 → semana actual, -1 → pasada.
     *
     * @return array{0: DateTimeImmutable, 1: DateTimeImmutable}
     */
    private static function weekRange(DateTimeImmutable $today, int $weekOffset): array
    {
        // PHP `N` (1=lunes…7=domingo). Para ISO week, offset al lunes:
        $dayOfWeek = (int) $today->format('N');
        $monday    = $today->modify('-' . ($dayOfWeek - 1) . ' days');
        $monday    = $monday->modify(($weekOffset * 7) . ' days');
        $sunday    = $monday->modify('+6 days');
        return [$monday, $sunday];
    }

    private static function formatBoundary(DateTimeImmutable $d, string $edge, string $fieldType): string
    {
        if ($fieldType === 'datetime') {
            $time = $edge === 'start' ? '00:00:00' : '23:59:59';
            return $d->format('Y-m-d') . ' ' . $time;
        }
        return $d->format('Y-m-d');
    }
}
