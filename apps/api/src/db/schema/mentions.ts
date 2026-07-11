import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { comments } from './comments';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * Menciones (@usuario en comentarios). Se extraen al crear el comment
 * (tokens `@login` que matchean emails de miembros del workspace) y las
 * consume la campana (`GET /me/mentions`). El "no leído" es client-side
 * (localStorage del bell) — no hay read_at. Tenant-scoped con RLS.
 */
export const mentions = pgTable('mentions', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    commentId: bigint('comment_id', { mode: 'number' })
        .notNull()
        .references(() => comments.id, { onDelete: 'cascade' }),
    listId: bigint('list_id', { mode: 'number' })
        .notNull()
        .references(() => lists.id, { onDelete: 'cascade' }),
    recordId: bigint('record_id', { mode: 'number' })
        .notNull()
        .references(() => records.id, { onDelete: 'cascade' }),
    mentionedUserId: bigint('mentioned_user_id', { mode: 'number' })
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    authorUserId: bigint('author_user_id', { mode: 'number' })
        .notNull()
        .references(() => users.id),
    snippet: text('snippet').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
