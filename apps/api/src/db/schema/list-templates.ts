import { bigint, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * Plantillas de lista del workspace (v0.1.166). El `blueprint` es el JSON
 * portable de `packages/shared` (`listBlueprintSchema`).
 */
export const listTemplates = pgTable('list_templates', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description'),
    icon: varchar('icon', { length: 64 }),
    color: varchar('color', { length: 32 }),
    category: varchar('category', { length: 32 }).notNull().default('otros'),
    blueprint: jsonb('blueprint').$type<Record<string, unknown>>().notNull(),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, {
        onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
