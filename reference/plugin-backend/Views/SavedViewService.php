<?php
declare(strict_types=1);

namespace ImaginaCRM\Views;

use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Support\ValidationResult;

/**
 * Casos de uso de Saved Views.
 *
 * Tipos soportados:
 * - `table` (Fase 1): vista tabla con filtros, sort, columnas visibles.
 * - `kanban` (Fase 4): tablero agrupado por un campo `select`. Requiere
 *   `config.group_by_field_id`. Las columnas se derivan de las options
 *   del campo en runtime (se reflejan cambios sin reconfigurar la vista).
 * - `calendar` (Fase 4): calendario mensual donde cada record aparece
 *   en el día de su `config.date_field_id` (debe ser tipo `date` o
 *   `datetime`).
 * - `cards` (Fase 12): grid de tarjetas. Cada tarjeta muestra el
 *   primary field como título + N fields configurados +
 *   opcionalmente una imagen de portada desde un field `file`.
 *   No requiere config obligatoria; vacío = solo primary field.
 *
 * `is_default` se asegura único por lista a nivel service: setear una nueva
 * default desmarca la anterior.
 */
final class SavedViewService
{
    public const ALLOWED_TYPES = ['table', 'kanban', 'calendar', 'cards'];

    public function __construct(
        private readonly SavedViewRepository $repo,
        private readonly ListRepository $lists,
        private readonly FieldRepository $fields,
    ) {
    }

    /**
     * @return array<int, SavedViewEntity>
     */
    public function allForList(int $listId): array
    {
        return $this->repo->allForList($listId);
    }

    public function find(int $listId, int $viewId): ?SavedViewEntity
    {
        $view = $this->repo->find($viewId);
        if ($view === null || $view->listId !== $listId) {
            return null;
        }
        return $view;
    }

    /**
     * @param array<string, mixed> $input
     */
    public function create(int $listId, array $input): SavedViewEntity|ValidationResult
    {
        if ($this->lists->find($listId) === null) {
            return ValidationResult::failWith('list_id', __('La lista no existe.', 'imagina-crm'));
        }

        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '') {
            return ValidationResult::failWith('name', __('El nombre es obligatorio.', 'imagina-crm'));
        }

        $type = (string) ($input['type'] ?? 'table');
        if (! in_array($type, self::ALLOWED_TYPES, true)) {
            return ValidationResult::failWith('type', __('Tipo de vista no soportado.', 'imagina-crm'));
        }

        $config = is_array($input['config'] ?? null) ? $input['config'] : [];

        $configCheck = $this->validateConfigForType($listId, $type, $config);
        if ($configCheck instanceof ValidationResult) {
            return $configCheck;
        }

        $isDefault = ! empty($input['is_default']);
        $now       = current_time('mysql', true);

        $id = $this->repo->insert([
            'list_id'    => $listId,
            'user_id'    => get_current_user_id(),
            'name'       => $name,
            'type'       => $type,
            'config'     => $config,
            'is_default' => $isDefault,
            'position'   => isset($input['position']) ? (int) $input['position'] : 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        if ($id === 0) {
            return ValidationResult::failWith('database', __('No se pudo crear la vista.', 'imagina-crm'));
        }

        if ($isDefault) {
            $this->repo->setDefault($listId, $id);
        }

        $created = $this->repo->find($id);
        if ($created === null) {
            return ValidationResult::failWith('database', __('La vista se creó pero no se pudo leer.', 'imagina-crm'));
        }

        do_action('imagina_crm/view_created', $created);
        return $created;
    }

    /**
     * @param array<string, mixed> $patch
     */
    public function update(int $listId, int $viewId, array $patch): SavedViewEntity|ValidationResult
    {
        $current = $this->find($listId, $viewId);
        if ($current === null) {
            return ValidationResult::failWith('id', __('La vista no existe.', 'imagina-crm'));
        }

        $effectiveType = $current->type;
        if (isset($patch['type'])) {
            $type = (string) $patch['type'];
            if (! in_array($type, self::ALLOWED_TYPES, true)) {
                return ValidationResult::failWith('type', __('Tipo de vista no soportado.', 'imagina-crm'));
            }
            $effectiveType = $type;
        }

        if (isset($patch['name'])) {
            $patch['name'] = trim((string) $patch['name']);
            if ($patch['name'] === '') {
                return ValidationResult::failWith('name', __('El nombre no puede estar vacío.', 'imagina-crm'));
            }
        }

        // Si el patch trae config (o cambió el type), revalidamos contra
        // las reglas del tipo efectivo.
        if (array_key_exists('config', $patch) || array_key_exists('type', $patch)) {
            $config = is_array($patch['config'] ?? null)
                ? $patch['config']
                : $current->config;
            $configCheck = $this->validateConfigForType($listId, $effectiveType, $config);
            if ($configCheck instanceof ValidationResult) {
                return $configCheck;
            }
        }

        $ok = $this->repo->update($viewId, $patch);
        if (! $ok) {
            return ValidationResult::failWith('database', __('No se pudo actualizar la vista.', 'imagina-crm'));
        }

        if (array_key_exists('is_default', $patch) && ! empty($patch['is_default'])) {
            $this->repo->setDefault($listId, $viewId);
        }

        $updated = $this->repo->find($viewId);
        if ($updated === null) {
            return ValidationResult::failWith('database', __('No se pudo releer la vista.', 'imagina-crm'));
        }

        do_action('imagina_crm/view_updated', $updated, $current);
        return $updated;
    }

    public function delete(int $listId, int $viewId): ValidationResult
    {
        $current = $this->find($listId, $viewId);
        if ($current === null) {
            return ValidationResult::failWith('id', __('La vista no existe.', 'imagina-crm'));
        }

        $ok = $this->repo->delete($viewId);
        if (! $ok) {
            return ValidationResult::failWith('database', __('No se pudo eliminar la vista.', 'imagina-crm'));
        }

        do_action('imagina_crm/view_deleted', $current);
        return ValidationResult::ok();
    }

    /**
     * Reglas específicas por tipo de vista.
     *
     * - `table`: cualquier config aplica (filtros, sort, columnas).
     * - `kanban`: requiere `group_by_field_id` apuntando a un campo
     *   `select` de la misma lista. Sin esa garantía la UI no puede
     *   construir columnas.
     *
     * @param array<string, mixed> $config
     */
    private function validateConfigForType(int $listId, string $type, array $config): ?ValidationResult
    {
        if ($type === 'kanban') {
            $groupBy = isset($config['group_by_field_id']) ? (int) $config['group_by_field_id'] : 0;
            if ($groupBy <= 0) {
                return ValidationResult::failWith(
                    'config.group_by_field_id',
                    __('La vista Kanban requiere un campo de agrupación.', 'imagina-crm'),
                );
            }
            $field = $this->fields->find($groupBy);
            if ($field === null || $field->listId !== $listId) {
                return ValidationResult::failWith(
                    'config.group_by_field_id',
                    __('El campo de agrupación no pertenece a esta lista.', 'imagina-crm'),
                );
            }
            if ($field->type !== 'select') {
                return ValidationResult::failWith(
                    'config.group_by_field_id',
                    __('La vista Kanban sólo soporta agrupar por campos tipo Select.', 'imagina-crm'),
                );
            }
        }

        if ($type === 'calendar') {
            $dateFieldId = isset($config['date_field_id']) ? (int) $config['date_field_id'] : 0;
            if ($dateFieldId <= 0) {
                return ValidationResult::failWith(
                    'config.date_field_id',
                    __('La vista Calendar requiere un campo de fecha.', 'imagina-crm'),
                );
            }
            $field = $this->fields->find($dateFieldId);
            if ($field === null || $field->listId !== $listId) {
                return ValidationResult::failWith(
                    'config.date_field_id',
                    __('El campo de fecha no pertenece a esta lista.', 'imagina-crm'),
                );
            }
            if ($field->type !== 'date' && $field->type !== 'datetime') {
                return ValidationResult::failWith(
                    'config.date_field_id',
                    __('La vista Calendar requiere un campo tipo Date o DateTime.', 'imagina-crm'),
                );
            }
        }

        if ($type === 'cards') {
            // card_field_ids: opcional. Si viene, valida que sean ints y pertenezcan a la lista.
            if (isset($config['card_field_ids'])) {
                if (! is_array($config['card_field_ids'])) {
                    return ValidationResult::failWith(
                        'config.card_field_ids',
                        __('card_field_ids debe ser un array.', 'imagina-crm'),
                    );
                }
                foreach ($config['card_field_ids'] as $fid) {
                    $fid = (int) $fid;
                    if ($fid <= 0) continue;
                    $field = $this->fields->find($fid);
                    if ($field === null || $field->listId !== $listId) {
                        return ValidationResult::failWith(
                            'config.card_field_ids',
                            __('Uno de los campos no pertenece a esta lista.', 'imagina-crm'),
                        );
                    }
                }
            }
            // card_cover_field_id: opcional. Si viene, debe ser tipo file.
            if (isset($config['card_cover_field_id'])) {
                $coverId = (int) $config['card_cover_field_id'];
                if ($coverId > 0) {
                    $cover = $this->fields->find($coverId);
                    if ($cover === null || $cover->listId !== $listId) {
                        return ValidationResult::failWith(
                            'config.card_cover_field_id',
                            __('El campo de portada no pertenece a esta lista.', 'imagina-crm'),
                        );
                    }
                    if ($cover->type !== 'file') {
                        return ValidationResult::failWith(
                            'config.card_cover_field_id',
                            __('El campo de portada debe ser de tipo File.', 'imagina-crm'),
                        );
                    }
                }
            }
            // card_size: opcional. Si viene, debe ser uno de los tres.
            if (isset($config['card_size'])) {
                $size = (string) $config['card_size'];
                if (! in_array($size, ['compact', 'comfortable', 'spacious'], true)) {
                    return ValidationResult::failWith(
                        'config.card_size',
                        __('card_size debe ser compact, comfortable o spacious.', 'imagina-crm'),
                    );
                }
            }
        }

        return null;
    }
}
