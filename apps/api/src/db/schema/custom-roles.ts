import { bigint, index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * C2 — Roles PROPIOS de una empresa (RLS). Parten de un rol base
 * (`base_role`) y guardan la lista EXPLÍCITA de capacidades. Nombre único
 * por empresa sin importar mayúsculas (índice de expresión en la 0086).
 */
export const customRoles = pgTable('custom_roles', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 60 }).notNull(),
    description: text('description'),
    color: varchar('color', { length: 32 }),
    baseRole: varchar('base_role', { length: 16 }).notNull(),
    capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type CustomRoleRow = typeof customRoles.$inferSelect;

/**
 * C3 — Registros sueltos compartidos con una persona INVITADA (rol `guest`),
 * con su nivel: ver / comentar / editar (RLS).
 */
export const recordShares = pgTable(
    'record_shares',
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
        userId: bigint('user_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        level: varchar('level', { length: 16 }).notNull(),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('record_shares_user_ix').on(t.tenantId, t.userId), index('record_shares_list_ix').on(t.listId)],
);
export type RecordShareRow = typeof recordShares.$inferSelect;
