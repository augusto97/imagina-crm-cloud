import { Injectable } from '@nestjs/common';
import { and, asc, eq, max, ne, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { lists } from '../db/schema';

export type ListRow = typeof lists.$inferSelect;

/**
 * Acceso a datos de `lists`. Todos los métodos reciben un `tx` ya scopeado a
 * un tenant (withTenant): la RLS filtra por `app.tenant_id` y además pasamos
 * `tenant_id` explícito como defensa en profundidad (regla de oro nº 3).
 */
@Injectable()
export class ListsRepository {
    listAll(tx: Tx, tenantId: number): Promise<ListRow[]> {
        return tx
            .select()
            .from(lists)
            .where(eq(lists.tenantId, tenantId))
            .orderBy(asc(lists.position), asc(lists.id));
    }

    async findById(tx: Tx, tenantId: number, id: number): Promise<ListRow | null> {
        const [row] = await tx
            .select()
            .from(lists)
            .where(and(eq(lists.tenantId, tenantId), eq(lists.id, id)))
            .limit(1);
        return row ?? null;
    }

    async findBySlug(tx: Tx, tenantId: number, slug: string): Promise<ListRow | null> {
        const [row] = await tx
            .select()
            .from(lists)
            .where(and(eq(lists.tenantId, tenantId), eq(lists.slug, slug)))
            .limit(1);
        return row ?? null;
    }

    /** ¿Existe el slug en el tenant? `exceptId` excluye la propia lista al renombrar. */
    async slugExists(
        tx: Tx,
        tenantId: number,
        slug: string,
        exceptId?: number,
    ): Promise<boolean> {
        const [row] = await tx
            .select({ id: lists.id })
            .from(lists)
            .where(
                and(
                    eq(lists.tenantId, tenantId),
                    eq(lists.slug, slug),
                    exceptId !== undefined ? ne(lists.id, exceptId) : undefined,
                ),
            )
            .limit(1);
        return row !== undefined;
    }

    async nextPosition(tx: Tx, tenantId: number): Promise<number> {
        const [row] = await tx
            .select({ maxPos: max(lists.position) })
            .from(lists)
            .where(eq(lists.tenantId, tenantId));
        return (row?.maxPos ?? -1) + 1;
    }

    async insert(
        tx: Tx,
        values: typeof lists.$inferInsert,
    ): Promise<ListRow> {
        const [row] = await tx.insert(lists).values(values).returning();
        if (!row) {
            throw new Error('Insert de lista no devolvió fila');
        }
        return row;
    }

    async update(
        tx: Tx,
        tenantId: number,
        id: number,
        patch: Partial<typeof lists.$inferInsert>,
    ): Promise<ListRow | null> {
        const [row] = await tx
            .update(lists)
            .set({ ...patch, updatedAt: sql`now()` })
            .where(and(eq(lists.tenantId, tenantId), eq(lists.id, id)))
            .returning();
        return row ?? null;
    }

    async remove(tx: Tx, tenantId: number, id: number): Promise<boolean> {
        const rows = await tx
            .delete(lists)
            .where(and(eq(lists.tenantId, tenantId), eq(lists.id, id)))
            .returning({ id: lists.id });
        return rows.length > 0;
    }
}
