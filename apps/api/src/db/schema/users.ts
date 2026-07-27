import { sql } from 'drizzle-orm';
import { bigint, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

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
        /** v0.1.118 — null = el alta nunca confirmó su casilla. */
        emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
        // Firma de email del usuario (/me/email-signature): NULL = sin firma.
        emailSignature: text('email_signature'),
        /** v0.1.120 — 2FA TOTP. El secreto va cifrado (secret-box). */
        totpSecret: text('totp_secret'),
        /** NULL = el segundo factor no está activo para esta cuenta. */
        totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
        /** Códigos de respaldo HASHEADOS (sha256 hex); se consumen de a uno. */
        totpBackupCodes: jsonb('totp_backup_codes').$type<string[]>(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex('users_email_lower_ux').on(sql`lower(${t.email})`)],
);
