import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * v0.1.184 (ADR-S21 fase 4) — Clientes OAuth registrados dinámicamente
 * (RFC 7591) por claude.ai, Claude Desktop, Cursor, etc. Un cliente es sólo
 * "quién pide": no tiene tenant ni usuario — eso lo decide la persona en la
 * pantalla "Autorizar" y queda en el token emitido. `client_secret_hash`
 * sólo existe para los clientes que eligieron autenticarse con secreto
 * (los públicos van con PKCE, que es obligatorio siempre).
 *
 * SIN RLS a propósito (patrón de `personal_access_tokens`).
 */
export const oauthClients = pgTable('oauth_clients', {
    clientId: varchar('client_id', { length: 64 }).primaryKey(),
    clientSecretHash: varchar('client_secret_hash', { length: 64 }),
    clientName: text('client_name').notNull(),
    redirectUris: jsonb('redirect_uris').$type<string[]>().notNull().default([]),
    tokenEndpointAuthMethod: varchar('token_endpoint_auth_method', { length: 24 }).notNull().default('none'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
});
