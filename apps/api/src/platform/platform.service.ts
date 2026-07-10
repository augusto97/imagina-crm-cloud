import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
    BILLING_STATUSES,
    isReadOnly,
    PLANS,
    type BillingStatus,
    type Plan,
    type PlatformOwner,
    type PlatformStats,
    type PlatformTenant,
    type UpdateTenantInput,
} from '@imagina-base/shared';
import { desc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/client';
import { automations, memberships, records, tenants, users } from '../db/schema';
import { BillingService } from '../billing/billing.service';

/**
 * Consola de plataforma (operador SaaS). Corre sobre la conexión BASE (rol
 * dueño/superusuario, que hace bypass de RLS — igual que el DDL de índices y
 * las migraciones), por eso ve TODAS las empresas. `tenants`/`users` no tienen
 * RLS; `memberships`/`records`/`automations` sí (FORCE), pero el superusuario
 * la saltea. Sólo se expone detrás del `SuperadminGuard`.
 */
@Injectable()
export class PlatformService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly billing: BillingService,
    ) {}

    /** Todas las empresas con plan/estado/uso/owner (para la grilla del operador). */
    async listTenants(): Promise<PlatformTenant[]> {
        const rows = await this.db.select().from(tenants).orderBy(desc(tenants.createdAt));
        const [recMap, userMap, autoMap, ownerMap] = await Promise.all([
            this.countByTenant(this.db.select({ tid: records.tenantId, n: intCount() }).from(records).where(isNull(records.deletedAt)).groupBy(records.tenantId)),
            this.countByTenant(this.db.select({ tid: memberships.tenantId, n: intCount() }).from(memberships).groupBy(memberships.tenantId)),
            this.countByTenant(this.db.select({ tid: automations.tenantId, n: intCount() }).from(automations).groupBy(automations.tenantId)),
            this.ownersByTenant(),
        ]);

        return rows.map((t) => {
            const status = (t.status ?? 'trialing') as BillingStatus;
            return {
                id: t.id,
                slug: t.slug,
                name: t.name,
                plan: (t.plan ?? 'trial') as Plan,
                status,
                read_only: isReadOnly(status),
                created_at: t.createdAt.toISOString(),
                owner: ownerMap.get(t.id) ?? null,
                usage: {
                    records: recMap.get(t.id) ?? 0,
                    users: userMap.get(t.id) ?? 0,
                    automations: autoMap.get(t.id) ?? 0,
                },
            };
        });
    }

    /** Una empresa concreta (tras un cambio de plan/estado). */
    async getTenant(id: number): Promise<PlatformTenant> {
        const [t] = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
        if (!t) {
            throw new NotFoundException({ code: 'tenant_not_found', message: `Empresa ${id} no encontrada`, data: { status: 404 } });
        }
        // El uso lo calcula BillingService (dentro del scope del tenant).
        const summary = await this.billing.summary(id);
        return {
            id: t.id,
            slug: t.slug,
            name: t.name,
            plan: summary.plan,
            status: summary.status,
            read_only: summary.read_only,
            created_at: t.createdAt.toISOString(),
            owner: (await this.ownersByTenant(id)).get(id) ?? null,
            usage: summary.usage,
        };
    }

    /** Cambia plan y/o estado (suspender = past_due/canceled → solo-lectura). */
    async updateTenant(id: number, input: UpdateTenantInput): Promise<PlatformTenant> {
        // Reusa el mismo camino que el webhook de pago (BillingService.setBilling).
        await this.billing.setBilling(id, { plan: input.plan, status: input.status });
        return this.getTenant(id);
    }

    /** Foto del negocio para el dashboard del operador. */
    async getStats(): Promise<PlatformStats> {
        const rows = await this.db
            .select({ plan: tenants.plan, status: tenants.status, createdAt: tenants.createdAt })
            .from(tenants);

        const by_status = Object.fromEntries(BILLING_STATUSES.map((s) => [s, 0])) as Record<BillingStatus, number>;
        const by_plan = Object.fromEntries(PLANS.map((p) => [p, 0])) as Record<Plan, number>;
        let read_only_tenants = 0;
        let signups_last_30d = 0;
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        for (const r of rows) {
            const status = (r.status ?? 'trialing') as BillingStatus;
            const plan = (r.plan ?? 'trial') as Plan;
            if (status in by_status) by_status[status] += 1;
            if (plan in by_plan) by_plan[plan] += 1;
            if (isReadOnly(status)) read_only_tenants += 1;
            if (r.createdAt >= cutoff) signups_last_30d += 1;
        }

        const [u] = await this.db.select({ n: intCount() }).from(users);
        const [rec] = await this.db.select({ n: intCount() }).from(records).where(isNull(records.deletedAt));

        return {
            tenants_total: rows.length,
            by_status,
            by_plan,
            read_only_tenants,
            users_total: u?.n ?? 0,
            records_total: rec?.n ?? 0,
            signups_last_30d,
        };
    }

    // ─────────────────────────── helpers ───────────────────────────

    private async countByTenant(
        query: Promise<Array<{ tid: number; n: number }>>,
    ): Promise<Map<number, number>> {
        const rows = await query;
        return new Map(rows.map((r) => [r.tid, r.n]));
    }

    /**
     * Owner de cada tenant = su primer admin (membership `admin` más antigua).
     * Si `only` se pasa, acota a ese tenant.
     */
    private async ownersByTenant(only?: number): Promise<Map<number, PlatformOwner>> {
        const base = this.db
            .select({
                tid: memberships.tenantId,
                id: users.id,
                name: users.name,
                email: users.email,
            })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(only === undefined ? eq(memberships.role, 'admin') : sql`${memberships.role} = 'admin' AND ${memberships.tenantId} = ${only}`)
            .orderBy(memberships.createdAt);
        const rows = await base;
        const map = new Map<number, PlatformOwner>();
        for (const r of rows) {
            if (!map.has(r.tid)) map.set(r.tid, { id: r.id, name: r.name, email: r.email });
        }
        return map;
    }
}

function intCount() {
    return sql<number>`count(*)::int`;
}
