import { bigint, boolean, index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { dashboards } from './dashboards';
import { tenants } from './tenants';
import { users } from './users';

/**
 * v0.1.292 (ADR-S50) — Enlace público de un tablero: token opaco → tablero.
 * SIN RLS (como `public_lists`): se busca por token antes de conocer la
 * empresa; todo lo demás se lee después dentro del scope de esa empresa.
 * `published_by`: los datos se calculan con SU acceso.
 */
export const publicDashboards = pgTable(
    'public_dashboards',
    {
        token: varchar('token', { length: 64 }).primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        dashboardId: bigint('dashboard_id', { mode: 'number' })
            .notNull()
            .references(() => dashboards.id, { onDelete: 'cascade' }),
        publishedBy: bigint('published_by', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        /** Último día en que funciona (`YYYY-MM-DD`, en la zona de la empresa). */
        expiresAt: varchar('expires_at', { length: 10 }),
        allowedDomains: jsonb('allowed_domains').$type<string[]>().notNull().default([]),
        allowPeriod: boolean('allow_period').notNull().default(false),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('public_dashboards_dashboard_ux').on(t.dashboardId),
        index('public_dashboards_tenant_ix').on(t.tenantId),
        index('public_dashboards_published_by_ix').on(t.publishedBy),
    ],
);

/** v0.1.292 (ADR-S50) — Envío programado del tablero por correo (RLS). */
export const dashboardSubscriptions = pgTable(
    'dashboard_subscriptions',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        dashboardId: bigint('dashboard_id', { mode: 'number' })
            .notNull()
            .references(() => dashboards.id, { onDelete: 'cascade' }),
        ownerId: bigint('owner_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        enabled: boolean('enabled').notNull().default(true),
        frequency: varchar('frequency', { length: 8 }).notNull().default('weekly'),
        weekdays: jsonb('weekdays').$type<number[]>().notNull().default([1]),
        monthDay: smallint('month_day').notNull().default(1),
        hour: smallint('hour').notNull().default(8),
        minute: smallint('minute').notNull().default(0),
        timeZone: varchar('time_zone', { length: 64 }),
        recipientUserIds: jsonb('recipient_user_ids').$type<number[]>().notNull().default([]),
        recipientEmails: jsonb('recipient_emails').$type<string[]>().notNull().default([]),
        subject: varchar('subject', { length: 200 }).notNull().default(''),
        message: text('message').notNull().default(''),
        attachPdf: boolean('attach_pdf').notNull().default(false),
        lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
        lastStatus: varchar('last_status', { length: 12 }),
        lastError: text('last_error'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index('dashboard_subscriptions_dashboard_ix').on(t.tenantId, t.dashboardId),
        index('dashboard_subscriptions_dashboard_fk_ix').on(t.dashboardId),
        index('dashboard_subscriptions_owner_ix').on(t.ownerId),
    ],
);
