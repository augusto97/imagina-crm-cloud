<?php
declare(strict_types=1);

namespace ImaginaCRM\Portal;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Support\Cache;
use ImaginaCRM\Support\Database;
use WP_User;

/**
 * Encuentra (a) la lista marcada como lista-de-portal y (b) el record
 * de cliente que corresponde a un `WP_User` dado (Fase 9 — 3.A).
 *
 * Modelo de datos (ver `docs/multi-stakeholder-design.md` §3.1):
 *   - Una lista del CRM se marca como portal en `settings.portal.enabled
 *     = true` + `settings.portal.owner_field_id = <field_id>`.
 *   - Ese field debe ser de tipo `user`. Su columna física guarda el
 *     `wp_users.ID` del cliente dueño del record.
 *   - Solo se espera UNA lista de portal por instalación WP (multi-tenant
 *     queda para futuro). Si hay varias marcadas, usamos la primera por
 *     `position` (orden estable).
 *
 * Cache:
 *   - `portalList()` se cachea por todo el grupo del plugin — invalidado
 *     automáticamente por `Cache::registerInvalidationHooks` cuando
 *     cambia cualquier lista.
 *   - `clientRecordFor()` NO se cachea: el lookup es per-request por
 *     user_id y el cache wins son marginales vs. el riesgo de servir
 *     stale al cliente justo después de que el admin actualizó algo.
 */
final class ClientResolver implements ClientResolverInterface
{
    public function __construct(
        private readonly ListRepository $lists,
        private readonly FieldRepository $fields,
        private readonly Database $db,
        private readonly Cache $cache,
    ) {
    }

    /**
     * Devuelve la lista marcada como portal, o null si no hay ninguna
     * configurada. Cacheado por el group del plugin.
     */
    public function portalList(): ?ListEntity
    {
        $cacheKey = $this->cache->key('portal_list', 'singleton');
        $loader = function (): ?ListEntity {
            foreach ($this->lists->all() as $list) {
                $cfg = PortalConfig::fromListSettings($list->settings);
                if ($cfg->isPortalList()) {
                    return $list;
                }
            }
            return null;
        };
        $cached = $this->cache->remember($cacheKey, $loader);
        return $cached instanceof ListEntity ? $cached : null;
    }

    public function configFor(ListEntity $list): PortalConfig
    {
        return PortalConfig::fromListSettings($list->settings);
    }

    /**
     * Devuelve el field tipo `user` configurado como `owner_field_id`
     * de la lista de portal. Null si:
     *  - la lista no es portal,
     *  - el field referenciado no existe,
     *  - el field es de otra lista (referencia stale),
     *  - el field NO es de tipo `user` (mis-config defensiva).
     */
    public function ownerField(ListEntity $portalList): ?FieldEntity
    {
        $cfg = $this->configFor($portalList);
        if ($cfg->ownerFieldId === null) {
            return null;
        }
        $field = $this->fields->find($cfg->ownerFieldId);
        if ($field === null || $field->listId !== $portalList->id) {
            return null;
        }
        if ($field->type !== 'user') {
            return null;
        }
        return $field;
    }

    /**
     * Resuelve el record del cliente actual. Es la operación más
     * crítica para data isolation: el cliente solo puede ver su propio
     * record (y datos vinculados a él) a través del portal.
     *
     * Devuelve null si:
     *  - No hay lista de portal configurada.
     *  - El owner_field está mal o no existe.
     *  - El user no tiene un record asociado en la lista de portal.
     *
     * En todos los casos, el caller debe interpretar null como "este
     * user NO tiene portal accesible" y responder 404 / forbidden.
     *
     * @return array<string, mixed>|null Row del record (sin hidratar).
     */
    public function clientRecordFor(WP_User $user): ?array
    {
        if ($user->ID <= 0) {
            return null;
        }
        $portalList = $this->portalList();
        if ($portalList === null) {
            return null;
        }
        $ownerField = $this->ownerField($portalList);
        if ($ownerField === null) {
            return null;
        }

        // Query directo: WHERE {owner_col} = user_id AND deleted_at IS NULL LIMIT 1.
        // El nombre de la columna ya pasó por SlugManager al crearse —
        // es seguro inyectarlo entre backticks. El user_id va por
        // prepared statement.
        $table = $this->db->dataTable($portalList->tableSuffix);
        $col   = $ownerField->columnName;
        $wpdb  = $this->db->wpdb();

        /** @var array<string, mixed>|null $row */
        $row = $wpdb->get_row(
            $wpdb->prepare(
                'SELECT * FROM `' . esc_sql($table) . '` '
                . 'WHERE `' . esc_sql($col) . '` = %d AND deleted_at IS NULL LIMIT 1',
                $user->ID,
            ),
            ARRAY_A,
        );
        return is_array($row) ? $row : null;
    }
}
