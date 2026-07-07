<?php
declare(strict_types=1);

namespace ImaginaCRM\Lists;

use ImaginaCRM\Support\Database;

/**
 * Único punto de salida para DDL del plugin (CREATE/ALTER/DROP TABLE).
 *
 * - `installSystemTables()` corre `dbDelta` para las 7 tablas fijas.
 * - `createDataTable()` crea la tabla dinámica de una lista (sin columnas
 *   personalizadas — esas se añaden con `addColumn()` cuando el usuario
 *   crea fields).
 * - `dropDataTable()` la elimina al borrar la lista.
 *
 * Nunca se llama DDL fuera de esta clase. Los identificadores que llegan
 * aquí (table_suffix, column_name) deben venir ya sanitizados por
 * `SlugManager`. Aún así, todas las queries usan el helper interno
 * `quoteIdent()` que valida el formato `^[a-z][a-z0-9_]{0,62}$` antes de
 * envolver con backticks — defensa en profundidad.
 */
final class SchemaManager
{
    private const IDENT_REGEX = '/^[a-z][a-z0-9_]{0,62}$/';

    public function __construct(private readonly Database $db)
    {
    }

    /**
     * Crea/actualiza las 7 tablas del sistema vía `dbDelta`.
     *
     * Se llama desde `Activation\Installer::activate()`. Es idempotente:
     * `dbDelta` aplica solo los cambios necesarios.
     */
    public function installSystemTables(): void
    {
        if (! function_exists('dbDelta')) {
            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        }

        $charset = $this->db->charsetCollate();

        $statements = [
            $this->sqlLists($charset),
            $this->sqlFields($charset),
            $this->sqlSavedViews($charset),
            $this->sqlComments($charset),
            $this->sqlActivity($charset),
            $this->sqlRelations($charset),
            $this->sqlSlugHistory($charset),
            $this->sqlAutomations($charset),
            $this->sqlAutomationRuns($charset),
            $this->sqlDashboards($charset),
            $this->sqlSavedFilters($charset),
            $this->sqlRecurrences($charset),
            $this->sqlSearchTokens($charset),
            $this->sqlSearchDocuments($charset),
            $this->sqlExportJobs($charset),
        ];

        foreach ($statements as $sql) {
            dbDelta($sql);
        }
    }

    /**
     * Crea la tabla de datos para una lista recién creada.
     *
     * Sin columnas personalizadas — solo las base. Las columnas dinámicas se
     * añaden con `addColumn()` cuando se crean campos.
     */
    public function createDataTable(string $tableSuffix): void
    {
        $table   = $this->quoteIdent($this->db->dataTable($tableSuffix), allowPrefix: true);
        $charset = $this->db->charsetCollate();

        $sql = "CREATE TABLE IF NOT EXISTS {$table} (
            id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
            created_by    BIGINT UNSIGNED  NOT NULL DEFAULT 0,
            created_at    DATETIME         NOT NULL,
            updated_at    DATETIME         NOT NULL,
            deleted_at    DATETIME         NULL,
            PRIMARY KEY (id),
            KEY idx_deleted (deleted_at),
            KEY idx_created (created_at)
        ) {$charset};";

        $this->db->wpdb()->query($sql);
    }

    public function dropDataTable(string $tableSuffix): void
    {
        $table = $this->quoteIdent($this->db->dataTable($tableSuffix), allowPrefix: true);
        $this->db->wpdb()->query("DROP TABLE IF EXISTS {$table}");
    }

    public function dataTableExists(string $tableSuffix): bool
    {
        $name = $this->db->dataTable($tableSuffix);
        $found = $this->db->wpdb()->get_var(
            $this->db->wpdb()->prepare('SHOW TABLES LIKE %s', $name)
        );
        return $found === $name;
    }

    /**
     * Añade una columna a la tabla dinámica de la lista.
     *
     * `$sqlDefinition` debe venir del FieldType correspondiente (ej.
     * `VARCHAR(255) NULL`). El `columnName` debe haber pasado por
     * `SlugManager::generateUnique()`. Si el tipo no materializa columna
     * (relation), no llamar a este método.
     */
    public function addColumn(string $tableSuffix, string $columnName, string $sqlDefinition): void
    {
        if (trim($sqlDefinition) === '') {
            throw new \InvalidArgumentException('Empty SQL definition for column ' . $columnName);
        }

        $table  = $this->quoteIdent($this->db->dataTable($tableSuffix), allowPrefix: true);
        $column = $this->quoteIdent($columnName);

        $this->db->wpdb()->query("ALTER TABLE {$table} ADD COLUMN {$column} " . $this->normalizeDefinition($sqlDefinition));
    }

    /**
     * Cambia el tipo SQL de una columna existente. Útil cuando el usuario
     * cambia config (ej. max_length de un text). El `columnName` no cambia.
     */
    public function alterColumn(string $tableSuffix, string $columnName, string $sqlDefinition): void
    {
        if (trim($sqlDefinition) === '') {
            throw new \InvalidArgumentException('Empty SQL definition for column ' . $columnName);
        }

        $table  = $this->quoteIdent($this->db->dataTable($tableSuffix), allowPrefix: true);
        $column = $this->quoteIdent($columnName);

        $this->db->wpdb()->query("ALTER TABLE {$table} MODIFY COLUMN {$column} " . $this->normalizeDefinition($sqlDefinition));
    }

    public function dropColumn(string $tableSuffix, string $columnName): void
    {
        $table  = $this->quoteIdent($this->db->dataTable($tableSuffix), allowPrefix: true);
        $column = $this->quoteIdent($columnName);

        $this->db->wpdb()->query("ALTER TABLE {$table} DROP COLUMN {$column}");
    }

    /**
     * Crea un índice UNIQUE para una columna. El nombre del índice se
     * deriva del `columnName` para no colisionar con otros y poder
     * dropearlo fácilmente.
     */
    public function addUniqueIndex(string $tableSuffix, string $columnName): void
    {
        $table  = $this->quoteIdent($this->db->dataTable($tableSuffix), allowPrefix: true);
        $column = $this->quoteIdent($columnName);
        $index  = $this->quoteIdent('uq_' . $columnName);

        $this->db->wpdb()->query("ALTER TABLE {$table} ADD UNIQUE INDEX {$index} ({$column})");
    }

    public function dropUniqueIndex(string $tableSuffix, string $columnName): void
    {
        $table = $this->quoteIdent($this->db->dataTable($tableSuffix), allowPrefix: true);
        $index = $this->quoteIdent('uq_' . $columnName);

        $this->db->wpdb()->query("ALTER TABLE {$table} DROP INDEX {$index}");
    }

    /**
     * Crea un índice NO-único para acelerar filtros / sort sobre la
     * columna. El user lo activa con `is_indexed=true` en el field
     * config. A diferencia de UNIQUE, este permite valores duplicados.
     *
     * Tradeoff: cada índice cuesta storage (~10% de la tabla) y
     * lentifica writes ~5%; por eso es opt-in. Pero filtros sobre la
     * columna pasan de table scan a index seek — orden de magnitud
     * más rápido a 50k+ filas.
     *
     * Idempotente: si el índice ya existe, MySQL retorna error pero
     * lo capturamos y seguimos. Útil para reactivar el toggle sin
     * que rompa.
     */
    public function addIndex(string $tableSuffix, string $columnName): void
    {
        if ($this->indexExists($tableSuffix, 'idx_' . $columnName)) {
            return;
        }
        $table  = $this->quoteIdent($this->db->dataTable($tableSuffix), allowPrefix: true);
        $column = $this->quoteIdent($columnName);
        $index  = $this->quoteIdent('idx_' . $columnName);

        $this->db->wpdb()->query("ALTER TABLE {$table} ADD INDEX {$index} ({$column})");
    }

    public function dropIndex(string $tableSuffix, string $columnName): void
    {
        if (! $this->indexExists($tableSuffix, 'idx_' . $columnName)) {
            return;
        }
        $table = $this->quoteIdent($this->db->dataTable($tableSuffix), allowPrefix: true);
        $index = $this->quoteIdent('idx_' . $columnName);

        $this->db->wpdb()->query("ALTER TABLE {$table} DROP INDEX {$index}");
    }

    /**
     * Verifica que un índice exista en la tabla dinámica antes de
     * crear/dropear — evita errores de MySQL "Duplicate key name" al
     * re-activar el toggle, y "Can't DROP" cuando se desactiva sin
     * haberlo creado nunca.
     */
    public function indexExists(string $tableSuffix, string $indexName): bool
    {
        $tableName = $this->db->dataTable($tableSuffix);
        $sql = $this->db->wpdb()->prepare(
            'SHOW INDEX FROM `' . esc_sql($tableName) . '` WHERE Key_name = %s',
            $indexName,
        );
        $found = $this->db->wpdb()->get_var($sql);
        return $found !== null;
    }

    public function columnExists(string $tableSuffix, string $columnName): bool
    {
        $tableName = $this->db->dataTable($tableSuffix);
        $sql       = $this->db->wpdb()->prepare(
            'SHOW COLUMNS FROM `' . esc_sql($tableName) . '` LIKE %s',
            $columnName
        );
        $found = $this->db->wpdb()->get_var($sql);
        return $found !== null;
    }

    /**
     * Sanea una definición SQL para evitar inyectar comandos extra. Permite
     * solamente la forma `<TYPE>[ NULL|NOT NULL][ DEFAULT <literal>]`.
     */
    private function normalizeDefinition(string $definition): string
    {
        $clean = trim($definition);
        // Remover trailing semicolons y comentarios.
        $clean = rtrim($clean, ";\n\r\t ");
        if (preg_match('/--|\/\*|\*\//', $clean)) {
            throw new \InvalidArgumentException('SQL definition contains forbidden tokens.');
        }
        return $clean;
    }

    /**
     * Sanitiza y rodea con backticks un identificador.
     *
     * Si `allowPrefix` está activo, se permite el prefijo de WP (`wp_imcrm_`)
     * antes del segmento validado. Si el identificador no calza el regex,
     * lanza excepción — esto NUNCA debería pasar porque SlugManager ya valida,
     * pero se mantiene como red de seguridad ante DDL.
     */
    private function quoteIdent(string $identifier, bool $allowPrefix = false): string
    {
        if ($allowPrefix) {
            $prefix = $this->db->prefix();
            if (str_starts_with($identifier, $prefix)) {
                $tail = substr($identifier, strlen($prefix));
                if (! preg_match('/^[a-z0-9_]+$/i', $tail)) {
                    throw new \InvalidArgumentException(
                        sprintf('Invalid table identifier "%s".', $identifier)
                    );
                }
                return '`' . $prefix . esc_sql($tail) . '`';
            }
        }

        if (! preg_match(self::IDENT_REGEX, $identifier)) {
            throw new \InvalidArgumentException(
                sprintf('Invalid SQL identifier "%s".', $identifier)
            );
        }

        return '`' . esc_sql($identifier) . '`';
    }

    private function sqlLists(string $charset): string
    {
        $table = $this->db->systemTable('lists');
        // Nota: `uq_slug` incluye `deleted_at` para que soft-deleted libere
        // el slug (NULL ≠ NULL en UNIQUE de MySQL). `table_suffix` SÍ es
        // absoluto: los nombres físicos nunca se reutilizan (CLAUDE.md §7.9).
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            slug VARCHAR(64) NOT NULL,
            table_suffix VARCHAR(64) NOT NULL,
            name VARCHAR(191) NOT NULL,
            description TEXT NULL,
            icon VARCHAR(64) NULL,
            color VARCHAR(16) NULL,
            settings LONGTEXT NOT NULL,
            position INT NOT NULL DEFAULT 0,
            created_by BIGINT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            deleted_at DATETIME NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uq_slug (slug, deleted_at),
            UNIQUE KEY uq_table_suffix (table_suffix),
            KEY idx_deleted (deleted_at)
        ) {$charset};";
    }

    private function sqlFields(string $charset): string
    {
        $table = $this->db->systemTable('fields');
        // `uq_list_slug` incluye `deleted_at` (mismo patrón que lists).
        // `uq_list_column` permanece absoluto: column_name nunca se reutiliza.
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            list_id BIGINT UNSIGNED NOT NULL,
            slug VARCHAR(64) NOT NULL,
            column_name VARCHAR(64) NOT NULL,
            label VARCHAR(191) NOT NULL,
            type VARCHAR(32) NOT NULL,
            config LONGTEXT NOT NULL,
            is_required TINYINT(1) NOT NULL DEFAULT 0,
            is_unique TINYINT(1) NOT NULL DEFAULT 0,
            is_primary TINYINT(1) NOT NULL DEFAULT 0,
            is_indexed TINYINT(1) NOT NULL DEFAULT 0,
            position INT NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            deleted_at DATETIME NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uq_list_slug (list_id, slug, deleted_at),
            UNIQUE KEY uq_list_column (list_id, column_name),
            KEY idx_list (list_id),
            KEY idx_deleted (deleted_at)
        ) {$charset};";
    }

    private function sqlSavedViews(string $charset): string
    {
        $table = $this->db->systemTable('saved_views');
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            list_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NULL,
            name VARCHAR(191) NOT NULL,
            type VARCHAR(32) NOT NULL,
            config LONGTEXT NOT NULL,
            is_default TINYINT(1) NOT NULL DEFAULT 0,
            position INT NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_list (list_id),
            KEY idx_user (user_id)
        ) {$charset};";
    }

    /**
     * Filtros guardados (ClickUp-style): sets nombrados de
     * filter_tree reusables entre vistas. user_id NULL = compartido
     * con todo el "entorno de trabajo". Cada lista tiene su set
     * propio (delete-cascade vía list_id).
     */
    private function sqlSavedFilters(string $charset): string
    {
        $table = $this->db->systemTable('saved_filters');
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            list_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NULL,
            name VARCHAR(191) NOT NULL,
            filter_tree LONGTEXT NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_list (list_id),
            KEY idx_user (user_id)
        ) {$charset};";
    }

    /**
     * Recurrencias por record (ClickUp-style). Cada fila configura cómo
     * un campo date/datetime de un record concreto "rueda" hacia adelante
     * — ya sea cuando un campo de estado cambia a un valor target
     * (`trigger_type = status_change`) o cuando el cron de Action
     * Scheduler detecta que la fecha actual ya pasó
     * (`trigger_type = schedule`).
     *
     * `monthly_pattern` solo aplica con frequency=monthly (same_day,
     * first_day, last_day, weekday — donde "weekday" usa el día de la
     * semana de la fecha original).
     *
     * `action_type`:
     *  - `update`: el record actual se actualiza (avanza la fecha,
     *    opcionalmente cambia su estado a `update_status_value`).
     *  - `clone`: se crea un nuevo record copiando el original con la
     *    fecha rodada; el original queda intacto.
     *
     * `repeat_until` NULL = indefinido. Si está, el runner deja de
     * disparar pasada esa fecha.
     */
    private function sqlRecurrences(string $charset): string
    {
        $table = $this->db->systemTable('recurrences');
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            list_id BIGINT UNSIGNED NOT NULL,
            record_id BIGINT UNSIGNED NOT NULL,
            date_field_id BIGINT UNSIGNED NOT NULL,
            frequency VARCHAR(16) NOT NULL,
            interval_n INT UNSIGNED NOT NULL DEFAULT 1,
            monthly_pattern VARCHAR(16) NULL,
            trigger_type VARCHAR(16) NOT NULL,
            trigger_status_field_id BIGINT UNSIGNED NULL,
            trigger_status_value VARCHAR(191) NULL,
            action_type VARCHAR(16) NOT NULL DEFAULT 'update',
            update_status_field_id BIGINT UNSIGNED NULL,
            update_status_value VARCHAR(191) NULL,
            repeat_until DATE NULL,
            last_fired_at DATETIME NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uq_record_field (record_id, date_field_id),
            KEY idx_list (list_id),
            KEY idx_trigger (trigger_type)
        ) {$charset};";
    }

    private function sqlComments(string $charset): string
    {
        $table = $this->db->systemTable('comments');
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            list_id BIGINT UNSIGNED NOT NULL,
            record_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            parent_id BIGINT UNSIGNED NULL,
            content LONGTEXT NOT NULL,
            metadata LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            deleted_at DATETIME NULL,
            PRIMARY KEY  (id),
            KEY idx_list_record (list_id, record_id),
            KEY idx_user (user_id)
        ) {$charset};";
    }

    private function sqlActivity(string $charset): string
    {
        $table = $this->db->systemTable('activity');
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            list_id BIGINT UNSIGNED NOT NULL,
            record_id BIGINT UNSIGNED NULL,
            user_id BIGINT UNSIGNED NULL,
            action VARCHAR(64) NOT NULL,
            changes LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_list_record (list_id, record_id),
            KEY idx_created (created_at)
        ) {$charset};";
    }

    private function sqlRelations(string $charset): string
    {
        $table = $this->db->systemTable('relations');
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            field_id BIGINT UNSIGNED NOT NULL,
            source_list_id BIGINT UNSIGNED NOT NULL,
            source_record_id BIGINT UNSIGNED NOT NULL,
            target_list_id BIGINT UNSIGNED NOT NULL,
            target_record_id BIGINT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uq_relation (field_id, source_record_id, target_record_id),
            KEY idx_source (source_list_id, source_record_id),
            KEY idx_target (target_list_id, target_record_id)
        ) {$charset};";
    }

    private function sqlSlugHistory(string $charset): string
    {
        $table = $this->db->systemTable('slug_history');
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            entity_type VARCHAR(16) NOT NULL,
            entity_id BIGINT UNSIGNED NOT NULL,
            old_slug VARCHAR(64) NOT NULL,
            new_slug VARCHAR(64) NOT NULL,
            changed_by BIGINT UNSIGNED NOT NULL,
            changed_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_entity (entity_type, entity_id),
            KEY idx_old_slug (entity_type, old_slug)
        ) {$charset};";
    }

    private function sqlAutomations(string $charset): string
    {
        $table = $this->db->systemTable('automations');
        // Una automatización pertenece a una lista (la del trigger). `actions`
        // es un JSON con la lista ordenada de specs `{type, config}`.
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            list_id BIGINT UNSIGNED NOT NULL,
            name VARCHAR(191) NOT NULL,
            description TEXT NULL,
            trigger_type VARCHAR(64) NOT NULL,
            trigger_config LONGTEXT NOT NULL,
            actions LONGTEXT NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_by BIGINT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            deleted_at DATETIME NULL,
            PRIMARY KEY  (id),
            KEY idx_list_active (list_id, is_active, deleted_at),
            KEY idx_trigger (trigger_type, is_active, deleted_at)
        ) {$charset};";
    }

    private function sqlAutomationRuns(string $charset): string
    {
        $table = $this->db->systemTable('automation_runs');
        // Cada disparo del engine deja una entrada acá: status (pending/
        // running/success/failed), context original, log per-action y
        // contador de retries para reintentos del Action Scheduler.
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            automation_id BIGINT UNSIGNED NOT NULL,
            list_id BIGINT UNSIGNED NOT NULL,
            record_id BIGINT UNSIGNED NULL,
            status VARCHAR(32) NOT NULL,
            trigger_context LONGTEXT NULL,
            actions_log LONGTEXT NULL,
            error TEXT NULL,
            retries INT NOT NULL DEFAULT 0,
            started_at DATETIME NULL,
            finished_at DATETIME NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_automation (automation_id),
            KEY idx_status_created (status, created_at),
            KEY idx_record (list_id, record_id)
        ) {$charset};";
    }

    /**
     * Tokens del índice invertido (Tier 3 — 0.30.0). Una fila por
     * (list, token, record). `tf` es term frequency en ese record;
     * el query engine multiplica por idf para BM25.
     *
     * Identidad por (list_id, token, record_id) — el indexer hace
     * REPLACE INTO para idempotencia. El primer KEY soporta el filtro
     * `WHERE list_id = ? AND token IN (...)` que domina el query
     * engine.
     */
    private function sqlSearchTokens(string $charset): string
    {
        $table = $this->db->systemTable('search_tokens');
        return "CREATE TABLE {$table} (
            list_id BIGINT UNSIGNED NOT NULL,
            record_id BIGINT UNSIGNED NOT NULL,
            token VARCHAR(64) NOT NULL,
            tf SMALLINT UNSIGNED NOT NULL DEFAULT 1,
            PRIMARY KEY  (list_id, token, record_id),
            KEY idx_token_lookup (list_id, token),
            KEY idx_record (list_id, record_id)
        ) {$charset};";
    }

    /**
     * Metadatos por documento: doc_length (suma de tf, usado para
     * BM25 length normalization) e indexed_at (debugging + UI status).
     */
    private function sqlSearchDocuments(string $charset): string
    {
        $table = $this->db->systemTable('search_documents');
        return "CREATE TABLE {$table} (
            list_id BIGINT UNSIGNED NOT NULL,
            record_id BIGINT UNSIGNED NOT NULL,
            doc_length INT UNSIGNED NOT NULL DEFAULT 0,
            indexed_at DATETIME NOT NULL,
            PRIMARY KEY  (list_id, record_id),
            KEY idx_indexed (list_id, indexed_at)
        ) {$charset};";
    }

    /**
     * Export jobs (Fase 17.A — DEFERRED #2).
     *
     * Diferimos exports de listas grandes a Action Scheduler en lugar
     * de ejecutar el `CsvExporter` síncrono en la request del user
     * (que acumula hasta 50k filas en memoria y puede tirar OOM /
     * timeout HTTP). Cada job tiene status pendiente/en-proceso/listo/
     * fallido, file_path al CSV en `uploads/imagina-crm/exports/`, y
     * los params originales del request (filter_tree, fields,
     * delimiter, with_bom) para que el worker reconstruya el export.
     *
     * Cleanup: jobs > 7 días se eliminan automáticamente en
     * `MaintenanceCron` (sus archivos también).
     */
    private function sqlExportJobs(string $charset): string
    {
        $table = $this->db->systemTable('export_jobs');
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            list_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            params LONGTEXT NULL,
            row_count BIGINT UNSIGNED NULL,
            file_path VARCHAR(255) NULL,
            error TEXT NULL,
            created_at DATETIME NOT NULL,
            completed_at DATETIME NULL,
            PRIMARY KEY  (id),
            KEY idx_user (user_id, created_at),
            KEY idx_list (list_id, created_at),
            KEY idx_status (status, created_at)
        ) {$charset};";
    }

    private function sqlDashboards(string $charset): string
    {
        $table = $this->db->systemTable('dashboards');
        // Un dashboard agrupa N widgets. Los widgets viven dentro del
        // JSON `widgets` (no merece su propia tabla en este punto: la
        // edición es atómica por dashboard; no hay queries por widget
        // independiente). `user_id` NULL = dashboard compartido por
        // todo el espacio; cualquier valor != NULL = dashboard privado
        // de ese usuario.
        return "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NULL,
            name VARCHAR(191) NOT NULL,
            description TEXT NULL,
            widgets LONGTEXT NOT NULL,
            is_default TINYINT(1) NOT NULL DEFAULT 0,
            position INT NOT NULL DEFAULT 0,
            created_by BIGINT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            deleted_at DATETIME NULL,
            PRIMARY KEY  (id),
            KEY idx_user (user_id),
            KEY idx_deleted (deleted_at)
        ) {$charset};";
    }
}
