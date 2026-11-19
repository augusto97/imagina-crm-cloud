import { type AnyPgColumn, bigint, boolean, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    slug: varchar('slug', { length: 63 }).notNull().unique(),
    name: text('name').notNull(),
    plan: varchar('plan', { length: 32 }).notNull().default('trial'),
    status: varchar('status', { length: 16 }).notNull().default('trialing'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    // Dominio propio del cliente (ADR-S17): entrada white-label a la app.
    customDomain: varchar('custom_domain', { length: 253 }).unique(),
    // v0.1.245 — dominio propio del PORTAL DEL CLIENTE (abre el portal, no la app).
    portalDomain: varchar('portal_domain', { length: 253 }).unique(),
    // Suscripción 'paga hasta' (operador): al vencer → solo-lectura (ADR-S09).
    subscriptionEndsAt: timestamp('subscription_ends_at', { withTimezone: true }),
    // v0.1.250 — hasta cuándo pagó por la app (Mercado Pago/PayPal). Vencido +
    // días de gracia → solo-lectura. Lo escribe SÓLO el aviso de pago.
    paidUntil: timestamp('paid_until', { withTimezone: true }),
    // v0.1.338 (ADR-S87) — fin de la prueba (plan `trial`). NULL = no vence.
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    // Archivada por el operador: deja de operar (solo-lectura) y se oculta de la grilla.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // v0.1.449 (I3, ADR-S108) — modo agencia: la empresa es una agencia, o es
    // cliente de una (una sola; una agencia no es cliente de otra).
    isAgency: boolean('is_agency').notNull().default(false),
    agencyId: bigint('agency_id', { mode: 'number' }).references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
    // La agencia pausó a este cliente: queda en sólo lectura.
    agencyPausedAt: timestamp('agency_paused_at', { withTimezone: true }),
    // v0.1.451 — hasta cuándo pagó este cliente a su agencia (lo lleva la agencia).
    agencyPaidUntil: timestamp('agency_paid_until', { withTimezone: true }),
    /** v0.1.452 — El registro de esta empresa en la lista «Empresas cliente» de su agencia (sin FK: se rearma si falta). */
    agencyRecordId: bigint('agency_record_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
