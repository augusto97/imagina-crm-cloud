import { ForbiddenException, Injectable } from '@nestjs/common';
import {
    isReadOnly,
    type BillingStatus,
    type BillingSummary,
    type Plan,
    type SetBillingInput,
    type Usage,
} from '@imagina-base/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { automations, memberships, records, tenants } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { PlansService } from './plans.service';

@Injectable()
export class BillingService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly plans: PlansService,
    ) {}

    async summary(tenantId: number): Promise<BillingSummary> {
        const { plan, status } = await this.planStatus(tenantId);
        const usage = await this.tenantDb.withTenant(tenantId, (tx) => this.usage(tx, tenantId));
        return {
            plan,
            status,
            read_only: isReadOnly(status),
            limits: await this.plans.limits(plan),
            usage,
        };
    }

    /**
     * Verifica que se pueda crear un record más según el plan. Lo llama
     * RecordsService antes de insertar. `null` = ilimitado.
     */
    async assertCanCreateRecord(tenantId: number): Promise<void> {
        const { plan } = await this.planStatus(tenantId);
        const limit = (await this.plans.limits(plan)).max_records;
        if (limit === null) return;
        const count = await this.tenantDb.withTenant(tenantId, (tx) => this.countRecords(tx, tenantId));
        if (count >= limit) {
            throw new ForbiddenException({
                code: 'plan_limit_reached',
                message: `Alcanzaste el límite de ${limit} registros del plan ${plan}`,
                data: { status: 403, errors: { plan: 'límite de registros' } },
            });
        }
    }

    /**
     * Igual que `assertCanCreateRecord` pero para un LOTE (SEC-09): verifica que
     * crear `additional` registros no supere el tope del plan. El import antes
     * solo comprobaba que "cabía uno más" y luego insertaba hasta 10 000 →
     * bypass del límite. Un solo conteo cubre todo el lote.
     */
    async assertCanCreateRecords(tenantId: number, additional: number): Promise<void> {
        if (additional <= 0) return;
        const { plan } = await this.planStatus(tenantId);
        const limit = (await this.plans.limits(plan)).max_records;
        if (limit === null) return;
        const count = await this.tenantDb.withTenant(tenantId, (tx) => this.countRecords(tx, tenantId));
        if (count + additional > limit) {
            throw new ForbiddenException({
                code: 'plan_limit_reached',
                message: `El import supera el límite de ${limit} registros del plan ${plan} (tenés ${count}, intentás agregar ${additional})`,
                data: { status: 403, errors: { plan: 'límite de registros' } },
            });
        }
    }

    /** Stand-in del webhook de Stripe: setea plan/estado del workspace. */
    async setBilling(tenantId: number, input: SetBillingInput): Promise<BillingSummary> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(tenants)
                .set({
                    ...(input.plan ? { plan: input.plan } : {}),
                    ...(input.status ? { status: input.status } : {}),
                    updatedAt: sql`now()`,
                })
                .where(eq(tenants.id, tenantId)),
        );
        return this.summary(tenantId);
    }

    private async planStatus(tenantId: number): Promise<{ plan: Plan; status: BillingStatus }> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [t] = await tx
                .select({ plan: tenants.plan, status: tenants.status })
                .from(tenants)
                .where(eq(tenants.id, tenantId))
                .limit(1);
            return t;
        });
        return {
            plan: (row?.plan ?? 'trial') as Plan,
            status: (row?.status ?? 'trialing') as BillingStatus,
        };
    }

    private async usage(tx: Tx, tenantId: number): Promise<Usage> {
        const recordCount = await this.countRecords(tx, tenantId);
        const [u] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(memberships)
            .where(eq(memberships.tenantId, tenantId));
        const [a] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(automations)
            .where(eq(automations.tenantId, tenantId));
        return { records: recordCount, users: u?.n ?? 0, automations: a?.n ?? 0 };
    }

    private async countRecords(tx: Tx, tenantId: number): Promise<number> {
        const [r] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(records)
            .where(and(eq(records.tenantId, tenantId), isNull(records.deletedAt)));
        return r?.n ?? 0;
    }
}
