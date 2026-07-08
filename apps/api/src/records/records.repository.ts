import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { records } from '../db/schema';

export type RecordRow = typeof records.$inferSelect;

export interface ListRecordsOpts {
    where?: SQL;
    cursor?: number;
    limit: number;
    dir: 'asc' | 'desc';
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
        const cursorClause =
            opts.cursor !== undefined
                ? opts.dir === 'asc'
                    ? gt(records.id, opts.cursor)
                    : lt(records.id, opts.cursor)
                : undefined;

        return tx
            .select()
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, listId),
                    isNull(records.deletedAt),
                    opts.where,
                    cursorClause,
                ),
            )
            .orderBy(opts.dir === 'asc' ? asc(records.id) : desc(records.id))
            .limit(opts.limit + 1);
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
