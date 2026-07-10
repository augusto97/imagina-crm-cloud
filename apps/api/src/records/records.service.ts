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
        const data = this.validateData(fields, input.data, { partial: false });

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const inserted = await this.repo.insert(tx, {
                tenantId,
                listId,
                data,
                createdBy: actor.userId,
            });
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
        return toRecord(row);
    }

    async get(tenantId: number, actor: Actor, listIdOrSlug: string, id: number): Promise<RecordDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const { row, hiddenKeys } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const r = await this.repo.findById(tx, tenantId, list.id, id);
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            return { row: r, hiddenKeys: hiddenKeysFor(fields, list.settings, actor.role) };
        });
        // ACL: si el scope no alcanza esta fila, 404 (no filtramos info).
        if (!row || !this.aclCanReach(list, actor, 'view', row)) throw recordNotFound(id);
        return stripHidden(toRecord(row), hiddenKeys);
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
        const { rows, hiddenKeys } = await this.tenantDb.withTenant(tenantId, async (tx) => {
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
            return { rows: result, hiddenKeys: hiddenKeysFor(fields, list.settings, actor.role) };
        });

        // Pedimos limit+1 para detectar página siguiente sin contar todo.
        const hasMore = rows.length > query.limit;
        const page = hasMore ? rows.slice(0, query.limit) : rows;
        const nextCursor = hasMore ? String(page[page.length - 1]!.id) : null;
        return { data: page.map((r) => stripHidden(toRecord(r), hiddenKeys)), meta: { next_cursor: nextCursor } };
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

        const result = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, listId, id);
            if (!current || !this.aclCanReach(list, actor, 'edit', current)) throw recordNotFound(id);

            // Merge parcial: validamos SOLO los campos presentes en el patch.
            const patch = this.validateData(fields, input.data, { partial: true });
            const merged = mergeData(current.data, patch);
            const updated = await this.repo.updateData(tx, tenantId, listId, id, merged);
            if (updated) {
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId,
                    recordId: id,
                    userId: actor.userId,
                    action: 'record_updated',
                    diff: computeDiff(current.data, merged),
                });
            }
            return { updated, before: current.data };
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
        return toRecord(row);
    }

    async remove(tenantId: number, actor: Actor, listIdOrSlug: string, id: number): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const listId = list.id;
        const deleted = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, listId, id);
            if (!current || !this.aclCanReach(list, actor, 'delete', current)) return false;
            const ok = await this.repo.softDelete(tx, tenantId, listId, id);
            if (ok) {
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

function toRecord(row: RecordRow): RecordDto {
    return {
        id: row.id,
        list_id: row.listId,
        data: row.data,
        created_by: row.createdBy,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
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
    return { ...record, data };
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
