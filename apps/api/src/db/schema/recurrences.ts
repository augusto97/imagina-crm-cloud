import { bigint, integer, pgTable, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { fields } from './fields';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';

/**
 * Recurrencias ClickUp-style sobre un campo `date`/`datetime` de un record
 * (paridad con `Recurrences/*` del plugin). Una por (record, campo de fecha).
 * `repeatUntil`/`lastFiredAt` son TEXT: se comparan como strings contra los
 * valores de fecha del JSONB (estilo plugin). Tenant-scoped con RLS.
 */
export const recurrences = pgTable(
    'recurrences',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        dateFieldId: bigint('date_field_id', { mode: 'number' })
            .notNull()
            .references(() => fields.id, { onDelete: 'cascade' }),
        frequency: varchar('frequency', { length: 20 }).notNull(),
        intervalN: integer('interval_n').notNull().default(1),
        monthlyPattern: varchar('monthly_pattern', { length: 20 }),
        triggerType: varchar('trigger_type', { length: 20 }).notNull().default('schedule'),
        triggerStatusFieldId: bigint('trigger_status_field_id', { mode: 'number' }).references(
            () => fields.id,
            { onDelete: 'set null' },
        ),
        triggerStatusValue: text('trigger_status_value'),
        actionType: varchar('action_type', { length: 10 }).notNull().default('update'),
        updateStatusFieldId: bigint('update_status_field_id', { mode: 'number' }).references(
            () => fields.id,
            { onDelete: 'set null' },
        ),
        updateStatusValue: text('update_status_value'),
        repeatUntil: text('repeat_until'),
        lastFiredAt: text('last_fired_at'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [unique('recurrences_record_field_unique').on(t.tenantId, t.recordId, t.dateFieldId)],
);
