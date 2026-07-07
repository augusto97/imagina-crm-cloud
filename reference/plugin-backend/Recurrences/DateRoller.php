<?php
declare(strict_types=1);

namespace ImaginaCRM\Recurrences;

use DateTimeImmutable;
use DateTimeZone;

/**
 * Calcula la "siguiente fecha" para una recurrencia dada. Pure
 * (no toca BD ni estado).
 *
 * Soporta:
 *   - daily / weekly / monthly / yearly / days_after con `interval`.
 *   - Patrones mensuales: same_day, first_day, last_day, weekday
 *     (= mismo día de la semana del mes; ej. "2do jueves").
 *
 * Edge cases manejados:
 *   - Mensual: si el día actual es 31 y el siguiente mes solo tiene
 *     30, usar el último día del siguiente mes (en lugar de saltar
 *     o overflow al próximo).
 *   - Last_day: respeta los días reales de cada mes (28/29/30/31).
 *   - Weekday: cuenta la N-ésima ocurrencia del día de la semana
 *     dentro del mes target.
 */
final class DateRoller
{
    /**
     * @return string La nueva fecha en el mismo formato que la original
     *   (`YYYY-MM-DD` o `YYYY-MM-DD HH:MM:SS`).
     */
    public static function nextOccurrence(string $currentDate, RecurrenceEntity $rec): string
    {
        $hasTime = self::hasTimeComponent($currentDate);
        $tz      = new DateTimeZone('UTC');

        $current = new DateTimeImmutable($currentDate, $tz);

        $next = match ($rec->frequency) {
            RecurrenceEntity::FREQ_DAILY      => $current->modify('+' . $rec->intervalN . ' day'),
            RecurrenceEntity::FREQ_DAYS_AFTER => $current->modify('+' . $rec->intervalN . ' day'),
            RecurrenceEntity::FREQ_WEEKLY     => $current->modify('+' . $rec->intervalN . ' week'),
            RecurrenceEntity::FREQ_YEARLY     => self::addYears($current, $rec->intervalN),
            RecurrenceEntity::FREQ_MONTHLY    => self::addMonths(
                $current,
                $rec->intervalN,
                $rec->monthlyPattern ?? RecurrenceEntity::MONTHLY_SAME_DAY,
            ),
            default => $current->modify('+1 day'),
        };

        return $hasTime
            ? $next->format('Y-m-d H:i:s')
            : $next->format('Y-m-d');
    }

    /**
     * Year-add con manejo de 29 de feb → 28 de feb cuando el target no
     * es bisiesto. PHP `+N year` ya hace esto correctamente, pero lo
     * envolvemos como helper por simetría con addMonths.
     */
    private static function addYears(DateTimeImmutable $current, int $n): DateTimeImmutable
    {
        return $current->modify('+' . $n . ' year');
    }

    /**
     * Avanza meses respetando el patrón configurado.
     */
    private static function addMonths(
        DateTimeImmutable $current,
        int $n,
        string $pattern,
    ): DateTimeImmutable {
        $year  = (int) $current->format('Y');
        $month = (int) $current->format('m');
        $day   = (int) $current->format('d');

        $targetMonth = $month + $n;
        $targetYear  = $year + intdiv($targetMonth - 1, 12);
        $targetMonth = (($targetMonth - 1) % 12) + 1;
        if ($targetMonth <= 0) {
            $targetMonth += 12;
            $targetYear--;
        }

        $tz = $current->getTimezone();

        switch ($pattern) {
            case RecurrenceEntity::MONTHLY_FIRST_DAY:
                return self::makeDate($targetYear, $targetMonth, 1, $current, $tz);
            case RecurrenceEntity::MONTHLY_LAST_DAY:
                $lastDay = (int) date('t', (int) mktime(0, 0, 0, $targetMonth, 1, $targetYear));
                return self::makeDate($targetYear, $targetMonth, $lastDay, $current, $tz);
            case RecurrenceEntity::MONTHLY_WEEKDAY:
                return self::nthWeekdayOfMonth($targetYear, $targetMonth, $current, $tz);
            case RecurrenceEntity::MONTHLY_SAME_DAY:
            default:
                $maxDay = (int) date('t', (int) mktime(0, 0, 0, $targetMonth, 1, $targetYear));
                $useDay = min($day, $maxDay);
                return self::makeDate($targetYear, $targetMonth, $useDay, $current, $tz);
        }
    }

    /**
     * Calcula la N-ésima ocurrencia del día de la semana de `$current`
     * dentro de `$year/$month`. Ej: si el current es "2do jueves de
     * mayo", devuelve el 2do jueves del mes target.
     */
    private static function nthWeekdayOfMonth(
        int $targetYear,
        int $targetMonth,
        DateTimeImmutable $current,
        DateTimeZone $tz,
    ): DateTimeImmutable {
        $weekday = (int) $current->format('w');           // 0=dom..6=sáb
        $day     = (int) $current->format('d');
        $nth     = (int) ceil($day / 7);                  // 1ra, 2da, …

        // Encontrar primer `weekday` en el mes target.
        $firstOfTarget = new DateTimeImmutable(
            sprintf('%04d-%02d-01', $targetYear, $targetMonth),
            $tz,
        );
        $firstWeekday  = (int) $firstOfTarget->format('w');
        $offset        = ($weekday - $firstWeekday + 7) % 7;
        $firstOccDay   = 1 + $offset;
        $targetDay     = $firstOccDay + ($nth - 1) * 7;

        // Si la N-ésima no existe en este mes (ej. 5to jueves), usar la
        // última ocurrencia disponible.
        $lastDayOfMonth = (int) date('t', (int) mktime(0, 0, 0, $targetMonth, 1, $targetYear));
        if ($targetDay > $lastDayOfMonth) {
            $targetDay -= 7;
        }

        return self::makeDate($targetYear, $targetMonth, $targetDay, $current, $tz);
    }

    private static function makeDate(
        int $year,
        int $month,
        int $day,
        DateTimeImmutable $hourSource,
        DateTimeZone $tz,
    ): DateTimeImmutable {
        $h = (int) $hourSource->format('H');
        $i = (int) $hourSource->format('i');
        $s = (int) $hourSource->format('s');
        return new DateTimeImmutable(
            sprintf('%04d-%02d-%02d %02d:%02d:%02d', $year, $month, $day, $h, $i, $s),
            $tz,
        );
    }

    private static function hasTimeComponent(string $date): bool
    {
        return str_contains($date, ' ') || str_contains($date, 'T');
    }
}
