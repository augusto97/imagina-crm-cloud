import { bigint, index, integer, pgTable, primaryKey, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { records } from './records';
import { savedViews } from './saved-views';
import { tenants } from './tenants';
import { users } from './users';

/**
 * A8 — Dependencias entre registros (RLS): «`blocker` bloquea a `blocked`».
 *
 * Una fila propia (no un campo relation): tiene dirección, desfase en días y
 * la regla «sin ciclos» que valida el servidor. Cada punta guarda su LISTA:
 * hoy las dos son la misma, y permitir otra lista después es sólo levantar
 * esa validación. Borrar un registro (papelera) deja la dependencia INERTE
 * —toda lectura cruza `records.deleted_at IS NULL`— y vuelve sola si se
 * restaura; purgarlo la borra en cascada.
 */
export const recordDependencies = pgTable(
    'record_dependencies',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        blockerListId: bigint('blocker_list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        blockerRecordId: bigint('blocker_record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        blockedListId: bigint('blocked_list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        blockedRecordId: bigint('blocked_record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        lagDays: integer('lag_days').notNull().default(0),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        unique('record_dependencies_pair_ux').on(t.blockerRecordId, t.blockedRecordId),
        index('record_dependencies_blocked_ix').on(t.blockedRecordId),
        index('record_dependencies_blocker_list_ix').on(t.blockerListId),
        index('record_dependencies_blocked_list_ix').on(t.tenantId, t.blockedListId),
        index('record_dependencies_created_by_ix').on(t.createdBy),
    ],
);
export type RecordDependencyRow = typeof recordDependencies.$inferSelect;

/**
 * B1 — Línea base del Gantt (RLS): las fechas de inicio y fin de cada registro
 * congeladas en un momento, para comparar después. Una por vista (la vista
 * sabe qué campos son inicio y fin); guardar otra la reemplaza.
 */
export const ganttBaselines = pgTable(
    'gantt_baselines',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        viewId: bigint('view_id', { mode: 'number' })
            .notNull()
            .references(() => savedViews.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 120 }).notNull().default(''),
        startFieldId: bigint('start_field_id', { mode: 'number' }).notNull(),
        endFieldId: bigint('end_field_id', { mode: 'number' }),
        itemCount: integer('item_count').notNull().default(0),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        unique('gantt_baselines_view_ux').on(t.viewId),
        index('gantt_baselines_list_ix').on(t.listId),
        index('gantt_baselines_tenant_ix').on(t.tenantId),
        index('gantt_baselines_created_by_ix').on(t.createdBy),
    ],
);
export type GanttBaselineRow = typeof ganttBaselines.$inferSelect;

export const ganttBaselineItems = pgTable(
    'gantt_baseline_items',
    {
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        baselineId: bigint('baseline_id', { mode: 'number' })
            .notNull()
            .references(() => ganttBaselines.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        startValue: varchar('start_value', { length: 40 }),
        endValue: varchar('end_value', { length: 40 }),
    },
    (t) => [
        primaryKey({ columns: [t.baselineId, t.recordId] }),
        index('gantt_baseline_items_record_ix').on(t.recordId),
        index('gantt_baseline_items_tenant_ix').on(t.tenantId),
    ],
);
