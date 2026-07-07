<?php
declare(strict_types=1);

namespace ImaginaCRM\Permissions;

/**
 * Value object inmutable que representa el ACL de una lista
 * (`wp_imcrm_lists.settings.permissions` + `settings.assignment_field_id`).
 *
 * El shape persistido es:
 * ```
 * {
 *   "permissions": {
 *     "crm_manager": { "view": "all",  "create": true,  "edit": "all",  "delete": "all",  "fields_hidden": [] },
 *     "crm_agent":   { "view": "own",  "create": true,  "edit": "own",  "delete": "none", "fields_hidden": [] },
 *     "crm_viewer":  { "view": "all",  "create": false, "edit": "none", "delete": "none", "fields_hidden": [] }
 *   },
 *   "assignment_field_id": 42
 * }
 * ```
 *
 * Los roles del plugin (`crm_admin`/`administrator`) que no aparecen en
 * `permissions` se tratan como bypass total — el PermissionService los
 * resuelve sin consultar este shape.
 *
 * Ver `docs/multi-stakeholder-design.md` §1.3 y §1.4.
 */
final class ListPermissions
{
    public const SCOPE_ALL      = 'all';
    public const SCOPE_OWN      = 'own';
    public const SCOPE_ASSIGNED = 'assigned';
    public const SCOPE_NONE     = 'none';

    /** Orden de permisividad: a mayor número, más permisivo. */
    public const SCOPE_RANK = [
        self::SCOPE_NONE     => 0,
        self::SCOPE_OWN      => 1,
        self::SCOPE_ASSIGNED => 2,
        self::SCOPE_ALL      => 3,
    ];

    public const OPS = ['view', 'edit', 'delete'];

    /**
     * @param array<string, array{view: string, create: bool, edit: string, delete: string, fields_hidden: list<string>}> $byRole
     */
    private function __construct(
        public readonly array $byRole,
        public readonly ?int $assignmentFieldId,
    ) {
    }

    /**
     * Parsea `settings` de una lista al value object. Acepta input parcial:
     * los campos faltantes se completan con defaults seguros (`none`/false).
     *
     * @param array<string, mixed> $settings
     */
    public static function fromListSettings(array $settings): self
    {
        $raw = $settings['permissions'] ?? null;
        $assignmentFieldId = isset($settings['assignment_field_id']) && is_numeric($settings['assignment_field_id'])
            ? (int) $settings['assignment_field_id']
            : null;

        if (! is_array($raw) || $raw === []) {
            return new self([], $assignmentFieldId);
        }

        $byRole = [];
        foreach ($raw as $roleSlug => $config) {
            if (! is_string($roleSlug) || $roleSlug === '' || ! is_array($config)) {
                continue;
            }
            $byRole[$roleSlug] = [
                'view'          => self::normalizeScope($config['view'] ?? null),
                'create'        => (bool) ($config['create'] ?? false),
                'edit'          => self::normalizeScope($config['edit'] ?? null),
                'delete'        => self::normalizeScope($config['delete'] ?? null),
                'fields_hidden' => self::normalizeFieldsHidden($config['fields_hidden'] ?? []),
            ];
        }

        return new self($byRole, $assignmentFieldId);
    }

    /**
     * Construye el shape canónico para persistir en `settings.permissions`.
     *
     * @return array<string, array{view: string, create: bool, edit: string, delete: string, fields_hidden: list<string>}>
     */
    public function toArray(): array
    {
        return $this->byRole;
    }

    /**
     * Devuelve los defaults aplicables a una lista que NO tiene la clave
     * `permissions` en su settings. Estrategia: máximo conservadurismo —
     * solo `crm_admin` (que de todas formas tiene bypass via cap global)
     * y `administrator` (idem) verían algo. Manager/Agent/Viewer = `none`
     * en todo.
     *
     * Si se quiere abrir la lista a más roles, el admin debe editarlo
     * desde el List Builder.
     *
     * @return array<string, array{view: string, create: bool, edit: string, delete: string, fields_hidden: list<string>}>
     */
    public static function legacyDefaults(): array
    {
        $closed = [
            'view'          => self::SCOPE_NONE,
            'create'        => false,
            'edit'          => self::SCOPE_NONE,
            'delete'        => self::SCOPE_NONE,
            'fields_hidden' => [],
        ];

        return [
            CapabilityRegistry::ROLE_MANAGER => $closed,
            CapabilityRegistry::ROLE_AGENT   => $closed,
            CapabilityRegistry::ROLE_VIEWER  => $closed,
        ];
    }

    /**
     * Devuelve la entrada del ACL para un rol, aplicando defaults si la
     * lista no tiene `permissions` set o si el rol no figura.
     *
     * Para `crm_admin`: bypass total (siempre `all`/true).
     *
     * @return array{view: string, create: bool, edit: string, delete: string, fields_hidden: list<string>}
     */
    public function forRole(string $roleSlug): array
    {
        if ($roleSlug === CapabilityRegistry::ROLE_ADMIN || $roleSlug === 'administrator') {
            return [
                'view'          => self::SCOPE_ALL,
                'create'        => true,
                'edit'          => self::SCOPE_ALL,
                'delete'        => self::SCOPE_ALL,
                'fields_hidden' => [],
            ];
        }

        if (isset($this->byRole[$roleSlug])) {
            return $this->byRole[$roleSlug];
        }

        // Sin entrada: fallback a defaults legacy si los hay, sino `none`.
        $defaults = self::legacyDefaults();
        return $defaults[$roleSlug] ?? [
            'view'          => self::SCOPE_NONE,
            'create'        => false,
            'edit'          => self::SCOPE_NONE,
            'delete'        => self::SCOPE_NONE,
            'fields_hidden' => [],
        ];
    }

    /**
     * Combina dos scopes y devuelve el más permisivo. Usado al evaluar a
     * un usuario que tiene varios roles.
     */
    public static function mergeScopes(string $a, string $b): string
    {
        $rankA = self::SCOPE_RANK[$a] ?? 0;
        $rankB = self::SCOPE_RANK[$b] ?? 0;
        return $rankA >= $rankB ? $a : $b;
    }

    /**
     * Normaliza un valor cualquiera a un scope válido. Cualquier valor
     * desconocido cae a `none` (fail-closed).
     */
    public static function normalizeScope(mixed $value): string
    {
        if (! is_string($value)) {
            return self::SCOPE_NONE;
        }
        $value = strtolower(trim($value));
        return match ($value) {
            self::SCOPE_ALL      => self::SCOPE_ALL,
            self::SCOPE_OWN      => self::SCOPE_OWN,
            self::SCOPE_ASSIGNED => self::SCOPE_ASSIGNED,
            default              => self::SCOPE_NONE,
        };
    }

    /**
     * @param mixed $value
     * @return list<string>
     */
    private static function normalizeFieldsHidden(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }
        $out = [];
        foreach ($value as $item) {
            if (is_string($item) && $item !== '') {
                $out[] = $item;
            }
        }
        return array_values(array_unique($out));
    }
}
