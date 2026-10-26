import { bigint, index, jsonb, pgTable, text, timestamp, unique, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { connections } from './connections';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';

/**
 * D3 — WhatsApp oficial (Meta Cloud API). Token de la URL de avisos de cada
 * conexión. SIN RLS (como `collection_hooks`): el aviso de Meta llega antes de
 * saber de qué empresa es. `verifyToken` es el que Meta repite al verificar la
 * URL (`hub.verify_token`).
 */
export const whatsappHooks = pgTable(
    'whatsapp_hooks',
    {
        token: varchar('token', { length: 64 }).primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        connectionId: bigint('connection_id', { mode: 'number' })
            .notNull()
            .references(() => connections.id, { onDelete: 'cascade' }),
        verifyToken: varchar('verify_token', { length: 64 }).notNull(),
        lastHookAt: timestamp('last_hook_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex('whatsapp_hooks_connection_ux').on(t.connectionId), index('whatsapp_hooks_tenant_ix').on(t.tenantId)],
);

/** Copia de las plantillas de la cuenta de WhatsApp Business (RLS). */
export const whatsappTemplates = pgTable(
    'whatsapp_templates',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        connectionId: bigint('connection_id', { mode: 'number' })
            .notNull()
            .references(() => connections.id, { onDelete: 'cascade' }),
        metaId: varchar('meta_id', { length: 64 }).notNull().default(''),
        name: varchar('name', { length: 512 }).notNull(),
        language: varchar('language', { length: 16 }).notNull(),
        category: varchar('category', { length: 32 }).notNull().default(''),
        status: varchar('status', { length: 32 }).notNull().default(''),
        parameterFormat: varchar('parameter_format', { length: 16 }).notNull().default('POSITIONAL'),
        components: jsonb('components').$type<Array<Record<string, unknown>>>().notNull().default([]),
        rejectedReason: text('rejected_reason'),
        syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [unique('whatsapp_templates_name_ux').on(t.connectionId, t.name, t.language), index('whatsapp_templates_tenant_ix').on(t.tenantId)],
);
export type WhatsappTemplateRowDb = typeof whatsappTemplates.$inferSelect;

/**
 * Un contacto por (conexión, número): cuándo escribió por última vez (la
 * ventana de 24 h) y el id del último envío (para atar su estado al registro).
 * Sin texto de mensajes: la conversación vive en WhatsApp.
 */
export const whatsappContacts = pgTable(
    'whatsapp_contacts',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        connectionId: bigint('connection_id', { mode: 'number' })
            .notNull()
            .references(() => connections.id, { onDelete: 'cascade' }),
        /** Sólo dígitos, con el indicativo y sin `+` (como el `wa_id` de Meta). */
        phone: varchar('phone', { length: 20 }).notNull(),
        profileName: varchar('profile_name', { length: 200 }),
        lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
        lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
        lastOutboundWamid: varchar('last_outbound_wamid', { length: 160 }),
        lastOutboundStatus: varchar('last_outbound_status', { length: 16 }),
        lastOutboundError: text('last_outbound_error'),
        lastOutboundListId: bigint('last_outbound_list_id', { mode: 'number' }).references(() => lists.id, { onDelete: 'set null' }),
        lastOutboundRecordId: bigint('last_outbound_record_id', { mode: 'number' }).references(() => records.id, {
            onDelete: 'set null',
        }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        unique('whatsapp_contacts_phone_ux').on(t.connectionId, t.phone),
        index('whatsapp_contacts_tenant_ix').on(t.tenantId),
        index('whatsapp_contacts_wamid_ix').on(t.connectionId, t.lastOutboundWamid),
        index('whatsapp_contacts_record_ix').on(t.lastOutboundRecordId),
        index('whatsapp_contacts_list_ix').on(t.lastOutboundListId),
    ],
);
export type WhatsappContactRowDb = typeof whatsappContacts.$inferSelect;
