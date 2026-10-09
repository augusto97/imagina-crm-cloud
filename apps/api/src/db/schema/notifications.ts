import { bigint, index, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * v0.1.276 (ADR-S40) — Avisos por destinatario. Datos de la empresa (RLS).
 * `title` es la frase ya armada al crearlo: si después se renombra la lista
 * o el registro, el aviso sigue contando lo que pasó.
 */
export const notifications = pgTable(
    'notifications',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        userId: bigint('user_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        kind: varchar('kind', { length: 16 }).notNull(),
        listId: bigint('list_id', { mode: 'number' }).references(() => lists.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' }).references(() => records.id, { onDelete: 'cascade' }),
        actorId: bigint('actor_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        title: varchar('title', { length: 300 }).notNull(),
        body: text('body').notNull().default(''),
        readAt: timestamp('read_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('notifications_user_ix').on(t.tenantId, t.userId, t.id)],
);
export type NotificationRow = typeof notifications.$inferSelect;

/** Registros que una persona sigue (avisos de comentarios y cambios). */
export const recordFollows = pgTable(
    'record_follows',
    {
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        userId: bigint('user_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.tenantId, t.userId, t.recordId] }), index('record_follows_record_ix').on(t.recordId)],
);

/** Recordatorios personales (de un registro o sueltos). */
export const reminders = pgTable(
    'reminders',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        userId: bigint('user_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' }).references(() => lists.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' }).references(() => records.id, { onDelete: 'cascade' }),
        remindAt: timestamp('remind_at', { withTimezone: true }).notNull(),
        note: varchar('note', { length: 500 }).notNull().default(''),
        firedAt: timestamp('fired_at', { withTimezone: true }),
        doneAt: timestamp('done_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('reminders_user_ix').on(t.tenantId, t.userId, t.remindAt)],
);
export type ReminderRow = typeof reminders.$inferSelect;
