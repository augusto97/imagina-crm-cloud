import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { PlansService } from '../billing/plans.service';
import { DRIZZLE, type Db } from '../db/client';
import { aiUsage, tenants } from '../db/schema';
import { periodOf } from '../mail/email-quota.service';

/** La empresa agotó los pedidos del mes con la clave de la plataforma (ADR-S21). */
export class AiQuotaExceededError extends Error {
    readonly code = 'ai_quota_reached';
    constructor(
        readonly used: number,
        readonly limit: number,
    ) {
        super(
            `Se alcanzó el límite de pedidos al asistente del plan para este mes (${used}/${limit}). ` +
                'Cargá una clave IA propia en Ajustes → Asistente IA para usarlo sin límite, o pasá a un plan mayor.',
        );
    }
}

/**
 * Cuota mensual de pedidos al asistente por empresa (ADR-S21). Sólo cuentan
 * los pedidos hechos con la clave de la PLATAFORMA (los paga el operador);
 * con clave propia la empresa no consume nada. Se chequea ANTES de llamar al
 * modelo y se registra DESPUÉS de una respuesta completa, con los tokens
 * reales para que el operador conozca el costo por cliente.
 */
@Injectable()
export class AiQuotaService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly plans: PlansService,
    ) {}

    async usedThisMonth(tenantId: number, now: Date = new Date()): Promise<number> {
        const [row] = await this.db
            .select({ requests: aiUsage.requests })
            .from(aiUsage)
            .where(and(eq(aiUsage.tenantId, tenantId), eq(aiUsage.period, periodOf(now))))
            .limit(1);
        return row?.requests ?? 0;
    }

    /** Límite del plan. `null` = ilimitado. */
    async limitFor(tenantId: number): Promise<number | null> {
        const [row] = await this.db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        if (!row) return null;
        return (await this.plans.limits(row.plan)).max_ai_requests_month;
    }

    async assertWithinQuota(tenantId: number, now: Date = new Date()): Promise<void> {
        const limit = await this.limitFor(tenantId);
        if (limit === null) return;
        const used = await this.usedThisMonth(tenantId, now);
        if (used >= limit) throw new AiQuotaExceededError(used, limit);
    }

    async record(
        tenantId: number,
        tokens: { input: number; output: number },
        now: Date = new Date(),
    ): Promise<void> {
        await this.db
            .insert(aiUsage)
            .values({ tenantId, period: periodOf(now), requests: 1, inputTokens: tokens.input, outputTokens: tokens.output })
            .onConflictDoUpdate({
                target: [aiUsage.tenantId, aiUsage.period],
                set: {
                    requests: sql`${aiUsage.requests} + 1`,
                    inputTokens: sql`${aiUsage.inputTokens} + ${tokens.input}`,
                    outputTokens: sql`${aiUsage.outputTokens} + ${tokens.output}`,
                    updatedAt: new Date(),
                },
            });
    }

    async summary(tenantId: number, now: Date = new Date()): Promise<{ used: number; limit: number | null }> {
        const [limit, used] = await Promise.all([this.limitFor(tenantId), this.usedThisMonth(tenantId, now)]);
        return { used, limit };
    }
}
