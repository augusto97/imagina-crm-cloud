import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { connections } from './connections';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * v0.1.332 (ADR-S82) — Token de la URL de avisos de entrega de cada conexión
 * de SMS. SIN RLS (como `whatsapp_hooks` y `collection_hooks`): el aviso del
 * proveedor llega antes de saber de qué empresa es. El token es la credencial
 * para los proveedores que no firman (BulkGate, Infobip, LabsMobile); Twilio
 * además firma con `X-Twilio-Signature`.
 */
export const smsHooks = pgTable(
    'sms_hooks',
    {
        token: varchar('token', { length: 64 }).primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        connectionId: bigint('connection_id', { mode: 'number' })
            .notNull()
            .references(() => connections.id, { onDelete: 'cascade' }),
        lastHookAt: timestamp('last_hook_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex('sms_hooks_connection_ux').on(t.connectionId), index('sms_hooks_tenant_ix').on(t.tenantId)],
);

/**
 * Cada SMS que sale (RLS). El TEXTO sólo vive mientras el mensaje espera
 * (programado por el horario de la Ley 2300 o en la cola de un envío masivo):
 * al mandarse se borra, con el mismo criterio que WhatsApp — la app no guarda
 * conversaciones. Queda a quién, cuántas partes, cómo terminó y el id del
 * proveedor (para atar su aviso de entrega).
 */
export const smsMessages = pgTable(
    'sms_messages',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        /** null = se borró la conexión (lo pendiente falla con el motivo). */
        connectionId: bigint('connection_id', { mode: 'number' }).references(() => connections.id, { onDelete: 'set null' }),
        provider: varchar('provider', { length: 32 }).notNull(),
        listId: bigint('list_id', { mode: 'number' }).references(() => lists.id, { onDelete: 'set null' }),
        recordId: bigint('record_id', { mode: 'number' }).references(() => records.id, { onDelete: 'set null' }),
        /** Quién lo mandó (null = una automatización, la agenda o el sistema). */
        userId: bigint('user_id', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        /** manual | bulk | automation | booking | test */
        source: varchar('source', { length: 16 }).notNull(),
        batchId: varchar('batch_id', { length: 32 }),
        automationId: bigint('automation_id', { mode: 'number' }),
        toPhone: varchar('to_phone', { length: 24 }).notNull(),
        /** Sólo mientras espera; se borra al mandarse. */
        body: text('body'),
        sender: varchar('sender', { length: 32 }),
        segments: integer('segments').notNull().default(1),
        encoding: varchar('encoding', { length: 8 }).notNull().default('gsm7'),
        status: varchar('status', { length: 16 }).notNull(),
        error: text('error'),
        providerMessageId: varchar('provider_message_id', { length: 160 }),
        /** Referencia propia que viaja al proveedor (el `subid` de LabsMobile). */
        reference: varchar('reference', { length: 32 }).notNull(),
        respectHours: boolean('respect_hours').notNull().default(false),
        sendAfter: timestamp('send_after', { withTimezone: true }),
        claimedAt: timestamp('claimed_at', { withTimezone: true }),
        attempts: integer('attempts').notNull().default(0),
        sentAt: timestamp('sent_at', { withTimezone: true }),
        deliveredAt: timestamp('delivered_at', { withTimezone: true }),
        /** Onurix no avisa: cuándo volver a preguntar el estado. */
        nextPollAt: timestamp('next_poll_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index('sms_messages_tenant_ix').on(t.tenantId, t.createdAt),
        index('sms_messages_connection_ix').on(t.connectionId, t.createdAt),
        uniqueIndex('sms_messages_provider_id_ux').on(t.connectionId, t.providerMessageId).where(sql`${t.providerMessageId} IS NOT NULL`),
        uniqueIndex('sms_messages_reference_ux').on(t.reference),
        index('sms_messages_pending_ix').on(t.status, t.sendAfter).where(sql`${t.status} IN ('programado', 'en_cola', 'enviando')`),
        index('sms_messages_poll_ix').on(t.nextPollAt).where(sql`${t.nextPollAt} IS NOT NULL`),
        index('sms_messages_record_ix').on(t.recordId, t.id),
        index('sms_messages_list_ix').on(t.listId),
        index('sms_messages_batch_ix').on(t.tenantId, t.batchId).where(sql`${t.batchId} IS NOT NULL`),
        index('sms_messages_user_ix').on(t.userId),
    ],
);
export type SmsMessageRowDb = typeof smsMessages.$inferSelect;
