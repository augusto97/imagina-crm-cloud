<?php
declare(strict_types=1);

namespace ImaginaCRM\Records;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Search\SearchService;
use ImaginaCRM\Support\ValidationResult;

/**
 * Casos de uso de records.
 *
 * Orquesta `RecordValidator`, `RecordRepository`, `RelationRepository` y
 * `QueryBuilder`. Garantiza que los `relation` fields se persisten en
 * `wp_imcrm_relations` y NO en la tabla dinámica.
 */
final class RecordService
{
    public function __construct(
        private readonly FieldRepository $fields,
        private readonly RecordRepository $records,
        private readonly RelationRepository $relations,
        private readonly RecordValidator $validator,
        private readonly QueryBuilder $queryBuilder,
        private readonly ?SearchService $search = null,
    ) {
    }

    /**
     * Lista paginada con filtros/sort/search.
     *
     * `$filterTree` (opcional, ClickUp-style) tiene prioridad sobre
     * `$filters` (forma plana legacy) cuando ambos vienen. Permite
     * AND/OR + grupos anidados que el shape plano no expresa.
     *
     * `$additionalWhere` (Fase 7 — 1.D) es el escape hatch por el que
     * `PermissionService::recordsScopeWhere()` inyecta el filtro de
     * scope (own/assigned/none) al WHERE final, sin alterar los
     * filtros del usuario ni el tree. Si no se pasa, comportamiento
     * idéntico al pre-1.D.
     *
     * @param array<string, mixed>                       $filters
     * @param array<int, array{slug:string, dir:string}> $sort
     * @param array<int, string>                         $fields
     * @param array<string, mixed>|null                  $filterTree
     * @param array{sql:string, args:array<int, mixed>}|null $additionalWhere
     *
     * @return array{
     *     data: array<int, array<string, mixed>>,
     *     meta: array{page:int, per_page:int, total:int, total_pages:int}
     * }|ValidationResult
     */
    public function list(
        ListEntity $list,
        array $filters,
        array $sort,
        array $fields,
        ?string $search,
        int $page,
        int $perPage,
        ?array $filterTree = null,
        ?int $cursor = null,
        ?array $additionalWhere = null,
    ): array|ValidationResult {
        $listFields = $this->fields->allForList($list->id);

        // Tier 3 (0.30.0): si la lista tiene índice invertido activo,
        // delegamos el `?search=` al motor BM25 y reemplazamos el
        // LIKE %s% por una whitelist `id IN (...)`. Si el motor no
        // matchea nada, salimos temprano con resultado vacío.
        $idWhitelist     = null;
        $searchForBuilder = $search;
        if (
            $search !== null
            && trim($search) !== ''
            && $this->search !== null
            && $this->search->isIndexed($list)
        ) {
            $hits = $this->search->search($list->id, $search, 5000);
            $idWhitelist = array_keys($hits);
            $searchForBuilder = null; // Evita el LIKE redundante.
        }

        // Si viene tree, dejamos `$params->filters` vacío para que
        // `buildSelect` use exclusivamente el override del tree-WHERE.
        // El sort/proyección/paginación se siguen sacando de params.
        $params = $this->queryBuilder->normalize(
            $list->id,
            $listFields,
            $filterTree !== null ? [] : $filters,
            $sort,
            $fields,
            $filterTree !== null ? null : $searchForBuilder,
            $page,
            $perPage,
            includeDeleted: false,
            cursor: $cursor,
        );

        if ($params instanceof ValidationResult) {
            return $params;
        }

        $whereOverride = null;
        if ($filterTree !== null) {
            $whereOverride = $this->queryBuilder->compileTreeWhereForList(
                $list->id,
                $listFields,
                $filterTree,
                $searchForBuilder,
                includeDeleted: false,
            );
        }

        $compiled = $this->queryBuilder->buildSelect(
            $list->tableSuffix,
            $listFields,
            $params,
            $whereOverride,
            $idWhitelist,
            $additionalWhere,
        );
        $result   = $this->records->executeQuery(
            $compiled['sql'],
            $compiled['args'],
            $compiled['count_sql'],
            $compiled['count_args'],
        );

        // Si el cliente pidió projection (`?fields=...`), pasamos los
        // slugs al hydrate para skipear evaluación de computed fuera
        // del set.
        $projection = $params->fields !== [] ? $params->fields : null;
        $hydrated = array_map(
            fn (array $row): array => $this->hydrate($listFields, $row, $projection),
            $result['rows']
        );

        $hydrated = $this->attachRelations($listFields, $hydrated);

        $total = $result['total'];
        // Para keyset (cursor activo): el "next cursor" es el id del
        // último record devuelto. Si la página vino llena y hay más
        // que ese id, el cliente lo usa para pedir la siguiente.
        $nextCursor = null;
        if ($params->cursor !== null && count($hydrated) === $params->perPage) {
            $last = end($hydrated);
            if (is_array($last) && isset($last['id'])) {
                $nextCursor = (int) $last['id'];
            }
        }
        return [
            'data' => $hydrated,
            'meta' => [
                'page'        => $params->page,
                'per_page'    => $params->perPage,
                'total'       => $total,
                'total_pages' => $params->perPage > 0 ? (int) ceil($total / $params->perPage) : 1,
                // Cuando keyset está activo, el cliente paginará via
                // cursor en lugar de page. `next_cursor=null` indica
                // fin de stream.
                'next_cursor' => $nextCursor,
            ],
        ];
    }

    /**
     * Lista de grupos (buckets) para un campo agrupable, respetando
     * filters/search igual que `list()`. Cada bucket trae `value` (lo
     * que el frontend usa luego para filtrar al expandir) y `count`.
     *
     * @param array<string, mixed>      $filters
     * @param array<string, mixed>|null $filterTree
     *
     * @return array{
     *     data: array<int, array{value: mixed, count: int}>,
     *     meta: array{
     *         group_by_field_id: int,
     *         group_by_slug: string,
     *         group_by_type: string,
     *         total_groups: int,
     *         total_records: int
     *     }
     * }|ValidationResult
     */
    public function groups(
        ListEntity $list,
        int $groupByFieldId,
        array $filters,
        ?string $search,
        ?array $filterTree = null,
    ): array|ValidationResult {
        $listFields = $this->fields->allForList($list->id);

        $groupBy = null;
        foreach ($listFields as $f) {
            if ($f->id === $groupByFieldId) {
                $groupBy = $f;
                break;
            }
        }

        if ($groupBy === null) {
            return ValidationResult::failWith(
                'group_by',
                __('El campo de agrupación no existe en esta lista.', 'imagina-crm')
            );
        }

        if (! in_array($groupBy->type, QueryBuilder::GROUPABLE_TYPES, true)) {
            return ValidationResult::failWith(
                'group_by',
                __('Este tipo de campo no soporta agrupación.', 'imagina-crm')
            );
        }

        // Reusamos `normalize` solo para sanitizar filters/search; las
        // dimensiones de paginación/sort/projection no aplican a la
        // query de groups. Si vino tree, igual que en `list()`,
        // pasamos filtros vacíos a normalize y compilamos el tree-WHERE
        // por separado.
        $params = $this->queryBuilder->normalize(
            $list->id,
            $listFields,
            $filterTree !== null ? [] : $filters,
            [],
            [],
            $filterTree !== null ? null : $search,
            1,
            1,
            includeDeleted: false,
        );

        if ($params instanceof ValidationResult) {
            return $params;
        }

        $whereOverride = null;
        if ($filterTree !== null) {
            $whereOverride = $this->queryBuilder->compileTreeWhereForList(
                $list->id,
                $listFields,
                $filterTree,
                $search,
                includeDeleted: false,
            );
        }

        $compiled = $this->queryBuilder->buildGroupQuery(
            $list->tableSuffix,
            $listFields,
            $groupBy,
            $params,
            $whereOverride,
        );
        $rows = $this->records->executeSelect($compiled['sql'], $compiled['args']);

        $groups = [];
        $total  = 0;
        foreach ($rows as $row) {
            $count = (int) ($row['group_count'] ?? 0);
            $value = $row['group_value'] ?? null;
            $total += $count;
            $groups[] = [
                'value' => $value,
                'count' => $count,
            ];
        }

        return [
            'data' => $groups,
            'meta' => [
                'group_by_field_id' => $groupBy->id,
                'group_by_slug'     => $groupBy->slug,
                'group_by_type'     => $groupBy->type,
                'total_groups'      => count($groups),
                'total_records'     => $total,
            ],
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function find(ListEntity $list, int $recordId): ?array
    {
        $row = $this->records->find($list->tableSuffix, $recordId);
        if ($row === null) {
            return null;
        }

        $listFields = $this->fields->allForList($list->id);
        $hydrated   = $this->hydrate($listFields, $row);

        $withRelations = $this->attachRelations($listFields, [$hydrated]);
        return $withRelations[0] ?? $hydrated;
    }

    /**
     * `$partial` es para imports bulk: cuando es true, los campos
     * `is_required` que no estén en `$values` no rebotan la
     * validación. Eso deja que filas con celdas vacías en columnas
     * obligatorias se inserten igual con NULL en SQL — todas las
     * columnas dinámicas son nullable a nivel schema. El usuario
     * llena los faltantes después en la UI.
     *
     * @param array<string, mixed> $values [slug => value]
     *
     * @return array<string, mixed>|ValidationResult
     */
    public function create(ListEntity $list, array $values, bool $partial = false): array|ValidationResult
    {
        $listFields = $this->fields->allForList($list->id);

        $validation = $this->validator->validate($listFields, $values, partial: $partial);
        if (! $validation->isValid()) {
            return $validation;
        }

        $row = $this->validator->buildRow($listFields, $values);

        $id = $this->records->insert($list->tableSuffix, $row);
        if ($id === 0) {
            return ValidationResult::failWith('database', __('No se pudo crear el record.', 'imagina-crm'));
        }

        $this->syncRelationsFromValues($list, $listFields, $id, $values);

        $created = $this->find($list, $id);

        // Disparamos con el record hidratado para que las automatizaciones
        // tengan acceso a `{fields: {slug: value}, relations: {…}, …}`
        // — las acciones como UpdateFieldAction lo necesitan así.
        do_action('imagina_crm/record_created', $list, $id, $created ?? [], $values);
        if ($created === null) {
            return ValidationResult::failWith('database', __('El record se creó pero no se pudo leer.', 'imagina-crm'));
        }
        return $created;
    }

    /**
     * Bulk create: inserta N records en chunks usando una sola
     * INSERT por chunk (en lugar de N round-trips). Para imports
     * grandes y fixtures de testing.
     *
     * - Valida CADA fila individualmente (mismo nivel de safety
     *   que `create`). Las que fallan validación se reportan en
     *   el array de errors y NO se insertan; el resto del chunk
     *   sí.
     * - Las relaciones (`relation` field) se sincronizan
     *   per-record después del insert porque dependen del ID
     *   generado.
     * - Dispara `imagina_crm/record_created` por cada record.
     *   Si quieres suprimir esto durante imports masivos, pasa
     *   `$silentHooks = true`.
     *
     * @param array<int, array<string, mixed>> $valuesList Cada item es `[slug => value]`.
     *
     * @return array{created: array<int, int>, errors: array<int, array{index:int, message:string}>}
     */
    public function bulkCreate(
        ListEntity $list,
        array $valuesList,
        bool $partial = false,
        bool $silentHooks = false,
        int $chunkSize = 200,
    ): array {
        $chunkSize = max(1, $chunkSize);
        $listFields = $this->fields->allForList($list->id);
        $created = [];
        $errors  = [];

        // Validar todas las filas primero. Las inválidas quedan
        // marcadas con índice; las válidas pasan al staging.
        /** @var array<int, array{values: array<string, mixed>, row: array<string, mixed>, originalIndex: int}> $staged */
        $staged = [];
        foreach ($valuesList as $idx => $values) {
            $validation = $this->validator->validate($listFields, $values, partial: $partial);
            if (! $validation->isValid()) {
                $errors[] = [
                    'index'   => $idx,
                    'message' => $validation->firstError() ?? __('Validación fallida.', 'imagina-crm'),
                ];
                continue;
            }
            $row = $this->validator->buildRow($listFields, $values);
            $staged[] = [
                'values'        => $values,
                'row'           => $row,
                'originalIndex' => $idx,
            ];
        }

        // Insert por chunks. Una INSERT con 200 VALUES = 200 filas
        // en un solo round-trip a MySQL. Mucho más rápido que N
        // INSERTs individuales en hosting con RTT >5ms.
        foreach (array_chunk($staged, $chunkSize) as $chunk) {
            $rows = array_map(static fn (array $s): array => $s['row'], $chunk);
            $ids = $this->records->insertBatch($list->tableSuffix, $rows);
            foreach ($ids as $i => $id) {
                $stagedItem = $chunk[$i] ?? null;
                if ($stagedItem === null || $id <= 0) continue;
                $created[] = $id;
                // Sync relations per-record (necesita el ID).
                $this->syncRelationsFromValues($list, $listFields, $id, $stagedItem['values']);
                // Hook por record. `$silentHooks` suprime esto cuando
                // un import masivo no quiere disparar 5000
                // automatizaciones.
                if (! $silentHooks) {
                    $hydrated = $this->find($list, $id) ?? [];
                    do_action(
                        'imagina_crm/record_created',
                        $list,
                        $id,
                        $hydrated,
                        $stagedItem['values'],
                    );
                }
            }
        }

        return ['created' => $created, 'errors' => $errors];
    }

    /**
     * @param array<string, mixed> $values
     *
     * @return array<string, mixed>|ValidationResult
     */
    public function update(ListEntity $list, int $recordId, array $values): array|ValidationResult
    {
        $existing = $this->records->find($list->tableSuffix, $recordId);
        if ($existing === null) {
            return ValidationResult::failWith('id', __('El record no existe.', 'imagina-crm'));
        }

        $listFields = $this->fields->allForList($list->id);

        // Snapshot previo hidratado (con `{id, fields, relations, ...}`)
        // para que las automatizaciones puedan comparar diff antes/después.
        $previousRecord = $this->find($list, $recordId);

        $validation = $this->validator->validate($listFields, $values, partial: true);
        if (! $validation->isValid()) {
            return $validation;
        }

        $row = $this->validator->buildRow($listFields, $values);
        if ($row !== []) {
            $ok = $this->records->update($list->tableSuffix, $recordId, $row);
            if (! $ok) {
                return ValidationResult::failWith('database', __('No se pudo actualizar el record.', 'imagina-crm'));
            }
        }

        $this->syncRelationsFromValues($list, $listFields, $recordId, $values, partial: true);

        $updated = $this->find($list, $recordId);
        do_action('imagina_crm/record_updated', $list, $recordId, $updated ?? [], $previousRecord);

        if ($updated === null) {
            return ValidationResult::failWith('database', __('No se pudo releer el record.', 'imagina-crm'));
        }
        return $updated;
    }

    public function delete(ListEntity $list, int $recordId, bool $purge = false): ValidationResult
    {
        $existing = $this->records->find($list->tableSuffix, $recordId);
        if ($existing === null) {
            return ValidationResult::failWith('id', __('El record no existe.', 'imagina-crm'));
        }

        if ($purge) {
            $this->relations->deleteAllForRecord($recordId);
            $this->records->hardDelete($list->tableSuffix, $recordId);
        } else {
            $this->records->softDelete($list->tableSuffix, $recordId);
        }

        do_action('imagina_crm/record_deleted', $list, $recordId, $purge);
        return ValidationResult::ok();
    }

    /**
     * Aplica una operación bulk sobre múltiples records.
     *
     * @param string                               $action  'delete' | 'update'
     * @param array<int, int>                      $ids
     * @param array<string, mixed>                 $values  Solo para `update`.
     *
     * @return array{succeeded: array<int, int>, failed: array<int, array{id:int, message:string}>}
     */
    public function bulk(ListEntity $list, string $action, array $ids, array $values = []): array
    {
        $succeeded = [];
        $failed    = [];

        // Normalizamos + dedup. Filtramos IDs <= 0 (defensa frente a
        // garbage del cliente).
        $cleanIds = [];
        foreach ($ids as $rid) {
            $rid = (int) $rid;
            if ($rid > 0) {
                $cleanIds[$rid] = true;
            }
        }
        $cleanIds = array_keys($cleanIds);

        if ($cleanIds === []) {
            return ['succeeded' => [], 'failed' => $failed];
        }

        // Fase 16.B — fast path para `delete`: single bulk UPDATE en
        // lugar de N find()+softDelete()+do_action. Antes el bulk de
        // 500 IDs disparaba ~1000-2000 queries; ahora 1 query SQL +
        // N do_action calls (los listeners — ETag bump, search index,
        // automation engine — son in-memory cuando no tocan DB).
        if ($action === 'delete') {
            $affected = $this->records->bulkSoftDelete($list->tableSuffix, $cleanIds);
            // Disparamos do_action por cada ID afectado para preservar
            // contratos del activity log + search index + automations.
            // El loop NO hace queries — solo dispatching de hooks.
            // (Si afecta < count, IDs ya soft-deleted o inexistentes
            // se marcan como fallidos. Sin saber cuáles fallaron sin
            // un SELECT extra, marcamos todos como succeeded — la
            // semántica "ya estaba borrado" es OK para bulk delete.)
            foreach ($cleanIds as $rid) {
                do_action('imagina_crm/record_deleted', $list, $rid, false);
                $succeeded[] = $rid;
            }
            unset($affected);
            return ['succeeded' => $succeeded, 'failed' => $failed];
        }

        if ($action === 'update') {
            return $this->bulkUpdate($list, $cleanIds, $values);
        }

        return [
            'succeeded' => $succeeded,
            'failed' => array_map(
                static fn (int $rid): array => ['id' => $rid, 'message' => __('Acción desconocida.', 'imagina-crm')],
                $cleanIds,
            ),
        ];
    }

    /**
     * Fast path para bulk update con values uniformes (Fase 17.B —
     * DEFERRED #3).
     *
     * Estrategia:
     *  1. Valida `$values` UNA sola vez (asumimos values uniformes
     *     para todos los IDs; no hay validación condicional por
     *     record state — los validators del proyecto son
     *     deterministas sobre el value).
     *  2. Si `$values` contiene fields tipo `relation`, NO podemos
     *     bulkear (relations son many-to-many via wp_imcrm_relations
     *     — cada record necesita su propio sync). Fallback a loop.
     *  3. Pre-fetch snapshots en una sola query `WHERE id IN`.
     *  4. Single UPDATE bulk con `RecordRepository::bulkUpdate`.
     *  5. Construye `$updated` per ID in-memory (snapshot + applied
     *     changes) — evita N SELECT post-update.
     *  6. Dispatch `record_updated` por cada ID con el snapshot
     *     correcto.
     *
     * Si `$row` está vacío después del buildRow (todos los values
     * eran relations / computed / inválidos), termina sin tocar DB.
     *
     * @param list<int>                    $ids
     * @param array<string, mixed>         $values
     * @return array{succeeded: list<int>, failed: list<array{id:int, message:string}>}
     */
    private function bulkUpdate(ListEntity $list, array $ids, array $values): array
    {
        $listFields = $this->fields->allForList($list->id);

        // Detectar si el caller pidió tocar relations. Si sí, fallback
        // al loop legacy — el syncRelations requiere lookups per record.
        $hasRelationValues = false;
        foreach ($listFields as $field) {
            if ($field->type === 'relation' && array_key_exists($field->slug, $values)) {
                $hasRelationValues = true;
                break;
            }
        }
        if ($hasRelationValues) {
            return $this->bulkUpdateFallback($list, $ids, $values);
        }

        // Validar una sola vez. Si los values fallan, todos los IDs
        // fallan con el mismo error (no llamamos al DB).
        $validation = $this->validator->validate($listFields, $values, partial: true);
        if (! $validation->isValid()) {
            $message = $validation->firstError() ?? __('Valores inválidos.', 'imagina-crm');
            return [
                'succeeded' => [],
                'failed' => array_map(
                    static fn (int $rid): array => ['id' => $rid, 'message' => $message],
                    $ids,
                ),
            ];
        }

        $row = $this->validator->buildRow($listFields, $values);
        if ($row === []) {
            // Nada que actualizar (todos los values caían en relations
            // o computed). Igual disparamos el hook para preservar
            // contrato — pero sin DB op.
            foreach ($ids as $rid) {
                do_action('imagina_crm/record_updated', $list, $rid, [], []);
            }
            return ['succeeded' => $ids, 'failed' => []];
        }

        // Pre-fetch snapshots en una sola query.
        $snapshots = $this->records->findManyByIds($list->tableSuffix, $ids);

        // Single UPDATE bulk.
        $affected = $this->records->bulkUpdate($list->tableSuffix, $ids, $row);
        unset($affected); // valor no se devuelve al caller; trade-off
                           // documentado: IDs ya soft-deleted o
                           // inexistentes se reportan como succeeded.

        // Dispatch hooks per ID con snapshot correcto. El "updated"
        // se construye in-memory: snapshot + row aplicado.
        $succeeded = [];
        $failed = [];
        foreach ($ids as $rid) {
            $oldRaw = $snapshots[$rid] ?? null;
            if ($oldRaw === null) {
                $failed[] = ['id' => $rid, 'message' => __('Record no encontrado o soft-deleted.', 'imagina-crm')];
                continue;
            }
            $previousRecord = $this->hydrate($listFields, $oldRaw);

            $newRaw = array_merge($oldRaw, $row);
            $updatedRecord = $this->hydrate($listFields, $newRaw);

            do_action('imagina_crm/record_updated', $list, $rid, $updatedRecord, $previousRecord);
            $succeeded[] = $rid;
        }

        return ['succeeded' => $succeeded, 'failed' => $failed];
    }

    /**
     * Fallback al loop legacy cuando el bulk update no se puede
     * optimizar (typically: $values contiene relations). Same
     * semantics que pre-17.B.
     *
     * @param list<int>                    $ids
     * @param array<string, mixed>         $values
     * @return array{succeeded: list<int>, failed: list<array{id:int, message:string}>}
     */
    private function bulkUpdateFallback(ListEntity $list, array $ids, array $values): array
    {
        $succeeded = [];
        $failed = [];
        foreach ($ids as $rid) {
            $result = $this->update($list, $rid, $values);
            if ($result instanceof ValidationResult) {
                if ($result->isValid()) {
                    $succeeded[] = $rid;
                } else {
                    $failed[] = ['id' => $rid, 'message' => $result->firstError() ?? ''];
                }
            } else {
                $succeeded[] = $rid;
            }
        }
        return ['succeeded' => $succeeded, 'failed' => $failed];
    }

    /**
     * @param array<int, FieldEntity>   $listFields
     * @param array<string, mixed>      $row             Fila cruda.
     * @param array<int, string>|null   $projectedSlugs  Si no es null,
     *      solo se hidratan / evalúan los slugs incluidos. Skip de
     *      computed fields fuera del set ahorra evaluación recursiva
     *      (con cycle guard, división, etc.) en cada read.
     *
     * @return array<string, mixed>
     */
    private function hydrate(array $listFields, array $row, ?array $projectedSlugs = null): array
    {
        $fields = $this->validator->hydrateRow($listFields, $row);

        // Computed fields: derivamos su valor desde otros campos del
        // mismo record. Lazy evaluation — se calcula en cada lectura.
        // Soporta encadenamiento (un computed que depende de otro
        // computed) vía recursión con cycle guard en el evaluator.
        //
        // Si el caller pasó una projection explícita (ej. `?fields=
        // name,email`) skipeamos los computed fuera del set — sin
        // sentido evaluar `total_owed` si el cliente solo pidió
        // name+email. Reduce hydration cost por record cuando hay
        // muchos computed.
        $projection = $projectedSlugs !== null ? array_flip($projectedSlugs) : null;
        foreach ($listFields as $f) {
            if ($f->type !== \ImaginaCRM\Fields\Types\ComputedField::SLUG) continue;
            if ($projection !== null && ! isset($projection[$f->slug])) continue;
            $fields[$f->slug] = \ImaginaCRM\Fields\ComputedFieldEvaluator::evaluate(
                $f,
                $listFields,
                $fields,
            );
        }

        return [
            'id'         => (int) ($row['id'] ?? 0),
            'fields'     => $fields,
            'relations'  => [], // se llena en attachRelations
            'created_by' => (int) ($row['created_by'] ?? 0),
            'created_at' => (string) ($row['created_at'] ?? ''),
            'updated_at' => (string) ($row['updated_at'] ?? ''),
        ];
    }

    /**
     * @param array<int, FieldEntity>           $listFields
     * @param array<int, array<string, mixed>>  $records
     *
     * @return array<int, array<string, mixed>>
     */
    private function attachRelations(array $listFields, array $records): array
    {
        $relationFields = array_values(array_filter(
            $listFields,
            static fn (FieldEntity $f): bool => $f->type === 'relation'
        ));

        if ($relationFields === [] || $records === []) {
            return $records;
        }

        $recordIds = array_map(static fn (array $r): int => (int) $r['id'], $records);
        $fieldIds  = array_map(static fn (FieldEntity $f): int => $f->id, $relationFields);

        $batch = $this->relations->batchTargets($recordIds, $fieldIds);

        foreach ($records as &$record) {
            $rid = (int) $record['id'];
            foreach ($relationFields as $field) {
                $record['relations'][$field->slug] = $batch[$rid][$field->id] ?? [];
            }
        }
        unset($record);

        return $records;
    }

    /**
     * @param array<int, FieldEntity>  $listFields
     * @param array<string, mixed>     $values
     */
    private function syncRelationsFromValues(
        ListEntity $list,
        array $listFields,
        int $sourceRecordId,
        array $values,
        bool $partial = false,
    ): void {
        foreach ($listFields as $field) {
            if ($field->type !== 'relation') {
                continue;
            }
            if ($partial && ! array_key_exists($field->slug, $values)) {
                continue;
            }
            $targetListId = (int) ($field->config['target_list_id'] ?? 0);
            if ($targetListId <= 0) {
                continue;
            }

            $raw = $values[$field->slug] ?? [];
            if (! is_array($raw)) {
                $raw = [$raw];
            }
            $ids = [];
            foreach ($raw as $v) {
                if (is_numeric($v) && (int) $v > 0) {
                    $ids[] = (int) $v;
                }
            }

            $this->relations->sync(
                $field->id,
                $list->id,
                $sourceRecordId,
                $targetListId,
                $ids,
            );
        }
    }
}
