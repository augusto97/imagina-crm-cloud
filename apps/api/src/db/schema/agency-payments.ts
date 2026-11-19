import { bigint, date, index, integer, numeric, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * v0.1.451 (I3, ADR-S108) — Un pago de una empresa CLIENTE a su agencia. Es
 * dato de la AGENCIA (RLS por `tenant_id` = agencia). Registrarlo extiende el
 * `agency_paid_until` del cliente; deshacer el último lo devuelve a
 * `prev_paid_until`.
 */
export const agencyPayments = pgTable(
    'agency_payments',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        clientId: bigint('client_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        amount: numeric('amount', { precision: 16, scale: 2, mode: 'number' }).notNull(),
        currency: varchar('currency', { length: 8 }).notNull(),
        months: integer('months').notNull(),
        method: varchar('method', { length: 24 }).notNull(),
        note: varchar('note', { length: 240 }),
        paidOn: date('paid_on', { mode: 'string' }).notNull(),
        periodFrom: timestamp('period_from', { withTimezone: true }).notNull(),
        periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
        prevPaidUntil: timestamp('prev_paid_until', { withTimezone: true }),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        undoneAt: timestamp('undone_at', { withTimezone: true }),
        undoneBy: bigint('undone_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
    },
    (t) => [index('agency_payments_client_ix').on(t.clientId, t.id), index('agency_payments_tenant_ix').on(t.tenantId, t.createdAt)],
);
export type AgencyPaymentRow = typeof agencyPayments.$inferSelect;
