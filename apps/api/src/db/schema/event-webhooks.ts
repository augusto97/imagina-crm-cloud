import { bigint, integer, jsonb, pgTable, text, timestamp, varchar, boolean, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * v0.1.442 (G1, ADR-S105) — Webhooks de eventos: «avísale a esta dirección
 * cuando pase esto». Con RLS por empresa; el tic de entregas toma lo vencido
 * por la conexión base (sin RLS) y cada envío lee el registro dentro del scope
 * de su empresa, con el acceso de quien creó la suscripción.
 */
export const webhookSubscriptions = pgTable(
    'webhook_subscriptions',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 80 }).notNull(),
        url: text('url').notNull(),
        events: text('events').array().notNull(),
        listIds: bigint('list_ids', { mode: 'number' }).array(),
        secretEnc: text('secret_enc').notNull(),
        secretHint: varchar('secret_hint', { length: 8 }).notNull(),
        active: boolean('active').notNull().default(true),
        disabledReason: text('disabled_reason'),
        createdBy: bigint('created_by', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        source: varchar('source', { length: 8 }).notNull().default('app'),
        consecutiveFailures: integer('consecutive_failures').notNull().default(0),
        lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
        lastStatus: varchar('last_status', { length: 12 }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('webhook_subscriptions_tenant_ix').on(t.tenantId)],
);

export const webhookDeliveries = pgTable(
    'webhook_deliveries',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        subscriptionId: bigint('subscription_id', { mode: 'number' })
            .notNull()
            .references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
        eventId: varchar('event_id', { length: 40 }).notNull(),
        event: varchar('event', { length: 32 }).notNull(),
        listId: bigint('list_id', { mode: 'number' }),
        recordId: bigint('record_id', { mode: 'number' }),
        context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
        payload: jsonb('payload').$type<Record<string, unknown> | null>(),
        status: varchar('status', { length: 12 }).notNull().default('pending'),
        attempts: integer('attempts').notNull().default(0),
        nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
        responseStatus: integer('response_status'),
        responseBody: text('response_body'),
        error: text('error'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    },
    (t) => [index('webhook_deliveries_sub_ix').on(t.subscriptionId, t.id)],
);
