<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields\Types;

use ImaginaCRM\Support\ValidationResult;

/**
 * Relación entre registros de listas distintas (CLAUDE.md §6.1, §8).
 *
 * NO crea columna en la tabla dinámica: las relaciones viven en
 * `wp_imcrm_relations`. Por eso `hasColumn()` devuelve `false` y
 * `getSqlDefinition()` devuelve `''` — `SchemaManager::addColumn` debe
 * respetar esta semántica y omitir el ALTER cuando recibe este tipo.
 */
final class RelationField extends AbstractFieldType
{
    public const SLUG = 'relation';

    public function getSlug(): string
    {
        return self::SLUG;
    }

    public function getLabel(): string
    {
        return __('Relación', 'imagina-crm');
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
        if ($required = $this->checkRequired($value, $config)) {
            return $required;
        }
        if ($this->isNullish($value)) {
            return ValidationResult::ok();
        }

        // Aceptamos un array de IDs (multi) o un único ID (single).
        $ids = is_array($value) ? $value : [$value];

        if (! isset($config['target_list_id']) || (int) $config['target_list_id'] <= 0) {
            return $this->invalidFailure(__('Falta target_list_id en la configuración del campo.', 'imagina-crm'));
        }

        foreach ($ids as $id) {
            if (! is_numeric($id) || (int) $id < 1) {
                return $this->invalidFailure(__('ID de registro inválido en la relación.', 'imagina-crm'));
            }
        }
        return ValidationResult::ok();
    }

    public function serialize(mixed $value, array $config): mixed
    {
        unset($config);
        // El valor real se persiste en wp_imcrm_relations vía el
        // RecordService, no se escribe en la tabla dinámica. Devolvemos null.
        unset($value);
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
            'target_list_id' => ['type' => 'integer', 'required' => true],
            'multi'          => ['type' => 'boolean', 'default' => false],
        ];
    }
}
