import {
    bigint,
    boolean,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Dashboards por workspace (CONTRACT.md §5 — widgets sobre el motor de
 * agregados). Los widgets se guardan como jsonb (cada uno referencia list_id +
 * field_id por ID). `user_id` null = dashboard compartido del workspace;
 * `is_default` marca el que abre por defecto. RLS por tenant_id.
 */
export const dashboards = pgTable('dashboards', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    userId: bigint('user_id', { mode: 'number' }),
    name: text('name').notNull(),
    description: text('description'),
    widgets: jsonb('widgets').$type<unknown[]>().notNull().default([]),
    isDefault: boolean('is_default').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdBy: bigint('created_by', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
