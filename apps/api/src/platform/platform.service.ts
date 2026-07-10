import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import {
    BILLING_STATUSES,
    isReadOnly,
    type BillingStatus,
    type CreatePlanInput,
    type CreateTenantInput,
    type ImpersonationLogEntry,
    type Plan,
    type PlatformOwner,
    type PlatformPlan,
    type PlatformStats,
    type PlatformTenant,
    type PlatformTenantDetail,
    type PlatformUser,
    type UpdatePlanInput,
    type UpdateTenantInput,
} from '@imagina-base/shared';
import { desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuthService } from '../auth/auth.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { automations, impersonationLog, memberships, records, tenants, users } from '../db/schema';
import { BillingService } from '../billing/billing.service';
import { PlansService } from '../billing/plans.service';

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
        @Inject(ENV) private readonly env: Env,
        private readonly billing: BillingService,
        private readonly auth: AuthService,
        private readonly plans: PlansService,
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

    /** Alta de una empresa nueva + su admin en un paso (onboarding por el operador). */
    async createTenant(input: CreateTenantInput): Promise<PlatformTenant> {
        if (input.plan !== undefined && !(await this.plans.exists(input.plan))) {
            throw new BadRequestException({ code: 'unknown_plan', message: `El plan '${input.plan}' no existe`, data: { status: 400, errors: { plan: 'No existe' } } });
        }
        const { tenantId } = await this.auth.adminCreateTenant({
            workspace_name: input.workspace_name,
            admin_email: input.admin_email,
            admin_name: input.admin_name,
            plan: input.plan ?? 'trial',
        });
        return this.getTenant(tenantId);
    }

    /** Detalle de una empresa: datos + miembros + límites del plan. */
    async tenantDetail(id: number): Promise<PlatformTenantDetail> {
        const tenant = await this.getTenant(id);
        const rows = await this.db
            .select({ user_id: users.id, name: users.name, email: users.email, role: memberships.role, disabledAt: users.disabledAt })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(eq(memberships.tenantId, id))
            .orderBy(memberships.createdAt);
        const limits = await this.plans.limits(tenant.plan);
        return {
            tenant,
            members: rows.map((m) => ({ user_id: m.user_id, name: m.name, email: m.email, role: m.role, disabled: m.disabledAt != null })),
            limits,
        };
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
        // El plan debe existir en la tabla de planes (evita asignar un slug inválido).
        if (input.plan !== undefined && !(await this.plans.exists(input.plan))) {
            throw new BadRequestException({ code: 'unknown_plan', message: `El plan '${input.plan}' no existe`, data: { status: 400, errors: { plan: 'No existe' } } });
        }
        // Reusa el mismo camino que el webhook de pago (BillingService.setBilling).
        await this.billing.setBilling(id, { plan: input.plan, status: input.status });
        return this.getTenant(id);
    }

    // ─────────────── Impersonación de soporte (F5) ───────────────

    /** Abre una sesión de impersonación como `targetUserId`. Devuelve token+target. */
    impersonate(operatorId: number, operatorToken: string, targetUserId: number) {
        return this.auth.impersonate(operatorId, operatorToken, targetUserId);
    }

    /** Log de auditoría de impersonación (más recientes primero). */
    async listImpersonations(limit = 50): Promise<ImpersonationLogEntry[]> {
        const actor = alias(users, 'actor');
        const target = alias(users, 'target');
        const rows = await this.db
            .select({
                id: impersonationLog.id,
                actor_name: actor.name,
                actor_email: actor.email,
                target_name: target.name,
                target_email: target.email,
                started_at: impersonationLog.startedAt,
                expires_at: impersonationLog.expiresAt,
                ended_at: impersonationLog.endedAt,
            })
            .from(impersonationLog)
            .innerJoin(actor, eq(actor.id, impersonationLog.actorUserId))
            .innerJoin(target, eq(target.id, impersonationLog.targetUserId))
            .orderBy(desc(impersonationLog.startedAt))
            .limit(limit);
        return rows.map((r) => ({
            id: r.id,
            actor_name: r.actor_name,
            actor_email: r.actor_email,
            target_name: r.target_name,
            target_email: r.target_email,
            started_at: r.started_at.toISOString(),
            expires_at: r.expires_at.toISOString(),
            ended_at: r.ended_at ? r.ended_at.toISOString() : null,
        }));
    }

    // ─────────────────────────── Planes (F3) ───────────────────────────

    listPlans(): Promise<PlatformPlan[]> {
        return this.plans.list();
    }
    createPlan(input: CreatePlanInput): Promise<PlatformPlan> {
        return this.plans.create(input);
    }
    updatePlan(slug: string, input: UpdatePlanInput): Promise<PlatformPlan> {
        return this.plans.update(slug, input);
    }
    removePlan(slug: string): Promise<void> {
        return this.plans.remove(slug);
    }

    /** Foto del negocio para el dashboard del operador. */
    async getStats(): Promise<PlatformStats> {
        const [rows, planList] = await Promise.all([
            this.db.select({ plan: tenants.plan, status: tenants.status, createdAt: tenants.createdAt }).from(tenants),
            this.plans.list(),
        ]);

        const by_status = Object.fromEntries(BILLING_STATUSES.map((s) => [s, 0])) as Record<BillingStatus, number>;
        // Inicializa por cada plan existente (así aparecen en 0 aunque nadie los use).
        const by_plan: Record<string, number> = Object.fromEntries(planList.map((p) => [p.slug, 0]));
        let read_only_tenants = 0;
        let signups_last_30d = 0;
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        for (const r of rows) {
            const status = (r.status ?? 'trialing') as BillingStatus;
            const plan = (r.plan ?? 'trial') as Plan;
            if (status in by_status) by_status[status] += 1;
            by_plan[plan] = (by_plan[plan] ?? 0) + 1;
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

    // ─────────────────────────── Usuarios (F2) ───────────────────────────

    /** Todos los usuarios de la plataforma con nº de workspaces + flags. */
    async listUsers(): Promise<PlatformUser[]> {
        const rows = await this.db
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                createdAt: users.createdAt,
                disabledAt: users.disabledAt,
            })
            .from(users)
            .orderBy(desc(users.createdAt));
        const counts = await this.countByTenant(
            this.db.select({ tid: memberships.userId, n: intCount() }).from(memberships).groupBy(memberships.userId),
        );
        const superset = new Set(this.env.PLATFORM_SUPERADMINS.map((e) => e.toLowerCase()));
        return rows.map((u) => this.toUser(u, counts.get(u.id) ?? 0, superset));
    }

    /** Crea la cuenta + envía email de invitación (link para definir contraseña). */
    async createUser(email: string, name: string): Promise<PlatformUser> {
        const user = await this.auth.adminCreateUser(email, name);
        const superset = new Set(this.env.PLATFORM_SUPERADMINS.map((e) => e.toLowerCase()));
        return this.toUser(user, 0, superset);
    }

    /** Desactiva/reactiva (al desactivar, revoca sesiones). Devuelve el usuario. */
    async setUserDisabled(userId: number, disabled: boolean): Promise<PlatformUser> {
        await this.auth.setUserDisabled(userId, disabled);
        const [u] = await this.db
            .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt, disabledAt: users.disabledAt })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        const [c] = await this.db.select({ n: intCount() }).from(memberships).where(eq(memberships.userId, userId));
        const superset = new Set(this.env.PLATFORM_SUPERADMINS.map((e) => e.toLowerCase()));
        return this.toUser(u!, c?.n ?? 0, superset);
    }

    /** Dispara el email de reset de contraseña de un usuario. */
    async resetUserPassword(userId: number): Promise<void> {
        await this.auth.adminResetPassword(userId);
    }

    private toUser(
        u: { id: number; email: string; name: string; createdAt: Date; disabledAt: Date | null },
        workspaces: number,
        superset: Set<string>,
    ): PlatformUser {
        return {
            id: u.id,
            email: u.email,
            name: u.name,
            created_at: u.createdAt.toISOString(),
            disabled: u.disabledAt != null,
            is_superadmin: superset.has(u.email.toLowerCase()),
            workspaces,
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
