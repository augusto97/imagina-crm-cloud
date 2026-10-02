import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import {
    isEffectivelyReadOnly,
    type BillingStatus,
    type BillingSummary,
    type Plan,
    type SetBillingInput,
    type Usage,
} from '@imagina-base/shared';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { AiQuotaService } from '../ai/ai-quota.service';
import { AiSettingsService } from '../ai/ai-settings.service';
import type { Tx } from '../db/client';
import { attachments, automations, memberships, records, tenants } from '../db/schema';
import { EmailQuotaService } from '../mail/email-quota.service';
import { TenantSmtpService } from '../mail/tenant-smtp.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { PlansService } from './plans.service';

@Injectable()
export class BillingService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly plans: PlansService,
        private readonly emailQuota: EmailQuotaService,
        private readonly tenantSmtp: TenantSmtpService,
        // v0.1.181 (ADR-S21) — opcionales para que los specs que arman el
        // service a mano sigueran compilando; en la app siempre están.
        @Optional() private readonly aiQuota?: AiQuotaService,
        @Optional() private readonly aiSettings?: AiSettingsService,
    ) {}

    async summary(tenantId: number): Promise<BillingSummary> {
        const { plan, status, archivedAt, subscriptionEndsAt } = await this.planStatus(tenantId);
        const [usage, emails, smtp, aiUsed, ownAiKey] = await Promise.all([
            this.tenantDb.withTenant(tenantId, (tx) => this.usage(tx, tenantId)),
            this.emailQuota.usedThisMonth(tenantId),
            // Con SMTP propio los correos salen por el servidor del cliente:
            // no consumen la cuota de la plataforma (ADR-S18).
            this.tenantSmtp.ownMail(tenantId),
            // Ídem con la clave IA propia (ADR-S21).
            this.aiQuota ? this.aiQuota.usedThisMonth(tenantId) : Promise.resolve(0),
            this.aiSettings ? this.aiSettings.tenantHasOwnKey(tenantId) : Promise.resolve(false),
        ]);
        usage.emails_month = emails;
        usage.ai_requests_month = aiUsed;
        return {
            own_ai_key: ownAiKey,
            plan,
            status,
            read_only: isEffectivelyReadOnly({
                status,
                archived_at: archivedAt,
                subscription_ends_at: subscriptionEndsAt,
            }),
            limits: await this.plans.limits(plan),
            usage,
            own_smtp: smtp,
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
                message: `Se superaría el límite de ${limit} registros del plan ${plan} (tenés ${count}, se agregarían ${additional})`,
                data: { status: 403, errors: { plan: 'límite de registros' } },
            });
        }
    }

    /**
     * v0.1.240 — Límite de USUARIOS del plan (`max_users`), al sumar a alguien
     * al equipo. Existía en la tabla de planes desde F4 pero nada lo aplicaba.
     * Cuentan las personas del EQUIPO: los clientes del portal (rol `client`)
     * no ocupan lugar — un CRM puede tener cientos sin que eso sea su equipo.
     */
    async assertCanAddMember(tenantId: number): Promise<void> {
        const { plan } = await this.planStatus(tenantId);
        const limit = (await this.plans.limits(plan)).max_users;
        if (limit === null) return;
        const count = await this.tenantDb.withTenant(tenantId, (tx) => this.countStaff(tx, tenantId));
        if (count >= limit) {
            throw new ForbiddenException({
                code: 'plan_limit_reached',
                message: `Alcanzaste el límite de ${limit} usuarios del plan ${plan}. Quitá a alguien o pasá a un plan mayor.`,
                data: { status: 403, errors: { plan: 'límite de usuarios' } },
            });
        }
    }

    private async countStaff(tx: Tx, tenantId: number): Promise<number> {
        const [u] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(memberships)
            .where(and(eq(memberships.tenantId, tenantId), ne(memberships.role, 'client')));
        return u?.n ?? 0;
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

    private async planStatus(
        tenantId: number,
    ): Promise<{ plan: Plan; status: BillingStatus; archivedAt: Date | null; subscriptionEndsAt: Date | null }> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [t] = await tx
                .select({
                    plan: tenants.plan,
                    status: tenants.status,
                    archivedAt: tenants.archivedAt,
                    subscriptionEndsAt: tenants.subscriptionEndsAt,
                })
                .from(tenants)
                .where(eq(tenants.id, tenantId))
                .limit(1);
            return t;
        });
        return {
            plan: (row?.plan ?? 'trial') as Plan,
            status: (row?.status ?? 'trialing') as BillingStatus,
            archivedAt: row?.archivedAt ?? null,
            subscriptionEndsAt: row?.subscriptionEndsAt ?? null,
        };
    }

    private async usage(tx: Tx, tenantId: number): Promise<Usage> {
        const recordCount = await this.countRecords(tx, tenantId);
        const staff = await this.countStaff(tx, tenantId);
        const [a] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(automations)
            .where(eq(automations.tenantId, tenantId));
        const [st] = await tx
            .select({ n: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)::bigint` })
            .from(attachments)
            .where(eq(attachments.tenantId, tenantId));
        return {
            records: recordCount,
            users: staff,
            automations: a?.n ?? 0,
            storage_bytes: Number(st?.n ?? 0),
            // Lo completa `summary` (vive fuera del scope del tenant: el
            // contador lo escribe el worker de correo por la conexión base).
            emails_month: 0,
            ai_requests_month: 0,
        };
    }

    /**
     * Cuota de storage del plan (ADR-S16): rechaza el upload si el uso actual
     * más el archivo nuevo supera `max_storage_mb`. NULL = ilimitado.
     */
    async assertCanUpload(tenantId: number, incomingBytes: number): Promise<void> {
        const { plan } = await this.planStatus(tenantId);
        const limits = await this.plans.limits(plan);
        if (limits.max_storage_mb === null) return;
        const used = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [st] = await tx
                .select({ n: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)::bigint` })
                .from(attachments)
                .where(eq(attachments.tenantId, tenantId));
            return Number(st?.n ?? 0);
        });
        if (used + incomingBytes > limits.max_storage_mb * 1024 * 1024) {
            throw new ForbiddenException({
                code: 'storage_limit_reached',
                message: `Alcanzaste el límite de almacenamiento de tu plan (${limits.max_storage_mb} MB)`,
                data: { status: 403 },
            });
        }
    }

    private async countRecords(tx: Tx, tenantId: number): Promise<number> {
        const [r] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(records)
            .where(and(eq(records.tenantId, tenantId), isNull(records.deletedAt)));
        return r?.n ?? 0;
    }
}
