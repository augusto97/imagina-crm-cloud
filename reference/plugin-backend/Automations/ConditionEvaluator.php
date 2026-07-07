<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations;

/**
 * Evalúa condiciones de automatización contra un `TriggerContext`.
 *
 * Acepta DOS shapes:
 *
 *  1. Legacy plano (compat con triggers/actions guardadas en 0.1.x —
 *     0.18.x): `{slug: value, ...}` — todos los pares deben matchear
 *     por igualdad laxa. No expresa operadores.
 *
 *  2. Nuevo (rico, 0.20.0+): `[{field, op, value}, ...]` — array de
 *     condiciones con operadores explícitos. Joinadas con AND.
 *     Soporta `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`,
 *     `not_contains`, `starts_with`, `ends_with`, `in`, `nin`,
 *     `is_null`, `is_not_null`. Los rangos de fecha se modelan como
 *     dos condiciones (`gte`+`lte`) sobre el mismo campo, generadas
 *     por los date-range presets del UI.
 *
 * Usado por:
 * - `AbstractTrigger::evaluateFilters()` (trigger-level filters)
 * - `AutomationEngine::executeAction()` (action-level conditions)
 * - `IfElseAction::execute()` (branch decision)
 */
final class ConditionEvaluator
{
    /**
     * @param array<string|int, mixed>|null $condition
     */
    public static function matches(TriggerContext $context, ?array $condition): bool
    {
        if ($condition === null || $condition === []) {
            return true;
        }

        if (self::looksLikeRichArray($condition)) {
            /** @var array<int, mixed> $condition */
            foreach ($condition as $cnd) {
                if (! is_array($cnd)) {
                    continue;
                }
                if (! self::matchOne($context, $cnd)) {
                    return false;
                }
            }
            return true;
        }

        // Legacy plano: `{slug => valor}`.
        foreach ($condition as $slug => $expected) {
            if (! is_string($slug) || $slug === '') {
                continue;
            }
            $actual = $context->fieldValue($slug);
            if (! self::valuesEqual($actual, $expected)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Detecta el shape rico: array indexado por enteros 0..N-1 cuyos
     * elementos son arrays con al menos `field` (o `slug`) y `op`.
     *
     * @param array<string|int, mixed> $condition
     */
    private static function looksLikeRichArray(array $condition): bool
    {
        if (! array_is_list($condition)) {
            return false;
        }
        foreach ($condition as $item) {
            if (! is_array($item)) {
                return false;
            }
            $hasField = isset($item['field']) || isset($item['slug']);
            if (! $hasField || ! isset($item['op'])) {
                return false;
            }
        }
        return true;
    }

    /**
     * @param array<string, mixed> $cnd
     */
    private static function matchOne(TriggerContext $context, array $cnd): bool
    {
        $field = isset($cnd['field']) ? (string) $cnd['field'] : (string) ($cnd['slug'] ?? '');
        if ($field === '') {
            return false;
        }
        $op       = isset($cnd['op']) ? (string) $cnd['op'] : 'eq';
        $expected = $cnd['value'] ?? null;
        $actual   = $context->fieldValue($field);
        return self::evalOp($actual, $op, $expected);
    }

    private static function evalOp(mixed $actual, string $op, mixed $expected): bool
    {
        switch ($op) {
            case 'eq':
                return self::valuesEqual($actual, $expected);
            case 'neq':
                return ! self::valuesEqual($actual, $expected);
            case 'is_null':
                return $actual === null || $actual === '' || $actual === [];
            case 'is_not_null':
                return ! ($actual === null || $actual === '' || $actual === []);
            case 'contains':
                return self::stringContains($actual, $expected);
            case 'not_contains':
                return ! self::stringContains($actual, $expected);
            case 'starts_with':
                return is_string($actual) && is_string($expected) && $expected !== ''
                    && str_starts_with($actual, $expected);
            case 'ends_with':
                return is_string($actual) && is_string($expected) && $expected !== ''
                    && str_ends_with($actual, $expected);
            case 'gt':
            case 'gte':
            case 'lt':
            case 'lte':
                return self::numericCompare($actual, $op, $expected);
            case 'in':
                return is_array($expected)
                    && in_array(self::stringifyForIn($actual), array_map('strval', $expected), true);
            case 'nin':
                return is_array($expected)
                    && ! in_array(self::stringifyForIn($actual), array_map('strval', $expected), true);
        }
        return false;
    }

    /**
     * `contains` semántica:
     * - String + String: substring case-sensitive.
     * - Array (multi_select) + scalar: el scalar está en el array.
     */
    private static function stringContains(mixed $haystack, mixed $needle): bool
    {
        if (is_array($haystack) && is_scalar($needle)) {
            foreach ($haystack as $v) {
                if (is_scalar($v) && (string) $v === (string) $needle) {
                    return true;
                }
            }
            return false;
        }
        return is_string($haystack) && is_string($needle) && $needle !== ''
            && str_contains($haystack, $needle);
    }

    private static function numericCompare(mixed $actual, string $op, mixed $expected): bool
    {
        // Para fechas (string ISO YYYY-MM-DD o DATETIME), strcmp
        // funciona como orden cronológico. Para números reales,
        // pasamos a float. Detectamos por intentar parse numérico.
        $aNum = is_numeric($actual);
        $eNum = is_numeric($expected);
        if ($aNum && $eNum) {
            $a = (float) $actual;
            $e = (float) $expected;
            return match ($op) {
                'gt'  => $a >  $e,
                'gte' => $a >= $e,
                'lt'  => $a <  $e,
                'lte' => $a <= $e,
                default => false,
            };
        }
        if (is_string($actual) && is_string($expected)) {
            return match ($op) {
                'gt'  => strcmp($actual, $expected) >  0,
                'gte' => strcmp($actual, $expected) >= 0,
                'lt'  => strcmp($actual, $expected) <  0,
                'lte' => strcmp($actual, $expected) <= 0,
                default => false,
            };
        }
        return false;
    }

    private static function stringifyForIn(mixed $value): string
    {
        if ($value === null) return '';
        if (is_bool($value)) return $value ? '1' : '0';
        if (is_scalar($value)) return (string) $value;
        return '';
    }

    /**
     * Comparación laxa: arrays se comparan por JSON canon, escalares con
     * loose equality (`==`) para evitar falsos negativos por `"1" vs 1`.
     */
    public static function valuesEqual(mixed $a, mixed $b): bool
    {
        if (is_array($a) && is_array($b)) {
            return wp_json_encode($a) === wp_json_encode($b);
        }
        if (is_array($a) || is_array($b)) {
            return false;
        }
        // phpcs:ignore Universal.Operators.StrictComparisons.LooseEqual
        return $a == $b;
    }
}
