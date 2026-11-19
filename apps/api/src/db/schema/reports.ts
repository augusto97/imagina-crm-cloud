import { bigint, index, integer, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * v0.1.464 (J1) — Informes: un documento armado con bloques (título, texto,
 * indicadores, gráficos y tablas) donde cada bloque de datos sale de su
 * propia lista. `blocks` es jsonb y referencia listas y campos por ID; se lee
 * tolerante (un bloque roto se descarta sin tirar el informe). Visibilidad
 * como los tableros. RLS por tenant_id (migración 0142).
 */
export const reports = pgTable(
    'reports',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        description: text('description'),
        blocks: jsonb('blocks').$type<unknown[]>().notNull().default([]),
        settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
        visibility: varchar('visibility', { length: 16 }).notNull().default('workspace'),
        allowedRoles: jsonb('allowed_roles').$type<string[]>().notNull().default([]),
        position: integer('position').notNull().default(0),
        createdBy: bigint('created_by', { mode: 'number' }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('reports_tenant_ix').on(t.tenantId, t.position, t.id)],
);
