import { Body, Controller, Get, HttpCode, Inject, Post, Put, UseGuards } from '@nestjs/common';
import {
    applyTrialEndsSchema,
    updateBillingPolicySchema,
    type ApplyTrialEndsInput,
    type PlatformBillingPolicyView,
    type UpdateBillingPolicyInput,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { BillingPolicyService } from '../billing/billing-policy.service';
import { accessOf } from '../billing/tenant-access';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { memberships, tenants, users } from '../db/schema';

/**
 * v0.1.338 (ADR-S87) — Plataforma → Planes → «Prueba y vencimientos»: la
 * política (duración de la prueba, qué pasa al terminar, gracia y paso a
 * prueba) y la acción de ponerles fecha de fin a las pruebas que no la tienen.
 */
@Controller('platform/billing-policy')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformBillingPolicyController {
    constructor(
        private readonly policies: BillingPolicyService,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
    ) {}

    @Get()
    async view(): Promise<PlatformBillingPolicyView> {
        return this.buildView();
    }

    @Put()
    async update(
        @Body(new ZodValidationPipe(updateBillingPolicySchema)) input: UpdateBillingPolicyInput,
    ): Promise<PlatformBillingPolicyView> {
        await this.policies.update(input);
        return this.buildView();
    }

    /**
     * Les pone fecha de fin (`days` desde hoy) a las empresas en prueba que no
     * la tienen — las de antes de esta versión. Nunca a una empresa donde
     * trabaja un superadmin: la del propio operador no se pausa.
     */
    @Post('apply-trial-ends')
    @HttpCode(200)
    async applyTrialEnds(
        @Body(new ZodValidationPipe(applyTrialEndsSchema)) input: ApplyTrialEndsInput,
    ): Promise<PlatformBillingPolicyView & { updated: number }> {
        const ends = new Date(Date.now() + input.days * 24 * 60 * 60 * 1000);
        const res = await this.db
            .update(tenants)
            .set({ trialEndsAt: ends, updatedAt: new Date() })
            .where(this.trialsWithoutEnd())
            .returning({ id: tenants.id });
        return { ...(await this.buildView()), updated: res.length };
    }

    private trialsWithoutEnd() {
        const operators = this.env.PLATFORM_SUPERADMINS;
        const base = and(eq(tenants.plan, 'trial'), isNull(tenants.trialEndsAt), isNull(tenants.archivedAt));
        if (operators.length === 0) return base;
        return and(
            base,
            notExists(
                this.db
                    .select({ one: sql`1` })
                    .from(memberships)
                    .innerJoin(users, eq(users.id, memberships.userId))
                    .where(and(eq(memberships.tenantId, tenants.id), inArray(sql`lower(${users.email})`, operators))),
            ),
        );
    }

    private async buildView(): Promise<PlatformBillingPolicyView> {
        const policy = await this.policies.get();
        const [legacy] = await this.db.select({ n: sql<number>`count(*)::int` }).from(tenants).where(this.trialsWithoutEnd());
        const rows = await this.db
            .select({
                plan: tenants.plan,
                status: tenants.status,
                archivedAt: tenants.archivedAt,
                trialEndsAt: tenants.trialEndsAt,
                subscriptionEndsAt: tenants.subscriptionEndsAt,
                paidUntil: tenants.paidUntil,
            })
            .from(tenants);
        return {
            policy,
            trials_without_end: legacy?.n ?? 0,
            locked: rows.filter((r) => accessOf(r).state === 'locked').length,
        };
    }
}
