import { bigint, boolean, jsonb, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';
import { connections } from './connections';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/** Una sincronización con una tienda por conexión (v0.1.206, ADR-S24). */
export const connectionSyncs = pgTable('connection_syncs', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    connectionId: bigint('connection_id', { mode: 'number' })
        .notNull()
        .references(() => connections.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    /** Lo que eligió la persona (qué, cada cuánto, qué lista/campo recibe qué). */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    /** Lo que escribe el motor (cursores, progreso, errores, meta descubierta). */
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** «El pedido 1234 de esta tienda es el registro N» (v0.1.206). */
export const syncLinks = pgTable(
    'sync_links',
    {
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        syncId: bigint('sync_id', { mode: 'number' })
            .notNull()
            .references(() => connectionSyncs.id, { onDelete: 'cascade' }),
        resource: varchar('resource', { length: 32 }).notNull(),
        externalId: varchar('external_id', { length: 190 }).notNull(),
        parentExternalId: varchar('parent_external_id', { length: 190 }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.syncId, t.resource, t.externalId] })],
);

export type ConnectionSyncRow = typeof connectionSyncs.$inferSelect;
export type SyncLinkRow = typeof syncLinks.$inferSelect;
