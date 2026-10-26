import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * E6 — Agentes de IA (RLS). El agente corre con el acceso de su DUEÑO
 * (`ownerId`), intersectado con sus listas y sus herramientas. Cuándo trabaja
 * son automatizaciones con la acción `ask_agent` (no viven aquí).
 */
export const aiAgents = pgTable(
    'ai_agents',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 80 }).notNull(),
        description: text('description').notNull().default(''),
        color: varchar('color', { length: 16 }),
        icon: varchar('icon', { length: 40 }),
        instructions: text('instructions').notNull().default(''),
        tools: jsonb('tools').$type<string[]>().notNull().default([]),
        mode: varchar('mode', { length: 10 }).notNull().default('propose'),
        settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
        maxSteps: integer('max_steps').notNull().default(8),
        maxRunsPerDay: integer('max_runs_per_day').notNull().default(200),
        monthlyTokenBudget: bigint('monthly_token_budget', { mode: 'number' }).default(2_000_000),
        ownerId: bigint('owner_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        isActive: boolean('is_active').notNull().default(true),
        pausedReason: text('paused_reason'),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('ai_agents_tenant_ix').on(t.tenantId, t.id), index('ai_agents_owner_ix').on(t.ownerId), index('ai_agents_created_by_ix').on(t.createdBy)],
);
export type AiAgentRow = typeof aiAgents.$inferSelect;

/** Listas en las que trabaja un agente (RLS). */
export const aiAgentLists = pgTable(
    'ai_agent_lists',
    {
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        agentId: bigint('agent_id', { mode: 'number' })
            .notNull()
            .references(() => aiAgents.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
    },
    (t) => [primaryKey({ columns: [t.agentId, t.listId] }), index('ai_agent_lists_list_ix').on(t.tenantId, t.listId), index('ai_agent_lists_list_fk_ix').on(t.listId)],
);

/** Una corrida de un agente (RLS): pasos resumidos, tokens y estado. */
export const aiAgentRuns = pgTable(
    'ai_agent_runs',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        agentId: bigint('agent_id', { mode: 'number' })
            .notNull()
            .references(() => aiAgents.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' }).references(() => lists.id, { onDelete: 'set null' }),
        recordId: bigint('record_id', { mode: 'number' }).references(() => records.id, { onDelete: 'set null' }),
        automationId: bigint('automation_id', { mode: 'number' }),
        automationName: varchar('automation_name', { length: 190 }),
        triggerLabel: varchar('trigger_label', { length: 240 }).notNull().default(''),
        status: varchar('status', { length: 12 }).notNull().default('queued'),
        simulated: boolean('simulated').notNull().default(false),
        mode: varchar('mode', { length: 10 }).notNull().default('propose'),
        instruction: text('instruction').notNull().default(''),
        steps: jsonb('steps').$type<unknown[]>().notNull().default([]),
        /** Lo que viaja de la automatización al agente (la cadena anti-bucle). */
        context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
        summary: text('summary').notNull().default(''),
        inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
        outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
        error: text('error'),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        startedAt: timestamp('started_at', { withTimezone: true }),
        finishedAt: timestamp('finished_at', { withTimezone: true }),
    },
    (t) => [
        index('ai_agent_runs_agent_ix').on(t.tenantId, t.agentId, sql`${t.id} DESC`),
        index('ai_agent_runs_agent_time_ix').on(t.agentId, t.createdAt),
        index('ai_agent_runs_record_ix').on(t.recordId),
        index('ai_agent_runs_list_ix').on(t.listId),
        index('ai_agent_runs_created_by_ix').on(t.createdBy),
    ],
);
export type AiAgentRunRow = typeof aiAgentRuns.$inferSelect;

/** Cambios propuestos por un agente que esperan a una persona (RLS). */
export const aiAgentProposals = pgTable(
    'ai_agent_proposals',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        agentId: bigint('agent_id', { mode: 'number' }).references(() => aiAgents.id, { onDelete: 'set null' }),
        agentName: varchar('agent_name', { length: 80 }).notNull().default(''),
        runId: bigint('run_id', { mode: 'number' }).references(() => aiAgentRuns.id, { onDelete: 'set null' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        status: varchar('status', { length: 12 }).notNull().default('pending'),
        summary: text('summary').notNull().default(''),
        changes: jsonb('changes').$type<unknown[]>().notNull().default([]),
        result: jsonb('result').$type<Record<string, unknown>>().notNull().default({}),
        decidedBy: bigint('decided_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        decidedAt: timestamp('decided_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index('ai_agent_proposals_record_ix').on(t.recordId, sql`${t.id} DESC`).where(sql`${t.status} = 'pending'`),
        index('ai_agent_proposals_pending_ix').on(t.tenantId, sql`${t.id} DESC`).where(sql`${t.status} = 'pending'`),
        index('ai_agent_proposals_agent_ix').on(t.agentId),
        index('ai_agent_proposals_run_ix').on(t.runId),
        index('ai_agent_proposals_list_ix').on(t.listId),
        index('ai_agent_proposals_record_fk_ix').on(t.recordId),
        index('ai_agent_proposals_decided_by_ix').on(t.decidedBy),
    ],
);
export type AiAgentProposalRow = typeof aiAgentProposals.$inferSelect;

/** Una foto del agente por guardado (las últimas 30, RLS). */
export const aiAgentVersions = pgTable(
    'ai_agent_versions',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        agentId: bigint('agent_id', { mode: 'number' })
            .notNull()
            .references(() => aiAgents.id, { onDelete: 'cascade' }),
        snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
        authorId: bigint('author_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        note: text('note'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('ai_agent_versions_agent_ix').on(t.agentId, sql`${t.id} DESC`), index('ai_agent_versions_tenant_ix').on(t.tenantId), index('ai_agent_versions_author_ix').on(t.authorId)],
);
