<?php
declare(strict_types=1);

namespace ImaginaCRM\Permissions;

use ImaginaCRM\Lists\ListEntity;
use WP_User;

/**
 * Sanitizer centralizado de records contra per-field permissions
 * (Fase 16.A).
 *
 * Antes (pre-16.A): el strip de campos ocultos vivía como helper
 * privado en `RecordsController` (`stripHiddenFields`), aplicado
 * solo en list/get/update. Endpoints como Export, Portal,
 * Aggregates, Search y Group-by quedaban sin gating — un user
 * con role que oculta `costo_real` podía pedir un CSV con ese
 * campo (`?fields=<id>`) y exfiltrarlo trivialmente.
 *
 * Este servicio:
 *  - Pre-computa los hidden slugs una sola vez por usuario+lista.
 *  - Expone helpers cohesivos: `stripRecord`, `stripRecords`,
 *    `stripActivityChanges`, `filterAllowedFieldIds`,
 *    `canSeeField`.
 *  - Es stateful (constructor con user+list) para que el caller
 *    no tenga que pasar esos params en cada call — invita a
 *    aplicar el strip consistentemente.
 *
 * Uso típico desde un REST controller:
 *
 *     $sanitizer = $this->permissions->sanitizerFor($user, $list);
 *     $records = $sanitizer->stripRecords($result['data']);
 *
 * El SanitizerFactory está en `PermissionService` para mantener
 * una sola fuente de verdad sobre `hiddenFieldSlugs()`.
 */
final class RecordSanitizer
{
    /**
     * @param list<string> $hiddenSlugs Pre-computed via
     *                                   `PermissionService::hiddenFieldSlugs()`.
     *                                   `[]` = admin del plugin, no aplica
     *                                   ningún strip (fast path).
     */
    public function __construct(
        public readonly array $hiddenSlugs,
    ) {
    }

    /**
     * True cuando NO hay nada que sanitizar (admin del plugin o
     * ACL sin fields_hidden para los roles del user). Los callers
     * pueden usarlo como fast-path para skipear el clone del array.
     */
    public function isNoop(): bool
    {
        return $this->hiddenSlugs === [];
    }

    /**
     * Strip de campos hidden de un único record (shape
     * `{fields: ..., relations: ...}` o el plain row de la DB).
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public function stripRecord(array $row): array
    {
        if ($this->isNoop()) {
            return $row;
        }
        $hiddenSet = array_flip($this->hiddenSlugs);
        if (isset($row['fields']) && is_array($row['fields'])) {
            $row['fields'] = array_diff_key($row['fields'], $hiddenSet);
        }
        if (isset($row['relations']) && is_array($row['relations'])) {
            $row['relations'] = array_diff_key($row['relations'], $hiddenSet);
        }
        // Plain row (sin envolver en 'fields'): los slugs son top-level.
        // Detectamos por la presencia de 'id' + ausencia de 'fields'.
        if (isset($row['id']) && ! isset($row['fields']) && ! isset($row['relations'])) {
            foreach ($this->hiddenSlugs as $slug) {
                unset($row[$slug]);
            }
        }
        return $row;
    }

    /**
     * Batch del strip — útil cuando el caller tiene una lista.
     *
     * @param list<array<string, mixed>> $records
     * @return list<array<string, mixed>>
     */
    public function stripRecords(array $records): array
    {
        if ($this->isNoop()) {
            return $records;
        }
        $out = [];
        foreach ($records as $row) {
            $out[] = $this->stripRecord($row);
        }
        return $out;
    }

    /**
     * Strip de campos hidden del JSON `changes` de un activity
     * event. El shape típico es `{before: {slug: val}, after:
     * {slug: val}}` o un map plano `{slug: val}` — sanitizamos
     * ambos.
     *
     * @param array<string, mixed>|null $changes
     * @return array<string, mixed>|null
     */
    public function stripActivityChanges(?array $changes): ?array
    {
        if ($changes === null || $this->isNoop()) {
            return $changes;
        }
        $hiddenSet = array_flip($this->hiddenSlugs);

        // Shape before/after.
        if (isset($changes['before']) || isset($changes['after'])) {
            if (isset($changes['before']) && is_array($changes['before'])) {
                $changes['before'] = array_diff_key($changes['before'], $hiddenSet);
            }
            if (isset($changes['after']) && is_array($changes['after'])) {
                $changes['after'] = array_diff_key($changes['after'], $hiddenSet);
            }
            return $changes;
        }

        // Shape plano slug → val.
        return array_diff_key($changes, $hiddenSet);
    }

    /**
     * Filtra IDs de fields contra hidden. Útil cuando el caller
     * recibe `?fields=1,2,3` y necesita verificar que ninguno
     * sea hidden ANTES de pasar al QueryBuilder / exporter.
     *
     * Necesita un map `fieldId → slug` (típicamente lo arma el
     * caller desde `FieldRepository::allForList`).
     *
     * @param list<int>                                   $requestedIds
     * @param array<int, string>                          $idToSlug
     * @return list<int>  Solo los IDs que NO son hidden.
     */
    public function filterAllowedFieldIds(array $requestedIds, array $idToSlug): array
    {
        if ($this->isNoop()) {
            return $requestedIds;
        }
        $hiddenSet = array_flip($this->hiddenSlugs);
        $out = [];
        foreach ($requestedIds as $id) {
            $slug = $idToSlug[$id] ?? null;
            if ($slug === null) continue;
            if (isset($hiddenSet[$slug])) continue;
            $out[] = $id;
        }
        return $out;
    }

    /**
     * Check rápido para una operación que toca un único field
     * (ej. group_by, sort_by, filter target). Devuelve false si
     * el slug está en hidden.
     */
    public function canSeeField(string $slug): bool
    {
        if ($this->isNoop()) {
            return true;
        }
        return ! in_array($slug, $this->hiddenSlugs, true);
    }
}
