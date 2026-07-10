import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import {
    BILLING_STATUSES,
    isEffectivelyReadOnly,
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
    type UpdatePlatformUserInput,
    type UpdateTenantInput,
} from '@imagina-base/shared';
import { desc, eq, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuthService } from '../auth/auth.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import {
    activity,
    automationRuns,
    automations,
    comments,
    dashboards,
    fields,
    impersonationLog,
    lists,
    memberships,
    portalLinks,
    publicLists,
    records,
    savedFilters,
    savedViews,
    tenants,
    users,
} from '../db/schema';
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
    async listTenants(includeArchived = false): Promise<PlatformTenant[]> {
        const rows = await this.db.select().from(tenants).orderBy(desc(tenants.createdAt));
        const [recMap, userMap, autoMap, ownerMap] = await Promise.all([
            this.countByTenant(this.db.select({ tid: records.tenantId, n: intCount() }).from(records).where(isNull(records.deletedAt)).groupBy(records.tenantId)),
            this.countByTenant(this.db.select({ tid: memberships.tenantId, n: intCount() }).from(memberships).groupBy(memberships.tenantId)),
            this.countByTenant(this.db.select({ tid: automations.tenantId, n: intCount() }).from(automations).groupBy(automations.tenantId)),
            this.ownersByTenant(),
        ]);

        return rows
            .filter((t) => includeArchived || t.archivedAt == null)
            .map((t) =>
                this.toPlatformTenant(t, ownerMap.get(t.id) ?? null, {
                    records: recMap.get(t.id) ?? 0,
                    users: userMap.get(t.id) ?? 0,
                    automations: autoMap.get(t.id) ?? 0,
                }),
            );
    }

    /** Fila de tenant → DTO del operador (con solo-lectura efectivo). */
    private toPlatformTenant(
        t: typeof tenants.$inferSelect,
        owner: PlatformOwner | null,
        usage: PlatformTenant['usage'],
    ): PlatformTenant {
        const status = (t.status ?? 'trialing') as BillingStatus;
        return {
            id: t.id,
            slug: t.slug,
            name: t.name,
            plan: (t.plan ?? 'trial') as Plan,
            status,
            read_only: isEffectivelyReadOnly({
                status,
                archived_at: t.archivedAt,
                subscription_ends_at: t.subscriptionEndsAt,
            }),
            archived: t.archivedAt != null,
            subscription_ends_at: t.subscriptionEndsAt ? t.subscriptionEndsAt.toISOString() : null,
            created_at: t.createdAt.toISOString(),
            owner,
            usage,
        };
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
        return this.toPlatformTenant(t, (await this.ownersByTenant(id)).get(id) ?? null, summary.usage);
    }

    /**
     * Edita una empresa: plan/estado (suspender = past_due → solo-lectura),
     * renombre, archivar/desarchivar y fecha 'paga hasta'. Fijar
     * `status: active` + `subscription_ends_at` = suscripción manual.
     */
    async updateTenant(id: number, input: UpdateTenantInput): Promise<PlatformTenant> {
        // El plan debe existir en la tabla de planes (evita asignar un slug inválido).
        if (input.plan !== undefined && !(await this.plans.exists(input.plan))) {
            throw new BadRequestException({ code: 'unknown_plan', message: `El plan '${input.plan}' no existe`, data: { status: 400, errors: { plan: 'No existe' } } });
        }
        await this.getTenant(id); // 404 si no existe.

        // Campos del ciclo de vida (nombre / archivado / vencimiento) se escriben
        // directo en la fila; plan/estado reusan el camino del webhook de pago.
        const changes: Partial<typeof tenants.$inferInsert> = {};
        if (input.name !== undefined) changes.name = input.name;
        if (input.archived !== undefined) changes.archivedAt = input.archived ? new Date() : null;
        if (input.subscription_ends_at !== undefined) {
            changes.subscriptionEndsAt = input.subscription_ends_at ? new Date(input.subscription_ends_at) : null;
        }
        if (Object.keys(changes).length > 0) {
            changes.updatedAt = new Date();
            await this.db.update(tenants).set(changes).where(eq(tenants.id, id));
        }
        if (input.plan !== undefined || input.status !== undefined) {
            await this.billing.setBilling(id, { plan: input.plan, status: input.status });
        }
        return this.getTenant(id);
    }

    /**
     * BORRA una empresa y TODOS sus datos (irreversible). Corre en la conexión
     * base (bypass RLS) y borra en orden FK-seguro: hijos → padres. `records` y
     * `public_lists` no tienen ON DELETE CASCADE a `lists`, por eso se borran
     * explícitamente antes que `lists`. No borra usuarios (pueden estar en otras
     * empresas): sólo sus membresías.
     */
    async deleteTenant(id: number): Promise<void> {
        await this.getTenant(id); // 404 si no existe.
        await this.db.transaction(async (tx: Tx) => {
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, id));
            await tx.delete(automations).where(eq(automations.tenantId, id));
            await tx.delete(comments).where(eq(comments.tenantId, id));
            await tx.delete(activity).where(eq(activity.tenantId, id));
            await tx.delete(portalLinks).where(eq(portalLinks.tenantId, id));
            await tx.delete(publicLists).where(eq(publicLists.tenantId, id));
            await tx.delete(savedFilters).where(eq(savedFilters.tenantId, id));
            await tx.delete(savedViews).where(eq(savedViews.tenantId, id));
            await tx.delete(records).where(eq(records.tenantId, id));
            await tx.delete(fields).where(eq(fields.tenantId, id));
            await tx.delete(dashboards).where(eq(dashboards.tenantId, id));
            await tx.delete(lists).where(eq(lists.tenantId, id));
            await tx.delete(memberships).where(eq(memberships.tenantId, id));
            await tx.delete(tenants).where(eq(tenants.id, id));
        });
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

    /** Edita nombre/email y/o desactiva-reactiva una cuenta. */
    async updateUser(userId: number, input: UpdatePlatformUserInput): Promise<PlatformUser> {
        const [existing] = await this.db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        if (!existing) {
            throw new NotFoundException({ code: 'user_not_found', message: `Usuario ${userId} no encontrado`, data: { status: 404 } });
        }
        if (input.email !== undefined && input.email.toLowerCase() !== existing.email.toLowerCase()) {
            const [dup] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
            if (dup) {
                throw new BadRequestException({ code: 'email_taken', message: 'Ese email ya está en uso', data: { status: 400, errors: { email: 'Ya existe' } } });
            }
        }
        const changes: Partial<typeof users.$inferInsert> = {};
        if (input.name !== undefined) changes.name = input.name;
        if (input.email !== undefined) changes.email = input.email;
        if (Object.keys(changes).length > 0) {
            await this.db.update(users).set(changes).where(eq(users.id, userId));
        }
        // Desactivar reusa AuthService (revoca sesiones + guard de superadmin).
        if (input.disabled !== undefined) {
            await this.auth.setUserDisabled(userId, input.disabled);
        }
        return this.userDto(userId);
    }

    /**
     * BORRA una cuenta (irreversible). Rechaza a un superadmin. Borra primero el
     * log de impersonación que la referencia (no tiene ON DELETE CASCADE);
     * membresías / portal_links / saved_filters caen por cascade.
     */
    async deleteUser(userId: number): Promise<void> {
        const [u] = await this.db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        if (!u) {
            throw new NotFoundException({ code: 'user_not_found', message: `Usuario ${userId} no encontrado`, data: { status: 404 } });
        }
        const superset = new Set(this.env.PLATFORM_SUPERADMINS.map((e) => e.toLowerCase()));
        if (superset.has(u.email.toLowerCase())) {
            throw new BadRequestException({ code: 'cannot_delete_superadmin', message: 'No se puede borrar a un superadmin de plataforma', data: { status: 400 } });
        }
        // Revoca sesiones antes de borrar (best-effort).
        await this.auth.setUserDisabled(userId, true).catch(() => undefined);
        await this.db.transaction(async (tx: Tx) => {
            await tx
                .delete(impersonationLog)
                .where(or(eq(impersonationLog.actorUserId, userId), eq(impersonationLog.targetUserId, userId)));
            await tx.delete(users).where(eq(users.id, userId));
        });
    }

    /** DTO de un usuario por id (con nº de workspaces + flag superadmin). */
    private async userDto(userId: number): Promise<PlatformUser> {
        const [u] = await this.db
            .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt, disabledAt: users.disabledAt })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        if (!u) {
            throw new NotFoundException({ code: 'user_not_found', message: `Usuario ${userId} no encontrado`, data: { status: 404 } });
        }
        const [c] = await this.db.select({ n: intCount() }).from(memberships).where(eq(memberships.userId, userId));
        const superset = new Set(this.env.PLATFORM_SUPERADMINS.map((e) => e.toLowerCase()));
        return this.toUser(u, c?.n ?? 0, superset);
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
