import { bigint, boolean, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import type { ActionLogEntry, ActionSpec, TriggerConfig } from '@imagina-base/shared';
import { lists } from './lists';
import { tenants } from './tenants';
import { users } from './users';

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
    /**
     * v0.1.289 — una corrida `waiting` (en un «Esperar») se reanuda a esta
     * hora; `resume_state` guarda el puntero al paso que sigue y el contexto
     * acumulado (variables de webhooks, del PDF, del cobro…). `resumed_at` es
     * cuándo la tomó el reloj de las esperas: el mantenimiento mide desde ahí
     * (no desde `created_at`, que puede ser de hace días).
     */
    resumeAt: timestamp('resume_at', { withTimezone: true }),
    resumedAt: timestamp('resumed_at', { withTimezone: true }),
    resumeState: jsonb('resume_state').$type<Record<string, unknown>>(),
});

/**
 * v0.1.289 — Historial de versiones: una foto por guardado (sin secretos), con
 * autor y nota. Se conservan las últimas 50 por automatización.
 */
export const automationVersions = pgTable('automation_versions', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
    automationId: bigint('automation_id', { mode: 'number' })
        .notNull()
        .references(() => automations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    triggerType: text('trigger_type').notNull(),
    triggerConfig: jsonb('trigger_config').$type<Record<string, unknown>>().notNull().default({}),
    actions: jsonb('actions').$type<ActionSpec[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    authorId: bigint('author_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
    note: varchar('note', { length: 300 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * v0.1.110 — Webhook entrante: mapeo público token → automatización. SIN RLS
 * (mismo patrón que public_lists): el token opaco ES la credencial; el run se
 * ejecuta luego dentro del scope del tenant resuelto.
 */
export const automationHooks = pgTable(
    'automation_hooks',
    {
        token: varchar('token', { length: 64 }).primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        automationId: bigint('automation_id', { mode: 'number' })
            .notNull()
            .references(() => automations.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex('automation_hooks_automation_ux').on(t.automationId)],
);
