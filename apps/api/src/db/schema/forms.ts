import { bigint, boolean, date, index, integer, jsonb, pgTable, primaryKey, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
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
 * v0.1.289 — Respuesta esperando que quien la mandó confirme su correo
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
        /**
         * Autorización de tratamiento de datos aceptada al ENVIAR (versión,
         * cuándo, IP, navegador, referencia del enlace de retiro): se registra al
         * confirmar, con estos datos del envío original. null = no se pidió.
         */
        consent: jsonb('consent').$type<PendingConsent | null>(),
        /** v0.1.356 — La pantalla final que le tocó al enviar (null = el «¡Gracias!»). */
        endingId: varchar('ending_id', { length: 24 }),
        /** v0.1.368 — El plan de suscripción que eligió (se suscribe al confirmar). */
        planId: bigint('plan_id', { mode: 'number' }),
        /** v0.1.386 — De dónde llegó (página, sitio anterior, campaña): para las automatizaciones al confirmar. */
        origin: jsonb('origin').$type<Record<string, string> | null>(),
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

/** La autorización de datos que espera con una respuesta sin confirmar. */
export interface PendingConsent {
    version: number;
    /** Huella del texto aceptado (casilla + texto + enlace). */
    text_hash: string;
    accepted_at: string;
    ip: string | null;
    user_agent: string | null;
    /** Referencia del enlace de retiro que va en el correo de confirmación. */
    withdraw_ref: string | null;
}

/**
 * v0.1.358 — Contadores de un formulario por día (zona de la empresa):
 * visitas, empezados, enviados, pasos, abandonos, orígenes y dispositivos.
 * Son sumas, nunca datos de una persona. RLS: dato de la empresa.
 */
export const formStats = pgTable(
    'form_stats',
    {
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        formId: bigint('form_id', { mode: 'number' })
            .notNull()
            .references(() => forms.id, { onDelete: 'cascade' }),
        day: date('day', { mode: 'string' }).notNull(),
        counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.formId, t.day] }), index('form_stats_tenant_ix').on(t.tenantId, t.formId, t.day)],
);
export type FormStatsRow = typeof formStats.$inferSelect;

/**
 * v0.1.358 — Un avance guardado («Guardar y seguir después»). El enlace del
 * correo lo busca por `token_hash` con la conexión base. RLS: datos de la
 * empresa (son respuestas a medio llenar). Dura 30 días; se borra al enviar.
 */
export const formDrafts = pgTable(
    'form_drafts',
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
        values: jsonb('values').$type<Record<string, unknown>>().notNull().default({}),
        page: integer('page').notNull().default(0),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('form_drafts_token_ux').on(t.tokenHash),
        index('form_drafts_expires_ix').on(t.expiresAt),
        index('form_drafts_form_ix').on(t.tenantId, t.formId),
    ],
);
export type FormDraftRow = typeof formDrafts.$inferSelect;
