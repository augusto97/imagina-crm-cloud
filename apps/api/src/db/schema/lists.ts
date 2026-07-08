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
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    // Unicidad de slug de lista: global por tenant (CONTRACT.md §2).
    (t) => [uniqueIndex('lists_tenant_slug_ux').on(t.tenantId, t.slug)],
);
