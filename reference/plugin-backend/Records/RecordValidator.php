<?php
declare(strict_types=1);

namespace ImaginaCRM\Records;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldTypeRegistry;
use ImaginaCRM\Support\Database;
use ImaginaCRM\Support\ValidationResult;

/**
 * Valida un payload entrante de record contra los campos configurados de
 * la lista, delegando la lógica per-tipo al `FieldTypeRegistry`.
 *
 * Errores se acumulan por slug del campo:
 *
 *     ['email' => 'Email inválido.', 'amount' => 'Excede el máximo.']
 */
final class RecordValidator
{
    public function __construct(
        private readonly FieldTypeRegistry $registry,
        private readonly Database $db,
    ) {
    }

    /**
     * @param array<int, FieldEntity>     $fields  Campos vivos de la lista.
     * @param array<string, mixed>        $values  [slug => value] en partial → solo se validan los presentes.
     */
    public function validate(array $fields, array $values, bool $partial = false): ValidationResult
    {
        $errors = [];

        foreach ($fields as $field) {
            $hasValue = array_key_exists($field->slug, $values);
            $value    = $values[$field->slug] ?? null;

            $type = $this->registry->get($field->type);
            if ($type === null) {
                $errors[$field->slug] = sprintf(
                    /* translators: %s: type slug */
                    __('Tipo desconocido: %s.', 'imagina-crm'),
                    $field->type
                );
                continue;
            }

            // En PATCH parcial, ausencia ≠ error required (req se evalúa solo si está presente).
            // Para POST completo, ausencia con required = error.
            if (! $hasValue) {
                if (! $partial && $field->isRequired) {
                    $errors[$field->slug] = __('Este campo es obligatorio.', 'imagina-crm');
                }
                continue;
            }

            $config = $field->config + ['required' => $field->isRequired];

            $result = $type->validate($value, $config);
            if (! $result->isValid()) {
                $errors[$field->slug] = $result->firstError() ?? __('Valor inválido.', 'imagina-crm');
                continue;
            }

            // Unicidad a nivel app: backend extra check para evitar carrera
            // entre el SELECT y el INSERT. La columna también tiene UNIQUE
            // INDEX, pero atrapamos el error aquí con un mensaje legible.
            // Nota: en update, el caller debe pasar `excludeRecordId` por
            // separado; lo validamos en uniqueCheck().
            // (Lo dejamos para una capa superior por simplicidad, el
            // INDEX UNIQUE garantiza la integridad.)
        }

        if ($errors === []) {
            return ValidationResult::ok();
        }

        return ValidationResult::fail($errors);
    }

    /**
     * Convierte el payload de slugs a una fila lista para INSERT/UPDATE en
     * la tabla dinámica. Solo incluye campos cuyos tipos materializan
     * columna física; los `relation` se manejan aparte por
     * `RelationRepository`.
     *
     * @param array<int, FieldEntity>     $fields
     * @param array<string, mixed>        $values
     *
     * @return array<string, mixed> [columnName => serializedValue]
     */
    public function buildRow(array $fields, array $values): array
    {
        $row = [];
        foreach ($fields as $field) {
            if (! array_key_exists($field->slug, $values)) {
                continue;
            }

            $type = $this->registry->get($field->type);
            if ($type === null || ! $type->hasColumn()) {
                continue;
            }

            $row[$field->columnName] = $type->serialize($values[$field->slug], $field->config);
        }
        return $row;
    }

    /**
     * Lee una fila de la tabla dinámica y la convierte a `[slug => value]`
     * usando los `unserialize` de cada tipo.
     *
     * @param array<int, FieldEntity>  $fields
     * @param array<string, mixed>     $row    Fila cruda (columnas físicas).
     *
     * @return array<string, mixed>
     */
    public function hydrateRow(array $fields, array $row): array
    {
        $out = [];
        foreach ($fields as $field) {
            $type = $this->registry->get($field->type);
            if ($type === null || ! $type->hasColumn()) {
                continue;
            }
            $raw       = $row[$field->columnName] ?? null;
            $out[$field->slug] = $type->unserialize($raw, $field->config);
        }
        return $out;
    }

    /**
     * @param array<int, FieldEntity>  $fields
     * @return array<string, FieldEntity> [slug => entity]
     */
    public function indexBySlug(array $fields): array
    {
        $idx = [];
        foreach ($fields as $f) {
            $idx[$f->slug] = $f;
        }
        return $idx;
    }

    public function database(): Database
    {
        return $this->db;
    }
}
