import { Injectable } from '@nestjs/common';
import { and, asc, eq, max, ne, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { savedViews } from '../db/schema';

export type ViewRow = typeof savedViews.$inferSelect;

/** Acceso a datos de saved_views, tenant-scoped (RLS + tenant_id explícito). */
@Injectable()
export class ViewsRepository {
    listByList(tx: Tx, tenantId: number, listId: number): Promise<ViewRow[]> {
        return tx
            .select()
            .from(savedViews)
            .where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.listId, listId)))
            .orderBy(asc(savedViews.position), asc(savedViews.id));
    }

    /** Todas las vistas del tenant (para el endpoint bootstrap — sin N+1). */
    listByTenant(tx: Tx, tenantId: number): Promise<ViewRow[]> {
        return tx
            .select()
            .from(savedViews)
            .where(eq(savedViews.tenantId, tenantId))
            .orderBy(asc(savedViews.listId), asc(savedViews.position), asc(savedViews.id));
    }

    async findById(tx: Tx, tenantId: number, listId: number, id: number): Promise<ViewRow | null> {
        const [row] = await tx
            .select()
            .from(savedViews)
            .where(
                and(
                    eq(savedViews.tenantId, tenantId),
                    eq(savedViews.listId, listId),
                    eq(savedViews.id, id),
                ),
            )
            .limit(1);
        return row ?? null;
    }

    async nextPosition(tx: Tx, tenantId: number, listId: number): Promise<number> {
        const [row] = await tx
            .select({ maxPos: max(savedViews.position) })
            .from(savedViews)
            .where(and(eq(savedViews.tenantId, tenantId), eq(savedViews.listId, listId)));
        return (row?.maxPos ?? -1) + 1;
    }

    /** Baja el default actual de la lista (excepto `exceptId`) para respetar
     *  el índice único parcial "un solo default por lista". */
    async clearDefault(
        tx: Tx,
        tenantId: number,
        listId: number,
        exceptId?: number,
    ): Promise<void> {
        await tx
            .update(savedViews)
            .set({ isDefault: false, updatedAt: sql`now()` })
            .where(
                and(
                    eq(savedViews.tenantId, tenantId),
                    eq(savedViews.listId, listId),
                    eq(savedViews.isDefault, true),
                    exceptId !== undefined ? ne(savedViews.id, exceptId) : undefined,
                ),
            );
    }

    async insert(tx: Tx, values: typeof savedViews.$inferInsert): Promise<ViewRow> {
        const [row] = await tx.insert(savedViews).values(values).returning();
        if (!row) throw new Error('Insert de vista no devolvió fila');
        return row;
    }

    async update(
        tx: Tx,
        tenantId: number,
        listId: number,
        id: number,
        patch: Partial<typeof savedViews.$inferInsert>,
    ): Promise<ViewRow | null> {
        const [row] = await tx
            .update(savedViews)
            .set({ ...patch, updatedAt: sql`now()` })
            .where(
                and(
                    eq(savedViews.tenantId, tenantId),
                    eq(savedViews.listId, listId),
                    eq(savedViews.id, id),
                ),
            )
            .returning();
        return row ?? null;
    }

    async remove(tx: Tx, tenantId: number, listId: number, id: number): Promise<boolean> {
        const rows = await tx
            .delete(savedViews)
            .where(
                and(
                    eq(savedViews.tenantId, tenantId),
                    eq(savedViews.listId, listId),
                    eq(savedViews.id, id),
                ),
            )
            .returning({ id: savedViews.id });
        return rows.length > 0;
    }
}
