import { bigint, boolean, index, jsonb, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * v0.1.394 (ADR-S99) — Widget de contacto de la empresa (botones de
 * WhatsApp, formularios, agenda, llamar, correo, enlaces) para pegar en su
 * sitio. RLS: dato de la empresa. El `token` es la dirección pública (único
 * global) y el endpoint público lo resuelve por la conexión base, como los
 * formularios.
 */
export const contactWidgets = pgTable(
    'contact_widgets',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 120 }).notNull(),
        token: varchar('token', { length: 64 }).notNull(),
        enabled: boolean('enabled').notNull().default(false),
        config: jsonb('config').$type<Record<string, unknown>>().notNull(),
        createdBy: bigint('created_by', { mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('contact_widgets_tenant_ix').on(t.tenantId), uniqueIndex('contact_widgets_token_ux').on(t.token)],
);
export type ContactWidgetRow = typeof contactWidgets.$inferSelect;
