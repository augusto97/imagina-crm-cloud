import { sql } from 'drizzle-orm';
import { bigint, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { forms } from './forms';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * Autorización de tratamiento de datos personales (Ley 1581 de 2012).
 *
 * Cada cambio del texto ya armado de la empresa es una VERSIÓN numerada por
 * empresa (`version`, no un id: así viaja igual al migrar la empresa y la
 * configuración en `tenants.settings.data_consent` apunta a ella sin
 * traducir nada). RLS: dato de la empresa.
 */
export const dataConsentVersions = pgTable(
    'data_consent_versions',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        version: integer('version').notNull(),
        text: text('text').notNull(),
        checkboxLabel: varchar('checkbox_label', { length: 1000 }).notNull(),
        policyUrl: varchar('policy_url', { length: 500 }),
        textHash: varchar('text_hash', { length: 64 }).notNull(),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('data_consent_versions_ux').on(t.tenantId, t.version),
        index('data_consent_versions_created_by_ix').on(t.createdBy),
    ],
);
export type DataConsentVersionRow = typeof dataConsentVersions.$inferSelect;

/**
 * La EVIDENCIA de cada autorización: quién, qué versión (y su hash), cuándo,
 * desde dónde, y si la retiró. Las referencias a formulario/lista/registro/
 * persona quedan en NULL si esos objetos se borran: la prueba no se pierde
 * con ellos (por eso el correo y el nombre del titular son un snapshot).
 */
export const dataConsents = pgTable(
    'data_consents',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        version: integer('version').notNull(),
        textHash: varchar('text_hash', { length: 64 }).notNull(),
        source: varchar('source', { length: 12 }).notNull(),
        sourceLabel: varchar('source_label', { length: 300 }).notNull().default(''),
        formId: bigint('form_id', { mode: 'number' }).references(() => forms.id, { onDelete: 'set null' }),
        listId: bigint('list_id', { mode: 'number' }).references(() => lists.id, { onDelete: 'set null' }),
        recordId: bigint('record_id', { mode: 'number' }).references(() => records.id, { onDelete: 'set null' }),
        userId: bigint('user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        subjectEmail: varchar('subject_email', { length: 320 }),
        subjectName: varchar('subject_name', { length: 300 }),
        acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull(),
        ip: varchar('ip', { length: 64 }),
        userAgent: varchar('user_agent', { length: 400 }),
        withdrawRef: varchar('withdraw_ref', { length: 40 }),
        withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
        withdrawnVia: varchar('withdrawn_via', { length: 12 }),
        withdrawnIp: varchar('withdrawn_ip', { length: 64 }),
        withdrawnUserAgent: varchar('withdrawn_user_agent', { length: 400 }),
        withdrawnBy: bigint('withdrawn_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        withdrawnNote: varchar('withdrawn_note', { length: 500 }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        foreignKey({
            name: 'data_consents_version_fk',
            columns: [t.tenantId, t.version],
            foreignColumns: [dataConsentVersions.tenantId, dataConsentVersions.version],
        }),
        index('data_consents_tenant_ix').on(t.tenantId, t.id.desc()),
        index('data_consents_version_ix').on(t.tenantId, t.version),
        index('data_consents_record_ix').on(t.recordId),
        index('data_consents_user_ix').on(t.userId),
        index('data_consents_form_ix').on(t.formId),
        index('data_consents_list_ix').on(t.listId),
        index('data_consents_withdrawn_by_ix').on(t.withdrawnBy),
        index('data_consents_email_ix').on(t.tenantId, sql`lower(${t.subjectEmail})`),
        uniqueIndex('data_consents_withdraw_ux').on(t.tenantId, t.withdrawRef).where(sql`${t.withdrawRef} IS NOT NULL`),
    ],
);
export type DataConsentRow = typeof dataConsents.$inferSelect;
