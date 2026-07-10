import { bigint, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { tenants } from './tenants';
import { users } from './users';

/**
 * Filtros guardados por lista (herencia del plugin, estilo ClickUp). Guardan un
 * `filter_tree` con nombre. `user_id` null = filtro del workspace (shared);
 * un id = filtro personal de ese usuario. Tenant-scoped con RLS.
 */
export const savedFilters = pgTable('saved_filters', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    listId: bigint('list_id', { mode: 'number' })
        .notNull()
        .references(() => lists.id, { onDelete: 'cascade' }),
    // null = shared (workspace); un id = personal de ese usuario.
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filterTree: jsonb('filter_tree').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
