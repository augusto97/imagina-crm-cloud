<?php
declare(strict_types=1);

namespace ImaginaCRM\Lists;

use ImaginaCRM\Support\Database;
use ImaginaCRM\Support\RenameResult;
use ImaginaCRM\Support\SlugContext;
use ImaginaCRM\Support\ValidationResult;

/**
 * Único punto de entrada para validar, generar, renombrar y resolver slugs
 * de listas y campos.
 *
 * Reglas vigentes (CLAUDE.md §7):
 *
 * - Formato: `^[a-z][a-z0-9_]{0,62}$`. Snake_case obligatorio.
 * - Reservados de listas: prefijos REST + verbos del sistema.
 * - Reservados de campos: columnas base + palabras reservadas MySQL.
 * - Unicidad: slug de lista global; slug de campo por lista.
 * - Renombrar slug NUNCA toca schema físico (`table_suffix` / `column_name`
 *   son inmutables y se generan una sola vez con `generateUnique()`).
 * - Cada rename queda registrado en `wp_imcrm_slug_history`.
 * - `resolveCurrentSlug()` permite redirigir un slug antiguo a su nuevo
 *   nombre cuando éste es único en el historial.
 */
class SlugManager
{
    public const SLUG_REGEX        = '/^[a-z][a-z0-9_]{0,62}$/';
    public const MAX_SLUG_LENGTH   = 63;
    public const PHYSICAL_MAX_LEN  = 48;

    /** @var array<int, string> */
    public const RESERVED_LIST_SLUGS = [
        'lists', 'fields', 'views', 'records', 'comments', 'activity',
        'relations', 'automations', 'settings', 'me', 'admin', 'system',
        'api', 'auth', 'licensing', 'slug-history', 'slug_history',
        'field-types', 'field_types', 'import', 'export', 'webhook', 'webhooks',
    ];

    /** @var array<int, string> */
    public const RESERVED_FIELD_SLUGS = [
        'id', 'created_at', 'updated_at', 'deleted_at', 'created_by',
    ];

    /**
     * Subconjunto representativo de palabras reservadas MySQL.
     * Mantener en orden alfabético para facilitar code review.
     *
     * @var array<int, string>
     */
    public const MYSQL_RESERVED = [
        'add', 'all', 'alter', 'analyze', 'and', 'as', 'asc', 'between',
        'by', 'call', 'case', 'cast', 'change', 'check', 'collate', 'column',
        'condition', 'constraint', 'create', 'cross', 'current_date',
        'current_time', 'current_timestamp', 'current_user', 'cursor',
        'database', 'databases', 'declare', 'default', 'delete', 'desc',
        'describe', 'distinct', 'drop', 'else', 'elseif', 'enclosed', 'end',
        'enum', 'escape', 'exists', 'explain', 'false', 'fetch', 'float',
        'for', 'foreign', 'from', 'fulltext', 'function', 'grant', 'group',
        'having', 'high_priority', 'if', 'ignore', 'in', 'index', 'inner',
        'insert', 'int', 'integer', 'interval', 'into', 'is', 'join', 'key',
        'keys', 'kill', 'leading', 'leave', 'left', 'like', 'limit', 'lines',
        'load', 'lock', 'long', 'longblob', 'longtext', 'loop', 'low_priority',
        'match', 'mediumblob', 'mediumint', 'mediumtext', 'mod', 'modifies',
        'natural', 'no', 'not', 'null', 'numeric', 'on', 'optimize', 'option',
        'or', 'order', 'out', 'outer', 'partition', 'precision', 'primary',
        'procedure', 'purge', 'range', 'read', 'real', 'references', 'rename',
        'repeat', 'replace', 'require', 'restrict', 'return', 'revoke',
        'right', 'rlike', 'schema', 'select', 'separator', 'set', 'show',
        'signal', 'smallint', 'spatial', 'sql', 'ssl', 'starting', 'table',
        'terminated', 'then', 'tinyint', 'to', 'trailing', 'trigger', 'true',
        'truncate', 'union', 'unique', 'unlock', 'unsigned', 'update', 'usage',
        'use', 'using', 'utc_date', 'utc_time', 'utc_timestamp', 'values',
        'varbinary', 'varchar', 'varying', 'when', 'where', 'while', 'with',
        'write', 'xor', 'year', 'zerofill',
    ];

    public function __construct(private readonly Database $db)
    {
    }

    /**
     * Valida solamente el formato del slug. No consulta la BD.
     */
    public function validateFormat(string $slug): ValidationResult
    {
        if ($slug === '') {
            return ValidationResult::failWith('slug', __('El slug no puede estar vacío.', 'imagina-crm'));
        }

        if (strlen($slug) > self::MAX_SLUG_LENGTH) {
            return ValidationResult::failWith(
                'slug',
                sprintf(
                    /* translators: %d: maximum length */
                    __('El slug no puede exceder %d caracteres.', 'imagina-crm'),
                    self::MAX_SLUG_LENGTH
                )
            );
        }

        if (! preg_match(self::SLUG_REGEX, $slug)) {
            return ValidationResult::failWith(
                'slug',
                __('Formato inválido. Usa snake_case: minúsculas, números y guiones bajos. Debe empezar por letra.', 'imagina-crm')
            );
        }

        return ValidationResult::ok();
    }

    /**
     * `true` si el slug está en la lista de reservados aplicable al contexto.
     */
    public function isReserved(string $slug, SlugContext $context): bool
    {
        $slug = strtolower($slug);

        if ($context === SlugContext::List_) {
            return in_array($slug, self::RESERVED_LIST_SLUGS, true)
                || in_array($slug, self::MYSQL_RESERVED, true);
        }

        return in_array($slug, self::RESERVED_FIELD_SLUGS, true)
            || in_array($slug, self::MYSQL_RESERVED, true);
    }

    /**
     * Convierte un texto libre en un slug candidato (snake_case, ASCII).
     *
     * Útil tanto para generar `table_suffix` / `column_name` desde el label
     * inicial como para sanear el primer slug propuesto al usuario en el
     * frontend (mantenemos paridad con el helper TS de `app/lib/slug.ts`).
     */
    public function slugify(string $input, int $maxLength = self::MAX_SLUG_LENGTH): string
    {
        // Normalizar a NFC (forma precomposed) antes de remove_accents.
        // Sin esto, inputs con caracteres descomposed (NFD) — comunes en
        // pegados desde macOS — dejan combining marks que `remove_accents`
        // no maneja y terminan como `_` en el slug. Ejemplo: "Gestión"
        // en NFD = "o" + combining acute → quedaba `gesti_n` en lugar de
        // `gestion`.
        if (class_exists('\\Normalizer')) {
            $normalized = \Normalizer::normalize($input, \Normalizer::FORM_C);
            if (is_string($normalized)) {
                $input = $normalized;
            }
        }
        $input = remove_accents($input);
        $input = strtolower($input);
        $input = preg_replace('/[^a-z0-9]+/', '_', $input) ?? '';
        $input = trim($input, '_');

        if ($input === '') {
            return '';
        }

        // El slug debe empezar por letra (regex). Si arranca con dígito, prefijar.
        if (! preg_match('/^[a-z]/', $input)) {
            $input = 'l_' . $input;
        }

        if (strlen($input) > $maxLength) {
            $input = substr($input, 0, $maxLength);
            $input = rtrim($input, '_');
        }

        return $input;
    }

    /**
     * Valida un slug completo (formato + reservados + unicidad).
     *
     * @param int|null $listId    Requerido para `SlugContext::Field`.
     * @param int|null $excludeId ID a excluir de la unicidad (caso "edición").
     */
    public function validate(
        string $slug,
        SlugContext $context,
        ?int $listId = null,
        ?int $excludeId = null,
    ): ValidationResult {
        $format = $this->validateFormat($slug);
        if (! $format->isValid()) {
            return $format;
        }

        if ($this->isReserved($slug, $context)) {
            return ValidationResult::failWith(
                'slug',
                __('Ese slug está reservado por el sistema. Elige otro.', 'imagina-crm')
            );
        }

        if ($context === SlugContext::Field && $listId === null) {
            return ValidationResult::failWith(
                'list_id',
                __('Falta el list_id para validar el slug de un campo.', 'imagina-crm')
            );
        }

        if ($this->slugInUse($slug, $context, $listId, $excludeId)) {
            return ValidationResult::failWith(
                'slug',
                __('Ya existe otra entidad con ese slug.', 'imagina-crm')
            );
        }

        return ValidationResult::ok();
    }

    /**
     * Genera un identificador único para uso interno.
     *
     * Para `table_suffix` (listas) o `column_name` (campos) — los nombres
     * físicos inmutables. Si el base ya está tomado, sufija con `_2`, `_3`, …
     *
     * @param string $type One of `table_suffix`, `column_name`.
     */
    public function generateUnique(
        string $base,
        string $type,
        ?int $listId = null,
    ): string {
        $base = $this->slugify($base, self::PHYSICAL_MAX_LEN);

        if ($base === '') {
            $base = $type === 'table_suffix' ? 'list' : 'field';
        }

        // Forzamos no colisión con reservados MySQL aunque el slugify ya filtre.
        if (in_array($base, self::MYSQL_RESERVED, true)) {
            $base .= '_x';
        }

        if (! $this->physicalNameExists($base, $type, $listId)) {
            return $base;
        }

        $n = 2;
        while (true) {
            $candidate = $this->fitWithSuffix($base, $n);
            if (! $this->physicalNameExists($candidate, $type, $listId)) {
                return $candidate;
            }
            ++$n;
            if ($n > 9999) {
                throw new \RuntimeException('No se pudo generar un identificador físico único.');
            }
        }
    }

    /**
     * Aplica un nuevo slug a una entidad existente. NO toca schema físico.
     *
     * Devuelve `RenameResult::unchanged()` si el slug es idéntico al actual
     * (no genera entrada en historial). En caso de éxito real, escribe en
     * `wp_imcrm_slug_history`.
     */
    public function rename(
        SlugContext $context,
        int $entityId,
        string $newSlug,
        ?int $listId = null,
    ): RenameResult {
        $current = $this->getCurrentSlug($context, $entityId, $listId);

        if ($current === null) {
            return RenameResult::fail(
                ValidationResult::failWith('id', __('La entidad no existe.', 'imagina-crm'))
            );
        }

        $newSlug = strtolower(trim($newSlug));

        if ($newSlug === $current) {
            return RenameResult::unchanged($current);
        }

        $validation = $this->validate($newSlug, $context, $listId, $entityId);
        if (! $validation->isValid()) {
            return RenameResult::fail($validation);
        }

        $wpdb = $this->db->wpdb();
        $now  = current_time('mysql', true);

        if ($context === SlugContext::List_) {
            $updated = $wpdb->update(
                $this->db->systemTable('lists'),
                ['slug' => $newSlug, 'updated_at' => $now],
                ['id' => $entityId],
                ['%s', '%s'],
                ['%d']
            );
        } else {
            $updated = $wpdb->update(
                $this->db->systemTable('fields'),
                ['slug' => $newSlug, 'updated_at' => $now],
                ['id' => $entityId],
                ['%s', '%s'],
                ['%d']
            );
        }

        if ($updated === false) {
            return RenameResult::fail(
                ValidationResult::failWith('slug', __('No se pudo actualizar el slug en la base de datos.', 'imagina-crm'))
            );
        }

        $wpdb->insert(
            $this->db->systemTable('slug_history'),
            [
                'entity_type' => $context->entityType(),
                'entity_id'   => $entityId,
                'old_slug'    => $current,
                'new_slug'    => $newSlug,
                'changed_by'  => get_current_user_id(),
                'changed_at'  => $now,
            ],
            ['%s', '%d', '%s', '%s', '%d', '%s']
        );

        return RenameResult::ok($current, $newSlug);
    }

    /**
     * Resuelve un slug que el cliente envió pero que podría ser viejo.
     *
     * - Si es el slug actual de una entidad: devuelve ese mismo string.
     * - Si aparece en historial y mapea a un único slug nuevo: devuelve el nuevo.
     * - Si es ambiguo (mapea a varios) o inexistente: devuelve null.
     */
    public function resolveCurrentSlug(
        SlugContext $context,
        string $maybeOldSlug,
        ?int $listId = null,
    ): ?string {
        $maybeOldSlug = strtolower(trim($maybeOldSlug));

        if ($maybeOldSlug === '') {
            return null;
        }

        if ($this->slugInUse($maybeOldSlug, $context, $listId)) {
            return $maybeOldSlug;
        }

        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_col(
            $wpdb->prepare(
                'SELECT DISTINCT new_slug FROM ' . $this->db->systemTable('slug_history')
                . ' WHERE entity_type = %s AND old_slug = %s ORDER BY changed_at DESC LIMIT 5',
                $context->entityType(),
                $maybeOldSlug
            )
        );

        if (! is_array($rows) || count($rows) === 0) {
            return null;
        }

        // Solo redirigimos si el slug viejo apunta a UN único slug nuevo
        // que además sigue vigente. Si hay ambigüedad → null (el caller
        // devuelve 409).
        $candidates = array_values(array_unique(array_filter(array_map(
            static fn ($row) => is_string($row) ? $row : null,
            $rows
        ))));

        if (count($candidates) !== 1) {
            return null;
        }

        $current = $candidates[0];
        if ($current === null) {
            return null;
        }

        return $this->slugInUse($current, $context, $listId) ? $current : null;
    }

    /**
     * Devuelve el historial completo (más reciente primero) de cambios de
     * slug para la entidad indicada.
     *
     * @return array<int, array{old_slug: string, new_slug: string, changed_by: int, changed_at: string}>
     */
    public function getHistory(SlugContext $context, int $entityId): array
    {
        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                'SELECT old_slug, new_slug, changed_by, changed_at FROM '
                . $this->db->systemTable('slug_history')
                . ' WHERE entity_type = %s AND entity_id = %d ORDER BY changed_at DESC',
                $context->entityType(),
                $entityId
            ),
            ARRAY_A
        );

        if (! is_array($rows)) {
            return [];
        }

        return array_map(
            static fn (array $r): array => [
                'old_slug'   => (string) ($r['old_slug'] ?? ''),
                'new_slug'   => (string) ($r['new_slug'] ?? ''),
                'changed_by' => (int) ($r['changed_by'] ?? 0),
                'changed_at' => (string) ($r['changed_at'] ?? ''),
            ],
            $rows
        );
    }

    private function slugInUse(
        string $slug,
        SlugContext $context,
        ?int $listId,
        ?int $excludeId = null,
    ): bool {
        $wpdb = $this->db->wpdb();

        if ($context === SlugContext::List_) {
            $sql = 'SELECT COUNT(*) FROM ' . $this->db->systemTable('lists')
                . ' WHERE slug = %s AND deleted_at IS NULL';
            $params = [$slug];

            if ($excludeId !== null) {
                $sql .= ' AND id <> %d';
                $params[] = $excludeId;
            }

            return (int) $wpdb->get_var($wpdb->prepare($sql, ...$params)) > 0;
        }

        // Field
        $sql = 'SELECT COUNT(*) FROM ' . $this->db->systemTable('fields')
            . ' WHERE list_id = %d AND slug = %s AND deleted_at IS NULL';
        $params = [(int) $listId, $slug];

        if ($excludeId !== null) {
            $sql .= ' AND id <> %d';
            $params[] = $excludeId;
        }

        return (int) $wpdb->get_var($wpdb->prepare($sql, ...$params)) > 0;
    }

    private function physicalNameExists(string $name, string $type, ?int $listId): bool
    {
        $wpdb = $this->db->wpdb();

        if ($type === 'table_suffix') {
            return (int) $wpdb->get_var(
                $wpdb->prepare(
                    'SELECT COUNT(*) FROM ' . $this->db->systemTable('lists') . ' WHERE table_suffix = %s',
                    $name
                )
            ) > 0;
        }

        if ($type === 'column_name') {
            return (int) $wpdb->get_var(
                $wpdb->prepare(
                    'SELECT COUNT(*) FROM ' . $this->db->systemTable('fields')
                    . ' WHERE list_id = %d AND column_name = %s',
                    (int) $listId,
                    $name
                )
            ) > 0;
        }

        throw new \InvalidArgumentException('Unknown physical name type: ' . $type);
    }

    private function getCurrentSlug(SlugContext $context, int $entityId, ?int $listId): ?string
    {
        $wpdb = $this->db->wpdb();

        if ($context === SlugContext::List_) {
            $slug = $wpdb->get_var(
                $wpdb->prepare(
                    'SELECT slug FROM ' . $this->db->systemTable('lists') . ' WHERE id = %d AND deleted_at IS NULL',
                    $entityId
                )
            );
        } else {
            $slug = $wpdb->get_var(
                $wpdb->prepare(
                    'SELECT slug FROM ' . $this->db->systemTable('fields')
                    . ' WHERE id = %d AND list_id = %d AND deleted_at IS NULL',
                    $entityId,
                    (int) $listId
                )
            );
        }

        return is_string($slug) ? $slug : null;
    }

    /**
     * Asegura que `base` + `_<n>` no exceda el límite. Si el base es muy largo,
     * se trunca para hacer espacio al sufijo.
     */
    private function fitWithSuffix(string $base, int $n): string
    {
        $suffix    = '_' . $n;
        $available = self::PHYSICAL_MAX_LEN - strlen($suffix);

        if ($available < 1) {
            // Caso límite: sufijo más largo que el espacio disponible.
            return substr($suffix, -self::PHYSICAL_MAX_LEN);
        }

        $core = substr($base, 0, $available);
        $core = rtrim($core, '_');

        return $core . $suffix;
    }
}
