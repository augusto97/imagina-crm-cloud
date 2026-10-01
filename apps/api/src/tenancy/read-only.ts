import { isEffectivelyReadOnly, type BillingStatus } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { tenants } from '../db/schema';

/**
 * SEC-34 (v0.1.239) — ¿La empresa está en SOLO-LECTURA (ADR-S09: impaga,
 * archivada o suscripción vencida)? El `TenantGuard` lo aplica a lo que hace
 * una persona por HTTP, pero lo que corre SOLO —automatizaciones programadas,
 * por fecha o por webhook entrante, recurrencias— no pasa por ahí: una empresa
 * suspendida seguía creando registros y mandando correos. Se consulta dentro
 * de la transacción con scope del tenant (RLS deja ver su propia fila).
 */
export async function tenantIsReadOnly(tx: Tx, tenantId: number): Promise<boolean> {
    const [t] = await tx
        .select({ status: tenants.status, archivedAt: tenants.archivedAt, subscriptionEndsAt: tenants.subscriptionEndsAt })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
    if (!t) return true;
    return isEffectivelyReadOnly({
        status: t.status as BillingStatus,
        archived_at: t.archivedAt,
        subscription_ends_at: t.subscriptionEndsAt,
    });
}
