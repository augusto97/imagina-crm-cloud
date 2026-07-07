<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields;

use DateTimeImmutable;
use ImaginaCRM\Fields\Types\ComputedField;

/**
 * Evalúa el valor de un campo `computed` leyendo sus inputs del
 * record hidratado. Soporta encadenamiento (un computed que depende
 * de otro computed) vía recursión con detección de ciclos por
 * profundidad y conjunto de visitados.
 *
 * El evaluator es PURO: no toca BD, no carga state. Recibe el array
 * de fields de la lista y el record hidratado. Devuelve `null` si:
 *  - Falta algún input.
 *  - Hay un ciclo (mismo field referenciándose recursivamente).
 *  - La operación no es válida.
 *  - División por cero.
 *  - Profundidad de cadena > MAX_DEPTH.
 *
 * Llamado desde `RecordService::hydrate()` después de hidratar los
 * fields regulares.
 */
final class ComputedFieldEvaluator
{
    /** Profundidad máxima de cadena de computed → computed. */
    public const MAX_DEPTH = 8;

    /**
     * @param array<int, FieldEntity> $listFields  Todos los fields de la lista.
     * @param array<string, mixed>    $hydratedFields  `[slug => value]` con los inputs ya hidratados.
     * @param array<int, true>        $visiting  Set de field IDs en evaluación (cycle guard).
     */
    public static function evaluate(
        FieldEntity $field,
        array $listFields,
        array $hydratedFields,
        array $visiting = [],
        int $depth = 0,
    ): mixed {
        if ($field->type !== ComputedField::SLUG) {
            return $hydratedFields[$field->slug] ?? null;
        }
        if ($depth > self::MAX_DEPTH) {
            return null;
        }
        if (isset($visiting[$field->id])) {
            return null; // ciclo detectado
        }

        $operation = (string) ($field->config['operation'] ?? '');
        $inputs    = is_array($field->config['inputs'] ?? null) ? $field->config['inputs'] : [];

        $resolved = self::resolveInputs(
            $inputs,
            $listFields,
            $hydratedFields,
            [...$visiting, $field->id => true],
            $depth + 1,
        );

        return self::apply($operation, $resolved, $field->config);
    }

    /**
     * Resuelve cada input ID a su valor. Si el input es a su vez un
     * computed, recursa con `evaluate()`.
     *
     * @param array<int, mixed>      $inputs  Lista de field IDs (ints/strings).
     * @param array<int, FieldEntity> $listFields
     * @param array<string, mixed>    $hydratedFields
     * @param array<int, true>        $visiting
     *
     * @return array<int, mixed>
     */
    private static function resolveInputs(
        array $inputs,
        array $listFields,
        array $hydratedFields,
        array $visiting,
        int $depth,
    ): array {
        $byId = [];
        foreach ($listFields as $f) {
            $byId[$f->id] = $f;
        }

        $out = [];
        foreach ($inputs as $rawId) {
            $id = is_numeric($rawId) ? (int) $rawId : 0;
            if ($id <= 0 || ! isset($byId[$id])) {
                $out[] = null;
                continue;
            }
            $f = $byId[$id];
            if ($f->type === ComputedField::SLUG) {
                $out[] = self::evaluate($f, $listFields, $hydratedFields, $visiting, $depth);
            } else {
                $out[] = $hydratedFields[$f->slug] ?? null;
            }
        }
        return $out;
    }

    /**
     * Aplica la operación a los valores ya resueltos.
     *
     * @param array<int, mixed>    $values
     * @param array<string, mixed> $config
     */
    private static function apply(string $operation, array $values, array $config): mixed
    {
        switch ($operation) {
            case ComputedField::OP_DATE_DIFF_MONTHS:
                return self::dateDiffMonths($values[0] ?? null, $values[1] ?? null);
            case ComputedField::OP_DATE_DIFF_DAYS:
                return self::dateDiffDays($values[0] ?? null, $values[1] ?? null);
            case ComputedField::OP_SUM:
                return self::sum($values);
            case ComputedField::OP_PRODUCT:
                return self::product($values);
            case ComputedField::OP_SUBTRACT:
                return self::subtract($values[0] ?? null, $values[1] ?? null);
            case ComputedField::OP_DIVIDE:
                return self::divide($values[0] ?? null, $values[1] ?? null);
            case ComputedField::OP_CONCAT:
                return self::concat($values, (string) ($config['separator'] ?? ' '));
            case ComputedField::OP_ABS:
                return self::abs($values[0] ?? null);
        }
        return null;
    }

    /**
     * Diferencia en meses como entero lineal:
     *   `(year_b * 12 + month_b) − (year_a * 12 + month_a)`
     *
     * Funciona correctamente cruzando años: dic 2025 → ene 2026 = 1.
     * Signo positivo si `b > a` (b está más adelante).
     */
    private static function dateDiffMonths(mixed $a, mixed $b): ?int
    {
        $da = self::parseDate($a);
        $db = self::parseDate($b);
        if ($da === null || $db === null) return null;
        $ma = (int) $da->format('Y') * 12 + (int) $da->format('n');
        $mb = (int) $db->format('Y') * 12 + (int) $db->format('n');
        return $mb - $ma;
    }

    /**
     * Diferencia en días: floor((b - a) / 86400). Funciona para date
     * y datetime — para date asume 00:00:00 UTC.
     */
    private static function dateDiffDays(mixed $a, mixed $b): ?int
    {
        $da = self::parseDate($a);
        $db = self::parseDate($b);
        if ($da === null || $db === null) return null;
        $diffSeconds = $db->getTimestamp() - $da->getTimestamp();
        return (int) floor($diffSeconds / 86400);
    }

    /**
     * @param array<int, mixed> $values
     */
    private static function sum(array $values): ?float
    {
        $any = false;
        $total = 0.0;
        foreach ($values as $v) {
            if (! self::isNumeric($v)) continue;
            $total += (float) $v;
            $any = true;
        }
        return $any ? $total : null;
    }

    /**
     * @param array<int, mixed> $values
     */
    private static function product(array $values): ?float
    {
        $any = false;
        $total = 1.0;
        foreach ($values as $v) {
            if (! self::isNumeric($v)) continue;
            $total *= (float) $v;
            $any = true;
        }
        return $any ? $total : null;
    }

    private static function subtract(mixed $a, mixed $b): ?float
    {
        if (! self::isNumeric($a) || ! self::isNumeric($b)) return null;
        return (float) $a - (float) $b;
    }

    private static function divide(mixed $a, mixed $b): ?float
    {
        if (! self::isNumeric($a) || ! self::isNumeric($b)) return null;
        $bf = (float) $b;
        if ($bf === 0.0) return null; // división por cero → null
        return (float) $a / $bf;
    }

    /**
     * @param array<int, mixed> $values
     */
    private static function concat(array $values, string $separator): ?string
    {
        $pieces = [];
        foreach ($values as $v) {
            if ($v === null || $v === '') continue;
            if (is_scalar($v)) {
                $pieces[] = (string) $v;
            }
        }
        return $pieces === [] ? null : implode($separator, $pieces);
    }

    private static function abs(mixed $a): ?float
    {
        if (! self::isNumeric($a)) return null;
        return abs((float) $a);
    }

    /**
     * Parser tolerante: acepta `YYYY-MM-DD`, `YYYY-MM-DD HH:MM:SS`,
     * `YYYY-MM-DDTHH:MM` con o sin segundos. Devuelve null si la
     * cadena no parsea.
     */
    private static function parseDate(mixed $v): ?DateTimeImmutable
    {
        if (! is_string($v) || $v === '') return null;
        try {
            return new DateTimeImmutable($v);
        } catch (\Exception $_) {
            return null;
        }
    }

    private static function isNumeric(mixed $v): bool
    {
        if ($v === null || $v === '') return false;
        if (is_bool($v)) return true; // 1/0
        return is_numeric($v);
    }
}
