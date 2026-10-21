import { bigint, index, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * v0.1.289 — Contraseña del PORTAL del cliente, POR EMPRESA. No es la
 * contraseña de la cuenta (`users.password_hash`): un cliente de dos empresas
 * tiene dos contraseñas independientes, y ninguna abre la app del equipo ni
 * cambia la de su cuenta de trabajo. RLS: dato de la empresa. No viaja en la
 * migración de empresa (es una credencial de esta instalación).
 */
export const portalCredentials = pgTable(
    'portal_credentials',
    {
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        userId: bigint('user_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        passwordHash: varchar('password_hash', { length: 255 }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index('portal_credentials_user_ix').on(t.userId)],
);
