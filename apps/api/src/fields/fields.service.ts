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
    validateFieldValue,
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

        let typeChanged = false;
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.resolveField(tx, tenantId, listId, fieldIdOrSlug);

            const changes: Partial<typeof import('../db/schema').fields.$inferInsert> = {};
            if (patch.label !== undefined) changes.label = patch.label;
            if (patch.is_required !== undefined) changes.isRequired = patch.is_required;
            if (patch.is_unique !== undefined) changes.isUnique = patch.is_unique;
            if (patch.position !== undefined) changes.position = patch.position;

            // Conversión de tipo: valida compatibilidad, arma la config del
            // tipo NUEVO y migra los datos existentes en la misma tx.
            const toType = patch.type as FieldType | undefined;
            if (toType !== undefined && toType !== current.type) {
                assertConvertible(current.type as FieldType, toType);
                let newConfig = safeConfig(toType, patch.config ?? {});
                // A select/multi_select sin opciones: se generan de los
                // valores DISTINTOS existentes (mismo espíritu que la
                // auto-expansión del import) — así nada se pierde.
                if (
                    (toType === 'select' || toType === 'multi_select')
                    && !(Array.isArray((newConfig as { options?: unknown[] }).options) && (newConfig as { options: unknown[] }).options.length > 0)
                ) {
                    const distinct = await collectDistinctValues(tx, tenantId, listId, current.id, current.type as FieldType);
                    newConfig = { ...newConfig, options: distinct.map((v) => ({ value: v, label: v })) };
                }
                changes.type = toType;
                changes.config = newConfig;
                await migrateFieldData(tx, tenantId, listId, current.id, current.type as FieldType, toType, newConfig);
                typeChanged = true;
            } else if (patch.config !== undefined) {
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
        if (typeChanged) {
            // El índice viejo indexa la expresión del tipo ANTERIOR — se
            // suelta siempre y se recrea con la del nuevo si estaba activo.
            await this.syncFieldIndexes(row.id, row.type as FieldType, false);
            if (row.isIndexed) {
                await this.syncFieldIndexes(row.id, row.type as FieldType, true);
            }
        } else if (patch.is_indexed !== undefined) {
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

// ─── Conversión de tipo (v0.1.85) ────────────────────────────────────────

/**
 * Tipos NO convertibles: su almacenamiento/semántica difiere del JSONB plano
 * (relation vive en la tabla `relations`, computed jamás se persiste, file
 * son IDs de attachments que dejarían huérfanos silenciosos).
 */
const NON_CONVERTIBLE: readonly FieldType[] = ['computed', 'relation', 'file'];

function assertConvertible(from: FieldType, to: FieldType): void {
    if (NON_CONVERTIBLE.includes(from) || NON_CONVERTIBLE.includes(to)) {
        throw new BadRequestException({
            code: 'type_not_convertible',
            message: `No se puede convertir entre '${from}' y '${to}' — los tipos relación, archivo y calculado no admiten conversión.`,
            data: { status: 400 },
        });
    }
}

const CONVERT_BATCH = 500;

/**
 * Valores DISTINTOS no vacíos del campo (hasta 50) — para auto-generar las
 * options al convertir a select/multi_select sin perder datos. Fuente
 * multi_select: se desanidan los elementos del array.
 */
async function collectDistinctValues(
    tx: Tx,
    tenantId: number,
    listId: number,
    fieldId: number,
    fromType: FieldType,
): Promise<string[]> {
    const key = jsonbKeyForField(fieldId);
    const valueExpr =
        fromType === 'multi_select'
            ? sql<string | null>`jsonb_array_elements_text(${records.data} -> ${key})`
            : sql<string | null>`${records.data} ->> ${key}`;
    const rows = await tx
        .selectDistinct({ v: valueExpr })
        .from(records)
        .where(
            and(
                eq(records.tenantId, tenantId),
                eq(records.listId, listId),
                isNull(records.deletedAt),
                // Forma función de `data ? key` — el operador `?` choca con
                // los placeholders de algunos drivers.
                sql`jsonb_exists(${records.data}, ${key})`,
            ),
        )
        .limit(50);
    return rows
        .map((r) => r.v)
        .filter((v): v is string => typeof v === 'string' && v !== '');
}

/**
 * Migra los valores existentes al tipo nuevo, por lotes keyset dentro de la
 * MISMA tx del cambio de schema: cada valor pasa por un puente de coerción
 * (fechas recortadas/extendidas, arrays↔escalares, números↔strings) y por
 * `validateFieldValue` del tipo destino; lo inválido se LIMPIA (la celda
 * queda vacía — jamás datos corruptos con el tipo equivocado).
 */
async function migrateFieldData(
    tx: Tx,
    tenantId: number,
    listId: number,
    fieldId: number,
    fromType: FieldType,
    toType: FieldType,
    config: Record<string, unknown>,
): Promise<void> {
    const key = jsonbKeyForField(fieldId);
    const spec = { type: toType, config, is_required: false };
    let cursor = 0;
    for (;;) {
        const batch = await tx
            .select({ id: records.id, data: records.data })
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    isNull(records.deletedAt),
                    sql`${records.id} > ${cursor}`,
                    sql`jsonb_exists(${records.data}, ${key})`,
                ),
            )
            .orderBy(records.id)
            .limit(CONVERT_BATCH);
        if (batch.length === 0) break;
        for (const row of batch) {
            cursor = row.id;
            const raw = (row.data as Record<string, unknown>)[key];
            if (raw === null || raw === undefined) continue;
            const bridged = bridgeValue(fromType, toType, raw);
            const result = validateFieldValue(spec, bridged);
            const next = result.ok ? result.value : null;
            // Solo escribimos si el valor CAMBIA (la mayoría de conversiones
            // compatibles —ej. text→select con options de los valores— no
            // tocan ninguna fila).
            if (JSON.stringify(next) === JSON.stringify(raw)) continue;
            if (next === null) {
                await tx
                    .update(records)
                    .set({ data: sql`data - ${key}`, updatedAt: sql`now()` })
                    .where(and(eq(records.tenantId, tenantId), eq(records.id, row.id)));
            } else {
                await tx
                    .update(records)
                    .set({
                        data: sql`jsonb_set(data, ${sql.raw(`'{${key}}'`)}, ${JSON.stringify(next)}::jsonb)`,
                        updatedAt: sql`now()`,
                    })
                    .where(and(eq(records.tenantId, tenantId), eq(records.id, row.id)));
            }
        }
        if (batch.length < CONVERT_BATCH) break;
    }
}

/**
 * Puente de coerción entre tipos ANTES del validador destino: cubre los
 * saltos razonables que el validador (estricto por diseño) rechazaría.
 */
function bridgeValue(from: FieldType, to: FieldType, raw: unknown): unknown {
    // multi_select destino: un escalar se envuelve en lista.
    if (to === 'multi_select' && !Array.isArray(raw)) {
        return raw === '' ? null : [String(raw)];
    }
    // multi_select origen → escalar: texto largo une con coma; select/resto
    // toman la primera opción.
    if (from === 'multi_select' && Array.isArray(raw) && to !== 'multi_select') {
        if (to === 'text' || to === 'long_text') return raw.map((x) => String(x)).join(', ');
        return raw.length > 0 ? String(raw[0]) : null;
    }
    if (to === 'date' && typeof raw === 'string' && raw.length > 10) return raw.slice(0, 10);
    if (to === 'datetime' && typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return `${raw} 00:00:00`;
    }
    // Destinos string-like: cualquier escalar se vuelve texto (5000 → "5000").
    if (
        (to === 'text' || to === 'long_text' || to === 'select' || to === 'email' || to === 'url')
        && typeof raw !== 'string'
        && (typeof raw === 'number' || typeof raw === 'boolean')
    ) {
        return String(raw);
    }
    return raw;
}
