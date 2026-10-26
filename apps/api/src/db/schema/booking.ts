import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * D5 — Página de agenda de una lista (estilo Calendly). RLS: dato de la
 * empresa. El `token` es la dirección pública (único global); el endpoint
 * público la resuelve por la conexión base, ANTES de conocer la empresa —
 * igual que los formularios (ADR-S39).
 */
export const bookingPages = pgTable(
    'booking_pages',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 120 }).notNull(),
        token: varchar('token', { length: 64 }).notNull(),
        enabled: boolean('enabled').notNull().default(false),
        config: jsonb('config').$type<Record<string, unknown>>().notNull(),
        bookingsCount: integer('bookings_count').notNull().default(0),
        lastBookedAt: timestamp('last_booked_at', { withTimezone: true }),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('booking_pages_token_ux').on(t.token),
        index('booking_pages_list_ix').on(t.tenantId, t.listId),
        index('booking_pages_list_fk_ix').on(t.listId),
        index('booking_pages_created_by_ix').on(t.createdBy),
    ],
);
export type BookingPageRow = typeof bookingPages.$inferSelect;

/** El evento creado en el calendario de quien atiende (para moverlo o borrarlo después). */
export interface BookingExternalEvent {
    connection_id: number;
    provider: 'google_calendar' | 'outlook';
    event_id: string;
    calendar: string | null;
}

/**
 * D5 — Una cita reservada por una página. El REGISTRO es la verdad (inicio,
 * estado, quién atiende); esta fila guarda lo que el registro no tiene: el
 * correo del cliente, los recordatorios enviados (dedup entre nodos), el
 * evento del calendario externo y una copia de inicio/fin/estado para el
 * barrido de recordatorios. RLS: dato de la empresa.
 */
export const bookingAppointments = pgTable(
    'booking_appointments',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        pageId: bigint('page_id', { mode: 'number' })
            .notNull()
            .references(() => bookingPages.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        staffId: varchar('staff_id', { length: 24 }).notNull(),
        staffUserId: bigint('staff_user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        serviceId: varchar('service_id', { length: 24 }).notNull(),
        startAt: timestamp('start_at', { withTimezone: true }).notNull(),
        endAt: timestamp('end_at', { withTimezone: true }).notNull(),
        status: varchar('status', { length: 12 }).notNull().default('confirmed'),
        clientName: varchar('client_name', { length: 300 }),
        clientEmail: varchar('client_email', { length: 320 }),
        clientTz: varchar('client_tz', { length: 64 }),
        externalEvent: jsonb('external_event').$type<BookingExternalEvent | null>(),
        remindersSent: jsonb('reminders_sent').$type<string[]>().notNull().default([]),
        cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('booking_appointments_record_ux').on(t.recordId),
        index('booking_appointments_page_ix').on(t.tenantId, t.pageId, t.startAt),
        index('booking_appointments_page_fk_ix').on(t.pageId),
        index('booking_appointments_list_ix').on(t.listId),
        index('booking_appointments_staff_user_ix').on(t.staffUserId),
        index('booking_appointments_upcoming_ix').on(t.startAt).where(sql`${t.status} <> 'cancelled'`),
    ],
);
export type BookingAppointmentRow = typeof bookingAppointments.$inferSelect;
