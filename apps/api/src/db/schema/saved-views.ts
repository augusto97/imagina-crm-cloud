import {
    bigint,
    boolean,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    varchar,
} from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { users } from './users';
import { tenants } from './tenants';

/**
 * Saved views por lista (CONTRACT.md §7). La config (por tipo) se guarda como
 * jsonb y referencia todo por field_id. `is_default` por lista se aplica ANTES
 * del primer fetch de records (lección HANDOFF §2.2).
 */
export const savedViews = pgTable('saved_views', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    listId: bigint('list_id', { mode: 'number' })
        .notNull()
        .references(() => lists.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: varchar('type', { length: 32 }).notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    isDefault: boolean('is_default').notNull().default(false),
    position: integer('position').notNull().default(0),
    /** v0.1.259 — icono y color de la pestaña (catálogo de las listas). */
    icon: text('icon'),
    color: text('color'),
    /** v0.1.260 — quién la creó (privada/protegida se deciden contra esto). */
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
    isPrivate: boolean('is_private').notNull().default(false),
    isLocked: boolean('is_locked').notNull().default(false),
    autosave: boolean('autosave').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
