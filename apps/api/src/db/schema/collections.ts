import { bigint, index, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { connections } from './connections';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';

/**
 * v0.1.251 (ADR-S31) — Un link de pago de una EMPRESA a su cliente (Mercado
 * Pago o Wompi), atado a un registro. RLS: es dato de la empresa. El estado
 * lo escribe el aviso del proveedor (verificado releyendo el pago) o el botón
 * «Verificar»; el registro recibe una copia en sus columnas de cobro.
 */
export const paymentLinks = pgTable(
    'payment_links',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        // Borrar la conexión no borra el historial de cobros.
        connectionId: bigint('connection_id', { mode: 'number' }).references(() => connections.id, {
            onDelete: 'set null',
        }),
        provider: varchar('provider', { length: 24 }).notNull(),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        /** Id del link en el proveedor (preference / payment link). */
        externalId: varchar('external_id', { length: 128 }).notNull(),
        url: text('url').notNull(),
        title: varchar('title', { length: 200 }).notNull(),
        amount: numeric('amount', { precision: 14, scale: 2, mode: 'number' }).notNull(),
        currency: varchar('currency', { length: 8 }).notNull(),
        status: varchar('status', { length: 16 }).notNull().default('pending'),
        payerEmail: varchar('payer_email', { length: 254 }),
        expiresAt: timestamp('expires_at', { withTimezone: true }),
        paidAmount: numeric('paid_amount', { precision: 14, scale: 2, mode: 'number' }),
        paidAt: timestamp('paid_at', { withTimezone: true }),
        method: varchar('method', { length: 64 }),
        paymentId: varchar('payment_id', { length: 128 }),
        note: text('note'),
        createdBy: bigint('created_by', { mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    },
    (t) => [
        uniqueIndex('payment_links_external_ux').on(t.provider, t.externalId),
        index('payment_links_record_ix').on(t.tenantId, t.recordId),
        index('payment_links_connection_ix').on(t.tenantId, t.connectionId, t.createdAt),
    ],
);
export type PaymentLinkRowDb = typeof paymentLinks.$inferSelect;

/**
 * Token de la URL de avisos de una conexión de cobro. SIN RLS (como
 * `store_hooks`): el aviso llega antes de saber de qué empresa es.
 */
export const collectionHooks = pgTable(
    'collection_hooks',
    {
        token: varchar('token', { length: 64 }).primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        connectionId: bigint('connection_id', { mode: 'number' })
            .notNull()
            .references(() => connections.id, { onDelete: 'cascade' }),
        provider: varchar('provider', { length: 24 }).notNull(),
        lastHookAt: timestamp('last_hook_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex('collection_hooks_connection_ux').on(t.connectionId)],
);
