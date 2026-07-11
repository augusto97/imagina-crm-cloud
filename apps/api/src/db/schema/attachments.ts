import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * Metadata de archivos (ADR-S16). Los bytes viven detrás de `FileStorage`
 * (driver local en disco; S3-compatible como upgrade). Los campos `file`
 * guardan el ID del attachment como valor. Tenant-scoped con RLS.
 */
export const attachments = pgTable('attachments', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    filename: text('filename').notNull(),
    mime: text('mime').notNull().default('application/octet-stream'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    storageKey: text('storage_key').notNull(),
    createdBy: bigint('created_by', { mode: 'number' })
        .notNull()
        .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
