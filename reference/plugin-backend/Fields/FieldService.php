<?php
declare(strict_types=1);

namespace ImaginaCRM\Fields;

use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Lists\SchemaManager;
use ImaginaCRM\Lists\SlugManager;
use ImaginaCRM\Records\RecordRepository;
use ImaginaCRM\Support\RenameResult;
use ImaginaCRM\Support\SlugContext;
use ImaginaCRM\Support\ValidationResult;

/**
 * Casos de uso de campos.
 *
 * Orquesta `SlugManager`, `SchemaManager`, `FieldTypeRegistry`,
 * `FieldRepository` y `ListRepository`. Cumple las invariantes:
 *
 * - El `column_name` se decide al crear el campo y nunca cambia.
 * - El `slug` es editable; se persiste vía `SlugManager::rename()`.
 * - Cuando el tipo materializa columna (`hasColumn() === true`), la
 *   creación/borrado del campo dispara `addColumn` / `dropColumn`.
 * - `is_unique` solo se acepta si el tipo lo soporta y se traduce a
 *   un `UNIQUE INDEX` real en la tabla dinámica.
 * - Si el DDL falla durante la creación, se hace rollback del INSERT.
 */
final class FieldService
{
    public function __construct(
        private readonly FieldRepository $fields,
        private readonly ListRepository $lists,
        private readonly SlugManager $slugs,
        private readonly SchemaManager $schema,
        private readonly FieldTypeRegistry $registry,
        private readonly RecordRepository $records,
    ) {
    }

    /**
     * @return array<int, FieldEntity>
     */
    public function allForList(int $listId): array
    {
        return $this->fields->allForList($listId);
    }

    public function findByIdOrSlug(int $listId, string $idOrSlug): ?FieldEntity
    {
        if (ctype_digit($idOrSlug)) {
            $field = $this->fields->find((int) $idOrSlug);
            return ($field !== null && $field->listId === $listId) ? $field : null;
        }

        $direct = $this->fields->findBySlug($listId, $idOrSlug);
        if ($direct !== null) {
            return $direct;
        }

        $resolved = $this->slugs->resolveCurrentSlug(SlugContext::Field, $idOrSlug, $listId);
        if ($resolved === null) {
            return null;
        }
        return $this->fields->findBySlug($listId, $resolved);
    }

    /**
     * Crea un campo nuevo dentro de una lista.
     *
     * @param array<string, mixed> $input Debe contener `label` y `type`.
     */
    public function create(int $listId, array $input): FieldEntity|ValidationResult
    {
        $list = $this->lists->find($listId);
        if ($list === null) {
            return ValidationResult::failWith('list_id', __('La lista no existe.', 'imagina-crm'));
        }

        $label = trim((string) ($input['label'] ?? ''));
        $type  = (string) ($input['type'] ?? '');

        if ($label === '') {
            return ValidationResult::failWith('label', __('El label es obligatorio.', 'imagina-crm'));
        }

        $fieldType = $this->registry->get($type);
        if ($fieldType === null) {
            return ValidationResult::failWith('type', __('Tipo de campo desconocido.', 'imagina-crm'));
        }

        $slugInput = isset($input['slug']) ? (string) $input['slug'] : '';
        $slug      = $slugInput !== '' ? strtolower($slugInput) : $this->slugs->slugify($label);

        $slugValidation = $this->slugs->validate($slug, SlugContext::Field, $listId);
        if (! $slugValidation->isValid()) {
            return $slugValidation;
        }

        $isUnique = ! empty($input['is_unique']);
        if ($isUnique && ! $fieldType->supportsUnique()) {
            return ValidationResult::failWith(
                'is_unique',
                __('Este tipo de campo no soporta unicidad.', 'imagina-crm')
            );
        }

        $config = is_array($input['config'] ?? null) ? $input['config'] : [];

        $columnName = $this->slugs->generateUnique($slug, 'column_name', $listId);
        $now        = current_time('mysql', true);

        $id = $this->fields->insert([
            'list_id'     => $listId,
            'slug'        => $slug,
            'column_name' => $columnName,
            'label'       => $label,
            'type'        => $type,
            'config'      => $config,
            'is_required' => ! empty($input['is_required']),
            'is_unique'   => $isUnique,
            'is_primary'  => ! empty($input['is_primary']),
            'is_indexed'  => ! empty($input['is_indexed']),
            'position'    => isset($input['position']) ? (int) $input['position'] : $this->nextPosition($listId),
            'created_at'  => $now,
            'updated_at'  => $now,
        ]);

        if ($id === 0) {
            return ValidationResult::failWith('database', __('No se pudo guardar el campo.', 'imagina-crm'));
        }

        // Materializar columna si el tipo lo requiere.
        if ($fieldType->hasColumn()) {
            try {
                $this->schema->addColumn($list->tableSuffix, $columnName, $fieldType->getSqlDefinition($config));
                if ($isUnique) {
                    $this->schema->addUniqueIndex($list->tableSuffix, $columnName);
                }
                // Toggle de índice no-unique. Mutuamente exclusivo con
                // UNIQUE (UNIQUE ya implica un índice) — solo creamos
                // este si NO hay UNIQUE.
                if (! $isUnique && ! empty($input['is_indexed'])) {
                    $this->schema->addIndex($list->tableSuffix, $columnName);
                }
            } catch (\Throwable $e) {
                // Rollback: marcar el campo como deleted; intentar limpiar
                // estado parcial si la columna sí se creó pero el índice no.
                $this->fields->softDelete($id);
                if ($this->schema->columnExists($list->tableSuffix, $columnName)) {
                    try {
                        $this->schema->dropColumn($list->tableSuffix, $columnName);
                    } catch (\Throwable) {
                        // Ya estamos en path de error; nada más que hacer aquí.
                    }
                }
                return ValidationResult::failWith(
                    'schema',
                    sprintf(
                        /* translators: %s: error message */
                        __('No se pudo crear la columna: %s', 'imagina-crm'),
                        $e->getMessage()
                    )
                );
            }
        }

        $created = $this->fields->find($id);
        if ($created === null) {
            return ValidationResult::failWith('database', __('El campo se creó pero no se pudo leer.', 'imagina-crm'));
        }

        do_action('imagina_crm/field_created', $created, $list);
        return $created;
    }

    /**
     * Actualiza un campo: label, config, flags y position. Si cambia
     * `config` y el tipo materializa columna, se hace `MODIFY COLUMN`.
     * Si cambia `is_unique`, se añade/quita el `UNIQUE INDEX`.
     *
     * El cambio de slug se maneja por separado en `renameSlug()` para
     * mantener la trazabilidad y los headers de respuesta.
     *
     * @param array<string, mixed> $patch
     */
    public function update(int $listId, int $fieldId, array $patch): FieldEntity|ValidationResult
    {
        $list = $this->lists->find($listId);
        if ($list === null) {
            return ValidationResult::failWith('list_id', __('La lista no existe.', 'imagina-crm'));
        }

        $current = $this->fields->find($fieldId);
        if ($current === null || $current->listId !== $listId) {
            return ValidationResult::failWith('id', __('El campo no existe.', 'imagina-crm'));
        }

        $type = $this->registry->get($current->type);
        if ($type === null) {
            return ValidationResult::failWith('type', __('Tipo de campo desconocido.', 'imagina-crm'));
        }

        if (isset($patch['label'])) {
            $patch['label'] = trim((string) $patch['label']);
            if ($patch['label'] === '') {
                return ValidationResult::failWith('label', __('El label no puede estar vacío.', 'imagina-crm'));
            }
        }

        $newConfig    = $patch['config'] ?? null;
        $configChanged = $newConfig !== null && is_array($newConfig)
            && wp_json_encode($newConfig) !== wp_json_encode($current->config);

        $newUnique = array_key_exists('is_unique', $patch) ? (bool) $patch['is_unique'] : null;
        if ($newUnique === true && ! $type->supportsUnique()) {
            return ValidationResult::failWith(
                'is_unique',
                __('Este tipo de campo no soporta unicidad.', 'imagina-crm')
            );
        }

        $ok = $this->fields->update($fieldId, $patch);
        if (! $ok) {
            return ValidationResult::failWith('database', __('No se pudo actualizar el campo.', 'imagina-crm'));
        }

        // ALTER COLUMN si la config cambió y el tipo materializa columna.
        if ($configChanged && $type->hasColumn() && is_array($newConfig)) {
            try {
                $this->schema->alterColumn($list->tableSuffix, $current->columnName, $type->getSqlDefinition($newConfig));
            } catch (\Throwable $e) {
                return ValidationResult::failWith(
                    'schema',
                    sprintf(
                        /* translators: %s: error message */
                        __('No se pudo modificar la columna: %s', 'imagina-crm'),
                        $e->getMessage()
                    )
                );
            }
        }

        // Toggle UNIQUE INDEX si cambió.
        if ($newUnique !== null && $newUnique !== $current->isUnique && $type->hasColumn()) {
            try {
                if ($newUnique) {
                    $this->schema->addUniqueIndex($list->tableSuffix, $current->columnName);
                } else {
                    $this->schema->dropUniqueIndex($list->tableSuffix, $current->columnName);
                }
            } catch (\Throwable $e) {
                return ValidationResult::failWith(
                    'schema',
                    sprintf(
                        /* translators: %s: error message */
                        __('No se pudo actualizar el índice único: %s', 'imagina-crm'),
                        $e->getMessage()
                    )
                );
            }
        }

        // Toggle índice NO-único (`is_indexed`) si cambió. Solo
        // cuando NO hay UNIQUE — el UNIQUE ya provee índice. Si
        // ambos toggles están activos, gana UNIQUE y el regular se
        // dropea para no duplicar.
        $newIndexed = array_key_exists('is_indexed', $patch) ? (bool) $patch['is_indexed'] : null;
        $effectiveUnique = $newUnique ?? $current->isUnique;
        if ($newIndexed !== null && $newIndexed !== $current->isIndexed && $type->hasColumn()) {
            try {
                if ($newIndexed && ! $effectiveUnique) {
                    $this->schema->addIndex($list->tableSuffix, $current->columnName);
                } else {
                    $this->schema->dropIndex($list->tableSuffix, $current->columnName);
                }
            } catch (\Throwable $e) {
                return ValidationResult::failWith(
                    'schema',
                    sprintf(
                        /* translators: %s: error message */
                        __('No se pudo actualizar el índice: %s', 'imagina-crm'),
                        $e->getMessage()
                    )
                );
            }
        }

        $updated = $this->fields->find($fieldId);
        if ($updated === null) {
            return ValidationResult::failWith('database', __('No se pudo releer el campo.', 'imagina-crm'));
        }

        do_action('imagina_crm/field_updated', $updated, $current, $list);
        return $updated;
    }

    /**
     * Cambia el tipo de un campo, migrando los valores existentes
     * según `FieldTypeMigration`. Tres pasos:
     *
     *  1. Lee todos los valores actuales del campo (id, raw_value).
     *  2. Para cada uno: `oldType.unserialize → migrate → newType.serialize`.
     *  3. Si el SQL definition cambia entre tipos, `ALTER COLUMN`
     *     antes de escribir los valores transformados de vuelta. Si
     *     no cambia (caso number↔currency), salteamos el ALTER.
     *
     * El cambio es **atómico a nivel metadata**: o se actualiza todo
     * (tipo + config + columna + valores) o nada. Pero MySQL hace
     * auto-commit del ALTER TABLE, así que si fallan los UPDATE
     * posteriores quedamos con el schema nuevo y valores potencialmente
     * desactualizados — devolvemos `ValidationResult` con detalle del
     * primer error.
     *
     * Para tipos sin columna física (relation) o sin transición
     * registrada, retorna ValidationResult.
     *
     * @param array<string, mixed>|null $newConfig Si null, se preserva
     *     el subset compatible (ej. `options` para select↔multi_select,
     *     `decimals` para number↔currency); el resto va a default.
     */
    public function changeType(
        int $listId,
        int $fieldId,
        string $newTypeSlug,
        ?array $newConfig = null,
    ): FieldEntity|ValidationResult {
        $list = $this->lists->find($listId);
        if ($list === null) {
            return ValidationResult::failWith('list_id', __('La lista no existe.', 'imagina-crm'));
        }
        $current = $this->fields->find($fieldId);
        if ($current === null || $current->listId !== $listId) {
            return ValidationResult::failWith('id', __('El campo no existe.', 'imagina-crm'));
        }
        if ($current->type === $newTypeSlug) {
            return $current; // no-op
        }
        if (! FieldTypeMigration::isAllowed($current->type, $newTypeSlug)) {
            return ValidationResult::failWith(
                'type',
                sprintf(
                    /* translators: 1: source type, 2: target type */
                    __('No se puede convertir un campo de "%1$s" a "%2$s". Combinación no permitida.', 'imagina-crm'),
                    $current->type,
                    $newTypeSlug,
                ),
            );
        }

        $oldType = $this->registry->get($current->type);
        $newType = $this->registry->get($newTypeSlug);
        if ($oldType === null || $newType === null) {
            return ValidationResult::failWith('type', __('Tipo desconocido en el registry.', 'imagina-crm'));
        }
        if (! $oldType->hasColumn() || ! $newType->hasColumn()) {
            return ValidationResult::failWith(
                'type',
                __('Cambio de tipo no soportado para campos sin columna física (relation).', 'imagina-crm'),
            );
        }

        // Config destino: el caller puede pasar uno explícito o lo
        // construimos desde el current preservando subset compatible.
        $resolvedConfig = $newConfig ?? $this->bridgeConfigForTypeChange(
            $current->type,
            $newTypeSlug,
            $current->config,
        );

        $oldSqlDef = $oldType->getSqlDefinition($current->config);
        $newSqlDef = $newType->getSqlDefinition($resolvedConfig);
        $needsAlter = $this->normalizeSqlDef($oldSqlDef) !== $this->normalizeSqlDef($newSqlDef);

        // 1. Leer valores actuales (raw column).
        $allRecords = $this->records->fetchColumnValuesById($list->tableSuffix, $current->columnName);

        // 2. Transformar cada valor en memoria. Cualquier excepción
        // del unserializer/serializer aborta sin tocar el schema.
        $transformed = [];
        foreach ($allRecords as $id => $rawValue) {
            $appValue   = $oldType->unserialize($rawValue, $current->config);
            $migrated   = FieldTypeMigration::migrateValue($appValue, $current->type, $newTypeSlug);
            $serialized = $newType->serialize($migrated, $resolvedConfig);
            $transformed[$id] = $serialized;
        }

        // 3. Si cambia el SQL, hay que dropear índice único (si lo
        // tiene) antes del ALTER, después re-evaluamos si reaplica.
        $hadUnique = $current->isUnique;
        if ($needsAlter && $hadUnique) {
            try {
                $this->schema->dropUniqueIndex($list->tableSuffix, $current->columnName);
            } catch (\Throwable $e) {
                return ValidationResult::failWith('schema', $e->getMessage());
            }
        }

        // 4. ALTER COLUMN si cambia el SQL.
        if ($needsAlter) {
            try {
                $this->schema->alterColumn($list->tableSuffix, $current->columnName, $newSqlDef);
            } catch (\Throwable $e) {
                // Si falla acá, no escribimos los valores transformados
                // — el schema sigue viejo, así que los valores actuales
                // siguen siendo válidos. Sin cambios netos.
                if ($hadUnique) {
                    // Restauramos el índice único.
                    $this->schema->addUniqueIndex($list->tableSuffix, $current->columnName);
                }
                return ValidationResult::failWith(
                    'schema',
                    sprintf(__('No se pudo modificar la columna: %s', 'imagina-crm'), $e->getMessage()),
                );
            }
        }

        // 5. Escribir los valores transformados de vuelta. Si algún
        // UPDATE falla, lo logueamos pero seguimos — el schema ya está
        // nuevo y la mayoría de los rows son recuperables.
        $writeErrors = 0;
        foreach ($transformed as $id => $newValue) {
            $ok = $this->records->update($list->tableSuffix, (int) $id, [
                $current->columnName => $newValue,
            ]);
            if (! $ok) {
                $writeErrors++;
            }
        }

        // 6. Re-aplicar índice único si el destino lo soporta y la
        // config se mantiene unique. Si el nuevo tipo no soporta
        // unique, hacemos `is_unique = false` en el row de metadata.
        $keepUnique = $hadUnique && $newType->supportsUnique();
        if ($needsAlter && $keepUnique) {
            try {
                $this->schema->addUniqueIndex($list->tableSuffix, $current->columnName);
            } catch (\Throwable $e) {
                // Si la data tiene duplicados después de la migración
                // (ej. trim a 255 colisionó), el índice no entra. No
                // bloqueamos el cambio de tipo — desactivamos el flag.
                $keepUnique = false;
            }
        }

        // 7. Actualizar metadata del campo (`type`, `config`, `is_unique`).
        $patch = ['type' => $newTypeSlug, 'config' => $resolvedConfig];
        if ($hadUnique && ! $keepUnique) {
            $patch['is_unique'] = false;
        }
        $this->fields->update($fieldId, $patch);

        $updated = $this->fields->find($fieldId);
        if ($updated === null) {
            return ValidationResult::failWith('database', __('No se pudo recargar el campo tras el cambio de tipo.', 'imagina-crm'));
        }

        do_action('imagina_crm/field_type_changed', $updated, $current, $list, [
            'write_errors' => $writeErrors,
            'altered_sql'  => $needsAlter,
        ]);

        if ($writeErrors > 0) {
            return ValidationResult::failWith(
                'data',
                sprintf(
                    /* translators: 1: error count, 2: total rows */
                    __('Cambio de tipo aplicado, pero %1$d de %2$d registros tuvieron error al migrar el valor.', 'imagina-crm'),
                    $writeErrors,
                    count($transformed),
                ),
            );
        }
        return $updated;
    }

    /**
     * Construye un config "puente" cuando el caller no provee uno
     * explícito. Preserva lo que tenga sentido en el destino y
     * descarta el resto.
     *
     * @param array<string, mixed> $oldConfig
     * @return array<string, mixed>
     */
    private function bridgeConfigForTypeChange(string $from, string $to, array $oldConfig): array
    {
        // select ↔ multi_select: comparten `options`.
        if (in_array($from, ['select', 'multi_select'], true)
            && in_array($to, ['select', 'multi_select'], true)
        ) {
            return ['options' => $oldConfig['options'] ?? []];
        }
        // number ↔ currency: ambos tienen `decimals`; currency suma `currency`.
        if (in_array($from, ['number', 'currency'], true)
            && in_array($to, ['number', 'currency'], true)
        ) {
            $bridge = ['decimals' => $oldConfig['decimals'] ?? 2];
            if ($to === 'currency') {
                $bridge['currency'] = $oldConfig['currency'] ?? 'COP';
            }
            return $bridge;
        }
        // Resto: empezamos con config vacío.
        return [];
    }

    /**
     * Normaliza una SQL definition para comparar si dos tipos
     * producen exactamente el mismo schema físico (en cuyo caso no
     * hace falta ALTER). Solo lowercase + whitespace strip — no es
     * un parser SQL completo.
     */
    private function normalizeSqlDef(string $def): string
    {
        return preg_replace('/\s+/', ' ', strtolower(trim($def))) ?? $def;
    }

    /**
     * Agrega una opción nueva al `config.options` de un campo `select` o
     * `multi_select`. Operación atómica a nivel app: lee el field
     * actual, agrega la opción al final, escribe. Si dos usuarios
     * crean opciones al mismo tiempo el último gana — aceptable para
     * un caso de uso poco frecuente (admin/manager operations).
     *
     * Si ya existe una opción con el mismo `value` (case-sensitive),
     * retorna ValidationResult — el caller decide si re-usar o avisar.
     *
     * @param array{value:string, label?:string, color?:string} $option
     */
    public function appendOption(
        int $listId,
        int $fieldId,
        array $option,
    ): FieldEntity|ValidationResult {
        $field = $this->fields->find($fieldId);
        if ($field === null || $field->listId !== $listId) {
            return ValidationResult::failWith('id', __('El campo no existe.', 'imagina-crm'));
        }
        if (! in_array($field->type, ['select', 'multi_select'], true)) {
            return ValidationResult::failWith(
                'type',
                __('Solo los campos select y multi_select pueden tener opciones.', 'imagina-crm'),
            );
        }

        $value = trim((string) ($option['value'] ?? ''));
        if ($value === '') {
            return ValidationResult::failWith('value', __('El valor de la opción es obligatorio.', 'imagina-crm'));
        }
        $label = trim((string) ($option['label'] ?? $value));
        $color = isset($option['color']) && is_string($option['color']) ? $option['color'] : null;

        $current = $field->config;
        $options = is_array($current['options'] ?? null) ? $current['options'] : [];

        // Check duplicado por `value`.
        foreach ($options as $existing) {
            if (is_array($existing) && ($existing['value'] ?? null) === $value) {
                return ValidationResult::failWith(
                    'value',
                    sprintf(
                        /* translators: %s: option value */
                        __('Ya existe una opción con el valor "%s".', 'imagina-crm'),
                        $value,
                    ),
                );
            }
        }

        $newOption = ['value' => $value, 'label' => $label];
        if ($color !== null && $color !== '') {
            $newOption['color'] = $color;
        }
        $options[] = $newOption;

        $newConfig = array_merge($current, ['options' => $options]);

        // Reusa el flujo normal de update — incluye ALTER del default
        // del field si aplicara, y dispara el hook `field_updated`.
        $result = $this->update($listId, $fieldId, ['config' => $newConfig]);
        return $result;
    }

    public function renameSlug(int $listId, int $fieldId, string $newSlug): RenameResult
    {
        $field = $this->fields->find($fieldId);
        if ($field === null || $field->listId !== $listId) {
            return RenameResult::fail(
                ValidationResult::failWith('id', __('El campo no existe.', 'imagina-crm'))
            );
        }

        $result = $this->slugs->rename(SlugContext::Field, $fieldId, $newSlug, $listId);
        if ($result->success && $result->oldSlug !== $result->newSlug) {
            do_action('imagina_crm/field_slug_renamed', $listId, $fieldId, $result->oldSlug, $result->newSlug);
        }
        return $result;
    }

    /**
     * Elimina un campo. Por defecto soft-delete; con `purge: true` además
     * dropea la columna real de la tabla dinámica.
     */
    public function delete(int $listId, int $fieldId, bool $purge = false): ValidationResult
    {
        $list = $this->lists->find($listId);
        if ($list === null) {
            return ValidationResult::failWith('list_id', __('La lista no existe.', 'imagina-crm'));
        }

        $current = $this->fields->find($fieldId);
        if ($current === null || $current->listId !== $listId) {
            return ValidationResult::failWith('id', __('El campo no existe.', 'imagina-crm'));
        }

        $ok = $this->fields->softDelete($fieldId);
        if (! $ok) {
            return ValidationResult::failWith('database', __('No se pudo eliminar el campo.', 'imagina-crm'));
        }

        if ($purge) {
            $type = $this->registry->get($current->type);
            if ($type !== null && $type->hasColumn()) {
                try {
                    if ($current->isUnique && $this->schema->columnExists($list->tableSuffix, $current->columnName)) {
                        $this->schema->dropUniqueIndex($list->tableSuffix, $current->columnName);
                    }
                    $this->schema->dropColumn($list->tableSuffix, $current->columnName);
                } catch (\Throwable $e) {
                    return ValidationResult::failWith(
                        'schema',
                        sprintf(
                            /* translators: %s: error message */
                            __('El campo se marcó como eliminado pero la columna no se pudo borrar: %s', 'imagina-crm'),
                            $e->getMessage()
                        )
                    );
                }
            }
        }

        do_action('imagina_crm/field_deleted', $current, $list, $purge);
        return ValidationResult::ok();
    }

    /**
     * @param array<int, int> $order [fieldId => position]
     */
    public function reorder(int $listId, array $order): ValidationResult
    {
        $list = $this->lists->find($listId);
        if ($list === null) {
            return ValidationResult::failWith('list_id', __('La lista no existe.', 'imagina-crm'));
        }

        $valid = [];
        foreach ($order as $fieldId => $position) {
            if (! is_int($fieldId) && ! ctype_digit((string) $fieldId)) {
                continue;
            }
            $valid[(int) $fieldId] = (int) $position;
        }

        if ($valid === []) {
            return ValidationResult::failWith('order', __('No hay items que reordenar.', 'imagina-crm'));
        }

        $this->fields->reorder($listId, $valid);
        do_action('imagina_crm/fields_reordered', $listId, $valid);
        return ValidationResult::ok();
    }

    private function nextPosition(int $listId): int
    {
        $existing = $this->fields->allForList($listId);
        if ($existing === []) {
            return 0;
        }
        $max = 0;
        foreach ($existing as $f) {
            if ($f->position > $max) {
                $max = $f->position;
            }
        }
        return $max + 1;
    }

    /**
     * Tipos de campo donde NO tiene sentido autocompletar valores
     * desde la data — o porque ya tienen options fijas (select), o
     * porque el valor es opaco (file, relation, user) o booleano
     * (checkbox).
     */
    private const NO_AUTOCOMPLETE_TYPES = [
        'select',
        'multi_select',
        'checkbox',
        'date',
        'datetime',
        'file',
        'relation',
        'user',
    ];

    /**
     * Devuelve hasta `$limit` valores distintos de un campo, ordenados
     * por frecuencia descendente, opcionalmente filtrados por LIKE
     * `$search`. Para autocomplete en filtros y conditions de
     * automatizaciones.
     *
     * Retorna `[]` si:
     * - La lista no existe o está soft-deleted.
     * - El campo no existe en esa lista.
     * - El tipo del campo no soporta autocomplete (ver
     *   `NO_AUTOCOMPLETE_TYPES`).
     *
     * @return array<int, array{value: string, count: int}>
     */
    public function distinctValues(
        int $listId,
        int $fieldId,
        ?string $search,
        int $limit,
    ): array {
        $list = $this->lists->find($listId);
        if ($list === null || $list->deletedAt !== null) {
            return [];
        }
        $field = $this->fields->find($fieldId);
        if ($field === null || $field->listId !== $listId || $field->deletedAt !== null) {
            return [];
        }
        if (in_array($field->type, self::NO_AUTOCOMPLETE_TYPES, true)) {
            return [];
        }
        return $this->records->getDistinctValues(
            $list->tableSuffix,
            $field->columnName,
            $search,
            $limit,
        );
    }
}
