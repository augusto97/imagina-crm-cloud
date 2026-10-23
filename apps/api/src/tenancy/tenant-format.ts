import { tenantFormatSchema, type TenantFormat } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { tenants } from '../db/schema';
import type { TenantDb } from './tenant-db.service';

/**
 * El formato regional de la empresa (`tenants.settings.format`: separadores,
 * orden de fecha, reloj y zona — v0.1.104 / ADR-S33), tolerante a datos
 * viejos o rotos: lo que no valida cae a los valores por defecto.
 */
export async function readTenantFormat(tenantDb: TenantDb, tenantId: number): Promise<TenantFormat> {
    const [row] = await tenantDb.withTenant(tenantId, (tx) =>
        tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    );
    const parsed = tenantFormatSchema.safeParse(((row?.settings ?? {}) as Record<string, unknown>).format ?? {});
    return parsed.success ? parsed.data : tenantFormatSchema.parse({});
}
