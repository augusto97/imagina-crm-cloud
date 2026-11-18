import { bigint, index, pgTable, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * A14 (v0.1.445, ADR-S106) — Pares de registros marcados «no son
 * duplicados» (RLS). El par va ordenado (`recordLow` < `recordHigh`): (a,b) y
 * (b,a) son la misma fila. Las reglas viven en `lists.settings.duplicates`.
 */
export const recordDuplicateDismissals = pgTable(
    'record_duplicate_dismissals',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        recordLow: bigint('record_low', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        recordHigh: bigint('record_high', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('record_duplicate_dismissals_pair_ux').on(t.recordLow, t.recordHigh),
        index('record_duplicate_dismissals_high_ix').on(t.recordHigh),
        index('record_duplicate_dismissals_list_ix').on(t.tenantId, t.listId),
        index('record_duplicate_dismissals_created_by_ix').on(t.createdBy),
    ],
);
