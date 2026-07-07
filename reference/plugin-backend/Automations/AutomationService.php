<?php
declare(strict_types=1);

namespace ImaginaCRM\Automations;

use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Support\ValidationResult;

/**
 * Casos de uso de Automatizaciones (CRUD).
 *
 * Valida que el trigger y las acciones referenciados existan en los
 * registries correspondientes antes de persistir; así evitamos crear
 * automatizaciones huérfanas que el engine no podría ejecutar.
 */
final class AutomationService
{
    public function __construct(
        private readonly AutomationRepository $repo,
        private readonly ListRepository $lists,
        private readonly TriggerRegistry $triggers,
        private readonly ActionRegistry $actions,
    ) {
    }

    /**
     * @return array<int, AutomationEntity>
     */
    public function allForList(int $listId): array
    {
        return $this->repo->allForList($listId);
    }

    /**
     * Lista todas las automatizaciones cross-list que tengan al menos
     * una action del tipo dado. Usado por el "Webhooks manager" del
     * settings (Fase 15.C).
     *
     * @return array<int, AutomationEntity>
     */
    public function allWithActionType(string $actionType): array
    {
        return $this->repo->allWithActionType($actionType);
    }

    public function find(int $id): ?AutomationEntity
    {
        return $this->repo->find($id);
    }

    /**
     * @param array<string, mixed> $input
     */
    public function create(int $listId, array $input): AutomationEntity|ValidationResult
    {
        if ($this->lists->find($listId) === null) {
            return ValidationResult::failWith('list_id', __('La lista no existe.', 'imagina-crm'));
        }

        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '') {
            return ValidationResult::failWith('name', __('El nombre es obligatorio.', 'imagina-crm'));
        }

        $triggerType = (string) ($input['trigger_type'] ?? '');
        if (! $this->triggers->has($triggerType)) {
            return ValidationResult::failWith('trigger_type', __('Tipo de trigger desconocido.', 'imagina-crm'));
        }

        $actionsValidation = $this->validateActions($input['actions'] ?? null);
        if ($actionsValidation instanceof ValidationResult) {
            return $actionsValidation;
        }

        $now = current_time('mysql', true);
        $id  = $this->repo->insert([
            'list_id'        => $listId,
            'name'           => $name,
            'description'    => $input['description'] ?? null,
            'trigger_type'   => $triggerType,
            'trigger_config' => is_array($input['trigger_config'] ?? null) ? $input['trigger_config'] : [],
            'actions'        => $actionsValidation,
            'is_active'      => array_key_exists('is_active', $input) ? (bool) $input['is_active'] : true,
            'created_by'     => get_current_user_id(),
            'created_at'     => $now,
            'updated_at'     => $now,
        ]);

        if ($id === 0) {
            return ValidationResult::failWith('database', __('No se pudo crear la automatización.', 'imagina-crm'));
        }

        $created = $this->repo->find($id);
        if ($created === null) {
            return ValidationResult::failWith('database', __('Se creó pero no se pudo leer.', 'imagina-crm'));
        }
        do_action('imagina_crm/automation_created', $created);
        return $created;
    }

    /**
     * @param array<string, mixed> $patch
     */
    public function update(int $id, array $patch): AutomationEntity|ValidationResult
    {
        $current = $this->repo->find($id);
        if ($current === null) {
            return ValidationResult::failWith('id', __('La automatización no existe.', 'imagina-crm'));
        }

        if (isset($patch['name'])) {
            $patch['name'] = trim((string) $patch['name']);
            if ($patch['name'] === '') {
                return ValidationResult::failWith('name', __('El nombre no puede estar vacío.', 'imagina-crm'));
            }
        }

        if (isset($patch['trigger_type']) && ! $this->triggers->has((string) $patch['trigger_type'])) {
            return ValidationResult::failWith('trigger_type', __('Tipo de trigger desconocido.', 'imagina-crm'));
        }

        if (array_key_exists('actions', $patch)) {
            $actionsValidation = $this->validateActions($patch['actions']);
            if ($actionsValidation instanceof ValidationResult) {
                return $actionsValidation;
            }
            $patch['actions'] = $actionsValidation;
        }

        $ok = $this->repo->update($id, $patch);
        if (! $ok) {
            return ValidationResult::failWith('database', __('No se pudo actualizar.', 'imagina-crm'));
        }

        $updated = $this->repo->find($id);
        if ($updated === null) {
            return ValidationResult::failWith('database', __('No se pudo releer.', 'imagina-crm'));
        }
        do_action('imagina_crm/automation_updated', $updated, $current);
        return $updated;
    }

    public function delete(int $id): ValidationResult
    {
        $current = $this->repo->find($id);
        if ($current === null) {
            return ValidationResult::failWith('id', __('La automatización no existe.', 'imagina-crm'));
        }
        if (! $this->repo->softDelete($id)) {
            return ValidationResult::failWith('database', __('No se pudo eliminar.', 'imagina-crm'));
        }
        do_action('imagina_crm/automation_deleted', $current);
        return ValidationResult::ok();
    }

    /**
     * Anidamiento máximo de `if_else` permitido. Cap conservador para
     * evitar configs maliciosas (ej. JSON con 1000 niveles que tumben
     * el motor en runtime). 4 niveles cubre cualquier flujo razonable.
     */
    private const MAX_IF_ELSE_DEPTH = 4;

    /**
     * Valida y normaliza el array de acciones.
     *
     * `condition` es opcional. Si se pasa debe ser objeto `{slug: valor}`
     * — mismo shape que `field_filters` del trigger. Vacío o null se
     * normaliza a no incluir la key (acción ejecuta siempre).
     *
     * Para `if_else`, se valida recursivamente `config.then_actions` y
     * `config.else_actions`, hasta `MAX_IF_ELSE_DEPTH` niveles.
     *
     * @param mixed $raw
     * @return array<int, array{type: string, config: array<string, mixed>, condition?: array<string, mixed>}>|ValidationResult
     */
    private function validateActions(mixed $raw): array|ValidationResult
    {
        $result = $this->validateActionsAtDepth($raw, 0, true);
        if ($result instanceof ValidationResult) {
            return $result;
        }
        /** @var array<int, array{type: string, config: array<string, mixed>, condition?: array<string, mixed>}> $result */
        return $result;
    }

    /**
     * @param mixed $raw
     * @return array<int, array<string, mixed>>|ValidationResult
     */
    private function validateActionsAtDepth(mixed $raw, int $depth, bool $requireNonEmpty): array|ValidationResult
    {
        if ($depth > self::MAX_IF_ELSE_DEPTH) {
            return ValidationResult::failWith(
                'actions',
                sprintf(
                    /* translators: %d: depth limit */
                    __('Anidamiento de "Si / sino" excede el límite de %d niveles.', 'imagina-crm'),
                    self::MAX_IF_ELSE_DEPTH,
                ),
            );
        }
        if (! is_array($raw)) {
            return ValidationResult::failWith('actions', __('Acciones inválidas.', 'imagina-crm'));
        }
        if ($requireNonEmpty && $raw === []) {
            return ValidationResult::failWith('actions', __('Se requiere al menos una acción.', 'imagina-crm'));
        }

        $out = [];
        foreach ($raw as $i => $item) {
            if (! is_array($item)) {
                return ValidationResult::failWith('actions', sprintf(
                    /* translators: %d: index */
                    __('Acción inválida en posición %d.', 'imagina-crm'),
                    (int) $i,
                ));
            }
            $type   = isset($item['type']) && is_string($item['type']) ? $item['type'] : '';
            $config = isset($item['config']) && is_array($item['config']) ? $item['config'] : [];
            if (! $this->actions->has($type)) {
                return ValidationResult::failWith('actions', sprintf(
                    /* translators: %s: action slug */
                    __('Tipo de acción desconocido: %s', 'imagina-crm'),
                    $type,
                ));
            }

            // Para if_else, recursamos en cada branch. Branches vacíos
            // son válidos (ej. solo then sin else).
            if ($type === 'if_else') {
                foreach (['then_actions', 'else_actions'] as $branch) {
                    $rawBranch = $config[$branch] ?? [];
                    if (! is_array($rawBranch)) {
                        return ValidationResult::failWith('actions', sprintf(
                            /* translators: 1: branch name */
                            __('Branch %1$s inválido en if_else.', 'imagina-crm'),
                            $branch,
                        ));
                    }
                    $validated = $this->validateActionsAtDepth($rawBranch, $depth + 1, false);
                    if ($validated instanceof ValidationResult) {
                        return $validated;
                    }
                    $config[$branch] = $validated;
                }

                $rawIfCondition = $config['condition'] ?? null;
                $cleanedCondition = [];
                if (is_array($rawIfCondition)) {
                    foreach ($rawIfCondition as $slug => $value) {
                        if (! is_string($slug) || $slug === '') {
                            continue;
                        }
                        $cleanedCondition[$slug] = $value;
                    }
                }
                $config['condition'] = $cleanedCondition;
            }

            $entry = ['type' => $type, 'config' => $config];

            $rawCondition = $item['condition'] ?? null;
            if (is_array($rawCondition) && $rawCondition !== []) {
                $cleaned = [];
                foreach ($rawCondition as $slug => $value) {
                    if (! is_string($slug) || $slug === '') {
                        continue;
                    }
                    $cleaned[$slug] = $value;
                }
                if ($cleaned !== []) {
                    $entry['condition'] = $cleaned;
                }
            }

            $out[] = $entry;
        }
        return $out;
    }
}
