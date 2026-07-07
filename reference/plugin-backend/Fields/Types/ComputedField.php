<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

/**
 * Campo calculado: deriva su valor de otros campos del mismo registro
 * vía operaciones pre-armadas (date_diff_months, sum, product, etc.).
 *
 * NO crea columna en la tabla dinámica — `hasColumn()` devuelve false.
 * El valor se evalúa lazy en cada lectura por
 * `ComputedFieldEvaluator` desde `RecordService::hydrate()`.
 *
 * Config:
 *  - `operation`: tipo de cálculo (catálogo cerrado de operadores).
 *  - `inputs`: array de field IDs que son las entradas del cálculo.
 *  - `separator`: sólo para `concat` — string entre piezas.
 *  - `decimals`: opcional — para sum/product/divide/subtract.
 *
 * El valor del computed NO acepta input del usuario (read-only en UI).
 * `validate()` siempre pasa porque el valor se ignora; el record
 * payload puede traer cualquier cosa en este slug y la sobrescribimos
 * al hidratar.
 */
final class ComputedField extends AbstractFieldType
{
    public const SLUG = 'computed';

    public const OP_DATE_DIFF_MONTHS = 'date_diff_months';
    public const OP_DATE_DIFF_DAYS   = 'date_diff_days';
    public const OP_SUM              = 'sum';
    public const OP_PRODUCT          = 'product';
    public const OP_SUBTRACT         = 'subtract';
    public const OP_DIVIDE           = 'divide';
    public const OP_CONCAT           = 'concat';
    public const OP_ABS              = 'abs';

    /** @var array<int, string> */
    public const OPERATIONS = [
        self::OP_DATE_DIFF_MONTHS,
        self::OP_DATE_DIFF_DAYS,
        self::OP_SUM,
        self::OP_PRODUCT,
        self::OP_SUBTRACT,
        self::OP_DIVIDE,
        self::OP_CONCAT,
        self::OP_ABS,
    ];

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Calculado', 'imagina-crm');
    }

    public function getSqlDefinition(array $config): string
    {
        unset($config);
        return '';
    }

    public function hasColumn(): bool
    {
        return false;
    }

    public function validate(mixed $value, array $config): ValidationResult
    {
        unset($value, $config);
        // El valor lo derivamos al hidratar — cualquier input del
        // usuario se ignora silenciosamente.
        return ValidationResult::ok();
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($value, $config);
        return null;
    }

    public function unserialize(mixed $value, array $config): mixed
    {
        unset($value, $config);
        return null;
    }

    public function getConfigSchema(): array
    {
        return [
            'operation' => ['type' => 'string', 'required' => true],
            'inputs'    => ['type' => 'array',  'required' => true],
            'separator' => ['type' => 'string', 'default' => ' '],
            'decimals'  => ['type' => 'integer', 'default' => 2],
        ];
    }
}
