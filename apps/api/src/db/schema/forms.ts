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

/**
 * v0.1.290 — Respuesta esperando que quien la mandó confirme su correo
 * (doble opt-in). RLS: datos de la empresa. `data` es la respuesta YA
 * validada (claves `f{id}`): al confirmar se crea el registro con eso, sin
 * volver a pedirle nada al navegador. El enlace la busca por `token_hash`
 * (único) con la conexión base, igual que `forms.token`.
 */
export const formPendingSubmissions = pgTable(
    'form_pending_submissions',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        formId: bigint('form_id', { mode: 'number' })
            .notNull()
            .references(() => forms.id, { onDelete: 'cascade' }),
        tokenHash: varchar('token_hash', { length: 64 }).notNull(),
        email: varchar('email', { length: 320 }).notNull(),
        data: jsonb('data').$type<Record<string, unknown>>().notNull(),
        attachmentIds: jsonb('attachment_ids').$type<number[]>().notNull().default([]),
        ip: varchar('ip', { length: 64 }),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('form_pending_token_ux').on(t.tokenHash),
        index('form_pending_expires_ix').on(t.expiresAt),
        index('form_pending_form_ix').on(t.tenantId, t.formId),
    ],
);
export type FormPendingRow = typeof formPendingSubmissions.$inferSelect;
