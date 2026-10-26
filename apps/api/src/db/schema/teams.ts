import { bigint, boolean, index, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * C1 — Equipos (RLS). Grupos de personas del equipo de trabajo: se asigna un
 * registro a un equipo (campo «Equipo»), se le da acceso a una lista y se lo
 * menciona. Nombre único por empresa sin importar mayúsculas (índice de
 * expresión en la migración 0085).
 */
export const teams = pgTable(
    'teams',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 80 }).notNull(),
        description: text('description'),
        icon: varchar('icon', { length: 64 }),
        color: varchar('color', { length: 32 }),
        createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('teams_created_by_ix').on(t.createdBy)],
);
export type TeamRow = typeof teams.$inferSelect;

/** Personas de cada equipo (sólo miembros del equipo de trabajo). */
export const teamMembers = pgTable(
    'team_members',
    {
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        teamId: bigint('team_id', { mode: 'number' })
            .notNull()
            .references(() => teams.id, { onDelete: 'cascade' }),
        userId: bigint('user_id', { mode: 'number' })
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        isLead: boolean('is_lead').notNull().default(false),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        primaryKey({ columns: [t.teamId, t.userId] }),
        index('team_members_user_ix').on(t.tenantId, t.userId),
        index('team_members_user_only_ix').on(t.userId),
    ],
);
export type TeamMemberRow = typeof teamMembers.$inferSelect;
