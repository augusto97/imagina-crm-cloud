import { bigint, date, index, integer, numeric, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { paymentLinks } from './collections';

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

/**
 * v0.1.452 (I3, ADR-S108) — Un cobro en línea de la agencia a un cliente: el
 * link de pago (en la lista «Empresas cliente» de la agencia) por N meses del
 * plan. Al pagarse se registra solo en `agency_payments` (`payment_id`).
 */
export const agencyCharges = pgTable(
    'agency_charges',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        clientId: bigint('client_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        linkId: bigint('link_id', { mode: 'number' }).references(() => paymentLinks.id, { onDelete: 'set null' }),
        months: integer('months').notNull(),
        amount: numeric('amount', { precision: 16, scale: 2, mode: 'number' }).notNull(),
        currency: varchar('currency', { length: 8 }).notNull(),
        status: varchar('status', { length: 16 }).notNull().default('pending'),
        via: varchar('via', { length: 16 }).notNull().default('agency'),
        paymentId: bigint('payment_id', { mode: 'number' }).references(() => agencyPayments.id, { onDelete: 'set null' }),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        paidAt: timestamp('paid_at', { withTimezone: true }),
    },
    (t) => [index('agency_charges_client_ix').on(t.tenantId, t.clientId, t.id)],
);
export type AgencyChargeRow = typeof agencyCharges.$inferSelect;
