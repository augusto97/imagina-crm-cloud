import { bigint, boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { connections } from './connections';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';

/**
 * v0.1.367 (ADR-S96) — Un plan de suscripción de una EMPRESA («Hosting
 * mensual»). Cambiarlo vale para las suscripciones nuevas: cada suscripción
 * guarda su copia del valor y la frecuencia que el cliente autorizó.
 */
export const subscriptionPlans = pgTable(
    'subscription_plans',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        connectionId: bigint('connection_id', { mode: 'number' }).references(() => connections.id, { onDelete: 'set null' }),
        provider: varchar('provider', { length: 24 }).notNull(),
        name: varchar('name', { length: 120 }).notNull(),
        description: text('description'),
        amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }).notNull(),
        currency: varchar('currency', { length: 8 }).notNull(),
        frequency: integer('frequency').notNull().default(1),
        frequencyType: varchar('frequency_type', { length: 8 }).notNull().default('months'),
        cycles: integer('cycles'),
        trialDays: integer('trial_days').notNull().default(0),
        graceDays: integer('grace_days').notNull().default(10),
        onExpire: varchar('on_expire', { length: 12 }).notNull().default('mark'),
        active: boolean('active').notNull().default(true),
        /** v0.1.373 — PayPal: el producto y los planes que la app creó en la cuenta de la empresa. */
        providerRefs: jsonb('provider_refs').notNull().default({}),
        createdBy: bigint('created_by', { mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('subscription_plans_tenant_ix').on(t.tenantId, t.connectionId)],
);
export type SubscriptionPlanRowDb = typeof subscriptionPlans.$inferSelect;

/**
 * Una suscripción de un cliente, atada a un registro. El estado (`status`) lo
 * calcula la app con lo que dice Mercado Pago (`provider_status`), los cobros
 * y los días de gracia. Borrar el registro deja la suscripción (`record_id`
 * en null): en Mercado Pago sigue cobrando y hay que poder cancelarla.
 */
export const subscriptions = pgTable(
    'subscriptions',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        connectionId: bigint('connection_id', { mode: 'number' }).references(() => connections.id, { onDelete: 'set null' }),
        provider: varchar('provider', { length: 24 }).notNull(),
        planId: bigint('plan_id', { mode: 'number' }).references(() => subscriptionPlans.id, { onDelete: 'set null' }),
        listId: bigint('list_id', { mode: 'number' }).references(() => lists.id, { onDelete: 'set null' }),
        recordId: bigint('record_id', { mode: 'number' }).references(() => records.id, { onDelete: 'set null' }),
        /** Id de la suscripción en el proveedor (preapproval). */
        externalId: varchar('external_id', { length: 128 }),
        /** Nuestra referencia (`ibs_…`): la llevan el `external_reference` y la página de vuelta. */
        reference: varchar('reference', { length: 64 }).notNull(),
        /** El link para autorizar la tarjeta (init_point). */
        url: text('url'),
        title: varchar('title', { length: 200 }).notNull(),
        planName: varchar('plan_name', { length: 120 }),
        amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }).notNull(),
        currency: varchar('currency', { length: 8 }).notNull(),
        frequency: integer('frequency').notNull().default(1),
        frequencyType: varchar('frequency_type', { length: 8 }).notNull().default('months'),
        cycles: integer('cycles'),
        graceDays: integer('grace_days').notNull().default(10),
        onExpire: varchar('on_expire', { length: 12 }).notNull().default('mark'),
        payerEmail: varchar('payer_email', { length: 254 }),
        status: varchar('status', { length: 16 }).notNull().default('pending'),
        providerStatus: varchar('provider_status', { length: 16 }),
        startAt: timestamp('start_at', { withTimezone: true }),
        nextChargeAt: timestamp('next_charge_at', { withTimezone: true }),
        paidUntil: timestamp('paid_until', { withTimezone: true }),
        chargesPaid: integer('charges_paid').notNull().default(0),
        chargesFailed: integer('charges_failed').notNull().default(0),
        consecutiveFailed: integer('consecutive_failed').notNull().default(0),
        retrying: boolean('retrying').notNull().default(false),
        failedFinal: boolean('failed_final').notNull().default(false),
        lastChargeAt: timestamp('last_charge_at', { withTimezone: true }),
        lastChargeStatus: varchar('last_charge_status', { length: 16 }),
        lastFailureReason: text('last_failure_reason'),
        cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
        cancelReason: text('cancel_reason'),
        formId: bigint('form_id', { mode: 'number' }),
        createdBy: bigint('created_by', { mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    },
    (t) => [
        uniqueIndex('subscriptions_reference_ux').on(t.reference),
        index('subscriptions_record_ix').on(t.tenantId, t.recordId),
        index('subscriptions_connection_ix').on(t.tenantId, t.connectionId, t.createdAt),
        index('subscriptions_plan_ix').on(t.planId),
        index('subscriptions_list_ix').on(t.listId),
    ],
);
export type SubscriptionRowDb = typeof subscriptions.$inferSelect;

/** Un intento de cobro de una cuota (el historial de lo pagado y lo rechazado). */
export const subscriptionCharges = pgTable(
    'subscription_charges',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        subscriptionId: bigint('subscription_id', { mode: 'number' })
            .notNull()
            .references(() => subscriptions.id, { onDelete: 'cascade' }),
        provider: varchar('provider', { length: 24 }).notNull(),
        providerPaymentId: varchar('provider_payment_id', { length: 128 }).notNull(),
        /** La cuota del proveedor (authorized payment): varios intentos, una cuota. */
        invoiceId: varchar('invoice_id', { length: 128 }),
        amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }).notNull(),
        currency: varchar('currency', { length: 8 }).notNull(),
        status: varchar('status', { length: 16 }).notNull(),
        attempt: integer('attempt'),
        failureReason: text('failure_reason'),
        method: varchar('method', { length: 64 }),
        periodStart: timestamp('period_start', { withTimezone: true }),
        paidAt: timestamp('paid_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        /** v0.1.371 — Registro de cobros: la lista y el registro donde quedó, y cuándo. */
        logListId: bigint('log_list_id', { mode: 'number' }),
        logRecordId: bigint('log_record_id', { mode: 'number' }),
        loggedAt: timestamp('logged_at', { withTimezone: true }),
    },
    (t) => [
        uniqueIndex('subscription_charges_payment_ux').on(t.subscriptionId, t.providerPaymentId),
        index('subscription_charges_tenant_ix').on(t.tenantId, t.createdAt),
    ],
);
export type SubscriptionChargeRowDb = typeof subscriptionCharges.$inferSelect;
