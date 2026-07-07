<?php
declare(strict_types=1);

namespace ImaginaCRM\Lists;

use ImaginaCRM\Support\RenameResult;
use ImaginaCRM\Support\SlugContext;
use ImaginaCRM\Support\ValidationResult;

/**
 * Casos de uso de listas.
 *
 * Orquesta `SlugManager`, `SchemaManager` y `ListRepository`. Mantiene la
 * regla de oro: el slug es etiqueta editable; `table_suffix` se decide una
 * sola vez y nunca cambia.
 */
final class ListService
{
    public function __construct(
        private readonly ListRepository $repo,
        private readonly SlugManager $slugs,
        private readonly SchemaManager $schema,
    ) {
    }

    /**
     * Resuelve por id (numérico) o por slug actual. Si el slug recibido es
     * antiguo, intenta seguirlo en el historial vía `SlugManager`.
     */
    public function findByIdOrSlug(string $idOrSlug): ?ListEntity
    {
        if (ctype_digit($idOrSlug)) {
            return $this->repo->find((int) $idOrSlug);
        }

        $direct = $this->repo->findBySlug($idOrSlug);
        if ($direct !== null) {
            return $direct;
        }

        $resolved = $this->slugs->resolveCurrentSlug(SlugContext::List_, $idOrSlug);
        if ($resolved === null) {
            return null;
        }

        return $this->repo->findBySlug($resolved);
    }

    /**
     * @return array<int, ListEntity>
     */
    public function all(): array
    {
        return $this->repo->all();
    }

    /**
     * Crea una lista. Si no se pasa `slug`, se deriva del `name`.
     *
     * Devuelve `ListEntity` en éxito o `ValidationResult` con errores.
     *
     * @param array<string, mixed> $input Debe contener al menos `name` (string).
     */
    public function create(array $input): ListEntity|ValidationResult
    {
        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '') {
            return ValidationResult::failWith('name', __('El nombre es obligatorio.', 'imagina-crm'));
        }

        $slugInput = isset($input['slug']) ? (string) $input['slug'] : '';
        $slug      = $slugInput !== ''
            ? strtolower($slugInput)
            : $this->slugs->slugify($name);

        $settings = isset($input['settings']) && is_array($input['settings'])
            ? $input['settings']
            : [];

        $validation = $this->slugs->validate($slug, SlugContext::List_);
        if (! $validation->isValid()) {
            return $validation;
        }

        $tableSuffix = $this->slugs->generateUnique($slug, 'table_suffix');
        $now         = current_time('mysql', true);

        $id = $this->repo->insert([
            'slug'         => $slug,
            'table_suffix' => $tableSuffix,
            'name'         => $name,
            'description'  => $input['description'] ?? null,
            'icon'         => $input['icon'] ?? null,
            'color'        => $input['color'] ?? null,
            'settings'     => $settings,
            'position'     => 0,
            'created_by'   => get_current_user_id(),
            'created_at'   => $now,
            'updated_at'   => $now,
        ]);

        if ($id === 0) {
            return ValidationResult::failWith('database', __('No se pudo guardar la lista.', 'imagina-crm'));
        }

        // Una vez insertada la lista, materializamos su tabla dinámica.
        // Si esto falla, hacemos rollback del insert para no dejar estado
        // inconsistente.
        try {
            $this->schema->createDataTable($tableSuffix);
        } catch (\Throwable $e) {
            $this->repo->softDelete($id);
            return ValidationResult::failWith(
                'schema',
                sprintf(
                    /* translators: %s: error message */
                    __('No se pudo crear la tabla de datos: %s', 'imagina-crm'),
                    $e->getMessage()
                )
            );
        }

        $created = $this->repo->find($id);
        if ($created === null) {
            return ValidationResult::failWith('database', __('La lista se creó pero no se pudo leer.', 'imagina-crm'));
        }

        do_action('imagina_crm/list_created', $created);

        return $created;
    }

    /**
     * Actualiza metadatos de una lista. El cambio de slug se maneja por
     * separado en `renameSlug()` para que el flujo de validación,
     * historial y respuesta sean explícitos.
     *
     * @param array<string, mixed> $patch
     *
     * @return ListEntity|ValidationResult
     */
    public function update(int $id, array $patch): ListEntity|ValidationResult
    {
        $current = $this->repo->find($id);
        if ($current === null) {
            return ValidationResult::failWith('id', __('La lista no existe.', 'imagina-crm'));
        }

        if (isset($patch['name'])) {
            $patch['name'] = trim((string) $patch['name']);
            if ($patch['name'] === '') {
                return ValidationResult::failWith('name', __('El nombre no puede estar vacío.', 'imagina-crm'));
            }
        }

        $ok = $this->repo->update($id, $patch);
        if (! $ok) {
            return ValidationResult::failWith('database', __('No se pudo actualizar la lista.', 'imagina-crm'));
        }

        $updated = $this->repo->find($id);
        if ($updated === null) {
            return ValidationResult::failWith('database', __('No se pudo releer la lista.', 'imagina-crm'));
        }

        do_action('imagina_crm/list_updated', $updated, $current);
        return $updated;
    }

    public function renameSlug(int $id, string $newSlug): RenameResult
    {
        $result = $this->slugs->rename(SlugContext::List_, $id, $newSlug);

        if ($result->success) {
            do_action('imagina_crm/list_slug_renamed', $id, $result->oldSlug, $result->newSlug);
        }

        return $result;
    }

    /**
     * Elimina la lista. Por defecto es soft-delete: la fila queda con
     * `deleted_at`, la tabla dinámica se conserva (ADR-007). Si se pasa
     * `purge: true`, se hace hard-delete real + DROP TABLE.
     */
    public function delete(int $id, bool $purge = false): ValidationResult
    {
        $current = $this->repo->find($id);
        if ($current === null) {
            return ValidationResult::failWith('id', __('La lista no existe.', 'imagina-crm'));
        }

        $ok = $this->repo->softDelete($id);
        if (! $ok) {
            return ValidationResult::failWith('database', __('No se pudo eliminar la lista.', 'imagina-crm'));
        }

        if ($purge) {
            try {
                $this->schema->dropDataTable($current->tableSuffix);
            } catch (\Throwable $e) {
                return ValidationResult::failWith(
                    'schema',
                    sprintf(
                        /* translators: %s: error message */
                        __('La lista se marcó como eliminada pero la tabla de datos no se pudo eliminar: %s', 'imagina-crm'),
                        $e->getMessage()
                    )
                );
            }
        }

        do_action('imagina_crm/list_deleted', $current, $purge);
        return ValidationResult::ok();
    }
}
