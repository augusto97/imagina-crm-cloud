import { bigint, integer, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Correos enviados por cada empresa POR EL SMTP DE LA PLATAFORMA, por mes
 * (ADR-S18). Una fila por tenant+período (`YYYY-MM`, UTC) que se incrementa en
 * cada envío. Los correos que salen por el SMTP PROPIO del cliente no se
 * cuentan: no cuestan nada al operador.
 *
 * Tenant-scoped con RLS. El worker de correo escribe por la conexión base
 * (es cross-tenant); el resumen de facturación lee dentro de `withTenant`.
 */
export const emailUsage = pgTable(
    'email_usage',
    {
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        /** Mes en UTC, `YYYY-MM`. */
        period: varchar('period', { length: 7 }).notNull(),
        sent: integer('sent').notNull().default(0),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.period] }) }),
);
