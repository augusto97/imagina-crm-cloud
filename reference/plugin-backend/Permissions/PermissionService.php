<?php
declare(strict_types=1);

namespace ImaginaCRM\Permissions;

use Closure;
use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListEntity;
use WP_User;

/**
 * Centraliza las decisiones de autorización del plugin.
 *
 * Combina:
 *  - **Capabilities globales** (registradas en `CapabilityRegistry`): definen
 *    QUÉ puede hacer cada rol a nivel plugin.
 *  - **ACL por lista** (`wp_imcrm_lists.settings.permissions`): restringe
 *    el acceso a una lista concreta y define el scope de records
 *    (`all`/`own`/`assigned`/`none`).
 *
 * Reglas de oro:
 *  1. `administrator` y `crm_admin` siempre tienen bypass total.
 *  2. Operaciones de schema (crear/editar lista/campos/automations) NO se
 *     restringen por ACL — solo por la cap global correspondiente.
 *  3. Operaciones sobre records SÍ se restringen por ACL + cap global.
 *  4. Si el user tiene múltiples roles, se toma el scope MÁS PERMISIVO.
 *  5. Fail-closed: si el shape no se entiende, asumimos `none`.
 *
 * Las decisiones aquí toman SIEMPRE como input la `ListEntity` cargada y
 * (cuando aplica) el record como array. No se consulta la BD desde aquí:
 * eso permite tests rápidos sin MySQL real y deja a los controllers el
 * control de batching/loading.
 *
 * Para `recordsScopeWhere()`, devolvemos un fragmento SQL ya preparado
 * con placeholders + args que el `QueryBuilder` inyecta como cláusula
 * adicional al WHERE final.
 */
final class PermissionService
{
    /** @var Closure(int): ?FieldEntity */
    private readonly Closure $resolveField;

    /**
     * Acepta el `FieldRepository` real (caso producción) o, para tests,
     * un closure que resuelva field-id → FieldEntity sin tocar BD.
     *
     * @param FieldRepository|Closure(int): ?FieldEntity $fields
     */
    public function __construct(FieldRepository|Closure $fields)
    {
        if ($fields instanceof FieldRepository) {
            $this->resolveField = static fn (int $id): ?FieldEntity => $fields->find($id);
        } else {
            $this->resolveField = $fields;
        }
    }

    // ───────────────────────────────────────────────────────────────────
    //  Bypass / acceso al SPA
    // ───────────────────────────────────────────────────────────────────

    public function userCanAccessAdmin(WP_User $user): bool
    {
        return user_can($user, CapabilityRegistry::CAP_ACCESS_ADMIN);
    }

    /**
     * `true` si el user es admin "total" del plugin: rol `administrator`
     * (WP nativo) o `crm_admin`, o si tiene la cap `imcrm_manage_lists`
     * (umbrella de schema). Estos usuarios saltan todos los ACL.
     */
    public function userIsPluginAdmin(WP_User $user): bool
    {
        if (in_array('administrator', $user->roles, true)) {
            return true;
        }
        if (in_array(CapabilityRegistry::ROLE_ADMIN, $user->roles, true)) {
            return true;
        }
        return user_can($user, CapabilityRegistry::CAP_MANAGE_LISTS);
    }

    // ───────────────────────────────────────────────────────────────────
    //  Schema (listas, campos, automatizaciones, dashboards, vistas)
    // ───────────────────────────────────────────────────────────────────

    public function userCanManageLists(WP_User $user): bool
    {
        return user_can($user, CapabilityRegistry::CAP_MANAGE_LISTS);
    }

    public function userCanManageFields(WP_User $user): bool
    {
        return user_can($user, CapabilityRegistry::CAP_MANAGE_FIELDS)
            || user_can($user, CapabilityRegistry::CAP_MANAGE_LISTS);
    }

    public function userCanManageViews(WP_User $user): bool
    {
        return user_can($user, CapabilityRegistry::CAP_MANAGE_VIEWS)
            || user_can($user, CapabilityRegistry::CAP_MANAGE_LISTS);
    }

    public function userCanManageAutomations(WP_User $user): bool
    {
        return user_can($user, CapabilityRegistry::CAP_MANAGE_AUTOMATIONS);
    }

    public function userCanManageDashboards(WP_User $user): bool
    {
        return user_can($user, CapabilityRegistry::CAP_MANAGE_DASHBOARDS);
    }

    // ───────────────────────────────────────────────────────────────────
    //  Listas — visibilidad + creación
    // ───────────────────────────────────────────────────────────────────

    /**
     * `true` si la lista debe aparecer en el sidebar / GET /lists del user.
     * Es la combinación más permisiva entre todos los roles del user.
     */
    public function userCanSeeList(WP_User $user, ListEntity $list): bool
    {
        if ($this->userIsPluginAdmin($user)) {
            return true;
        }
        return $this->effectiveScope($user, $list, 'view') !== ListPermissions::SCOPE_NONE;
    }

    public function userCanCreateInList(WP_User $user, ListEntity $list): bool
    {
        if ($this->userIsPluginAdmin($user)) {
            return true;
        }
        if (! user_can($user, CapabilityRegistry::CAP_CREATE_RECORDS)) {
            return false;
        }
        return $this->effectiveCreate($user, $list);
    }

    // ───────────────────────────────────────────────────────────────────
    //  Records — view / edit / delete por record
    // ───────────────────────────────────────────────────────────────────

    /**
     * @param array<string, mixed> $record  Row del record con al menos `id` y `created_by`.
     */
    public function userCanViewRecord(WP_User $user, ListEntity $list, array $record): bool
    {
        if ($this->userIsPluginAdmin($user)) {
            return true;
        }
        if (
            ! user_can($user, CapabilityRegistry::CAP_VIEW_RECORDS)
            && ! user_can($user, CapabilityRegistry::CAP_VIEW_OWN_RECORDS)
        ) {
            return false;
        }
        $scope = $this->effectiveScope($user, $list, 'view');
        return $this->recordMatchesScope($scope, $user, $list, $record);
    }

    /**
     * @param array<string, mixed> $record
     */
    public function userCanEditRecord(WP_User $user, ListEntity $list, array $record): bool
    {
        if ($this->userIsPluginAdmin($user)) {
            return true;
        }
        if (
            ! user_can($user, CapabilityRegistry::CAP_EDIT_RECORDS)
            && ! user_can($user, CapabilityRegistry::CAP_EDIT_OWN_RECORDS)
        ) {
            return false;
        }
        $scope = $this->effectiveScope($user, $list, 'edit');
        return $this->recordMatchesScope($scope, $user, $list, $record);
    }

    /**
     * @param array<string, mixed> $record
     */
    public function userCanDeleteRecord(WP_User $user, ListEntity $list, array $record): bool
    {
        if ($this->userIsPluginAdmin($user)) {
            return true;
        }
        if (
            ! user_can($user, CapabilityRegistry::CAP_DELETE_RECORDS)
            && ! user_can($user, CapabilityRegistry::CAP_DELETE_OWN_RECORDS)
        ) {
            return false;
        }
        $scope = $this->effectiveScope($user, $list, 'delete');
        return $this->recordMatchesScope($scope, $user, $list, $record);
    }

    // ───────────────────────────────────────────────────────────────────
    //  Query-level scope para listados
    // ───────────────────────────────────────────────────────────────────

    /**
     * Devuelve la cláusula SQL a inyectar al WHERE de GET /records para
     * filtrar a lo que el user tiene permitido VER.
     *
     * Shape:
     *  - `{sql: "", args: []}` → sin filtro adicional (puede ver todo).
     *  - `{sql: "AND `r`.`created_by` = %d", args: [123]}` → scope `own`.
     *  - `{sql: "AND `r`.`assigned_to_col` = %d", args: [123]}` → scope `assigned`.
     *  - `{sql: "AND 1=0", args: []}` → scope `none` (no ve nada).
     *
     * @return array{sql: string, args: list<mixed>}
     */
    public function recordsScopeWhere(WP_User $user, ListEntity $list, string $tableAlias = ''): array
    {
        if ($this->userIsPluginAdmin($user)) {
            return ['sql' => '', 'args' => []];
        }

        $scope = $this->effectiveScope($user, $list, 'view');
        return $this->buildScopeSql($scope, $user, $list, $tableAlias);
    }

    /**
     * Slugs de fields que el usuario NO puede ver en esta lista. Se calcula
     * tomando la intersección (los fields que TODOS sus roles ocultan) —
     * si un rol revela el campo, queda visible.
     *
     * @return list<string>
     */
    public function hiddenFieldSlugs(WP_User $user, ListEntity $list): array
    {
        if ($this->userIsPluginAdmin($user)) {
            return [];
        }

        $acl = ListPermissions::fromListSettings($list->settings);
        $roles = $user->roles;
        if ($roles === []) {
            return [];
        }

        $hiddenByEachRole = [];
        foreach ($roles as $role) {
            $entry = $acl->forRole((string) $role);
            $hiddenByEachRole[] = $entry['fields_hidden'];
        }

        // Intersección: el campo queda oculto solo si TODOS los roles del
        // user lo ocultan. Si un rol lo revela, el user lo ve. El check
        // `$roles === []` de arriba garantiza que $hiddenByEachRole no
        // está vacío al llegar acá.
        $intersection = array_shift($hiddenByEachRole) ?? [];
        foreach ($hiddenByEachRole as $next) {
            $intersection = array_values(array_intersect($intersection, $next));
        }
        return $intersection;
    }

    /**
     * Factory del `RecordSanitizer` con los hidden slugs pre-
     * computed para el par `(user, list)`. Centraliza el strip de
     * campos ocultos en endpoints que devuelven records, activity,
     * aggregates, exports — antes de Fase 16.A el strip vivía solo
     * en `RecordsController` y los demás endpoints filtraban
     * inconsistentemente.
     */
    public function sanitizerFor(WP_User $user, ListEntity $list): RecordSanitizer
    {
        return new RecordSanitizer($this->hiddenFieldSlugs($user, $list));
    }

    // ───────────────────────────────────────────────────────────────────
    //  Internos
    // ───────────────────────────────────────────────────────────────────

    /**
     * Operación = `view`/`edit`/`delete`. Devuelve el scope más permisivo
     * entre todos los roles del user.
     */
    private function effectiveScope(WP_User $user, ListEntity $list, string $op): string
    {
        if (! in_array($op, ListPermissions::OPS, true)) {
            return ListPermissions::SCOPE_NONE;
        }

        $acl = ListPermissions::fromListSettings($list->settings);

        $best = ListPermissions::SCOPE_NONE;
        foreach ($user->roles as $role) {
            $entry = $acl->forRole((string) $role);
            $best = ListPermissions::mergeScopes($best, $entry[$op]);
        }
        return $best;
    }

    private function effectiveCreate(WP_User $user, ListEntity $list): bool
    {
        $acl = ListPermissions::fromListSettings($list->settings);
        foreach ($user->roles as $role) {
            $entry = $acl->forRole((string) $role);
            if ($entry['create']) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param array<string, mixed> $record
     */
    private function recordMatchesScope(string $scope, WP_User $user, ListEntity $list, array $record): bool
    {
        if ($scope === ListPermissions::SCOPE_ALL) {
            return true;
        }
        if ($scope === ListPermissions::SCOPE_NONE) {
            return false;
        }
        if ($scope === ListPermissions::SCOPE_OWN) {
            $createdBy = isset($record['created_by']) ? (int) $record['created_by'] : 0;
            return $createdBy !== 0 && $createdBy === (int) $user->ID;
        }
        if ($scope === ListPermissions::SCOPE_ASSIGNED) {
            $col = $this->assignmentColumnName($list);
            if ($col === null) {
                return false;
            }
            $assigned = isset($record[$col]) ? (int) $record[$col] : 0;
            return $assigned !== 0 && $assigned === (int) $user->ID;
        }
        return false;
    }

    /**
     * @return array{sql: string, args: list<mixed>}
     */
    private function buildScopeSql(string $scope, WP_User $user, ListEntity $list, string $tableAlias): array
    {
        $alias = $tableAlias === '' ? '' : '`' . str_replace('`', '', $tableAlias) . '`.';

        if ($scope === ListPermissions::SCOPE_ALL) {
            return ['sql' => '', 'args' => []];
        }
        if ($scope === ListPermissions::SCOPE_NONE) {
            return ['sql' => 'AND 1=0', 'args' => []];
        }
        if ($scope === ListPermissions::SCOPE_OWN) {
            return [
                'sql'  => 'AND ' . $alias . '`created_by` = %d',
                'args' => [(int) $user->ID],
            ];
        }
        if ($scope === ListPermissions::SCOPE_ASSIGNED) {
            $col = $this->assignmentColumnName($list);
            if ($col === null) {
                // Sin columna de asignación → comportamiento fail-closed:
                // el usuario no ve nada. Esto guía al admin a configurar
                // un assignment_field antes de elegir scope=assigned.
                return ['sql' => 'AND 1=0', 'args' => []];
            }
            return [
                'sql'  => 'AND ' . $alias . '`' . $col . '` = %d',
                'args' => [(int) $user->ID],
            ];
        }
        return ['sql' => 'AND 1=0', 'args' => []];
    }

    /**
     * Resuelve el `column_name` físico del field marcado como
     * `assignment_field_id` en `settings`. Devuelve null si el field no
     * existe o pertenece a otra lista.
     */
    private function assignmentColumnName(ListEntity $list): ?string
    {
        $fieldId = $list->settings['assignment_field_id'] ?? null;
        if (! is_numeric($fieldId) || (int) $fieldId <= 0) {
            return null;
        }
        $field = ($this->resolveField)((int) $fieldId);
        if ($field === null || $field->listId !== $list->id) {
            return null;
        }
        return $field->columnName;
    }
}
