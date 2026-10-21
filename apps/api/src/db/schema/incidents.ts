import { bigint, index, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { tenants } from './tenants';
import { users } from './users';

/**
 * v0.1.285 (ADR-S44) — Problemas de la empresa (RLS). Un problema ABIERTO por
 * (empresa, `key`); las fallas repetidas suman `count`. `notified_at` marca el
 * último aviso (se recuerda una vez por día mientras siga abierto).
 */
export const incidents = pgTable(
    'incidents',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        key: varchar('key', { length: 120 }).notNull(),
        source: varchar('source', { length: 24 }).notNull(),
        sourceId: bigint('source_id', { mode: 'number' }),
        listId: bigint('list_id', { mode: 'number' }).references(() => lists.id, { onDelete: 'cascade' }),
        ownerId: bigint('owner_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        title: varchar('title', { length: 300 }).notNull(),
        message: text('message').notNull().default(''),
        count: integer('count').notNull().default(1),
        firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
        lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
        notifiedAt: timestamp('notified_at', { withTimezone: true }),
        resolvedAt: timestamp('resolved_at', { withTimezone: true }),
        resolvedBy: bigint('resolved_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
    },
    (t) => [index('incidents_tenant_ix').on(t.tenantId, t.lastAt)],
);
export type IncidentRow = typeof incidents.$inferSelect;
