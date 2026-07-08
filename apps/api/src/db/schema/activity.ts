import { bigint, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { tenants } from './tenants';

/** Log de actividad append-only por record/lista con diffs (CONTRACT.md §1). */
export const activity = pgTable('activity', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    listId: bigint('list_id', { mode: 'number' })
        .notNull()
        .references(() => lists.id, { onDelete: 'cascade' }),
    recordId: bigint('record_id', { mode: 'number' }),
    userId: bigint('user_id', { mode: 'number' }),
    action: varchar('action', { length: 32 }).notNull(),
    diff: jsonb('diff').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
