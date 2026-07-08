import { bigint, index, pgEnum, pgTable, primaryKey, timestamp } from 'drizzle-orm/pg-core';
import { ROLES } from '@imagina-base/shared';
import { tenants } from './tenants';
import { users } from './users';

// Los mismos 5 roles del plugin (STANDALONE.md §5).
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
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        primaryKey({ columns: [t.userId, t.tenantId] }),
        index('memberships_tenant_idx').on(t.tenantId),
    ],
);
