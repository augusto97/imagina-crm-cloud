import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { comments } from './comments';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * D2 — El buzón de soporte de una lista (RLS). Uno por lista. La contraseña
 * de aplicación va cifrada (secret-box) y `state` lleva el cursor por
 * UIDVALIDITY + último UID: no se borra ni marca nada en el buzón.
 */
export const helpdeskMailboxes = pgTable(
    'helpdesk_mailboxes',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        preset: varchar('preset', { length: 16 }).notNull().default('generic'),
        host: varchar('host', { length: 255 }).notNull(),
        port: integer('port').notNull(),
        security: varchar('security', { length: 16 }).notNull().default('tls'),
        username: varchar('username', { length: 255 }).notNull(),
        passwordEnc: text('password_enc'),
        folder: varchar('folder', { length: 255 }).notNull().default('INBOX'),
        supportAddress: varchar('support_address', { length: 255 }).notNull(),
        markSeen: boolean('mark_seen').notNull().default(false),
        allowInvalidCert: boolean('allow_invalid_cert').notNull().default(false),
        enabled: boolean('enabled').notNull().default(true),
        state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
        nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [unique('helpdesk_mailboxes_list_ux').on(t.listId), index('helpdesk_mailboxes_tenant_ix').on(t.tenantId)],
);
export type HelpdeskMailboxRow = typeof helpdeskMailboxes.$inferSelect;

/** D2 — Cada correo que entró (y qué se hizo con él) o que salió (RLS). */
export const helpdeskMessages = pgTable(
    'helpdesk_messages',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        mailboxId: bigint('mailbox_id', { mode: 'number' }).references(() => helpdeskMailboxes.id, { onDelete: 'set null' }),
        recordId: bigint('record_id', { mode: 'number' }).references(() => records.id, { onDelete: 'cascade' }),
        commentId: bigint('comment_id', { mode: 'number' }).references(() => comments.id, { onDelete: 'set null' }),
        direction: varchar('direction', { length: 4 }).notNull(),
        status: varchar('status', { length: 16 }).notNull(),
        reason: text('reason'),
        messageId: varchar('message_id', { length: 500 }),
        inReplyTo: varchar('in_reply_to', { length: 500 }),
        refs: jsonb('refs').$type<string[]>().notNull().default([]),
        fromEmail: varchar('from_email', { length: 320 }),
        fromName: varchar('from_name', { length: 255 }),
        toAddr: text('to_addr'),
        ccAddr: text('cc_addr'),
        subject: varchar('subject', { length: 500 }),
        uid: bigint('uid', { mode: 'number' }),
        uidvalidity: bigint('uidvalidity', { mode: 'number' }),
        sentBy: bigint('sent_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('helpdesk_messages_thread_ix').on(t.tenantId, t.listId, t.messageId)],
);
export type HelpdeskMessageRow = typeof helpdeskMessages.$inferSelect;

/** Una pausa del reloj del SLA (ISO; `to` null = sigue abierta). */
export interface StoredPause {
    from: string;
    to: string | null;
}

/** E5 — Estado de mesa de ayuda y reloj del SLA de un registro (RLS). */
export const helpdeskTickets = pgTable(
    'helpdesk_tickets',
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
        mailboxId: bigint('mailbox_id', { mode: 'number' }).references(() => helpdeskMailboxes.id, { onDelete: 'set null' }),
        customerEmail: varchar('customer_email', { length: 320 }),
        customerName: varchar('customer_name', { length: 255 }),
        subject: varchar('subject', { length: 500 }),
        startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
        priority: varchar('priority', { length: 190 }),
        firstResponseMinutes: integer('first_response_minutes'),
        resolutionMinutes: integer('resolution_minutes'),
        firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
        resolvedAt: timestamp('resolved_at', { withTimezone: true }),
        pauses: jsonb('pauses').$type<StoredPause[]>().notNull().default([]),
        slaStatus: varchar('sla_status', { length: 16 }),
        firstResponseDue: timestamp('first_response_due', { withTimezone: true }),
        resolutionDue: timestamp('resolution_due', { withTimezone: true }),
        alerts: jsonb('alerts').$type<Record<string, string>>().notNull().default({}),
        nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
        lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
        lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [unique('helpdesk_tickets_record_ux').on(t.recordId), index('helpdesk_tickets_list_ix').on(t.tenantId, t.listId)],
);
export type HelpdeskTicketRow = typeof helpdeskTickets.$inferSelect;
