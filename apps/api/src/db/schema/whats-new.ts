import { bigint, boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Fase 7 · entrega 3 — una NOVEDAD de la plataforma (migración 0092). Global:
 * sin `tenant_id` ni RLS, como `plans` (la leen todas las empresas). El rol de
 * la app sólo puede leerla; la escriben la sincronización del catálogo y la
 * consola del operador por la conexión base.
 */
export const whatsNewEntries = pgTable(
    'whats_new_entries',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        /** Clave estable (la del catálogo, o `op-…` para las del operador). */
        key: varchar('key', { length: 120 }).notNull(),
        /** `release` (catálogo en código) | `operator`. */
        origin: varchar('origin', { length: 16 }).notNull(),
        /** `draft` | `published` | `hidden`. */
        status: varchar('status', { length: 16 }).notNull().default('published'),
        kind: varchar('kind', { length: 16 }).notNull(),
        title: varchar('title', { length: 200 }).notNull(),
        summary: varchar('summary', { length: 400 }).notNull(),
        body: text('body').notNull().default(''),
        imageUrl: text('image_url'),
        videoUrl: text('video_url'),
        /** `{ label, href?, tour? }` (validado con `whatsNewActionSchema`). */
        action: jsonb('action'),
        version: varchar('version', { length: 32 }),
        featured: boolean('featured').notNull().default(false),
        audienceRoles: text('audience_roles').array().notNull().default([]),
        audiencePlans: text('audience_plans').array().notNull().default([]),
        /** Fecha que se muestra y puerta de visibilidad (null = borrador sin fecha). */
        publishedAt: timestamp('published_at', { withTimezone: true }),
        /** Desde cuándo cuenta como «nueva» en este servidor (null = sólo historial). */
        announceFrom: timestamp('announce_from', { withTimezone: true }),
        expiresAt: timestamp('expires_at', { withTimezone: true }),
        /** Novedad de versión editada por el operador: la sincronización ya no la toca. */
        edited: boolean('edited').notNull().default(false),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        updatedBy: bigint('updated_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('whats_new_entries_key_ux').on(t.key),
        index('whats_new_entries_created_by_ix').on(t.createdBy),
        index('whats_new_entries_updated_by_ix').on(t.updatedBy),
    ],
);
export type WhatsNewEntryRow = typeof whatsNewEntries.$inferSelect;

/**
 * Lo que vio cada PERSONA de cada novedad (global, no por empresa). RLS por
 * `app.user_id`: una persona sólo lee y marca lo suyo.
 */
export const whatsNewViews = pgTable(
    'whats_new_views',
    {
        userId: bigint('user_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        entryId: bigint('entry_id', { mode: 'number' })
            .notNull()
            .references(() => whatsNewEntries.id, { onDelete: 'cascade' }),
        seenAt: timestamp('seen_at', { withTimezone: true }),
        openedAt: timestamp('opened_at', { withTimezone: true }),
        clickedAt: timestamp('clicked_at', { withTimezone: true }),
        dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
        presentedAt: timestamp('presented_at', { withTimezone: true }),
    },
    (t) => [primaryKey({ name: 'whats_new_views_pk', columns: [t.userId, t.entryId] }), index('whats_new_views_entry_ix').on(t.entryId)],
);
