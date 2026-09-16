import { bigint, integer, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Pedidos al asistente IA por empresa y mes hechos CON LA CLAVE DE LA
 * PLATAFORMA (ADR-S21). Misma mecánica que `email_usage` (ADR-S18): una fila
 * por tenant+período (`YYYY-MM`, UTC) que se incrementa por pedido. Los
 * tokens se guardan para que el operador vea el costo real por cliente.
 * Con clave PROPIA de la empresa no se cuenta nada: la paga ella.
 */
export const aiUsage = pgTable(
    'ai_usage',
    {
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        /** Mes en UTC, `YYYY-MM`. */
        period: varchar('period', { length: 7 }).notNull(),
        requests: integer('requests').notNull().default(0),
        inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
        outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.period] }) }),
);
