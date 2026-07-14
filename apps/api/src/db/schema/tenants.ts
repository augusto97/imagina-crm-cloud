import { bigint, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    slug: varchar('slug', { length: 63 }).notNull().unique(),
    name: text('name').notNull(),
    plan: varchar('plan', { length: 32 }).notNull().default('trial'),
    status: varchar('status', { length: 16 }).notNull().default('trialing'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    // Dominio propio del cliente (ADR-S17): entrada white-label a la app.
    customDomain: varchar('custom_domain', { length: 253 }).unique(),
    // Suscripción 'paga hasta' (operador): al vencer → solo-lectura (ADR-S09).
    subscriptionEndsAt: timestamp('subscription_ends_at', { withTimezone: true }),
    // Archivada por el operador: deja de operar (solo-lectura) y se oculta de la grilla.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
