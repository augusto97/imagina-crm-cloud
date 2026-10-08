import { bigint, boolean, index, integer, jsonb, pgTable, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { records } from './records';
import { lists } from './lists';
import { tenants } from './tenants';

/**
 * v0.1.266 (ADR-S35) — Plantilla de documento PDF de una lista. RLS: dato de
 * la empresa. `design` es el modelo por bloques de `docDesignSchema`.
 */
export const documentTemplates = pgTable(
    'document_templates',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 120 }).notNull(),
        filename: varchar('filename', { length: 200 }).notNull().default(''),
        design: jsonb('design').$type<Record<string, unknown>>().notNull(),
        /** v0.1.267 — El próximo número a asignar (numeración consecutiva). */
        nextNumber: integer('next_number').notNull().default(1),
        /** v0.1.267 — El cliente lo puede bajar desde su portal. */
        portalVisible: boolean('portal_visible').notNull().default(false),
        createdBy: bigint('created_by', { mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('document_templates_list_ix').on(t.tenantId, t.listId)],
);
export type DocumentTemplateRow = typeof documentTemplates.$inferSelect;

/**
 * v0.1.267 — El número asignado a cada (plantilla, registro): se emite la
 * primera vez que el documento se genera de verdad y no cambia más.
 */
export const documentNumbers = pgTable(
    'document_numbers',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        templateId: bigint('template_id', { mode: 'number' })
            .notNull()
            .references(() => documentTemplates.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        number: integer('number').notNull(),
        label: varchar('label', { length: 40 }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        unique('document_numbers_record_uq').on(t.templateId, t.recordId),
        unique('document_numbers_number_uq').on(t.templateId, t.number),
        index('document_numbers_record_ix').on(t.recordId),
        index('document_numbers_tenant_ix').on(t.tenantId),
    ],
);
