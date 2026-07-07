<?php
declare(strict_types=1);

namespace ImaginaCRM\Records;

use ImaginaCRM\Support\Database;

/**
 * Acceso a `wp_imcrm_relations`.
 *
 * Cada fila es un edge dirigido (`source → target`) ligado a un `field_id`
 * concreto. La unicidad por `(field_id, source_record_id, target_record_id)`
 * la enforza el UNIQUE INDEX, así que `sync` puede ser idempotente.
 */
final class RelationRepository
{
    public function __construct(private readonly Database $db)
    {
    }

    /**
     * Reemplaza completamente las relaciones para `(field, source)`.
     *
     * @param array<int, int> $targetIds
     */
    public function sync(int $fieldId, int $sourceListId, int $sourceRecordId, int $targetListId, array $targetIds): void
    {
        $wpdb = $this->db->wpdb();
        $now  = current_time('mysql', true);

        $wpdb->query(
            (string) $wpdb->prepare(
                'DELETE FROM ' . $this->db->systemTable('relations')
                . ' WHERE field_id = %d AND source_record_id = %d',
                $fieldId,
                $sourceRecordId
            )
        );

        foreach (array_unique(array_map('intval', $targetIds)) as $targetId) {
            if ($targetId < 1) {
                continue;
            }
            $wpdb->insert(
                $this->db->systemTable('relations'),
                [
                    'field_id'          => $fieldId,
                    'source_list_id'    => $sourceListId,
                    'source_record_id'  => $sourceRecordId,
                    'target_list_id'    => $targetListId,
                    'target_record_id'  => $targetId,
                    'created_at'        => $now,
                ],
                ['%d', '%d', '%d', '%d', '%d', '%s']
            );
        }
    }

    /**
     * @return array<int, int> Lista de target_record_id ordenados por created_at.
     */
    public function targets(int $fieldId, int $sourceRecordId): array
    {
        $wpdb = $this->db->wpdb();
        $rows = $wpdb->get_col(
            $wpdb->prepare(
                'SELECT target_record_id FROM ' . $this->db->systemTable('relations')
                . ' WHERE field_id = %d AND source_record_id = %d ORDER BY created_at ASC',
                $fieldId,
                $sourceRecordId
            )
        );
        if (! is_array($rows)) {
            return [];
        }
        return array_values(array_map('intval', $rows));
    }

    /**
     * Devuelve `[recordId => [fieldId => [targetIds...]]]` para un set de
     * records — usado por listings para evitar N+1.
     *
     * @param array<int, int> $recordIds
     * @param array<int, int> $fieldIds
     *
     * @return array<int, array<int, array<int, int>>>
     */
    public function batchTargets(array $recordIds, array $fieldIds): array
    {
        if ($recordIds === [] || $fieldIds === []) {
            return [];
        }

        $wpdb = $this->db->wpdb();

        $idsPlaceholders   = implode(', ', array_fill(0, count($recordIds), '%d'));
        $fieldPlaceholders = implode(', ', array_fill(0, count($fieldIds), '%d'));

        $sql = 'SELECT field_id, source_record_id, target_record_id FROM '
            . $this->db->systemTable('relations')
            . " WHERE source_record_id IN ({$idsPlaceholders}) AND field_id IN ({$fieldPlaceholders})"
            . ' ORDER BY created_at ASC';

        $args = array_merge(array_map('intval', $recordIds), array_map('intval', $fieldIds));

        $rows = $wpdb->get_results($wpdb->prepare($sql, $args), ARRAY_A);
        if (! is_array($rows)) {
            return [];
        }

        $out = [];
        foreach ($rows as $row) {
            $rid = (int) ($row['source_record_id'] ?? 0);
            $fid = (int) ($row['field_id'] ?? 0);
            $tid = (int) ($row['target_record_id'] ?? 0);
            if ($rid === 0 || $fid === 0 || $tid === 0) {
                continue;
            }
            $out[$rid][$fid][] = $tid;
        }
        return $out;
    }

    public function deleteAllForRecord(int $sourceRecordId): void
    {
        $wpdb = $this->db->wpdb();
        $wpdb->query(
            (string) $wpdb->prepare(
                'DELETE FROM ' . $this->db->systemTable('relations')
                . ' WHERE source_record_id = %d OR target_record_id = %d',
                $sourceRecordId,
                $sourceRecordId
            )
        );
    }

    public function deleteAllForField(int $fieldId): void
    {
        $wpdb = $this->db->wpdb();
        $wpdb->query(
            (string) $wpdb->prepare(
                'DELETE FROM ' . $this->db->systemTable('relations') . ' WHERE field_id = %d',
                $fieldId
            )
        );
    }
}
