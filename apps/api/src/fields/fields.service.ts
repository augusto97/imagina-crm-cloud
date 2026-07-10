import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import {
    fieldSlugSchema,
    jsonbKeyForField,
    parseFieldConfig,
    slugify,
    type CreateFieldInput,
    type Field,
    type FieldType,
    type UpdateFieldInput,
} from '@imagina-base/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { records } from '../db/schema';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ListsService } from '../lists/lists.service';
import { FieldsRepository, type FieldRow } from './fields.repository';
import { createIndexStatements, dropIndexStatements } from './record-indexes';

@Injectable()
export class FieldsService {
    private readonly logger = new Logger(FieldsService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: FieldsRepository,
        private readonly lists: ListsService,
        private readonly realtime: RealtimeService,
        // Conexión base (rol owner, fuera de scope de tenant) para el DDL de
        // índices por campo (PERF-01). Opcional: en tests que instancian el
        // service a mano queda undefined → el DDL es no-op.
        @Optional() @Inject(DRIZZLE) private readonly db?: Db,
    ) {}

    /**
     * Sincroniza los índices de expresión de un campo (PERF-01). `CREATE/DROP
     * INDEX CONCURRENTLY` NO puede correr dentro de una transacción, así que se
     * ejecuta en la conexión base fuera del scope de tenant. Best-effort: un
     * fallo del DDL se loguea pero no rompe la request (el flag ya se guardó).
     */
    private async syncFieldIndexes(fieldId: number, type: FieldType, enable: boolean): Promise<void> {
        if (!this.db) return;
        const statements = enable
            ? createIndexStatements(fieldId, type)
            : dropIndexStatements(fieldId);
        for (const stmt of statements) {
            try {
                await this.db.execute(sql.raw(stmt));
            } catch (err) {
                this.logger.warn(
                    `Índice de campo f${fieldId} (${enable ? 'create' : 'drop'}) falló: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }
    }

    async list(tenantId: number, listIdOrSlug: string): Promise<Field[]> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        return this.listByListId(tenantId, listId);
    }

    /**
     * Igual que `list()` pero con el `list_id` numérico YA resuelto: evita el
     * `lists.get` redundante cuando el caller (p.ej. RecordsService) ya resolvió
     * la lista. Ahorra una transacción con scope por request (perf).
     */
    async listByListId(tenantId: number, listId: number): Promise<Field[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listByList(tx, tenantId, listId),
        );
        return rows.map(toField);
    }

    /** Igual que listByListId pero DENTRO de un tx ya abierto (PERF-02). */
    async listByListIdWithinTx(tx: Tx, tenantId: number, listId: number): Promise<Field[]> {
        const rows = await this.repo.listByList(tx, tenantId, listId);
        return rows.map(toField);
    }

    async get(tenantId: number, listIdOrSlug: string, fieldIdOrSlug: string): Promise<Field> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.resolveField(tx, tenantId, listId, fieldIdOrSlug),
        );
        return toField(row);
    }

    /**
     * Valores distintos de un campo, ordenados por frecuencia desc — para el
     * autocomplete de filtros y conditions de automatizaciones. Tipos con
     * valor opaco/enumerado (select, checkbox, fechas, user, file, relation)
     * devuelven `[]`: sus pickers ya conocen las opciones por otra vía.
     * La clave JSONB se deriva del `field.id` numérico (whitelist implícita);
     * el `search` viaja SIEMPRE como parámetro bindeado (regla de oro nº 4).
     */
    async distinctValues(
        tenantId: number,
        listIdOrSlug: string,
        fieldIdOrSlug: string,
        search: string,
        limit: number,
    ): Promise<Array<{ value: string; count: number }>> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.resolveField(tx, tenantId, listId, fieldIdOrSlug),
        );
        const field = toField(row);
        if (NO_AUTOCOMPLETE_TYPES.has(field.type)) return [];

        const key = jsonbKeyForField(field.id);
        const value = sql<string>`${records.data} ->> ${key}`;
        const cap = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
        const needle = search.trim() === '' ? null : `%${escapeLike(search.trim())}%`;

        return this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ value, count: sql<number>`count(*)::int` })
                .from(records)
                .where(
                    and(
                        eq(records.tenantId, tenantId),
                        eq(records.listId, listId),
                        isNull(records.deletedAt),
                        sql`${records.data} ->> ${key} is not null`,
                        sql`${records.data} ->> ${key} <> ''`,
                        needle === null ? undefined : sql`${records.data} ->> ${key} ilike ${needle}`,
                    ),
                )
                // Ordinales (`GROUP BY 1`): la clave llega como parámetro
                // bindeado y Postgres no unifica dos placeholders idénticos.
                .groupBy(sql`1`)
                .orderBy(sql`2 desc, 1`)
                .limit(cap),
        );
    }

    async create(tenantId: number, listIdOrSlug: string, input: CreateFieldInput): Promise<Field> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const config = safeConfig(input.type, input.config);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const slug = await this.resolveNewSlug(tx, tenantId, listId, input.label, input.slug);
            const position = await this.repo.nextPosition(tx, tenantId, listId);
            return this.repo.insert(tx, {
                tenantId,
                listId,
                slug,
                label: input.label,
                type: input.type,
                config,
                isRequired: input.is_required ?? false,
                isUnique: input.is_unique ?? false,
                isIndexed: input.is_indexed ?? false,
                position,
            });
        });
        this.realtime.fields(tenantId, listId);
        return toField(row);
    }

    async update(
        tenantId: number,
        listIdOrSlug: string,
        fieldIdOrSlug: string,
        patch: UpdateFieldInput,
    ): Promise<Field> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.resolveField(tx, tenantId, listId, fieldIdOrSlug);

            const changes: Partial<typeof import('../db/schema').fields.$inferInsert> = {};
            if (patch.label !== undefined) changes.label = patch.label;
            if (patch.is_required !== undefined) changes.isRequired = patch.is_required;
            if (patch.is_unique !== undefined) changes.isUnique = patch.is_unique;
            if (patch.position !== undefined) changes.position = patch.position;
            if (patch.config !== undefined) {
                changes.config = safeConfig(current.type as FieldType, patch.config);
            }
            if (patch.is_indexed !== undefined) {
                changes.isIndexed = patch.is_indexed;
            }
            if (patch.slug !== undefined && patch.slug !== current.slug) {
                if (await this.repo.slugExists(tx, tenantId, listId, patch.slug, current.id)) {
                    throw slugConflict(patch.slug);
                }
                changes.slug = patch.slug;
            }

            const updated = await this.repo.update(tx, tenantId, listId, current.id, changes);
            if (!updated) throw fieldNotFound(fieldIdOrSlug);
            return updated;
        });
        // PERF-01: crear/soltar el índice de expresión FUERA de la transacción
        // (CONCURRENTLY no puede correr en un tx). Idempotente (IF [NOT] EXISTS).
        if (patch.is_indexed !== undefined) {
            await this.syncFieldIndexes(row.id, row.type as FieldType, patch.is_indexed);
        }
        // Un cambio de schema (config/slug/required) afecta cómo se leen los
        // records → invalidamos fields Y records de la lista.
        this.realtime.fields(tenantId, listId);
        this.realtime.records(tenantId, listId);
        return toField(row);
    }

    async remove(tenantId: number, listIdOrSlug: string, fieldIdOrSlug: string): Promise<void> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const removedId = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.resolveField(tx, tenantId, listId, fieldIdOrSlug);
            await this.repo.remove(tx, tenantId, listId, current.id);
            return current.id;
        });
        // PERF-01: soltar los índices de expresión del campo borrado (best-effort).
        await this.syncFieldIndexes(removedId, 'text', false);
        this.realtime.fields(tenantId, listId);
        this.realtime.records(tenantId, listId);
    }

    async reorder(tenantId: number, listIdOrSlug: string, fieldIds: number[]): Promise<Field[]> {
        const listId = await this.resolveListId(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const existing = await this.repo.existingIds(tx, tenantId, listId, fieldIds);
            if (existing.length !== fieldIds.length || new Set(fieldIds).size !== fieldIds.length) {
                throw new BadRequestException({
                    code: 'invalid_reorder',
                    message: 'field_ids debe contener ids únicos que pertenezcan a la lista',
                    data: { status: 400 },
                });
            }
            await this.repo.applyOrder(tx, tenantId, listId, fieldIds);
            return this.repo.listByList(tx, tenantId, listId);
        });
        this.realtime.fields(tenantId, listId);
        return rows.map(toField);
    }

    /** Resuelve el list_id validando pertenencia al tenant (404 si no existe). */
    private async resolveListId(tenantId: number, listIdOrSlug: string): Promise<number> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return list.id;
    }

    private async resolveField(
        tx: Tx,
        tenantId: number,
        listId: number,
        fieldIdOrSlug: string,
    ): Promise<FieldRow> {
        const row = /^\d+$/.test(fieldIdOrSlug)
            ? await this.repo.findById(tx, tenantId, listId, Number(fieldIdOrSlug))
            : await this.repo.findBySlug(tx, tenantId, listId, fieldIdOrSlug);
        if (!row) throw fieldNotFound(fieldIdOrSlug);
        return row;
    }

    private async resolveNewSlug(
        tx: Tx,
        tenantId: number,
        listId: number,
        label: string,
        provided?: string,
    ): Promise<string> {
        if (provided !== undefined) {
            if (await this.repo.slugExists(tx, tenantId, listId, provided)) {
                throw slugConflict(provided);
            }
            return provided;
        }
        const base = ensureFieldSlug(slugify(label));
        for (let i = 0; i < 1000; i++) {
            const candidate = i === 0 ? base : ensureFieldSlug(`${base.slice(0, 60)}_${i + 1}`);
            if (!(await this.repo.slugExists(tx, tenantId, listId, candidate))) {
                return candidate;
            }
        }
        throw new ConflictException('No se pudo generar un slug de campo disponible');
    }
}

/**
 * Tipos SIN autocomplete de valores (paridad con el plugin): el valor es
 * opaco (file, relation, user), booleano o enumerado por config (select).
 */
const NO_AUTOCOMPLETE_TYPES: ReadonlySet<string> = new Set([
    'select',
    'multi_select',
    'checkbox',
    'date',
    'datetime',
    'file',
    'relation',
    'user',
    'computed',
]);

/** Escapa los metacaracteres de LIKE/ILIKE (`%`, `_`, `\`). */
function escapeLike(s: string): string {
    return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function toField(row: FieldRow): Field {
    return {
        id: row.id,
        list_id: row.listId,
        slug: row.slug,
        label: row.label,
        type: row.type as FieldType,
        config: row.config,
        is_required: row.isRequired,
        is_unique: row.isUnique,
        is_indexed: row.isIndexed,
        position: row.position,
    };
}

/** Valida la config contra el schema del tipo; 400 legible si no cuadra. */
function safeConfig(type: FieldType, config: unknown): Record<string, unknown> {
    try {
        return parseFieldConfig(type, config);
    } catch {
        throw new BadRequestException({
            code: 'invalid_field_config',
            message: `Config inválida para un campo de tipo '${type}'`,
            data: { status: 400, errors: { config: 'No cumple el schema del tipo' } },
        });
    }
}

function ensureFieldSlug(slug: string): string {
    return fieldSlugSchema.safeParse(slug).success ? slug : `campo_${slug}`.slice(0, 63);
}

function slugConflict(slug: string): ConflictException {
    return new ConflictException({
        code: 'slug_taken',
        message: `El slug '${slug}' ya existe en esta lista`,
        data: { status: 409, errors: { slug: 'Ya está en uso' } },
    });
}

function fieldNotFound(idOrSlug: string): NotFoundException {
    return new NotFoundException({
        code: 'field_not_found',
        message: `Campo '${idOrSlug}' no encontrado`,
        data: { status: 404 },
    });
}
