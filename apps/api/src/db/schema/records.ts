import type { RichDoc } from '@imagina-base/shared';
import { sql } from 'drizzle-orm';
import { bigint, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { tenants } from './tenants';

/**
 * Tabla universal de records (STANDALONE.md §3.1). Los datos dinámicos viven
 * en `data` con claves `f{field_id}` inmutables. Los índices GIN/FTS/parciales
 * se definen en la migración SQL (drizzle no expresa jsonb_to_tsvector).
 */
export const records = pgTable('records', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    tenantId: bigint('tenant_id', { mode: 'number' })
        .notNull()
        .references(() => tenants.id),
    listId: bigint('list_id', { mode: 'number' })
        .notNull()
        .references(() => lists.id, { onDelete: 'cascade' }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    /** Padre dentro de la misma lista (subtareas). null = primer nivel. */
    parentId: bigint('parent_id', { mode: 'number' }),
    /** Descripción rica (árbol ProseMirror). null = sin descripción. */
    description: jsonb('description').$type<RichDoc>(),
    /**
     * v0.1.188 — texto plano de la descripción, columna GENERADA por Postgres
     * (migración 0051) para que el buscador la vea. Nunca se escribe desde
     * la app.
     */
    descriptionText: text('description_text').generatedAlwaysAs(sql`imagina_richdoc_text(description)`),
    createdBy: bigint('created_by', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
