import { bigint, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
    slug: varchar('slug', { length: 63 }).notNull().unique(),
    name: text('name').notNull(),
    plan: varchar('plan', { length: 32 }).notNull().default('trial'),
    status: varchar('status', { length: 16 }).notNull().default('trialing'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
