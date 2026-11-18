import { sql } from 'drizzle-orm';
import { bigint, char, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { attachments } from './attachments';
import { documentNumbers, documentTemplates } from './document-templates';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * D6 (v0.1.446, ADR-S107) — Firma electrónica de documentos.
 *
 * Una solicitud = un PDF de un registro que firman una o varias personas por
 * enlace. El PDF ORIGINAL se guarda como copia propia (su huella SHA-256 es lo
 * que firman) y, cuando firman todos, el PDF FIRMADO (sellado + constancia).
 * Los dos son adjuntos de la empresa con `restrict`: no se borran sueltos.
 */
export const signatureRequests = pgTable(
    'signature_requests',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        title: varchar('title', { length: 160 }).notNull(),
        /** pending | completed | declined | expired | voided */
        status: varchar('status', { length: 16 }).notNull().default('pending'),
        /** parallel | sequential */
        orderMode: varchar('order_mode', { length: 16 }).notNull().default('parallel'),
        /** email | none */
        verify: varchar('verify', { length: 16 }).notNull().default('email'),
        message: text('message').notNull().default(''),
        /** template | file */
        source: varchar('source', { length: 16 }).notNull(),
        templateId: bigint('template_id', { mode: 'number' }).references(() => documentTemplates.id, { onDelete: 'set null' }),
        documentNumberId: bigint('document_number_id', { mode: 'number' }).references(() => documentNumbers.id, { onDelete: 'set null' }),
        documentLabel: varchar('document_label', { length: 40 }),
        originalFileId: bigint('original_file_id', { mode: 'number' })
            .notNull()
            .references(() => attachments.id, { onDelete: 'restrict' }),
        originalSha256: char('original_sha256', { length: 64 }).notNull(),
        pages: integer('pages').notNull().default(0),
        signedFileId: bigint('signed_file_id', { mode: 'number' }).references(() => attachments.id, { onDelete: 'restrict' }),
        signedSha256: char('signed_sha256', { length: 64 }),
        /** Código corto y público de la solicitud (constancia y verificación). Único en el servidor. */
        code: varchar('code', { length: 16 }).notNull(),
        onComplete: jsonb('on_complete').notNull().default(sql`'{}'::jsonb`),
        remindDays: integer('remind_days').notNull().default(3),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
        completedAt: timestamp('completed_at', { withTimezone: true }),
        voidedAt: timestamp('voided_at', { withTimezone: true }),
        voidedBy: bigint('voided_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        voidReason: varchar('void_reason', { length: 500 }),
        /** Sube al anular: los enlaces viejos dejan de servir. */
        linkVersion: integer('link_version').notNull().default(1),
    },
    (t) => [
        uniqueIndex('signature_requests_code_ux').on(t.code),
        index('signature_requests_record_ix').on(t.recordId),
        index('signature_requests_tenant_ix').on(t.tenantId, t.recordId),
        index('signature_requests_list_ix').on(t.listId),
        index('signature_requests_template_ix').on(t.templateId).where(sql`${t.templateId} IS NOT NULL`),
        index('signature_requests_number_ix').on(t.documentNumberId).where(sql`${t.documentNumberId} IS NOT NULL`),
        index('signature_requests_original_ix').on(t.originalFileId),
        index('signature_requests_signed_ix').on(t.signedFileId).where(sql`${t.signedFileId} IS NOT NULL`),
        index('signature_requests_created_by_ix').on(t.createdBy),
        index('signature_requests_voided_by_ix').on(t.voidedBy).where(sql`${t.voidedBy} IS NOT NULL`),
        index('signature_requests_pending_ix').on(t.expiresAt).where(sql`${t.status} = 'pending'`),
        // v0.1.447: verificar subiendo el PDF (búsqueda por huella).
        index('signature_requests_original_sha_ix').on(t.originalSha256),
        index('signature_requests_signed_sha_ix').on(t.signedSha256).where(sql`${t.signedSha256} IS NOT NULL`),
    ],
);
export type SignatureRequestRow = typeof signatureRequests.$inferSelect;

export const signatureSigners = pgTable(
    'signature_signers',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        requestId: bigint('request_id', { mode: 'number' })
            .notNull()
            .references(() => signatureRequests.id, { onDelete: 'cascade' }),
        position: integer('position').notNull(),
        name: varchar('name', { length: 120 }).notNull(),
        email: varchar('email', { length: 255 }).notNull(),
        role: varchar('role', { length: 60 }).notNull().default(''),
        /** waiting | sent | viewed | signed | declined */
        status: varchar('status', { length: 16 }).notNull().default('waiting'),
        sentAt: timestamp('sent_at', { withTimezone: true }),
        viewedAt: timestamp('viewed_at', { withTimezone: true }),
        signedAt: timestamp('signed_at', { withTimezone: true }),
        declinedAt: timestamp('declined_at', { withTimezone: true }),
        declineReason: text('decline_reason'),
        remindersSent: integer('reminders_sent').notNull().default(0),
        lastRemindedAt: timestamp('last_reminded_at', { withTimezone: true }),
        /** La evidencia de la firma. */
        signedName: varchar('signed_name', { length: 120 }),
        /** drawn | typed */
        signatureKind: varchar('signature_kind', { length: 8 }),
        /** PNG normalizado (base64, sin el prefijo `data:`). */
        signaturePng: text('signature_png'),
        ip: varchar('ip', { length: 64 }),
        userAgent: varchar('user_agent', { length: 400 }),
        /** email | none */
        verifiedBy: varchar('verified_by', { length: 16 }),
        consentText: text('consent_text'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index('signature_signers_request_ix').on(t.requestId, t.position),
        index('signature_signers_tenant_ix').on(t.tenantId),
        index('signature_signers_remind_ix').on(t.lastRemindedAt).where(sql`${t.status} IN ('sent', 'viewed')`),
    ],
);
export type SignatureSignerRow = typeof signatureSigners.$inferSelect;
