import { bigint, jsonb, pgTable, timestamp } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { tenants } from './tenants';

/**
 * Tabla universal de records (STANDALONE.md §3.1). Los datos dinámicos viven
 * en `data` con claves `f{field_id}` inmutables. Los índices GIN/FTS/parciales
 * se definen en la migración SQL (drizzle no expresa jsonb_to_tsvector).
 */
export const records = pgTable('records', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    listId: bigint('list_id', { mode: 'number' })
        .notNull()
        .references(() => lists.id, { onDelete: 'cascade' }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: bigint('created_by', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
