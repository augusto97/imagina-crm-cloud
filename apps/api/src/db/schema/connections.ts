import { bigint, boolean, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * Conexión a un servicio externo (v0.1.196, ADR-S22).
 *
 * `config` guarda lo NO secreto (nombre de la cabecera o del parámetro de
 * auth, cabeceras y query fijos) y `secrets` los valores cifrados con el
 * secret-box de SEC-20. Separarlos es lo que permite mostrar la configuración
 * en pantalla sin descifrar nada y sin arriesgar una fuga.
 */
export const connections = pgTable('connections', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    provider: varchar('provider', { length: 64 }).notNull().default('http'),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull().default(''),
    authType: varchar('auth_type', { length: 16 }).notNull().default('none'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** Valores cifrados: `{ token, username, password, signing_secret }`. */
    secrets: jsonb('secrets').$type<Record<string, string>>().notNull().default({}),
    visibility: varchar('visibility', { length: 16 }).notNull().default('workspace'),
    ownerUserId: bigint('owner_user_id', { mode: 'number' }).references(() => users.id),
    lastCheckAt: timestamp('last_check_at', { withTimezone: true }),
    lastCheckOk: boolean('last_check_ok'),
    lastCheckError: text('last_check_error'),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
