import { bigint, boolean, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { ActionLogEntry, ActionSpec, TriggerConfig } from '@imagina-base/shared';
import { lists } from './lists';
import { tenants } from './tenants';

/**
 * Automatizaciones — modelo FLEXIBLE alineado al plugin (paridad total):
 * `trigger_type` (slug) + `trigger_config` (field_filters / changed_fields /
 * claves específicas) + `actions` (ActionSpec[] con condition propia + if_else
 * recursivo) + `description`.
 */
export const automations = pgTable('automations', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    listId: bigint('list_id', { mode: 'number' })
        .notNull()
        .references(() => lists.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    triggerType: text('trigger_type').notNull(),
    triggerConfig: jsonb('trigger_config').$type<TriggerConfig>().notNull().default({}),
    actions: jsonb('actions').$type<ActionSpec[]>().notNull().default([]),
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
    actionsLog: jsonb('actions_log').$type<ActionLogEntry[]>().notNull().default([]),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
