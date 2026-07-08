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
import type { AutomationAction, AutomationTrigger, FilterGroup } from '@imagina-base/shared';
import { lists } from './lists';
import { tenants } from './tenants';

export const automations = pgTable('automations', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    listId: bigint('list_id', { mode: 'number' })
        .notNull()
        .references(() => lists.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    trigger: jsonb('trigger').$type<AutomationTrigger>().notNull(),
    actions: jsonb('actions').$type<AutomationAction[]>().notNull().default([]),
    condition: jsonb('condition').$type<FilterGroup | null>(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const automationRuns = pgTable('automation_runs', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    automationId: bigint('automation_id', { mode: 'number' })
        .notNull()
        .references(() => automations.id, { onDelete: 'cascade' }),
    recordId: bigint('record_id', { mode: 'number' }),
    status: varchar('status', { length: 16 }).notNull(),
    logs: jsonb('logs').$type<string[]>().notNull().default([]),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
