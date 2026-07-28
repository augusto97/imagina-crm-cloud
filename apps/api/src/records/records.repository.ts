import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { records } from '../db/schema';

export type RecordRow = typeof records.$inferSelect;

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

    async findById(tx: Tx, tenantId: number, listId: number, id: number): Promise<RecordRow | null> {
        const [row] = await tx
            .select()
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
     * Listado con cursor pagination keyset por `id` (STANDALONE §3.5).
     * Pide `limit + 1` para saber si hay página siguiente sin contar todo.
     */
    async list(tx: Tx, tenantId: number, listId: number, opts: ListRecordsOpts): Promise<RecordRow[]> {
        const sorted = opts.orderBy !== undefined && opts.orderBy.length > 0;
        const cursorClause =
            !sorted && opts.cursor !== undefined
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
            .select()
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
        return sorted ? base.offset(opts.offset ?? 0) : base;
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

    /** Marca como borradas las subtareas de un padre (mismo tx que el padre). */
    async softDeleteChildren(tx: Tx, tenantId: number, parentId: number): Promise<void> {
        await tx
            .update(records)
            .set({ deletedAt: new Date() })
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
    ): Promise<RecordRow | null> {
        const [row] = await tx
            .update(records)
            .set({ data, updatedAt: sql`now()` })
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

    async softDelete(tx: Tx, tenantId: number, listId: number, id: number): Promise<boolean> {
        const rows = await tx
            .update(records)
            .set({ deletedAt: sql`now()` })
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
