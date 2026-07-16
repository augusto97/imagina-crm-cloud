import { bigint, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { tenants } from './tenants';

/**
 * Mapeo público token → lista (para listas públicas embebibles). SIN RLS: es
 * un índice público (token opaco) que se consulta sin tenant scope. Los datos
 * de la lista/records se leen luego dentro del scope del tenant resuelto.
 */
export const publicLists = pgTable(
    'public_lists',
    {
        token: varchar('token', { length: 64 }).primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex('public_lists_list_ux').on(t.tenantId, t.listId)],
);
