import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { savedFilters } from '../db/schema';

export type SavedFilterRow = typeof savedFilters.$inferSelect;

/**
 * Acceso a datos de saved_filters, tenant-scoped (RLS + tenant_id explícito).
 * La visibilidad personal/shared se resuelve acá: un usuario ve los filtros
 * del workspace (user_id null) + los suyos (user_id = él).
 */
@Injectable()
export class SavedFiltersRepository {
    /** Filtros visibles para `userId` en la lista: shared (null) + propios. */
    listVisible(tx: Tx, tenantId: number, listId: number, userId: number): Promise<SavedFilterRow[]> {
        return tx
            .select()
            .from(savedFilters)
            .where(
                and(
                    eq(savedFilters.tenantId, tenantId),
                    eq(savedFilters.listId, listId),
                    or(isNull(savedFilters.userId), eq(savedFilters.userId, userId)),
                ),
            )
            .orderBy(asc(savedFilters.name), asc(savedFilters.id));
    }

    async insert(tx: Tx, values: typeof savedFilters.$inferInsert): Promise<SavedFilterRow> {
        const [row] = await tx.insert(savedFilters).values(values).returning();
        if (!row) throw new Error('Insert de saved_filter no devolvió fila');
        return row;
    }

    /**
     * Borra un filtro: sólo si es del workspace (user_id null) o del propio
     * usuario — nunca el filtro personal de otro. Devuelve si borró algo.
     */
    async remove(tx: Tx, tenantId: number, listId: number, id: number, userId: number): Promise<boolean> {
        const rows = await tx
            .delete(savedFilters)
            .where(
                and(
                    eq(savedFilters.tenantId, tenantId),
                    eq(savedFilters.listId, listId),
                    eq(savedFilters.id, id),
                    or(isNull(savedFilters.userId), eq(savedFilters.userId, userId)),
                ),
            )
            .returning({ id: savedFilters.id });
        return rows.length > 0;
    }
}
