import { bigint, index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
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
        createdBy: bigint('created_by', { mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('document_templates_list_ix').on(t.tenantId, t.listId)],
);
export type DocumentTemplateRow = typeof documentTemplates.$inferSelect;
