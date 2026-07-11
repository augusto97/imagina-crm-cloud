import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
    isDataField,
    jsonbKeyForField,
    validateFieldValue,
    type CreateRecordInput,
    type Field,
    type List,
    type ListRecordsQuery,
    type RecordDto,
    type Role,
    type UpdateRecordInput,
} from '@imagina-base/shared';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import {
    andWhere,
    effectivePermissions,
    hiddenFieldsFor,
    resolvePermissions,
    rowInScope,
    scopeWhere,
} from '../lists/list-acl';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { compileFilterTree, type FilterableField } from './query-builder';
import { RecordsRepository, type RecordRow } from './records.repository';
import { RelationsRepository } from './relations.repository';

/** Quién ejecuta la acción — para el scoping de "own records" (CONTRACT §6). */
export interface Actor {
    userId: number;
    role: Role;
}

export interface RecordsPage {
    data: RecordDto[];
    meta: { next_cursor: string | null };
}

@Injectable()
export class RecordsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: RecordsRepository,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly realtime: RealtimeService,
        private readonly activity: ActivityService,
        private readonly automations: AutomationDispatcher,
        private readonly relationsRepo: RelationsRepository,
    ) {}

    async create(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        input: CreateRecordInput,
    ): Promise<RecordDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const listId = list.id;
        // ACL por lista: el rol debe tener create habilitado para esta lista.
        if (!effectivePermissions(list.settings, actor.role).create) {
            throw new ForbiddenException({
                code: 'forbidden_create',
                message: 'Tu rol no puede crear registros en esta lista',
                data: { status: 403 },
            });
        }
        const fields = await this.fields.listByListId(tenantId, listId);
        // Los campos `relation` NO viven en el JSONB: se separan del payload
        // y se sincronizan a la tabla `relations` dentro del mismo tx.
        const rel = splitRelationValues(fields, input.data);
        const data = this.validateData(fields, rel.data, { partial: false });

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const inserted = await this.repo.insert(tx, {
                tenantId,
                listId,
                data,
                createdBy: actor.userId,
            });
            await this.syncRelations(tx, tenantId, inserted.id, rel.values);
            await this.activity.logInTx(tx, {
                tenantId,
                listId,
                recordId: inserted.id,
                userId: actor.userId,
                action: 'record_created',
                diff: computeDiff({}, inserted.data),
            });
            return inserted;
        });
        this.realtime.records(tenantId, listId);
        this.automations.dispatch({
            tenantId,
            listId,
            recordId: row.id,
            trigger: 'record_created',
            after: row.data,
        });
        const relFieldIds = fields.filter((f) => f.type === 'relation').map((f) => f.id);
        return toRecord(row, {
            ...byFieldToKeys(relFieldIds, undefined),
            ...relationsToMap(rel.values),
        });
    }

    async get(tenantId: number, actor: Actor, listIdOrSlug: string, id: number): Promise<RecordDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const { row, hiddenKeys, relMap, relFieldIds } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const r = await this.repo.findById(tx, tenantId, list.id, id);
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const rels = r
                ? await this.relationsRepo.batchTargets(
                      tx,
                      tenantId,
                      [r.id],
                      fields.filter((f) => f.type === 'relation').map((f) => f.id),
                  )
                : new Map<number, Map<number, number[]>>();
            return {
                row: r,
                hiddenKeys: hiddenKeysFor(fields, list.settings, actor.role),
                relMap: rels,
                relFieldIds: fields.filter((f) => f.type === 'relation').map((f) => f.id),
            };
        });
        // ACL: si el scope no alcanza esta fila, 404 (no filtramos info).
        if (!row || !this.aclCanReach(list, actor, 'view', row)) throw recordNotFound(id);
        return stripHidden(toRecord(row, byFieldToKeys(relFieldIds, relMap.get(row.id))), hiddenKeys);
    }

    async list(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        query: ListRecordsQuery,
    ): Promise<RecordsPage> {
        // PERF-02: lista + fields + records se resuelven en UNA sola
        // transacción con scope (antes eran 3 → 3× BEGIN/COMMIT + entrada de
        // scope por request).
        const { rows, hiddenKeys, rels, relFieldIds } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const list = await this.lists.getWithinTx(tx, tenantId, listIdOrSlug);
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const fieldsById = new Map<number, FilterableField>(
                fields.map((f) => [f.id, { id: f.id, type: f.type }]),
            );
            const filterWhere = compileFilterTree(fieldsById, query.filter_tree, new Date());
            // ACL por lista (permisos por rol): scope de lectura + campos ocultos.
            const perms = effectivePermissions(list.settings, actor.role);
            const assignmentId = resolvePermissions(list.settings).assignment_field_id;
            const assignmentKey = assignmentId ? jsonbKeyForField(assignmentId) : null;
            const scopeW = scopeWhere(perms.view, actor.userId, assignmentKey);
            const where = andWhere(filterWhere, scopeW);

            const result = await this.repo.list(tx, tenantId, list.id, {
                where,
                cursor: query.cursor,
                limit: query.limit,
                dir: query.sort_dir,
            });
            // Relations de la página entera en UNA query (regla de oro nº 8).
            const relFieldIds = fields.filter((f) => f.type === 'relation').map((f) => f.id);
            const rels = await this.relationsRepo.batchTargets(
                tx,
                tenantId,
                result.map((r) => r.id),
                relFieldIds,
            );
            return {
                rows: result,
                hiddenKeys: hiddenKeysFor(fields, list.settings, actor.role),
                rels,
                relFieldIds,
            };
        });

        // Pedimos limit+1 para detectar página siguiente sin contar todo.
        const hasMore = rows.length > query.limit;
        const page = hasMore ? rows.slice(0, query.limit) : rows;
        const nextCursor = hasMore ? String(page[page.length - 1]!.id) : null;
        return {
            data: page.map((r) => stripHidden(toRecord(r, byFieldToKeys(relFieldIds, rels.get(r.id))), hiddenKeys)),
            meta: { next_cursor: nextCursor },
        };
    }

    async update(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        id: number,
        input: UpdateRecordInput,
    ): Promise<RecordDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const listId = list.id;
        const fields = await this.fields.listByListId(tenantId, listId);

        // Los campos `relation` presentes en el patch se sincronizan aparte
        // (semántica parcial: los ausentes no se tocan).
        const rel = splitRelationValues(fields, input.data);
        const result = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, listId, id);
            if (!current || !this.aclCanReach(list, actor, 'edit', current)) throw recordNotFound(id);

            // Merge parcial: validamos SOLO los campos presentes en el patch.
            const patch = this.validateData(fields, rel.data, { partial: true });
            const merged = mergeData(current.data, patch);
            const updated = await this.repo.updateData(tx, tenantId, listId, id, merged);
            if (updated) {
                await this.syncRelations(tx, tenantId, id, rel.values);
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId,
                    recordId: id,
                    userId: actor.userId,
                    action: 'record_updated',
                    diff: computeDiff(current.data, merged),
                });
            }
            const relFieldIds = fields.filter((f) => f.type === 'relation').map((f) => f.id);
            const rels = updated
                ? await this.relationsRepo.batchTargets(tx, tenantId, [id], relFieldIds)
                : new Map<number, Map<number, number[]>>();
            return { updated, before: current.data, rels };
        });
        if (!result.updated) throw recordNotFound(id);
        const row = result.updated;
        this.realtime.records(tenantId, listId);
        this.automations.dispatch({
            tenantId,
            listId,
            recordId: row.id,
            trigger: 'record_updated',
            after: row.data,
            before: result.before, // para changed_fields
        });
        return toRecord(
            row,
            byFieldToKeys(
                fields.filter((f) => f.type === 'relation').map((f) => f.id),
                result.rels.get(row.id),
            ),
        );
    }

    async remove(tenantId: number, actor: Actor, listIdOrSlug: string, id: number): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const listId = list.id;
        const deleted = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, listId, id);
            if (!current || !this.aclCanReach(list, actor, 'delete', current)) return false;
            const ok = await this.repo.softDelete(tx, tenantId, listId, id);
            if (ok) {
                // Los vínculos que SALEN del record se limpian (paridad con el
                // plugin); los que ENTRAN se filtran al leer (target borrado).
                await this.relationsRepo.deleteBySource(tx, tenantId, id);
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId,
                    recordId: id,
                    userId: actor.userId,
                    action: 'record_deleted',
                });
            }
            return ok;
        });
        if (!deleted) throw recordNotFound(id);
        this.realtime.records(tenantId, listId);
    }

    /**
     * Acción masiva (borrar / actualizar campos) sobre varios records. Se aplica
     * por fila reutilizando update/remove (respeta capabilities, own-scoping,
     * validación, activity y realtime); junta éxitos y fallos individuales.
     */
    async bulk(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        action: 'delete' | 'update',
        ids: number[],
        values: Record<string, unknown>,
    ): Promise<{ succeeded: number[]; failed: Array<{ id: number; message: string }> }> {
        const data: Record<string, unknown> = {};
        if (action === 'update') {
            // `values` puede venir por slug o por f{id}; normalizamos a f{id}.
            const list = await this.lists.get(tenantId, listIdOrSlug);
            const fields = await this.fields.list(tenantId, String(list.id));
            const bySlug = new Map(fields.map((f) => [f.slug, `f${f.id}`]));
            for (const [k, v] of Object.entries(values)) {
                data[/^f\d+$/.test(k) ? k : (bySlug.get(k) ?? k)] = v;
            }
        }

        const succeeded: number[] = [];
        const failed: Array<{ id: number; message: string }> = [];
        for (const id of ids) {
            try {
                if (action === 'delete') {
                    await this.remove(tenantId, actor, listIdOrSlug, id);
                } else {
                    await this.update(tenantId, actor, listIdOrSlug, id, { data });
                }
                succeeded.push(id);
            } catch (err) {
                failed.push({ id, message: err instanceof Error ? err.message : 'Error' });
            }
        }
        return { succeeded, failed };
    }

    /**
     * ¿El actor alcanza esta fila para la acción, según el ACL de la lista?
     * Resuelve el scope efectivo del rol (all/assigned/own/none) y evalúa la
     * fila (created_by / valor del campo de asignación).
     */
    private aclCanReach(
        list: List,
        actor: Actor,
        action: 'view' | 'edit' | 'delete',
        row: RecordRow,
    ): boolean {
        const scope = effectivePermissions(list.settings, actor.role)[action];
        const assignmentId = resolvePermissions(list.settings).assignment_field_id;
        const assignmentKey = assignmentId ? jsonbKeyForField(assignmentId) : null;
        const assignmentValue = assignmentKey
            ? (row.data as Record<string, unknown>)[assignmentKey]
            : null;
        return rowInScope(scope, actor.userId, { createdBy: row.createdBy, assignmentValue });
    }

    /**
     * Sincroniza los campos `relation` presentes en el payload dentro del tx
     * de la mutación. Valida que CADA target exista vivo en la lista destino
     * del campo (mismo tenant — RLS + tenant_id explícito); un ID ajeno o
     * inexistente rechaza la mutación completa (400).
     */
    private async syncRelations(
        tx: Parameters<RelationsRepository['sync']>[0],
        tenantId: number,
        recordId: number,
        values: Array<{ field: Field; targetListId: number; ids: number[] }>,
    ): Promise<void> {
        for (const { field, targetListId, ids } of values) {
            if (ids.length > 0) {
                const alive = await this.relationsRepo.existingInList(tx, tenantId, targetListId, ids);
                const missing = ids.filter((id) => !alive.has(id));
                if (missing.length > 0) {
                    throw new BadRequestException({
                        code: 'validation_failed',
                        message: 'Datos del registro inválidos',
                        data: {
                            status: 400,
                            errors: {
                                [field.slug]: `Registros inexistentes en la lista destino: ${missing.join(', ')}`,
                            },
                        },
                    });
                }
            }
            await this.relationsRepo.sync(tx, tenantId, field.id, recordId, ids);
        }
    }

    private async resolveListId(tenantId: number, listIdOrSlug: string): Promise<number> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return list.id;
    }

    /**
     * Valida y normaliza `data` contra los fields de la lista (usando el
     * validador compartido). Rechaza claves desconocidas y tipos no-data
     * (relation/computed). En modo `partial` solo procesa las claves dadas;
     * en modo completo aplica los `is_required` de todos los campos de datos.
     */
    private validateData(
        fields: Field[],
        rawData: Record<string, unknown>,
        opts: { partial: boolean },
    ): Record<string, unknown> {
        const byKey = new Map(fields.map((f) => [jsonbKeyForField(f.id), f]));
        const errors: Record<string, string> = {};
        const out: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(rawData)) {
            const field = byKey.get(key);
            if (!field) {
                errors[key] = 'Campo desconocido en esta lista';
                continue;
            }
            if (!isDataField(field.type)) {
                errors[key] = `El tipo '${field.type}' no se escribe en los datos`;
                continue;
            }
            const result = validateFieldValue(
                { type: field.type, config: field.config, is_required: field.is_required },
                value,
            );
            if (!result.ok) {
                errors[field.slug] = result.error;
            } else if (result.value === null) {
                out[key] = null;
            } else {
                out[key] = result.value;
            }
        }

        if (!opts.partial) {
            // Alta: los campos de datos requeridos ausentes deben fallar.
            for (const field of fields) {
                if (!isDataField(field.type)) continue;
                const key = jsonbKeyForField(field.id);
                if (!(key in rawData)) {
                    const result = validateFieldValue(
                        { type: field.type, config: field.config, is_required: field.is_required },
                        undefined,
                    );
                    if (!result.ok) errors[field.slug] = result.error;
                    else if (result.value !== null) out[key] = result.value; // ej. checkbox → false
                }
            }
        }

        if (Object.keys(errors).length > 0) {
            throw new BadRequestException({
                code: 'validation_failed',
                message: 'Datos del registro inválidos',
                data: { status: 400, errors },
            });
        }
        return out;
    }
}

function toRecord(row: RecordRow, relations: Record<string, number[]> = {}): RecordDto {
    return {
        id: row.id,
        list_id: row.listId,
        data: row.data,
        relations,
        created_by: row.createdBy,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

/**
 * Separa del payload los campos tipo `relation` (van a la tabla `relations`,
 * no al JSONB). Acepta `null` (vaciar), un ID o un array de IDs; cualquier
 * otro shape rechaza con error por campo. Devuelve el `data` restante y los
 * sets a sincronizar.
 */
function splitRelationValues(
    fields: Field[],
    rawData: Record<string, unknown>,
): {
    data: Record<string, unknown>;
    values: Array<{ field: Field; targetListId: number; ids: number[] }>;
} {
    const byKey = new Map(fields.filter((f) => f.type === 'relation').map((f) => [jsonbKeyForField(f.id), f]));
    const data: Record<string, unknown> = {};
    const values: Array<{ field: Field; targetListId: number; ids: number[] }> = [];
    const errors: Record<string, string> = {};

    for (const [key, value] of Object.entries(rawData)) {
        const field = byKey.get(key);
        if (!field) {
            data[key] = value;
            continue;
        }
        const targetListId = Number((field.config as { target_list_id?: unknown }).target_list_id ?? 0);
        if (!Number.isInteger(targetListId) || targetListId <= 0) {
            errors[field.slug] = 'El campo relation no tiene lista destino configurada';
            continue;
        }
        const raw = value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
        const ids: number[] = [];
        let ok = true;
        for (const v of raw) {
            const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
            if (!Number.isInteger(n) || n <= 0) {
                ok = false;
                break;
            }
            if (!ids.includes(n)) ids.push(n);
        }
        if (!ok) {
            errors[field.slug] = 'La relación debe ser un ID o un array de IDs de registros';
            continue;
        }
        if (ids.length > 200) {
            errors[field.slug] = 'Una relación admite hasta 200 registros vinculados';
            continue;
        }
        values.push({ field, targetListId, ids });
    }

    if (Object.keys(errors).length > 0) {
        throw new BadRequestException({
            code: 'validation_failed',
            message: 'Datos del registro inválidos',
            data: { status: 400, errors },
        });
    }
    return { data, values };
}

/** `values` de splitRelationValues → mapa `f{id} → ids` para el DTO. */
function relationsToMap(
    values: Array<{ field: Field; targetListId: number; ids: number[] }>,
): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const { field, ids } of values) out[jsonbKeyForField(field.id)] = ids;
    return out;
}

/**
 * `fieldId → ids` (batchTargets) → mapa `f{id} → ids` para el DTO. Prefill:
 * TODO campo relation aparece con `[]` aunque no tenga vínculos (paridad con
 * el plugin — la UI lee `record.relations[slug]` sin chequear presencia).
 */
function byFieldToKeys(
    relFieldIds: number[],
    byField: Map<number, number[]> | undefined,
): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const id of relFieldIds) out[jsonbKeyForField(id)] = [];
    if (!byField) return out;
    for (const [fieldId, ids] of byField) out[jsonbKeyForField(fieldId)] = ids;
    return out;
}

/** Claves JSONB (f{id}) de los campos ocultos para el rol (ACL por lista). */
function hiddenKeysFor(
    fields: Field[],
    settings: Record<string, unknown>,
    role: Role,
): Set<string> {
    const hiddenSlugs = hiddenFieldsFor(settings, role);
    if (hiddenSlugs.size === 0) return new Set();
    const keys = new Set<string>();
    for (const f of fields) {
        if (hiddenSlugs.has(f.slug)) keys.add(jsonbKeyForField(f.id));
    }
    return keys;
}

/** Devuelve el record sin las claves de datos ocultas para el rol. */
function stripHidden(record: RecordDto, hiddenKeys: Set<string>): RecordDto {
    if (hiddenKeys.size === 0) return record;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record.data)) {
        if (!hiddenKeys.has(k)) data[k] = v;
    }
    const relations: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(record.relations ?? {})) {
        if (!hiddenKeys.has(k)) relations[k] = v;
    }
    return { ...record, data, relations };
}

/** Merge parcial: null borra la clave; el resto sobrescribe. */
function mergeData(
    current: Record<string, unknown>,
    patch: Record<string, unknown>,
): Record<string, unknown> {
    const merged = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
    }
    return merged;
}

function recordNotFound(id: number): NotFoundException {
    return new NotFoundException({
        code: 'record_not_found',
        message: `Registro ${id} no encontrado`,
        data: { status: 404 },
    });
}
