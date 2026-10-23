import { sql } from 'drizzle-orm';
import {
    bigint,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from 'drizzle-orm/pg-core';
import { listGroups } from './list-groups';
import { tenants } from './tenants';

export const lists = pgTable(
    'lists',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        slug: varchar('slug', { length: 63 }).notNull(),
        name: text('name').notNull(),
        icon: varchar('icon', { length: 64 }),
        color: varchar('color', { length: 32 }),
        settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
        position: integer('position').notNull().default(0),
        /** Carpeta del menú, o null = cuelga de la raíz. */
        groupId: bigint('group_id', { mode: 'number' }).references(() => listGroups.id, {
            onDelete: 'set null',
        }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        /** Papelera: null = viva. Mientras no es null, la RLS la oculta. */
        deletedAt: timestamp('deleted_at', { withTimezone: true }),
        deletedBy: bigint('deleted_by', { mode: 'number' }),
    },
    // Unicidad de slug de lista: global por tenant (CONTRACT.md §2), entre
    // las VIVAS (lo que está en la papelera libera su slug).
    (t) => [uniqueIndex('lists_tenant_slug_ux').on(t.tenantId, t.slug).where(sql`deleted_at IS NULL`)],
);
