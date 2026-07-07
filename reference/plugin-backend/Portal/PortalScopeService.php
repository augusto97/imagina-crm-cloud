<?php
declare(strict_types=1);

namespace ImaginaCRM\Portal;

use Closure;
use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Support\Database;
use WP_User;

/**
 * Genera el WHERE adicional que el `QueryBuilder` inyecta a TODAS las
 * lecturas de records dentro del portal (Fase 9 — 3.A).
 *
 * Es la pieza más crítica de la Fase 9 desde el punto de vista de
 * seguridad. Sin este filtro, un cliente podría adivinar IDs de
 * records ajenos y verlos. La regla es simple y agresiva:
 *
 *   - Lista de portal:
 *       AND `id` = <client_record_id>
 *
 *   - Lista cuyo schema tiene UN field de tipo `user` apuntando al
 *     cliente directo (caso "owner"):
 *       AND `<user_col>` = <user_id>
 *
 *   - Lista cuyo schema tiene UN field de tipo `relation` cuyo
 *     `target_list_id` es la lista de portal:
 *       AND `id` IN (
 *           SELECT source_record_id FROM wp_imcrm_relations
 *           WHERE field_id = <rel_field_id>
 *             AND target_record_id = <client_record_id>
 *       )
 *
 *   - Cualquier otro caso (lista sin vínculo al cliente):
 *       AND 1=0
 *
 * Reglas de oro (no negociables):
 *  1. Sin record-cliente resoluble → 1=0 en todas las listas.
 *  2. Si hay AMBIGÜEDAD (múltiples fields user/relation candidatos),
 *     usamos el primero por `position` — orden estable. NO unimos
 *     todas con OR para evitar agrandar el conjunto visible sin que
 *     el admin lo haya pedido explícitamente.
 *  3. Fail-closed siempre. Cualquier mis-config produce 1=0, no
 *     "ver todo".
 *
 * Ver tests `tests/Unit/Portal/PortalScopeServiceTest.php` —
 * cobertura obligatoria de aislamiento.
 */
final class PortalScopeService
{
    /** @var Closure(int): list<FieldEntity> */
    private readonly Closure $fieldsForList;

    /** Nombre completo de la tabla `wp_imcrm_relations` (resuelto en ctor). */
    private readonly string $relationsTable;

    /**
     * @param FieldRepository|Closure(int): list<FieldEntity> $fields
     *        Acepta el repositorio real (caso producción) o, para tests,
     *        un closure que resuelva list_id → fields sin tocar BD.
     * @param Database|string $db
     *        En producción es el `Database` wrapper. En tests acepta
     *        directamente el nombre de la tabla (string) para evitar
     *        el constructor de `Database` (que necesita `wpdb`).
     */
    public function __construct(
        private readonly ClientResolverInterface $resolver,
        FieldRepository|Closure $fields,
        Database|string $db,
    ) {
        if ($fields instanceof FieldRepository) {
            $this->fieldsForList = static fn (int $id): array => $fields->allForList($id);
        } else {
            $this->fieldsForList = $fields;
        }

        $this->relationsTable = $db instanceof Database
            ? $db->systemTable('relations')
            : $db;
    }

    /**
     * Devuelve la cláusula adicional a appendear al WHERE final del
     * QueryBuilder. Shape igual al de
     * `PermissionService::recordsScopeWhere`: el caller pasa el
     * resultado tal cual al `additionalWhere` de `QueryBuilder::buildSelect`.
     *
     * @return array{sql: string, args: list<mixed>}
     */
    public function recordsScopeWhere(WP_User $user, ListEntity $list): array
    {
        $clientRecord = $this->resolver->clientRecordFor($user);
        if ($clientRecord === null) {
            return $this->blocking();
        }
        $clientRecordId = isset($clientRecord['id']) ? (int) $clientRecord['id'] : 0;
        if ($clientRecordId <= 0) {
            return $this->blocking();
        }

        // Caso 1: la lista QUE LE PEDIMOS al service ES la lista de portal.
        $portalList = $this->resolver->portalList();
        if ($portalList !== null && $portalList->id === $list->id) {
            return [
                'sql'  => 'AND `id` = %d',
                'args' => [$clientRecordId],
            ];
        }

        // Caso 2: la lista tiene un field tipo `user` apuntando al cliente
        // directo. Esto es útil para listas tipo "Mis pedidos" donde el
        // record tiene `created_by_user` u otro campo análogo.
        $userField = $this->findOwnerLikeUserField($list);
        if ($userField !== null) {
            return [
                'sql'  => 'AND `' . esc_sql($userField->columnName) . '` = %d',
                'args' => [(int) $user->ID],
            ];
        }

        // Caso 3: la lista tiene un field tipo `relation` apuntando a la
        // lista de portal. Buscamos relations.source_record_id ↔
        // target_record_id = clientRecordId.
        $relationField = $portalList !== null
            ? $this->findRelationFieldTo($list, $portalList->id)
            : null;
        if ($relationField !== null) {
            $sql = 'AND `id` IN ('
                . 'SELECT source_record_id FROM `' . esc_sql($this->relationsTable) . '`'
                . ' WHERE field_id = %d AND target_record_id = %d'
                . ')';
            return [
                'sql'  => $sql,
                'args' => [$relationField->id, $clientRecordId],
            ];
        }

        // Sin vínculo identificable → el cliente NO ve nada en esta lista.
        return $this->blocking();
    }

    /**
     * Indica si el `WP_User` actual tiene un portal accesible:
     * existe lista de portal configurada Y el user tiene un record
     * asociado. Útil para que `/portal/me` devuelva 404 sin tener
     * que ejecutar queries adicionales.
     */
    public function userHasPortal(WP_User $user): bool
    {
        return $this->resolver->clientRecordFor($user) !== null;
    }

    /**
     * Cláusula "bloqueante" — la query no devolverá ninguna fila.
     * Se usa cuando el caller no debe ver nada en una lista pero
     * NO queremos romper la query (preferimos un result vacío a
     * un error 500).
     *
     * @return array{sql: string, args: list<mixed>}
     */
    private function blocking(): array
    {
        return ['sql' => 'AND 1=0', 'args' => []];
    }

    /**
     * Encuentra el primer field `user` (excluyendo el owner_field de
     * la lista de portal — ese cubre el caso 1) en la lista, ordenado
     * por position. Convencionalmente, este es el field que el admin
     * usa para "asignar" records a clientes desde el CRM admin.
     */
    private function findOwnerLikeUserField(ListEntity $list): ?FieldEntity
    {
        foreach (($this->fieldsForList)($list->id) as $field) {
            if ($field->deletedAt !== null) {
                continue;
            }
            if ($field->type === 'user') {
                return $field;
            }
        }
        return null;
    }

    /**
     * Encuentra el primer field `relation` cuyo `target_list_id` es la
     * lista de portal. Es lo que permite "Mis facturas" → vínculo a
     * "Clientes".
     */
    private function findRelationFieldTo(ListEntity $list, int $portalListId): ?FieldEntity
    {
        foreach (($this->fieldsForList)($list->id) as $field) {
            if ($field->deletedAt !== null) {
                continue;
            }
            if ($field->type !== 'relation') {
                continue;
            }
            $targetId = isset($field->config['target_list_id'])
                ? (int) $field->config['target_list_id']
                : 0;
            if ($targetId === $portalListId) {
                return $field;
            }
        }
        return null;
    }
}
