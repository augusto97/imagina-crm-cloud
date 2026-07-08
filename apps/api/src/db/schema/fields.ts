import {
    bigint,
    boolean,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { tenants } from './tenants';

/**
 * Definición de campos. Sin `column_name`: ya no hay columnas físicas —
 * los valores viven en `records.data` bajo la clave `f{field_id}` (ADR-S02).
 */
export const fields = pgTable(
    'fields',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        slug: varchar('slug', { length: 63 }).notNull(),
        label: text('label').notNull(),
        type: varchar('type', { length: 32 }).notNull(),
        config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
        isRequired: boolean('is_required').notNull().default(false),
        isUnique: boolean('is_unique').notNull().default(false),
        isIndexed: boolean('is_indexed').notNull().default(false),
        position: integer('position').notNull().default(0),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        // Unicidad de slug de campo: dentro de su lista (CONTRACT.md §2).
        uniqueIndex('fields_list_slug_ux').on(t.listId, t.slug),
        index('fields_tenant_idx').on(t.tenantId),
    ],
);
