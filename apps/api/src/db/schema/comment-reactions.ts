import { bigint, index, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { comments } from './comments';
import { tenants } from './tenants';
import { users } from './users';

/**
 * v0.1.291 — Reacciones con emoji a un comentario (RLS). Una por (comentario,
 * persona, emoji): tocar el mismo emoji otra vez la quita.
 */
export const commentReactions = pgTable(
    'comment_reactions',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        commentId: bigint('comment_id', { mode: 'number' })
            .notNull()
            .references(() => comments.id, { onDelete: 'cascade' }),
        userId: bigint('user_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        emoji: varchar('emoji', { length: 16 }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('comment_reactions_ux').on(t.commentId, t.userId, t.emoji),
        index('comment_reactions_user_ix').on(t.userId),
        index('comment_reactions_tenant_ix').on(t.tenantId),
    ],
);
export type CommentReactionRow = typeof commentReactions.$inferSelect;
