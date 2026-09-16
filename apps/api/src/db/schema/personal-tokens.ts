import { bigint, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { oauthClients } from './oauth-clients';
import { tenants } from './tenants';
import { users } from './users';

/**
 * v0.1.183 (ADR-S21 fase 3) — Tokens de acceso personal para el servidor
 * MCP. Un token pertenece a UN usuario en UN workspace; el secreto no se
 * guarda (sólo su SHA-256 y un prefijo para reconocerlo) y el rol se
 * resuelve EN VIVO contra `memberships` en cada uso: sacar a la persona del
 * workspace mata sus tokens al instante.
 *
 * SIN RLS a propósito (mismo patrón que `automation_hooks` / `public_lists`):
 * la búsqueda es por hash del token ANTES de saber el tenant; lo que el
 * token habilita corre después dentro del scope del tenant resuelto.
 */
export const personalAccessTokens = pgTable(
    'personal_access_tokens',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        userId: bigint('user_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        prefix: varchar('prefix', { length: 16 }).notNull(),
        tokenHash: varchar('token_hash', { length: 64 }).notNull(),
        scope: varchar('scope', { length: 8 }).notNull().default('read'),
        lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
        expiresAt: timestamp('expires_at', { withTimezone: true }),
        revokedAt: timestamp('revoked_at', { withTimezone: true }),
        // v0.1.184 — emitido por OAuth: cliente conectado + refresh token
        // rotativo (hash; el secreto no se guarda, como el de acceso).
        clientId: varchar('client_id', { length: 64 }).references(() => oauthClients.clientId, { onDelete: 'cascade' }),
        refreshTokenHash: varchar('refresh_token_hash', { length: 64 }),
        refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex('personal_access_tokens_hash_ux').on(t.tokenHash), uniqueIndex('personal_access_tokens_refresh_ux').on(t.refreshTokenHash)],
);
