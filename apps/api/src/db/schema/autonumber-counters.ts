import { bigint, integer, pgTable, primaryKey } from 'drizzle-orm/pg-core';
import { fields } from './fields';
import { tenants } from './tenants';

/**
 * v0.1.300 — Contador del campo «ID automático»: uno por campo y período (año, o
 * 0 si el campo no reinicia por año). Lo toma y avanza el trigger
 * `imcrm_records_autonumber` (migración 0079) al crear cada registro; la app
 * sólo lo escribe al numerar los registros que ya existían cuando se agregó
 * el campo y al migrar una empresa.
 */
export const autonumberCounters = pgTable(
    'autonumber_counters',
    {
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        fieldId: bigint('field_id', { mode: 'number' })
            .notNull()
            .references(() => fields.id, { onDelete: 'cascade' }),
        period: integer('period').notNull().default(0),
        nextValue: bigint('next_value', { mode: 'number' }).notNull(),
    },
    (t) => [primaryKey({ name: 'autonumber_counters_pk', columns: [t.fieldId, t.period] })],
);
