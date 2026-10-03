import { bigint, integer, numeric, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * v0.1.250 — Cada pago de un plan, una fila (idempotencia por proveedor +
 * id externo). `period_end` es hasta cuándo dejó pagado (sólo aprobados).
 * Tenant-scoped con RLS: el webhook escribe dentro de `withTenant`.
 */
export const billingPayments = pgTable('billing_payments', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 24 }).notNull(),
    externalId: varchar('external_id', { length: 128 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    plan: varchar('plan', { length: 32 }).notNull(),
    months: integer('months').notNull().default(1),
    amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    currency: varchar('currency', { length: 8 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    method: varchar('method', { length: 64 }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** La renovación automática (suscripción del proveedor) de una empresa. */
export const billingSubscriptions = pgTable('billing_subscriptions', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 24 }).notNull(),
    externalId: varchar('external_id', { length: 128 }).notNull(),
    plan: varchar('plan', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    currency: varchar('currency', { length: 8 }).notNull(),
    nextPaymentAt: timestamp('next_payment_at', { withTimezone: true }),
    authorizeUrl: text('authorize_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
