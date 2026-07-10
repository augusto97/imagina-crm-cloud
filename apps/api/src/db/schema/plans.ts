import { boolean, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Planes de suscripción (ADR-S15 F3). Editables por el operador desde la consola.
 * Global (sin RLS): config de plataforma. `null` en un límite = ilimitado.
 */
export const plans = pgTable('plans', {
    slug: varchar('slug', { length: 32 }).primaryKey(),
    name: text('name').notNull(),
    maxRecords: integer('max_records'),
    maxUsers: integer('max_users'),
    maxAutomations: integer('max_automations'),
    // Precio de checkout self-serve (ADR-S12). `null` = no vendible en esa moneda
    // (enterprise = "contactar ventas"). Entero: USD sin centavos, COP sin decimales.
    priceUsd: integer('price_usd'),
    priceCop: integer('price_cop'),
    isActive: boolean('is_active').notNull().default(true),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
