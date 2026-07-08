import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, max, ne, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { fields } from '../db/schema';

export type FieldRow = typeof fields.$inferSelect;

/**
 * Acceso a datos de `fields`, tenant-scoped (RLS + tenant_id explícito).
 * La unicidad de slug es POR LISTA (CONTRACT.md §2).
 */
@Injectable()
export class FieldsRepository {
    listByList(tx: Tx, tenantId: number, listId: number): Promise<FieldRow[]> {
        return tx
            .select()
            .from(fields)
            .where(and(eq(fields.tenantId, tenantId), eq(fields.listId, listId)))
            .orderBy(asc(fields.position), asc(fields.id));
    }

    /** Todos los campos del tenant (para el endpoint bootstrap — sin N+1). */
    listByTenant(tx: Tx, tenantId: number): Promise<FieldRow[]> {
        return tx
            .select()
            .from(fields)
            .where(eq(fields.tenantId, tenantId))
            .orderBy(asc(fields.listId), asc(fields.position), asc(fields.id));
    }

    async findById(tx: Tx, tenantId: number, listId: number, id: number): Promise<FieldRow | null> {
        const [row] = await tx
            .select()
            .from(fields)
            .where(
                and(eq(fields.tenantId, tenantId), eq(fields.listId, listId), eq(fields.id, id)),
            )
            .limit(1);
        return row ?? null;
    }

    async findBySlug(
        tx: Tx,
        tenantId: number,
        listId: number,
        slug: string,
    ): Promise<FieldRow | null> {
        const [row] = await tx
            .select()
            .from(fields)
            .where(
                and(eq(fields.tenantId, tenantId), eq(fields.listId, listId), eq(fields.slug, slug)),
            )
            .limit(1);
        return row ?? null;
    }

    async slugExists(
        tx: Tx,
        tenantId: number,
        listId: number,
        slug: string,
        exceptId?: number,
    ): Promise<boolean> {
        const [row] = await tx
            .select({ id: fields.id })
            .from(fields)
            .where(
                and(
                    eq(fields.tenantId, tenantId),
                    eq(fields.listId, listId),
                    eq(fields.slug, slug),
                    exceptId !== undefined ? ne(fields.id, exceptId) : undefined,
                ),
            )
            .limit(1);
        return row !== undefined;
    }

    async nextPosition(tx: Tx, tenantId: number, listId: number): Promise<number> {
        const [row] = await tx
            .select({ maxPos: max(fields.position) })
            .from(fields)
            .where(and(eq(fields.tenantId, tenantId), eq(fields.listId, listId)));
        return (row?.maxPos ?? -1) + 1;
    }

    async insert(tx: Tx, values: typeof fields.$inferInsert): Promise<FieldRow> {
        const [row] = await tx.insert(fields).values(values).returning();
        if (!row) throw new Error('Insert de campo no devolvió fila');
        return row;
    }

    async update(
        tx: Tx,
        tenantId: number,
        listId: number,
        id: number,
        patch: Partial<typeof fields.$inferInsert>,
    ): Promise<FieldRow | null> {
        const [row] = await tx
            .update(fields)
            .set({ ...patch, updatedAt: sql`now()` })
            .where(
                and(eq(fields.tenantId, tenantId), eq(fields.listId, listId), eq(fields.id, id)),
            )
            .returning();
        return row ?? null;
    }

    async remove(tx: Tx, tenantId: number, listId: number, id: number): Promise<boolean> {
        const rows = await tx
            .delete(fields)
            .where(
                and(eq(fields.tenantId, tenantId), eq(fields.listId, listId), eq(fields.id, id)),
            )
            .returning({ id: fields.id });
        return rows.length > 0;
    }

    /** Setea `position` = índice en `orderedIds` para los campos de la lista. */
    async applyOrder(
        tx: Tx,
        tenantId: number,
        listId: number,
        orderedIds: number[],
    ): Promise<void> {
        for (let i = 0; i < orderedIds.length; i++) {
            await tx
                .update(fields)
                .set({ position: i, updatedAt: sql`now()` })
                .where(
                    and(
                        eq(fields.tenantId, tenantId),
                        eq(fields.listId, listId),
                        eq(fields.id, orderedIds[i]!),
                    ),
                );
        }
    }

    /** IDs de la lista que están dentro de `candidateIds` (para validar reorder). */
    async existingIds(
        tx: Tx,
        tenantId: number,
        listId: number,
        candidateIds: number[],
    ): Promise<number[]> {
        if (candidateIds.length === 0) return [];
        const rows = await tx
            .select({ id: fields.id })
            .from(fields)
            .where(
                and(
                    eq(fields.tenantId, tenantId),
                    eq(fields.listId, listId),
                    inArray(fields.id, candidateIds),
                ),
            );
        return rows.map((r) => r.id);
    }
}
