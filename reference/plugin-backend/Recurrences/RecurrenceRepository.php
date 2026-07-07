<?php
declare(strict_types=1);

namespace ImaginaCRM\Recurrences;

use ImaginaCRM\Support\Database;

/**
 * CRUD sobre `wp_imcrm_recurrences`. Constraint UNIQUE(record_id,
 * date_field_id) garantiza una sola recurrencia por celda — en el
 * upsert (`create`) si ya existe se actualiza en su lugar.
 */
final class RecurrenceRepository
{
    public function __construct(private readonly Database $db)
    {
    }

    public function find(int $id): ?RecurrenceEntity
    {
        $table = $this->db->systemTable('recurrences');
        $wpdb  = $this->db->wpdb();
        $row   = $wpdb->get_row(
            (string) $wpdb->prepare("SELECT * FROM {$table} WHERE id = %d", $id),
            ARRAY_A,
        );
        return is_array($row) ? RecurrenceEntity::fromRow($row) : null;
    }

    public function findByRecordField(int $recordId, int $dateFieldId): ?RecurrenceEntity
    {
        $table = $this->db->systemTable('recurrences');
        $wpdb  = $this->db->wpdb();
        $row   = $wpdb->get_row(
            (string) $wpdb->prepare(
                "SELECT * FROM {$table} WHERE record_id = %d AND date_field_id = %d",
                $recordId,
                $dateFieldId,
            ),
            ARRAY_A,
        );
        return is_array($row) ? RecurrenceEntity::fromRow($row) : null;
    }

    /**
     * Recurrencias asociadas a un record (puede tener varias si tiene
     * varios campos de fecha). Útil para mostrar el icono en cada
     * celda.
     *
     * @return array<int, RecurrenceEntity>
     */
    public function listForRecord(int $recordId): array
    {
        $table = $this->db->systemTable('recurrences');
        $wpdb  = $this->db->wpdb();
        $rows  = $wpdb->get_results(
            (string) $wpdb->prepare("SELECT * FROM {$table} WHERE record_id = %d ORDER BY id ASC", $recordId),
            ARRAY_A,
        );
        $rows  = is_array($rows) ? $rows : [];
        return array_map(static fn (array $r): RecurrenceEntity => RecurrenceEntity::fromRow($r), $rows);
    }

    /**
     * Recurrencias por record_id (batch). Para attach a la respuesta
     * de `/records` y mostrar el icono en las celdas correspondientes
     * sin N+1.
     *
     * @param array<int, int> $recordIds
     * @return array<int, array<int, RecurrenceEntity>> Map record_id → recurrences[]
     */
    public function batchForRecords(array $recordIds): array
    {
        if ($recordIds === []) {
            return [];
        }
        $table = $this->db->systemTable('recurrences');
        $wpdb  = $this->db->wpdb();
        $placeholders = implode(', ', array_fill(0, count($recordIds), '%d'));
        $sql   = "SELECT * FROM {$table} WHERE record_id IN ({$placeholders})";
        $rows  = $wpdb->get_results((string) $wpdb->prepare($sql, $recordIds), ARRAY_A);
        $rows  = is_array($rows) ? $rows : [];

        $out = [];
        foreach ($rows as $r) {
            if (! is_array($r)) continue;
            $rec = RecurrenceEntity::fromRow($r);
            $out[$rec->recordId] ??= [];
            $out[$rec->recordId][] = $rec;
        }
        return $out;
    }

    /**
     * Recurrencias activas con trigger=schedule. El runner cron itera
     * estas para detectar cuáles ya pasaron su fecha y deben rodar.
     *
     * @return array<int, RecurrenceEntity>
     */
    public function listScheduleType(): array
    {
        $table = $this->db->systemTable('recurrences');
        $wpdb  = $this->db->wpdb();
        $rows  = $wpdb->get_results(
            (string) $wpdb->prepare(
                "SELECT * FROM {$table} WHERE trigger_type = %s",
                RecurrenceEntity::TRIGGER_SCHEDULE,
            ),
            ARRAY_A,
        );
        $rows  = is_array($rows) ? $rows : [];
        return array_map(static fn (array $r): RecurrenceEntity => RecurrenceEntity::fromRow($r), $rows);
    }

    /**
     * Recurrencias activas con trigger=status_change que apuntan a un
     * campo concreto. El handler de `record_updated` itera estas para
     * detectar matches.
     *
     * @return array<int, RecurrenceEntity>
     */
    public function listStatusChangeFor(int $recordId, int $statusFieldId): array
    {
        $table = $this->db->systemTable('recurrences');
        $wpdb  = $this->db->wpdb();
        $rows  = $wpdb->get_results(
            (string) $wpdb->prepare(
                "SELECT * FROM {$table} WHERE record_id = %d AND trigger_type = %s AND trigger_status_field_id = %d",
                $recordId,
                RecurrenceEntity::TRIGGER_STATUS_CHANGE,
                $statusFieldId,
            ),
            ARRAY_A,
        );
        $rows  = is_array($rows) ? $rows : [];
        return array_map(static fn (array $r): RecurrenceEntity => RecurrenceEntity::fromRow($r), $rows);
    }

    /**
     * @param array<string, mixed> $data
     */
    public function insert(array $data): int
    {
        $now   = current_time('mysql', true);
        $table = $this->db->systemTable('recurrences');
        $wpdb  = $this->db->wpdb();

        $cols = ['list_id', 'record_id', 'date_field_id', 'frequency',
            'interval_n', 'monthly_pattern', 'trigger_type',
            'trigger_status_field_id', 'trigger_status_value',
            'action_type', 'update_status_field_id', 'update_status_value',
            'repeat_until', 'created_at', 'updated_at'];
        $vals = [];
        $args = [];
        foreach ($cols as $col) {
            $v = $data[$col] ?? null;
            if ($col === 'created_at' || $col === 'updated_at') {
                $v = $now;
            }
            if ($v === null) {
                $vals[] = 'NULL';
                continue;
            }
            $vals[] = is_int($v) ? '%d' : '%s';
            $args[] = $v;
        }

        $sql      = "INSERT INTO {$table} (" . implode(', ', $cols) . ') VALUES (' . implode(', ', $vals) . ')';
        $prepared = $args === [] ? $sql : (string) $wpdb->prepare($sql, $args);
        $wpdb->query($prepared);
        return $this->db->lastInsertId();
    }

    /**
     * @param array<string, mixed> $patch
     */
    public function update(int $id, array $patch): bool
    {
        $patch['updated_at'] = current_time('mysql', true);

        $sets = [];
        $args = [];
        foreach ($patch as $col => $value) {
            if ($value === null) {
                $sets[] = "`{$col}` = NULL";
                continue;
            }
            $sets[] = "`{$col}` = " . (is_int($value) ? '%d' : '%s');
            $args[] = $value;
        }
        $args[] = $id;

        $table = $this->db->systemTable('recurrences');
        $wpdb  = $this->db->wpdb();
        $sql   = "UPDATE {$table} SET " . implode(', ', $sets) . ' WHERE id = %d';
        $result = $wpdb->query((string) $wpdb->prepare($sql, $args));
        return $result !== false;
    }

    public function markFired(int $id): void
    {
        $now = current_time('mysql', true);
        $this->update($id, ['last_fired_at' => $now]);
    }

    public function delete(int $id): bool
    {
        $table = $this->db->systemTable('recurrences');
        $wpdb  = $this->db->wpdb();
        $result = $wpdb->query(
            (string) $wpdb->prepare("DELETE FROM {$table} WHERE id = %d", $id),
        );
        return is_int($result) && $result > 0;
    }

    public function deleteForRecord(int $recordId): void
    {
        $table = $this->db->systemTable('recurrences');
        $wpdb  = $this->db->wpdb();
        $wpdb->query(
            (string) $wpdb->prepare("DELETE FROM {$table} WHERE record_id = %d", $recordId),
        );
    }
}
