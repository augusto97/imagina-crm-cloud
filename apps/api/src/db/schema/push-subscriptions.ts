import { bigint, index, integer, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * H1 — Un dispositivo donde la persona activó las notificaciones push (Web
 * Push con VAPID), en UNA empresa. RLS por tenant (migración 0088).
 */
export const pushSubscriptions = pgTable(
    'push_subscriptions',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        userId: bigint('user_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        endpoint: text('endpoint').notNull(),
        p256dh: varchar('p256dh', { length: 120 }).notNull(),
        auth: varchar('auth', { length: 60 }).notNull(),
        /** sha256 del endpoint (16 hex): la UNICIDAD y lo que ve la interfaz. */
        endpointHash: varchar('endpoint_hash', { length: 32 }).notNull(),
        /** Id PÚBLICO de la sesión con la que se activó (hash del token). */
        sessionId: varchar('session_id', { length: 32 }),
        userAgent: varchar('user_agent', { length: 300 }).notNull().default(''),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
        lastError: varchar('last_error', { length: 300 }),
        failures: integer('failures').notNull().default(0),
    },
    (t) => [
        uniqueIndex('push_subscriptions_endpoint_ux').on(t.tenantId, t.endpointHash),
        index('push_subscriptions_user_ix').on(t.tenantId, t.userId),
        index('push_subscriptions_user_fk_ix').on(t.userId),
        index('push_subscriptions_session_ix').on(t.sessionId),
    ],
);
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
