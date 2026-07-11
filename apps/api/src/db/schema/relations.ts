import { bigint, integer, pgTable, timestamp, unique } from 'drizzle-orm/pg-core';
import { fields } from './fields';
import { records } from './records';
import { tenants } from './tenants';

/**
 * Relaciones entre registros (campos tipo `relation` — CONTRACT §3). El valor
 * NO vive en `records.data`: cada vínculo source→target es una fila por campo,
 * paridad con `wp_imcrm_relations` del plugin. Tenant-scoped con RLS. El hard
 * delete de record/field limpia en cascada; el soft-delete del target se
 * filtra al leer (JOIN records con deleted_at IS NULL).
 */
export const relations = pgTable(
    'relations',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        fieldId: bigint('field_id', { mode: 'number' })
            .notNull()
            .references(() => fields.id, { onDelete: 'cascade' }),
        sourceRecordId: bigint('source_record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        targetRecordId: bigint('target_record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        position: integer('position').notNull().default(0),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [unique('relations_unique_link').on(t.tenantId, t.fieldId, t.sourceRecordId, t.targetRecordId)],
);
