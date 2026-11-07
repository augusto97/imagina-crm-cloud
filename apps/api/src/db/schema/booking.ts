import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { paymentLinks } from './collections';
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
    /**
     * v0.1.350 — Inicio y fin del evento la última vez que la app lo escribió
     * o lo vio (ISO). La sincronización compara contra esto —no contra la
     * cita— para saber si lo movió quien atiende y no la propia app.
     */
    start?: string;
    end?: string;
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
        /** v0.1.350 — El enlace de la videollamada (Meet, Teams o el fijo) y de dónde salió. */
        meetingUrl: text('meeting_url'),
        meetingProvider: varchar('meeting_provider', { length: 16 }),
        remindersSent: jsonb('reminders_sent').$type<string[]>().notNull().default([]),
        cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
        /** v0.1.353 — Por confirmar: hasta cuándo ocupa el lugar sin que nadie decida. */
        pendingUntil: timestamp('pending_until', { withTimezone: true }),
        decidedBy: bigint('decided_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        decidedAt: timestamp('decided_at', { withTimezone: true }),
        declineReason: varchar('decline_reason', { length: 500 }),
        /** v0.1.387 — El link de pago de la cita (cobrar al agendar). */
        paymentLinkId: bigint('payment_link_id', { mode: 'number' }).references((): AnyPgColumn => paymentLinks.id, { onDelete: 'set null' }),
        /** v0.1.387 — Esperando el pago: hasta cuándo queda apartado el horario. */
        paymentUntil: timestamp('payment_until', { withTimezone: true }),
        /** v0.1.387 — El equipo la marcó pagada a mano (pagó por otro medio). */
        paidMarkedBy: bigint('paid_marked_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        paidMarkedAt: timestamp('paid_marked_at', { withTimezone: true }),
        /** v0.1.353 — Va en la firma del enlace de la cita: cada cambio la sube (el enlace viejo deja de servir). */
        manageVersion: integer('manage_version').notNull().default(0),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('booking_appointments_record_ux').on(t.recordId),
        index('booking_appointments_page_ix').on(t.tenantId, t.pageId, t.startAt),
        index('booking_appointments_page_fk_ix').on(t.pageId),
        index('booking_appointments_list_ix').on(t.listId),
        index('booking_appointments_staff_user_ix').on(t.staffUserId),
        index('booking_appointments_upcoming_ix').on(t.startAt).where(sql`${t.status} NOT IN ('cancelled', 'declined')`),
        index('booking_appointments_pending_ix').on(t.pendingUntil).where(sql`${t.status} = 'pending'`),
        index('booking_appointments_decided_by_ix').on(t.decidedBy),
        index('booking_appointments_payment_link_ix').on(t.paymentLinkId).where(sql`${t.paymentLinkId} IS NOT NULL`),
        index('booking_appointments_unpaid_ix').on(t.paymentUntil).where(sql`${t.status} = 'unpaid'`),
        index('booking_appointments_paid_marked_by_ix').on(t.paidMarkedBy).where(sql`${t.paidMarkedBy} IS NOT NULL`),
    ],
);
export type BookingAppointmentRow = typeof bookingAppointments.$inferSelect;
