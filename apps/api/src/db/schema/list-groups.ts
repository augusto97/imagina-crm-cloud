import { bigint, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Carpeta de listas (v0.1.130). Un solo nivel: agrupa listas en el menú.
 * Las listas sin carpeta cuelgan de la raíz — `lists.group_id` es nullable
 * y borra en SET NULL, así borrar la carpeta nunca se lleva las listas.
 */
export const listGroups = pgTable('list_groups', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
