<?php
declare(strict_types=1);

namespace ImaginaCRM\Filters;

use ImaginaCRM\Support\ValidationResult;

/**
 * Casos de uso de filtros guardados. Validación + delegación al repo.
 *
 * Reglas:
 * - `name` requerido, ≤ 191 chars.
 * - `filter_tree` debe ser un grupo (`type === 'group'`); el resto del
 *   árbol se valida estructuralmente — el QueryBuilder ya hace
 *   fail-open ante nodos inválidos al ejecutar, así que aquí solo
 *   chequeamos forma básica.
 */
final class SavedFilterService
{
    public function __construct(private readonly SavedFilterRepository $repo)
    {
    }

    /**
     * @return array<int, SavedFilterEntity>
     */
    public function listForUser(int $listId, int $userId): array
    {
        return $this->repo->listForUser($listId, $userId);
    }

    /**
     * @param array<string, mixed> $input
     */
    public function create(int $listId, int $currentUserId, array $input): SavedFilterEntity|ValidationResult
    {
        $name = isset($input['name']) ? trim((string) $input['name']) : '';
        if ($name === '') {
            return ValidationResult::failWith('name', __('El nombre del filtro es obligatorio.', 'imagina-crm'));
        }
        if (mb_strlen($name) > 191) {
            return ValidationResult::failWith('name', __('El nombre es demasiado largo (máx. 191 caracteres).', 'imagina-crm'));
        }

        $tree = $input['filter_tree'] ?? null;
        if (! is_array($tree) || ($tree['type'] ?? '') !== 'group') {
            return ValidationResult::failWith('filter_tree', __('El árbol de filtros es inválido.', 'imagina-crm'));
        }

        $scope  = isset($input['scope']) ? (string) $input['scope'] : 'personal';
        $userId = $scope === 'shared' ? null : $currentUserId;

        $id = $this->repo->insert($listId, $userId, $name, $tree);
        if ($id <= 0) {
            return ValidationResult::failWith('database', __('No se pudo guardar el filtro.', 'imagina-crm'));
        }

        $created = $this->repo->find($id);
        if ($created === null) {
            return ValidationResult::failWith('database', __('Se guardó pero no pudo releerse.', 'imagina-crm'));
        }
        return $created;
    }

    /**
     * @param array<string, mixed> $input
     */
    public function update(int $id, int $currentUserId, array $input): SavedFilterEntity|ValidationResult
    {
        $existing = $this->repo->find($id);
        if ($existing === null) {
            return ValidationResult::failWith('id', __('El filtro no existe.', 'imagina-crm'));
        }
        // Permisos: el dueño puede editar el suyo. Filtros compartidos
        // (user_id NULL) los puede editar cualquier admin con
        // manage_options — el chequeo de cap ya lo hace el controller.
        if ($existing->userId !== null && $existing->userId !== $currentUserId) {
            return ValidationResult::failWith('id', __('No puedes editar el filtro de otro usuario.', 'imagina-crm'));
        }

        $name = null;
        if (isset($input['name'])) {
            $name = trim((string) $input['name']);
            if ($name === '') {
                return ValidationResult::failWith('name', __('El nombre no puede estar vacío.', 'imagina-crm'));
            }
        }

        $tree = null;
        if (array_key_exists('filter_tree', $input)) {
            $tree = $input['filter_tree'];
            if (! is_array($tree) || ($tree['type'] ?? '') !== 'group') {
                return ValidationResult::failWith('filter_tree', __('El árbol de filtros es inválido.', 'imagina-crm'));
            }
        }

        $this->repo->update($id, $name, $tree);

        $updated = $this->repo->find($id);
        return $updated ?? ValidationResult::failWith('database', __('Error al actualizar.', 'imagina-crm'));
    }

    public function delete(int $id, int $currentUserId): ValidationResult
    {
        $existing = $this->repo->find($id);
        if ($existing === null) {
            return ValidationResult::failWith('id', __('El filtro no existe.', 'imagina-crm'));
        }
        if ($existing->userId !== null && $existing->userId !== $currentUserId) {
            return ValidationResult::failWith('id', __('No puedes eliminar el filtro de otro usuario.', 'imagina-crm'));
        }
        $this->repo->delete($id);
        return ValidationResult::ok();
    }
}
