import { bigint, date, index, integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * v0.1.291 — Registro de tiempo por registro (RLS).
 *
 * `source = 'timer'` con `endedAt` NULL es un cronómetro EN CURSO: uno por
 * persona en toda la empresa (índice único parcial). Al detenerlo se guardan
 * los segundos. Una entrada `manual` no tiene inicio ni fin: sólo la fecha de
 * trabajo y la duración. Mientras corre, `seconds` es 0 — así el total del
 * registro (campo «Tiempo registrado») es una suma sin filtros.
 */
export const timeEntries = pgTable(
    'time_entries',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        userId: bigint('user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        source: varchar('source', { length: 8 }).notNull().default('manual'),
        workDate: date('work_date', { mode: 'string' }).notNull(),
        startedAt: timestamp('started_at', { withTimezone: true }),
        endedAt: timestamp('ended_at', { withTimezone: true }),
        seconds: integer('seconds').notNull().default(0),
        note: varchar('note', { length: 500 }).notNull().default(''),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index('time_entries_record_ix').on(t.recordId, t.seconds),
        index('time_entries_list_ix').on(t.listId, t.workDate),
        index('time_entries_user_ix').on(t.userId),
        index('time_entries_tenant_ix').on(t.tenantId),
    ],
);
export type TimeEntryRow = typeof timeEntries.$inferSelect;
