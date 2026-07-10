import { bigint, pgTable, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Auditoría de impersonación de soporte (ADR-S15 F5). Append-only, global (sin
 * RLS). Cada fila = una sesión de impersonación del operador sobre un usuario.
 */
export const impersonationLog = pgTable('impersonation_log', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    actorUserId: bigint('actor_user_id', { mode: 'number' })
        .notNull()
        .references(() => users.id),
    targetUserId: bigint('target_user_id', { mode: 'number' })
        .notNull()
        .references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
});
