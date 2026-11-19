import { bigint, boolean, jsonb, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { connections } from './connections';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/** v0.1.459 (G3) — Una lista sincronizada con una pestaña de Google Sheets. */
export const sheetSyncs = pgTable('sheet_syncs', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    connectionId: bigint('connection_id', { mode: 'number' })
        .notNull()
        .references(() => connections.id, { onDelete: 'cascade' }),
    listId: bigint('list_id', { mode: 'number' })
        .notNull()
        .references(() => lists.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Lo que eligió la persona (planilla, pestaña, dirección, clave, columnas). */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    /** Lo que escribe el motor (estado, último resultado, errores). */
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** «La fila con la clave K es el registro N», con lo último sincronizado de cada celda. */
export const sheetSyncRows = pgTable(
    'sheet_sync_rows',
    {
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        syncId: bigint('sync_id', { mode: 'number' })
            .notNull()
            .references(() => sheetSyncs.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        rowKey: varchar('row_key', { length: 190 }).notNull(),
        snapshot: jsonb('snapshot').$type<SheetRowSnapshot>().notNull().default({}),
        fingerprint: varchar('fingerprint', { length: 40 }),
        removed: boolean('removed').notNull().default(false),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.syncId, t.recordId] })],
);

/** Lo último sincronizado de cada celda: `s` = la hoja, `a` = la app (texto canónico por id de campo). */
export interface SheetRowSnapshot {
    s?: Record<string, string>;
    a?: Record<string, string>;
    /** `1` = el registro se creó desde una fila nueva y su ID todavía no se escribió en la hoja. */
    p?: 1;
}

export type SheetSyncRow = typeof sheetSyncs.$inferSelect;
export type SheetSyncLinkRow = typeof sheetSyncRows.$inferSelect;
