import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * C5 — Flujos de aprobación por lista (RLS). Configuración de la lista: pasos
 * en serie y qué se pone en el registro al aprobar o rechazar
 * (`ApprovalFlowConfig` en shared). Se borran para siempre (no van a la
 * papelera, como formularios y plantillas de documento).
 */
export const approvalFlows = pgTable(
    'approval_flows',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 120 }).notNull(),
        description: text('description').notNull().default(''),
        config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
        isActive: boolean('is_active').notNull().default(true),
        position: integer('position').notNull().default(0),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index('approval_flows_list_ix').on(t.tenantId, t.listId),
        index('approval_flows_list_fk_ix').on(t.listId),
        index('approval_flows_created_by_ix').on(t.createdBy),
    ],
);
export type ApprovalFlowRow = typeof approvalFlows.$inferSelect;

/**
 * C5 — Una solicitud de aprobación sobre UN registro (RLS). `config` es la
 * COPIA de la configuración del flujo al pedir: cambiar el flujo no altera las
 * pendientes. A lo sumo una pendiente por registro y flujo (índice único
 * parcial). Un registro que va a la papelera cancela sus pendientes (trigger
 * `records_approvals_trash`, migración 0086).
 */
export const approvalRequests = pgTable(
    'approval_requests',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        flowId: bigint('flow_id', { mode: 'number' }).references(() => approvalFlows.id, { onDelete: 'set null' }),
        flowName: varchar('flow_name', { length: 120 }).notNull(),
        config: jsonb('config').$type<Record<string, unknown>>().notNull(),
        status: varchar('status', { length: 16 }).notNull().default('pending'),
        currentStep: integer('current_step').notNull().default(0),
        stepStartedAt: timestamp('step_started_at', { withTimezone: true }).notNull().defaultNow(),
        note: text('note').notNull().default(''),
        source: varchar('source', { length: 16 }).notNull().default('user'),
        automationId: bigint('automation_id', { mode: 'number' }),
        automationName: varchar('automation_name', { length: 190 }),
        requestedBy: bigint('requested_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
        resolvedAt: timestamp('resolved_at', { withTimezone: true }),
        resolvedBy: bigint('resolved_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        reason: text('reason').notNull().default(''),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('approval_requests_one_pending_ux').on(t.recordId, t.flowId).where(sql`status = 'pending'`),
        index('approval_requests_record_ix').on(t.recordId, t.id),
        index('approval_requests_pending_ix').on(t.tenantId, t.id).where(sql`status = 'pending'`),
        index('approval_requests_list_ix').on(t.tenantId, t.listId, t.status),
        index('approval_requests_list_fk_ix').on(t.listId),
        index('approval_requests_flow_ix').on(t.flowId),
        index('approval_requests_requested_by_ix').on(t.tenantId, t.requestedBy, t.id),
        index('approval_requests_requested_by_fk_ix').on(t.requestedBy),
        index('approval_requests_resolved_by_ix').on(t.resolvedBy),
    ],
);
export type ApprovalRequestRow = typeof approvalRequests.$inferSelect;

/** C5 — Una decisión (aprobar / rechazar / devolver) de una persona en un paso (RLS). */
export const approvalDecisions = pgTable(
    'approval_decisions',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        requestId: bigint('request_id', { mode: 'number' })
            .notNull()
            .references(() => approvalRequests.id, { onDelete: 'cascade' }),
        step: integer('step').notNull(),
        userId: bigint('user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        decision: varchar('decision', { length: 10 }).notNull(),
        reason: text('reason').notNull().default(''),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        unique('approval_decisions_once_ux').on(t.requestId, t.step, t.userId),
        index('approval_decisions_user_ix').on(t.userId),
        index('approval_decisions_tenant_ix').on(t.tenantId),
    ],
);
export type ApprovalDecisionRow = typeof approvalDecisions.$inferSelect;
