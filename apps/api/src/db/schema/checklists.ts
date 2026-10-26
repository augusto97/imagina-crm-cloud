import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * A9 — Checklists de un registro (RLS). Varios por registro, con nombre y
 * orden. Un registro en la papelera los deja ocultos (toda lectura cruza el
 * registro vivo); purgarlo los borra en cascada.
 */
export const recordChecklists = pgTable(
    'record_checklists',
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
        name: varchar('name', { length: 120 }).notNull().default('Checklist'),
        position: integer('position').notNull().default(0),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index('record_checklists_record_ix').on(t.recordId, t.position),
        index('record_checklists_list_ix').on(t.tenantId, t.listId),
        index('record_checklists_created_by_ix').on(t.createdBy),
    ],
);
export type RecordChecklistRow = typeof recordChecklists.$inferSelect;

/**
 * A9 — Ítems de un checklist (RLS). `list_id` y `record_id` se repiten a
 * propósito: el progreso del listado y «Mi trabajo» se resuelven por índice.
 * La fecha va en `due_date` (sin hora) o `due_at` (con hora), nunca las dos.
 */
export const recordChecklistItems = pgTable(
    'record_checklist_items',
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
        checklistId: bigint('checklist_id', { mode: 'number' })
            .notNull()
            .references(() => recordChecklists.id, { onDelete: 'cascade' }),
        text: varchar('text', { length: 500 }).notNull(),
        done: boolean('done').notNull().default(false),
        doneBy: bigint('done_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        doneAt: timestamp('done_at', { withTimezone: true }),
        assigneeId: bigint('assignee_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        dueDate: date('due_date', { mode: 'string' }),
        dueAt: timestamp('due_at', { withTimezone: true }),
        position: integer('position').notNull().default(0),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index('record_checklist_items_checklist_ix').on(t.checklistId, t.position),
        index('record_checklist_items_record_ix').on(t.recordId, t.done),
        index('record_checklist_items_assignee_ix').on(t.tenantId, t.assigneeId).where(sql`NOT ${t.done}`),
        index('record_checklist_items_list_ix').on(t.tenantId, t.listId),
        index('record_checklist_items_done_by_ix').on(t.doneBy),
        index('record_checklist_items_assignee_fk_ix').on(t.assigneeId),
        index('record_checklist_items_created_by_ix').on(t.createdBy),
        check('record_checklist_items_one_due', sql`${t.dueDate} IS NULL OR ${t.dueAt} IS NULL`),
    ],
);
export type RecordChecklistItemRow = typeof recordChecklistItems.$inferSelect;

/**
 * C6 — Plantillas de registro (`kind = 'record'`) y de checklist
 * (`kind = 'checklist'`), por lista (RLS). `content` referencia campos y
 * personas por ID (ver `record-template.ts` en shared).
 */
export const recordTemplates = pgTable(
    'record_templates',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        kind: varchar('kind', { length: 16 }).notNull().default('record'),
        name: varchar('name', { length: 120 }).notNull(),
        description: varchar('description', { length: 500 }),
        icon: varchar('icon', { length: 64 }),
        color: varchar('color', { length: 32 }),
        content: jsonb('content').notNull().default({}),
        position: integer('position').notNull().default(0),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index('record_templates_list_ix').on(t.tenantId, t.listId, t.kind, t.position),
        index('record_templates_list_fk_ix').on(t.listId),
        index('record_templates_created_by_ix').on(t.createdBy),
        check('record_templates_kind_ck', sql`${t.kind} IN ('record', 'checklist')`),
    ],
);
export type RecordTemplateRow = typeof recordTemplates.$inferSelect;
