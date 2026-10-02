import { bigint, index, pgTable, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';
import { users } from './users';

/**
 * Vínculo usuario-portal → record (CONTRACT.md §9). Un usuario `client` ve
 * exactamente el record al que está vinculado. Desde v0.1.241 puede tener
 * VARIOS vínculos en la misma empresa (uno por registro) y elige cuál ver
 * desde el portal; lo único es el par (usuario, registro).
 */
export const portalLinks = pgTable(
    'portal_links',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        userId: bigint('user_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        recordId: bigint('record_id', { mode: 'number' })
            .notNull()
            .references(() => records.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        /** Última vez que el cliente canjeó un enlace y entró (v0.1.153). */
        lastAccessAt: timestamp('last_access_at', { withTimezone: true }),
    },
    (t) => [
        uniqueIndex('portal_links_user_record_ux').on(t.userId, t.recordId),
        index('portal_links_user_tenant_idx').on(t.userId, t.tenantId),
    ],
);
