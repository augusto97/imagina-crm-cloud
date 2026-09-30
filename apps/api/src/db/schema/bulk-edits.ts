import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * v0.1.218 — Historial de ediciones masivas, para poder deshacerlas.
 * `kind`: 'records' (columnas de la app) o 'store' (campos de WooCommerce).
 */
export const bulkEdits = pgTable(
    'bulk_edits',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        userId: bigint('user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        kind: varchar('kind', { length: 16 }).notNull(),
        summary: text('summary').notNull().default(''),
        operations: jsonb('operations').$type<unknown[]>().notNull().default([]),
        itemCount: integer('item_count').notNull().default(0),
        revertedCount: integer('reverted_count').notNull().default(0),
        revertedAt: timestamp('reverted_at', { withTimezone: true }),
        revertedBy: bigint('reverted_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
        listIdx: index('bulk_edits_list_ix').on(t.tenantId, t.listId, t.id),
    }),
);

/** Una fila de una edición masiva: el antes y el después de lo que cambió. */
export const bulkEditItems = pgTable(
    'bulk_edit_items',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        bulkEditId: bigint('bulk_edit_id', { mode: 'number' })
            .notNull()
            .references(() => bulkEdits.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' }).references(() => records.id, { onDelete: 'set null' }),
        externalId: varchar('external_id', { length: 190 }),
        parentExternalId: varchar('parent_external_id', { length: 190 }),
        title: text('title').notNull().default(''),
        before: jsonb('before').$type<Record<string, unknown>>().notNull().default({}),
        after: jsonb('after').$type<Record<string, unknown>>().notNull().default({}),
        reverted: boolean('reverted').notNull().default(false),
    },
    (t) => ({
        editIdx: index('bulk_edit_items_edit_ix').on(t.bulkEditId, t.id),
    }),
);
