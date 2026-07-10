import { sql } from 'drizzle-orm';
import { bigint, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable(
    'users',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        email: varchar('email', { length: 255 }).notNull(),
        passwordHash: text('password_hash').notNull(),
        name: text('name').notNull(),
        locale: varchar('locale', { length: 10 }).notNull().default('es'),
        // Desactivación de cuenta por el operador (ADR-S15 F2): NULL = activa.
        disabledAt: timestamp('disabled_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex('users_email_lower_ux').on(sql`lower(${t.email})`)],
);
