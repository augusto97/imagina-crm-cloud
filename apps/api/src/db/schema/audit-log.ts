import { bigint, index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * v0.1.114 — Bitácora de acciones ADMINISTRATIVAS del workspace (append-only).
 *
 * Distinta de `activity`, que registra cambios de REGISTROS y cuelga de una
 * lista: acá van las acciones que cambian la configuración o destruyen datos
 * (borrar listas/campos, tocar permisos, publicar una lista, mover miembros,
 * cambiar plan/SMTP/dominio) — incluidas las que no tienen lista asociada.
 */
export const auditLog = pgTable(
    'audit_log',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id),
        userId: bigint('user_id', { mode: 'number' }).references(() => users.id, {
            onDelete: 'set null',
        }),
        action: varchar('action', { length: 64 }).notNull(),
        targetType: varchar('target_type', { length: 32 }).notNull().default(''),
        targetId: bigint('target_id', { mode: 'number' }),
        /** Nombre al momento de la acción: sobrevive al borrado del objeto. */
        targetLabel: text('target_label').notNull().default(''),
        meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
        tenantIdx: index('audit_log_tenant_idx').on(t.tenantId, t.id),
    }),
);
