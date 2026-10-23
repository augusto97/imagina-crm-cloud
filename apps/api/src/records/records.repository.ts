import { Injectable } from '@nestjs/common';
import type { RichDoc } from '@imagina-base/shared';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { records } from '../db/schema';

export type RecordRow = typeof records.$inferSelect;

/**
 * Columnas del LISTADO: todas menos `description` (que puede pesar cientos de
 * KB por fila), más el booleano que necesita el icono de la tabla.
 */
const LIST_COLUMNS = {
    id: records.id,
    tenantId: records.tenantId,
    listId: records.listId,
    data: records.data,
    parentId: records.parentId,
    createdBy: records.createdBy,
    createdAt: records.createdAt,
    updatedAt: records.updatedAt,
    updatedBy: records.updatedBy,
    deletedAt: records.deletedAt,
    hasDescription: sql<boolean>`(${records.description} IS NOT NULL)`,
} as const;

export type RecordListRow = Omit<RecordRow, 'description' | 'descriptionText' | 'deletedBy'> & { hasDescription: boolean };

export interface ListRecordsOpts {
    where?: SQL;
    cursor?: number;
    limit: number;
    dir: 'asc' | 'desc';
    /**
     * Orden por CAMPO (expresiones tipadas whitelisted del QueryBuilder).
     * Cuando está presente, el keyset por id no aplica: se pagina por
     * `offset` (el service reinterpreta el cursor).
     */
    orderBy?: SQL[];
    offset?: number;
    /**
     * Subtareas (v0.1.132): `'roots'` = sólo primer nivel (el default del
     * listado), un id = las subtareas de ese registro, `'any'` = todo plano.
     */
    parent?: 'roots' | 'any' | number;
}

/**
 * Acceso a datos de `records`, tenant-scoped (RLS + tenant_id explícito).
 * Soft-delete por `deleted_at`; toda lectura excluye borrados.
 */
@Injectable()
export class RecordsRepository {
    async insert(tx: Tx, values: typeof records.$inferInsert): Promise<RecordRow> {
        const [row] = await tx.insert(records).values(values).returning();
        if (!row) throw new Error('Insert de record no devolvió fila');
        return row;
    }

    /**
     * Una fila SIN el documento de descripción (v0.1.257): se llama en cada
     * edición, recurrencia, automatización y comentario, y la descripción
     * puede pesar cientos de KB — casi nadie la necesita. El que sí, usa
     * `findDescription`.
     */
    async findById(tx: Tx, tenantId: number, listId: number, id: number): Promise<RecordListRow | null> {
        const [row] = await tx
            .select(LIST_COLUMNS)
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    eq(records.id, id),
                    isNull(records.deletedAt),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    /**
     * Igual que `findById` pero BLOQUEA la fila hasta el final de la
     * transacción (`FOR NO KEY UPDATE`, el mismo lock que toma un UPDATE).
     *
     * Quien lee → mezcla en JS → reescribe el `data` entero tiene que leer con
     * esto: sin lock, dos ediciones simultáneas de campos DISTINTOS leían el
     * mismo `data`, y la que terminaba última pisaba a la otra (auditoría:
     * 8 PATCH en paralelo → sobrevivían 3). Con el lock la segunda espera a que
     * la primera haga commit y relee la fila ya cambiada, así el diff de la
     * actividad y el antes/después de los avisos siguen siendo exactos.
     *
     * `NO KEY UPDATE` y no `UPDATE`: no choca con el `KEY SHARE` que toman las
     * FK (relaciones, actividad) que apuntan a la fila — dos ediciones que se
     * vinculan entre sí no se trancan.
     */
    async findByIdForUpdate(tx: Tx, tenantId: number, listId: number, id: number): Promise<RecordListRow | null> {
        const [row] = await tx
            .select(LIST_COLUMNS)
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    eq(records.id, id),
                    isNull(records.deletedAt),
                ),
            )
            .limit(1)
            .for('no key update');
        return row ?? null;
    }

    /**
     * Listado con cursor pagination keyset por `id` (STANDALONE §3.5).
     * Pide `limit + 1` para saber si hay página siguiente sin contar todo.
     */
    async list(tx: Tx, tenantId: number, listId: number, opts: ListRecordsOpts): Promise<RecordListRow[]> {
        const sorted = opts.orderBy !== undefined && opts.orderBy.length > 0;
        // v0.1.187 — un `offset` explícito (paginación por página) manda
        // también sin sort por campo: el keyset por id no aplica ahí.
        const byOffset = sorted || opts.offset !== undefined;
        const cursorClause =
            !byOffset && opts.cursor !== undefined
                ? opts.dir === 'asc'
                    ? gt(records.id, opts.cursor)
                    : lt(records.id, opts.cursor)
                : undefined;

        const parentClause =
            opts.parent === undefined || opts.parent === 'roots'
                ? isNull(records.parentId)
                : opts.parent === 'any'
                    ? undefined
                    : eq(records.parentId, opts.parent);

        const base = tx
            // v0.1.133 — el listado NO trae la descripción: un documento por
            // fila multiplicaría el peso de la página (y la tabla sólo
            // necesita saber si hay o no). El contenido se pide aparte.
            .select(LIST_COLUMNS)
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    isNull(records.deletedAt),
                    parentClause,
                    opts.where,
                    cursorClause,
                ),
            )
            .orderBy(
                ...(sorted ? opts.orderBy! : []),
                // Tiebreaker estable (y orden canónico sin sort por campo).
                opts.dir === 'asc' ? asc(records.id) : desc(records.id),
            )
            .limit(opts.limit + 1);
        return byOffset ? base.offset(opts.offset ?? 0) : base;
    }

    /**
     * v0.1.286 — las primeras `perGroup` filas de PRIMER NIVEL de cada grupo
     * (vista agrupada) en dos consultas: una ventana `row_number()` particionada
     * por la clave del grupo elige los ids, y después se leen esas filas con las
     * columnas del listado. Devuelve las filas en orden (grupo, posición).
     */
    async listPerGroup(
        tx: Tx,
        tenantId: number,
        listId: number,
        opts: {
            where?: SQL;
            groupExpr: SQL;
            keys: Array<string | null>;
            orderBy: SQL[];
            perGroup: number;
            /** v0.1.297 — tope propio de algunos grupos («Mostrar más» de una columna del kanban). */
            limits?: Array<{ key: string | null; limit: number }>;
            /** v0.1.297 — orden sin orden por campo (el kanban: lo actualizado hace poco primero). */
            fallbackOrder?: SQL[];
        },
    ): Promise<Array<{ group: string | null; row: RecordListRow }>> {
        if (opts.keys.length === 0) return [];
        const base = and(
            eq(records.tenantId, tenantId),
            eq(records.listId, listId),
            isNull(records.deletedAt),
            isNull(records.parentId),
            opts.where,
        );
        // La clave del grupo se calcula UNA vez por fila: la subconsulta va con
        // `OFFSET 0` (no se aplana) y se llama "records", así el orden por campo
        // —que apunta a `"records"."data"`— sigue valiendo sin tocarlo. Sin eso
        // la expresión (cara en un multi_select) se repetía en el filtro, en la
        // partición y en el SELECT.
        const grp = sql`${sql.identifier('records')}.${sql.identifier('grp')}`;
        const values = opts.keys.filter((k): k is string => k !== null);
        const keyParts: SQL[] = [];
        if (values.length > 0) keyParts.push(sql`${grp} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`);
        if (opts.keys.includes(null)) keyParts.push(sql`${grp} IS NULL`);
        const primary = opts.orderBy.length > 0 ? opts.orderBy : (opts.fallbackOrder ?? []);
        const order = sql.join([...primary, sql`${records.id} ASC`], sql`, `);
        const limit = perGroupLimit(opts.perGroup, (opts.limits ?? []).map((l) => ({ match: sql`t.grp IS NOT DISTINCT FROM ${l.key}::text`, limit: l.limit })));
        const picked = await tx.execute(sql`
            SELECT t.id, t.grp FROM (
                SELECT ${records.id} AS id, ${grp} AS grp,
                       row_number() OVER (PARTITION BY ${grp} ORDER BY ${order}) AS rn
                FROM (
                    SELECT ${records}.*, (${opts.groupExpr})::text AS grp
                    FROM ${records}
                    WHERE ${base}
                    OFFSET 0
                ) AS ${sql.identifier('records')}
                WHERE ${sql.join(keyParts, sql` OR `)}
            ) t
            WHERE t.rn <= ${limit}
            ORDER BY t.grp, t.rn`);
        const picks = (picked.rows as Array<{ id: string | number; grp: string | null }>).map((r) => ({
            id: Number(r.id),
            group: r.grp === null || r.grp === undefined ? null : String(r.grp),
        }));
        if (picks.length === 0) return [];
        const rows = await tx
            .select(LIST_COLUMNS)
            .from(records)
            .where(and(eq(records.tenantId, tenantId), inArray(records.id, picks.map((o) => o.id))));
        const byId = new Map(rows.map((r) => [r.id, r]));
        return picks.flatMap((o) => {
            const row = byId.get(o.id);
            return row ? [{ group: o.group, row }] : [];
        });
    }

    /**
     * v0.1.287 — Como `listPerGroup` pero para la vista agrupada en DOS
     * niveles: las primeras `perGroup` filas de cada PAR (grupo, subgrupo)
     * pedido, en una consulta (`row_number()` particionado por las dos
     * claves). Las claves se calculan una vez por fila en la subconsulta.
     */
    async listPerGroupPair(
        tx: Tx,
        tenantId: number,
        listId: number,
        opts: {
            where?: SQL;
            groupExpr: SQL;
            subExpr: SQL;
            pairs: Array<[string | null, string | null]>;
            orderBy: SQL[];
            perGroup: number;
            /** v0.1.297 — tope propio de algunos pares (celdas del kanban con «Mostrar más»). */
            limits?: Array<{ pair: [string | null, string | null]; limit: number }>;
            fallbackOrder?: SQL[];
        },
    ): Promise<Array<{ group: string | null; sub: string | null; row: RecordListRow }>> {
        if (opts.pairs.length === 0) return [];
        const base = and(
            eq(records.tenantId, tenantId),
            eq(records.listId, listId),
            isNull(records.deletedAt),
            isNull(records.parentId),
            opts.where,
        );
        const grp = sql`${sql.identifier('records')}.${sql.identifier('grp')}`;
        const sub = sql`${sql.identifier('records')}.${sql.identifier('sub')}`;
        // `IS NOT DISTINCT FROM`: el par puede llevar el grupo «(sin valor)».
        const pairParts = opts.pairs.map(
            ([g, s]) => sql`(${grp} IS NOT DISTINCT FROM ${g}::text AND ${sub} IS NOT DISTINCT FROM ${s}::text)`,
        );
        const primary = opts.orderBy.length > 0 ? opts.orderBy : (opts.fallbackOrder ?? []);
        const order = sql.join([...primary, sql`${records.id} ASC`], sql`, `);
        const limit = perGroupLimit(
            opts.perGroup,
            (opts.limits ?? []).map((l) => ({
                match: sql`t.grp IS NOT DISTINCT FROM ${l.pair[0]}::text AND t.sub IS NOT DISTINCT FROM ${l.pair[1]}::text`,
                limit: l.limit,
            })),
        );
        const picked = await tx.execute(sql`
            SELECT t.id, t.grp, t.sub FROM (
                SELECT ${records.id} AS id, ${grp} AS grp, ${sub} AS sub,
                       row_number() OVER (PARTITION BY ${grp}, ${sub} ORDER BY ${order}) AS rn
                FROM (
                    SELECT ${records}.*, (${opts.groupExpr})::text AS grp, (${opts.subExpr})::text AS sub
                    FROM ${records}
                    WHERE ${base}
                    OFFSET 0
                ) AS ${sql.identifier('records')}
                WHERE ${sql.join(pairParts, sql` OR `)}
            ) t
            WHERE t.rn <= ${limit}
            ORDER BY t.grp, t.sub, t.rn`);
        const picks = (picked.rows as Array<{ id: string | number; grp: string | null; sub: string | null }>).map((r) => ({
            id: Number(r.id),
            group: r.grp === null || r.grp === undefined ? null : String(r.grp),
            sub: r.sub === null || r.sub === undefined ? null : String(r.sub),
        }));
        if (picks.length === 0) return [];
        const rows = await tx
            .select(LIST_COLUMNS)
            .from(records)
            .where(and(eq(records.tenantId, tenantId), inArray(records.id, picks.map((o) => o.id))));
        const byId = new Map(rows.map((r) => [r.id, r]));
        return picks.flatMap((o) => {
            const row = byId.get(o.id);
            return row ? [{ group: o.group, sub: o.sub, row }] : [];
        });
    }

    /**
     * Cuántos registros matchean el MISMO where/scope del listado (v0.1.187,
     * para `meta.total` de la paginación por página). Una query aparte a
     * propósito: sumarle `count(*) over()` a la página encarecería CADA
     * listado por cursor, que no lo necesita.
     */
    async count(
        tx: Tx,
        tenantId: number,
        listId: number,
        opts: Pick<ListRecordsOpts, 'where' | 'parent'>,
    ): Promise<number> {
        const parentClause =
            opts.parent === undefined || opts.parent === 'roots'
                ? isNull(records.parentId)
                : opts.parent === 'any'
                    ? undefined
                    : eq(records.parentId, opts.parent);
        const [row] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    isNull(records.deletedAt),
                    parentClause,
                    opts.where,
                ),
            );
        return row?.n ?? 0;
    }

    /**
     * Cuántas subtareas VIVAS cuelga cada uno de estos registros. Una sola
     * query por página (regla de oro nº 8) — sin esto sería un count por fila.
     */
    async subtaskCounts(tx: Tx, tenantId: number, parentIds: number[]): Promise<Map<number, number>> {
        if (parentIds.length === 0) return new Map();
        const rows = await tx
            .select({ parentId: records.parentId, n: sql<number>`count(*)::int` })
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    inArray(records.parentId, parentIds),
                    isNull(records.deletedAt),
                ),
            )
            .groupBy(records.parentId);
        return new Map(rows.filter((r) => r.parentId !== null).map((r) => [r.parentId!, r.n]));
    }

    /**
     * ¿Esta lista tiene al menos una subtarea viva? Lo usa el export CSV para
     * decidir si emite las columnas de jerarquía (una lista sin subtareas
     * exporta exactamente igual que antes de v0.1.132).
     */
    async hasSubtasks(tx: Tx, tenantId: number, listId: number): Promise<boolean> {
        const rows = await tx
            .select({ id: records.id })
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    isNotNull(records.parentId),
                    isNull(records.deletedAt),
                ),
            )
            .limit(1);
        return rows.length > 0;
    }

    /** De estos ids, cuáles son registros VIVOS de primer nivel de la lista. */
    async rootIdsIn(tx: Tx, tenantId: number, listId: number, ids: number[]): Promise<Set<number>> {
        if (ids.length === 0) return new Set();
        const rows = await tx
            .select({ id: records.id })
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    inArray(records.id, ids),
                    isNull(records.parentId),
                    isNull(records.deletedAt),
                ),
            );
        return new Set(rows.map((r) => r.id));
    }

    /** Cuelga un lote de registros del mismo padre (import de subtareas). */
    async setParent(
        tx: Tx,
        tenantId: number,
        listId: number,
        ids: number[],
        parentId: number,
    ): Promise<void> {
        if (ids.length === 0) return;
        await tx
            .update(records)
            .set({ parentId })
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    inArray(records.id, ids),
                ),
            );
    }

    /**
     * Sólo la descripción de un registro (v0.1.133). Query propia porque es
     * lo ÚNICO que no viaja en el listado: se pide al abrir la ficha.
     */
    async findDescription(
        tx: Tx,
        tenantId: number,
        listId: number,
        id: number,
    ): Promise<{ description: RichDoc | null } | null> {
        const [row] = await tx
            .select({ description: records.description })
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    eq(records.id, id),
                    isNull(records.deletedAt),
                ),
            )
            .limit(1);
        return row === undefined ? null : { description: row.description ?? null };
    }

    /** Persiste (o borra, con `null`) la descripción. */
    async updateDescription(
        tx: Tx,
        tenantId: number,
        listId: number,
        id: number,
        description: RichDoc | null,
        /** v0.1.300 — quién la cambió («Modificado por»); 0 = el sistema. */
        updatedBy?: number,
    ): Promise<void> {
        await tx
            .update(records)
            .set({ description, updatedAt: new Date(), ...(updatedBy !== undefined ? { updatedBy } : {}) })
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    eq(records.id, id),
                ),
            );
    }

    /**
     * Marca como borradas las subtareas de un padre (mismo tx que el padre).
     * `now()` es el instante de la TRANSACCIÓN: el padre y sus subtareas
     * quedan con la misma fecha, y así restaurar el padre trae justo las que
     * se fueron con él (no las que ya estaban en la papelera de antes).
     */
    async softDeleteChildren(tx: Tx, tenantId: number, parentId: number, userId: number | null = null): Promise<void> {
        await tx
            .update(records)
            .set({ deletedAt: sql`now()`, deletedBy: userId })
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.parentId, parentId),
                    isNull(records.deletedAt),
                ),
            );
    }

    async updateData(
        tx: Tx,
        tenantId: number,
        listId: number,
        id: number,
        data: Record<string, unknown>,
        /** v0.1.300 — quién lo cambió («Modificado por»); 0 = el sistema. */
        updatedBy?: number,
    ): Promise<RecordRow | null> {
        const [row] = await tx
            .update(records)
            .set({ data, updatedAt: sql`now()`, ...(updatedBy !== undefined ? { updatedBy } : {}) })
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    eq(records.id, id),
                    isNull(records.deletedAt),
                ),
            )
            .returning();
        return row ?? null;
    }

    async softDelete(tx: Tx, tenantId: number, listId: number, id: number, userId: number | null = null): Promise<boolean> {
        const rows = await tx
            .update(records)
            .set({ deletedAt: sql`now()`, deletedBy: userId })
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    eq(records.id, id),
                    isNull(records.deletedAt),
                ),
            )
            .returning({ id: records.id });
        return rows.length > 0;
    }
}

/**
 * v0.1.297 — Tope de filas por grupo: el general o, para los grupos con tope propio
 * («Mostrar más» de una columna del kanban), el suyo. Todo bindeado; los casts
 * a `int` hacen falta porque dentro de un CASE los parámetros sin tipo se
 * resuelven como texto.
 */
function perGroupLimit(perGroup: number, overrides: Array<{ match: SQL; limit: number }>): SQL {
    if (overrides.length === 0) return sql`${perGroup}`;
    const whens = overrides.map((o) => sql`WHEN ${o.match} THEN ${o.limit}::int`);
    return sql`(CASE ${sql.join(whens, sql` `)} ELSE ${perGroup}::int END)`;
}
