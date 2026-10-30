import { moduleForIntegration, readDisabledModules, type PlanModule } from '@imagina-base/shared';
import { and, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Db, Tx } from '../db/client';
import { connections, plans, tenants } from '../db/schema';
import { planModuleDisabled } from './tenant-access';

export { moduleForIntegration };

/**
 * v0.1.338 (ADR-S87) — Puertas por módulo para lo que NO pasa por el
 * `TenantGuard`: webhooks públicos, procesos que corren solos y acciones de
 * las automatizaciones. Sirve con la conexión base o dentro de una
 * transacción con scope (los planes son globales, sin RLS).
 */

/** ¿El plan de la empresa NO incluye el módulo? Una empresa inexistente cuenta como apagada. */
export async function planModuleOff(db: Db | Tx, tenantId: number, module: PlanModule): Promise<boolean> {
    const [row] = await db
        .select({ disabled: plans.disabledModules })
        .from(tenants)
        .leftJoin(plans, eq(plans.slug, tenants.plan))
        .where(eq(tenants.id, tenantId))
        .limit(1);
    if (!row) return true;
    return readDisabledModules(row.disabled ?? []).includes(module);
}

/** Lanza `plan_module_disabled` (403) si el plan de la empresa no incluye el módulo. */
export async function assertPlanModule(db: Db | Tx, tenantId: number, module: PlanModule): Promise<void> {
    if (await planModuleOff(db, tenantId, module)) throw planModuleDisabled(module);
}

/**
 * Para una acción de automatización: el motivo legible si el módulo está
 * apagado (`null` = puede correr). El paso falla con ese texto.
 */
export async function planModuleStepError(db: Db | Tx, tenantId: number, module: PlanModule): Promise<string | null> {
    if (!(await planModuleOff(db, tenantId, module))) return null;
    return (planModuleDisabled(module).getResponse() as { message: string }).message;
}


/**
 * Condición SQL para los barridos (`tick`) de lo que corre solo: sólo las
 * empresas cuyo plan INCLUYE el módulo. Lo demás queda con su próxima corrida
 * vencida y arranca solo cuando el plan vuelve a incluirlo.
 */
export function planIncludesSql(tenantIdColumn: AnyColumn | SQL, module: PlanModule): SQL {
    return sql`NOT EXISTS (SELECT 1 FROM tenants t JOIN plans p ON p.slug = t.plan WHERE t.id = ${tenantIdColumn} AND p.disabled_modules ? ${module})`;
}

/** Con el `TenantGuard` ya corrido: 403 si el plan no incluye el módulo (`null` = sin módulo). */
export function assertReqModule(req: FastifyRequest, module: PlanModule | null): void {
    if (module && req.tenant?.disabledModules?.includes(module)) throw planModuleDisabled(module);
}

/** Lo mismo para una conexión guardada: el módulo sale de su proveedor. */
export async function assertConnectionModule(db: Db, req: FastifyRequest, connectionId: number): Promise<void> {
    const tenantId = req.tenant!.tenantId;
    const [row] = await db
        .select({ provider: connections.provider })
        .from(connections)
        .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
        .limit(1);
    // Una conexión que no existe sigue su camino normal (el service responde 404).
    if (row) assertReqModule(req, moduleForIntegration(row.provider));
}

/**
 * Para una acción que USA una conexión guardada (motor, probadores): el motivo
 * legible si el plan no incluye el módulo de ESA conexión (`null` = puede).
 */
export async function connectionModuleStepError(db: Db | Tx, tenantId: number, connectionId: number): Promise<string | null> {
    const [row] = await db
        .select({ provider: connections.provider })
        .from(connections)
        .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
        .limit(1);
    if (!row) return null; // el camino normal dice que la conexión ya no existe
    return planModuleStepError(db, tenantId, moduleForIntegration(row.provider));
}
