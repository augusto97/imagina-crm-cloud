import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    isDataField,
    jsonbKeyForField,
    roleHasCapability,
    validateFieldValue,
    type CreateRecordInput,
    type Field,
    type ListRecordsQuery,
    type RecordDto,
    type Role,
    type UpdateRecordInput,
} from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { records } from '../db/schema';
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
    ) {}

    async create(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        input: CreateRecordInput,
    ): Promise<RecordDto> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const fields = await this.fields.list(tenantId, String(listId));
        const data = this.validateData(fields, input.data, { partial: false });

        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.insert(tx, { tenantId, listId, data, createdBy: actor.userId }),
        );
        this.realtime.records(tenantId, listId);
        return toRecord(row);
    }

    async get(tenantId: number, actor: Actor, listIdOrSlug: string, id: number): Promise<RecordDto> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findById(tx, tenantId, listId, id),
        );
        // Solo-propios: si no ve todos y no es el dueño, 404 (no filtramos info).
        if (!row || !this.canReach(actor, 'view', row)) throw recordNotFound(id);
        return toRecord(row);
    }

    async list(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        query: ListRecordsQuery,
    ): Promise<RecordsPage> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const fields = await this.fields.list(tenantId, String(listId));
        const fieldsById = new Map<number, FilterableField>(
            fields.map((f) => [f.id, { id: f.id, type: f.type }]),
        );
        const filterWhere = compileFilterTree(fieldsById, query.filter_tree, new Date());
        // Solo-propios: los agents ven únicamente sus registros (created_by).
        const ownerWhere = roleHasCapability(actor.role, 'view_records')
            ? undefined
            : eq(records.createdBy, actor.userId);
        const where = filterWhere && ownerWhere ? and(filterWhere, ownerWhere) : filterWhere ?? ownerWhere;

        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.list(tx, tenantId, listId, {
                where,
                cursor: query.cursor,
                limit: query.limit,
                dir: query.sort_dir,
            }),
        );

        // Pedimos limit+1 para detectar página siguiente sin contar todo.
        const hasMore = rows.length > query.limit;
        const page = hasMore ? rows.slice(0, query.limit) : rows;
        const nextCursor = hasMore ? String(page[page.length - 1]!.id) : null;
        return { data: page.map(toRecord), meta: { next_cursor: nextCursor } };
    }

    async update(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        id: number,
        input: UpdateRecordInput,
    ): Promise<RecordDto> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const fields = await this.fields.list(tenantId, String(listId));

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, listId, id);
            if (!current || !this.canReach(actor, 'edit', current)) throw recordNotFound(id);

            // Merge parcial: validamos SOLO los campos presentes en el patch.
            const patch = this.validateData(fields, input.data, { partial: true });
            const merged = mergeData(current.data, patch);
            return this.repo.updateData(tx, tenantId, listId, id, merged);
        });
        if (!row) throw recordNotFound(id);
        this.realtime.records(tenantId, listId);
        return toRecord(row);
    }

    async remove(tenantId: number, actor: Actor, listIdOrSlug: string, id: number): Promise<void> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const deleted = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, listId, id);
            if (!current || !this.canReach(actor, 'delete', current)) return false;
            return this.repo.softDelete(tx, tenantId, listId, id);
        });
        if (!deleted) throw recordNotFound(id);
        this.realtime.records(tenantId, listId);
    }

    /**
     * Scoping de "own records": si el rol tiene la capability plena (view/
     * edit/delete_records) alcanza cualquier registro; si solo tiene la
     * variante `_own_`, únicamente los que creó (CONTRACT §6).
     */
    private canReach(actor: Actor, action: 'view' | 'edit' | 'delete', row: RecordRow): boolean {
        const full = { view: 'view_records', edit: 'edit_records', delete: 'delete_records' } as const;
        if (roleHasCapability(actor.role, full[action])) return true;
        return row.createdBy === actor.userId;
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
