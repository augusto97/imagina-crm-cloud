import { bigint, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { tenants } from './tenants';

/**
 * v0.1.117 — Slugs abandonados de una lista, para que renombrarla no rompa
 * los enlaces viejos (regla de oro nº 1: el slug es etiqueta humana editable,
 * el id es la verdad). Se resuelve al id actual al entrar por el slug viejo.
 */
export const listSlugHistory = pgTable(
    'list_slug_history',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        slug: varchar('slug', { length: 64 }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
        slugUx: uniqueIndex('list_slug_history_slug_ux').on(t.tenantId, t.slug),
    }),
);
