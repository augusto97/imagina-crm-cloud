import { bigint, boolean, index, integer, jsonb, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { tenants } from './tenants';

/**
 * v0.1.275 (ADR-S39) — Formulario público de una lista. RLS: dato de la
 * empresa. El `token` es la dirección pública (único global); el endpoint
 * público lo resuelve por la conexión base, ANTES de conocer la empresa —
 * como el resto de los endpoints por token (listas públicas, webhooks).
 */
export const forms = pgTable(
    'forms',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 120 }).notNull(),
        token: varchar('token', { length: 64 }).notNull(),
        enabled: boolean('enabled').notNull().default(false),
        config: jsonb('config').$type<Record<string, unknown>>().notNull(),
        submissionsCount: integer('submissions_count').notNull().default(0),
        lastSubmittedAt: timestamp('last_submitted_at', { withTimezone: true }),
        createdBy: bigint('created_by', { mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('forms_list_ix').on(t.tenantId, t.listId), uniqueIndex('forms_token_ux').on(t.token)],
);
export type FormRow = typeof forms.$inferSelect;
