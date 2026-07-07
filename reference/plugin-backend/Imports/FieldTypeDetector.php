<?php
declare(strict_types=1);

namespace ImaginaCRM\Imports;

/**
 * Heurística para inferir el tipo de campo apropiado a partir de
 * una muestra de valores del CSV. Pure helper — sin dependencias
 * del Container.
 *
 * Reglas (en orden):
 *  1. checkbox  — ≥80% de los valores no vacíos son sí/no/1/0/x.
 *  2. email     — ≥80% pasan `filter_var(EMAIL)`.
 *  3. url       — ≥80% empiezan con http(s)://.
 *  4. number    — ≥80% son numéricos (después de limpiar separadores
 *                 de miles ES/US).
 *  5. datetime  — ≥80% parsean como fecha Y al menos 50% incluyen
 *                 hora (`:`).
 *  6. date      — ≥80% parsean como fecha (sin necesidad de hora).
 *  7. select    — cardinalidad baja: ≤20 valores únicos Y unique
 *                 ≤ count/2 (al menos algún valor se repite).
 *  8. text      — fallback.
 *
 * El umbral 80% permite tolerar ruido en el sample (celdas vacías,
 * typos puntuales) sin downgradear todo a `text`.
 */
final class FieldTypeDetector
{
    private const THRESHOLD = 0.8;
    private const SELECT_MAX_CARDINALITY = 20;

    /**
     * @param array<int, string> $sample Valores raw de una columna.
     */
    public static function detect(array $sample): string
    {
        $nonEmpty = array_values(array_filter(
            array_map(static fn (string $v): string => trim($v), $sample),
            static fn (string $v): bool => $v !== '',
        ));
        $count = count($nonEmpty);
        if ($count === 0) {
            return 'text';
        }
        $needed = (int) ceil($count * self::THRESHOLD);

        if (self::matches($nonEmpty, [self::class, 'isBoolish']) >= $needed) {
            return 'checkbox';
        }

        if (self::matches($nonEmpty, static fn (string $v): bool => filter_var($v, FILTER_VALIDATE_EMAIL) !== false) >= $needed) {
            return 'email';
        }

        if (self::matches($nonEmpty, static fn (string $v): bool => preg_match('#^https?://#i', $v) === 1) >= $needed) {
            return 'url';
        }

        if (self::matches($nonEmpty, [self::class, 'isNumber']) >= $needed) {
            return 'number';
        }

        $dateMatches = self::matches($nonEmpty, [self::class, 'isDateish']);
        if ($dateMatches >= $needed) {
            $withTime = self::matches($nonEmpty, static fn (string $v): bool => str_contains($v, ':'));
            // Si la mitad o más traen hora, es datetime.
            return $withTime >= (int) ceil($count * 0.5) ? 'datetime' : 'date';
        }

        $unique = array_unique($nonEmpty);
        if (count($unique) <= self::SELECT_MAX_CARDINALITY && count($unique) * 2 <= $count) {
            return 'select';
        }

        return 'text';
    }

    /**
     * @param array<int, string>          $values
     * @param callable(string): bool      $predicate
     */
    private static function matches(array $values, callable $predicate): int
    {
        $hits = 0;
        foreach ($values as $v) {
            if ($predicate($v)) {
                $hits++;
            }
        }
        return $hits;
    }

    private static function isBoolish(string $v): bool
    {
        $low = strtolower($v);
        return in_array($low, ['1', '0', 'true', 'false', 'yes', 'no', 'sí', 'si', 'x', 'on', 'off'], true);
    }

    private static function isNumber(string $v): bool
    {
        // Limpiamos separadores ES (1.234,56) y dejamos como es US (1234.56).
        $clean = $v;
        if (preg_match('/^-?[0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?$/', $v) === 1) {
            $clean = str_replace(['.', ','], ['', '.'], $v);
        } elseif (str_contains($v, ',') && ! str_contains($v, '.')) {
            $clean = str_replace(',', '.', $v);
        }
        return is_numeric($clean);
    }

    private static function isDateish(string $v): bool
    {
        // ISO 8601: YYYY-MM-DD, posiblemente con hora.
        if (preg_match('/^\d{4}-\d{2}-\d{2}/', $v) === 1) {
            return @strtotime($v) !== false;
        }
        // DD/MM/YYYY o MM/DD/YYYY (con `/` o `-`).
        if (preg_match('/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/', $v) === 1) {
            return true;
        }
        return false;
    }
}
