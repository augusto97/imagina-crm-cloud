import {
    DEFAULT_BILLING_POLICY,
    TRIAL_PLAN,
    planModuleLabel,
    readDisabledModules,
    tenantAccess,
    type AgencyAccessInput,
    type BillingPolicy,
    type PlanModule,
    type TenantAccess,
} from '@imagina-base/shared';
import { ForbiddenException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { plans, tenants } from '../db/schema';

/**
 * v0.1.338 (ADR-S87) — El acceso de una empresa con la política VIGENTE.
 *
 * La política vive en Redis (`platform:billing-policy`) y la carga
 * `BillingPolicyService`, que la deja aquí cada vez que la lee o cambia: así
 * el guard y lo que corre solo (automatizaciones, recurrencias, syncs) la usan
 * sin inyectar nada ni pegarle a Redis en cada pedido. Hasta que se carga, la
 * política por defecto.
 */
let current: BillingPolicy = DEFAULT_BILLING_POLICY;

export function setCurrentBillingPolicy(policy: BillingPolicy): void {
    current = policy;
}

export function currentBillingPolicy(): BillingPolicy {
    return current;
}

/**
 * v0.1.449 (I3, ADR-S108) — Las columnas de acceso de la AGENCIA de un
 * cliente, en una subconsulta correlacionada (JSON; `null` si la empresa no es
 * cliente de una agencia). `tenants` no tiene RLS: se lee igual con cualquier
 * scope. Va dentro de un `select` cuya fuente incluye `tenants`.
 *
 * v0.1.451 — También lleva el «pagado hasta» del CLIENTE con su agencia (la
 * columna del cliente, correlacionada) y los días de gracia de la agencia:
 * así todo lugar que ya calculaba el acceso con esta subconsulta respeta el
 * cobro de la agencia sin tocarlo.
 */
export const agencyAccessSql = sql<AgencyAccessInput | null>`(SELECT json_build_object('plan', ag.plan, 'status', ag.status, 'archived_at', ag.archived_at, 'trial_ends_at', ag.trial_ends_at, 'subscription_ends_at', ag.subscription_ends_at, 'paid_until', ag.paid_until, 'client_paid_until', ${tenants.agencyPaidUntil}, 'client_grace_days', ag.settings->'agency_billing'->'grace_days') FROM tenants ag WHERE ag.id = ${tenants.agencyId})`;

/** Las columnas de `tenants` que deciden el acceso (para los `select`). */
export const accessColumns = {
    plan: tenants.plan,
    status: tenants.status,
    archivedAt: tenants.archivedAt,
    trialEndsAt: tenants.trialEndsAt,
    subscriptionEndsAt: tenants.subscriptionEndsAt,
    paidUntil: tenants.paidUntil,
    // v0.1.449 — un cliente de agencia sigue a su agencia (y la agencia lo puede pausar).
    agencyPausedAt: tenants.agencyPausedAt,
    agency: agencyAccessSql,
};

export interface AccessRow {
    plan: string | null;
    status: string | null;
    archivedAt: Date | null;
    trialEndsAt: Date | null;
    subscriptionEndsAt: Date | null;
    paidUntil: Date | null;
    /** v0.1.449 — la agencia pausó al cliente. */
    agencyPausedAt?: Date | null;
    /** v0.1.449 — el acceso de su agencia (`agencyAccessSql`); ausente = no se miró. */
    agency?: AgencyAccessInput | null;
}

export function accessOf(row: AccessRow, now?: Date): TenantAccess {
    return tenantAccess(
        {
            plan: row.plan ?? TRIAL_PLAN,
            status: row.status ?? 'trialing',
            archived_at: row.archivedAt,
            trial_ends_at: row.trialEndsAt,
            subscription_ends_at: row.subscriptionEndsAt,
            paid_until: row.paidUntil,
            agency_paused_at: row.agencyPausedAt ?? null,
            agency: row.agency ?? null,
            now,
        },
        current,
    );
}

/**
 * El acceso de una empresa leído dentro de una transacción con su scope (la
 * RLS deja ver su propia fila). Una empresa que no existe cuenta como pausada.
 */
export async function tenantAccessInTx(tx: Tx, tenantId: number): Promise<TenantAccess> {
    const [t] = await tx.select(accessColumns).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!t) return { state: 'locked', reason: 'archived', ends_at: null, trial: false };
    return accessOf(t);
}

/** Fin de una prueba nueva con la política vigente (`null` = no vence). */
export function newTrialEndsAt(now = new Date()): Date | null {
    const days = current.trial_days;
    return days === null ? null : new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

// ─────────────────────────── Módulos del plan ───────────────────────────

/** Los módulos que el plan de la empresa NO incluye (una consulta por PK). */
export async function tenantDisabledModulesInTx(tx: Tx, tenantId: number): Promise<PlanModule[]> {
    const [row] = await tx
        .select({ disabled: plans.disabledModules })
        .from(tenants)
        .leftJoin(plans, eq(plans.slug, tenants.plan))
        .where(eq(tenants.id, tenantId))
        .limit(1);
    return readDisabledModules(row?.disabled ?? []);
}

/** ¿El plan de la empresa incluye este módulo? (para lo que corre solo). */
export async function tenantModuleAllowed(tx: Tx, tenantId: number, module: PlanModule): Promise<boolean> {
    const [row] = await tx
        .select({ off: sql<boolean>`coalesce(${plans.disabledModules} ? ${module}, false)` })
        .from(tenants)
        .leftJoin(plans, eq(plans.slug, tenants.plan))
        .where(eq(tenants.id, tenantId))
        .limit(1);
    return row ? row.off !== true : false;
}

/** El error que ve la persona cuando su plan no incluye algo. */
export function planModuleDisabled(module: PlanModule): ForbiddenException {
    const label = planModuleLabel(module);
    return new ForbiddenException({
        code: 'plan_module_disabled',
        message: `Tu plan no incluye «${label}». Elige un plan que lo incluya para usarlo.`,
        data: { status: 403, module, label },
    });
}

/** Lanza `plan_module_disabled` si el plan de la empresa no incluye el módulo. */
export async function assertTenantModule(tx: Tx, tenantId: number, module: PlanModule): Promise<void> {
    if (!(await tenantModuleAllowed(tx, tenantId, module))) throw planModuleDisabled(module);
}

/**
 * v0.1.338 — Para lo que se ve HACIA AFUERA (portal, enlaces públicos,
 * documentos por enlace): ¿está apagado? Sí si la empresa está PAUSADA o si su
 * plan no incluye el módulo. Una consulta; sirve con la conexión base o dentro
 * de una transacción con scope.
 */
export async function publicSurfaceOff(db: Db | Tx, tenantId: number, module: PlanModule): Promise<boolean> {
    const [row] = await db
        .select({ ...accessColumns, disabled: plans.disabledModules })
        .from(tenants)
        .leftJoin(plans, eq(plans.slug, tenants.plan))
        .where(eq(tenants.id, tenantId))
        .limit(1);
    if (!row) return true;
    return accessOf(row).state === 'locked' || readDisabledModules(row.disabled ?? []).includes(module);
}
