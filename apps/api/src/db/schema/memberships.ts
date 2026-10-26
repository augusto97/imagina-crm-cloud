import { jsonb, bigint, index, pgEnum, pgTable, primaryKey, timestamp } from 'drizzle-orm/pg-core';
import { ROLES } from '@imagina-base/shared';
import { customRoles } from './custom-roles';
import { tenants } from './tenants';
import { users } from './users';

// Los 5 roles del plugin (STANDALONE.md §5) + `guest` (C3, invitados externos).
export const membershipRole = pgEnum('membership_role', ROLES);

export const memberships = pgTable(
    'memberships',
    {
        userId: bigint('user_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        role: membershipRole('role').notNull(),
        // v0.1.107 — preferencias del usuario EN este workspace (favoritos).
        settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
        // C2 — rol PROPIO (capacidades); `role` sigue siendo su base.
        customRoleId: bigint('custom_role_id', { mode: 'number' }).references(() => customRoles.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        primaryKey({ columns: [t.userId, t.tenantId] }),
        index('memberships_tenant_idx').on(t.tenantId),
    ],
);
