import { bigint, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/** Qué guarda una fila de `templates` (v0.1.167). */
export const TEMPLATE_KINDS = ['list', 'dashboard', 'automation'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/**
 * Plantillas del workspace (v0.1.166 listas; v0.1.167 dashboards y
 * automatizaciones). El `blueprint` es el JSON portable de `packages/shared`
 * según `kind`: `listBlueprintSchema`, `dashboardTemplateSchema` o
 * `automationTemplateSchema`.
 */
export const templates = pgTable('templates', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    kind: varchar('kind', { length: 16 }).$type<TemplateKind>().notNull().default('list'),
    name: text('name').notNull(),
    description: text('description'),
    icon: varchar('icon', { length: 64 }),
    color: varchar('color', { length: 32 }),
    category: varchar('category', { length: 32 }).notNull().default('otros'),
    blueprint: jsonb('blueprint').$type<Record<string, unknown>>().notNull(),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, {
        onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
