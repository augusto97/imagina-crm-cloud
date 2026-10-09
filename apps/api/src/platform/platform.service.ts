import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AuditService, type AuditAction } from '../audit/audit.service';
import { MembersService } from '../members/members.service';
import { AiQuotaService } from '../ai/ai-quota.service';
import { AiSettingsService } from '../ai/ai-settings.service';
import { BadRequestException } from '@nestjs/common';
import {
    BILLING_STATUSES,
    isEffectivelyReadOnly,
    isReadOnly,
    type BillingStatus,
    type AddMemberInput,
    type AddMemberResult,
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
    type PlatformUserWorkspace,
    type UpdateMemberRoleInput,
    type UpdatePlanInput,
    type WorkspaceMember,
    type UpdatePlatformUserInput,
    type UpdateTenantInput,
} from '@imagina-base/shared';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuthService } from '../auth/auth.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import {
    activity,
    attachments,
    automationRuns,
    automations,
    comments,
    dashboards,
    emailUsage,
    aiUsage,
    billingPayments,
    billingSubscriptions,
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
    auditLog,
    automationHooks,
    connections,
    listGroups,
    listSlugHistory,
    mentions,
    personalAccessTokens,
    recurrences,
    relations,
    templates,
    connectionSyncs,
    sqlSyncs,
    paymentLinks,
    collectionHooks,
    syncLinks,
    bulkEditItems,
    bulkEdits,
    documentNumbers,
    documentTemplates,
    forms,
} from '../db/schema';
import { BillingService } from '../billing/billing.service';
import { PlansService } from '../billing/plans.service';
import { EmailQuotaService, periodOf } from '../mail/email-quota.service';
import { TenantSmtpService } from '../mail/tenant-smtp.service';
import { FILE_STORAGE, type FileStorage } from '../files/file-storage';

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
        private readonly emailQuota: EmailQuotaService,
        private readonly tenantSmtp: TenantSmtpService,
        // v0.1.181 (ADR-S21) — opcionales: los specs arman el service a mano.
        @Optional() private readonly aiQuota?: AiQuotaService,
        @Optional() private readonly aiSettings?: AiSettingsService,
        // v0.1.197 — borrar una empresa también borra sus bytes. Opcional por
        // el mismo motivo que los anteriores.
        @Optional() @Inject(FILE_STORAGE) private readonly storage?: FileStorage,
        // v0.1.240 — gestión de miembros de cualquier empresa desde la consola.
        @Optional() private readonly members?: MembersService,
        @Optional() private readonly audit?: AuditService,
    ) {}

    /**
     * Empresas con plan/estado/uso/owner (grilla del operador), PAGINADA.
     *
     * v0.1.115: antes traía TODAS las empresas y encima corría cuatro
     * `GROUP BY` de tabla completa (records, memberships, automations,
     * attachments) en cada carga — con 54 empresas andaba, pero a escala cada
     * visita a la consola escaneaba la tabla de records entera. Ahora se
     * pagina PRIMERO y los agregados se calculan sólo para los ids de la
     * página (`WHERE tenant_id IN (...)`), que es un lookup por índice.
     */
    async listTenants(
        opts: { includeArchived?: boolean; limit?: number; offset?: number; search?: string } = {},
    ): Promise<{ data: PlatformTenant[]; meta: { total: number; limit: number; offset: number } }> {
        const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
        const offset = Math.max(opts.offset ?? 0, 0);
        const search = (opts.search ?? '').trim();

        const filters: SQL[] = [];
        if (!opts.includeArchived) filters.push(isNull(tenants.archivedAt));
        if (search !== '') {
            const term = `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
            filters.push(sql`(${tenants.name} ILIKE ${term} OR ${tenants.slug} ILIKE ${term})`);
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const [rows, totalRow] = await Promise.all([
            this.db
                .select()
                .from(tenants)
                .where(where)
                .orderBy(desc(tenants.createdAt))
                .limit(limit)
                .offset(offset),
            this.db.select({ n: intCount() }).from(tenants).where(where),
        ]);

        const ids = rows.map((t) => t.id);
        if (ids.length === 0) {
            return { data: [], meta: { total: Number(totalRow[0]?.n ?? 0), limit, offset } };
        }

        const [recMap, userMap, autoMap, storageMap, emailMap, aiMap, ownerMap] = await Promise.all([
            this.countByTenant(this.db.select({ tid: records.tenantId, n: intCount() }).from(records).where(and(isNull(records.deletedAt), inArray(records.tenantId, ids))).groupBy(records.tenantId)),
            this.countByTenant(this.db.select({ tid: memberships.tenantId, n: intCount() }).from(memberships).where(and(inArray(memberships.tenantId, ids), ne(memberships.role, 'client'))).groupBy(memberships.tenantId)),
            this.countByTenant(this.db.select({ tid: automations.tenantId, n: intCount() }).from(automations).where(inArray(automations.tenantId, ids)).groupBy(automations.tenantId)),
            this.countByTenant(this.db.select({ tid: attachments.tenantId, n: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)::bigint` }).from(attachments).where(and(inArray(attachments.tenantId, ids), isNull(attachments.storageConnectionId))).groupBy(attachments.tenantId)),
            // Correos de plataforma del mes en curso (ADR-S18): lookup por PK,
            // acotado a los ids de ESTA página (mismo criterio de v0.1.115).
            this.countByTenant(
                this.db
                    .select({ tid: emailUsage.tenantId, n: sql<number>`coalesce(sum(${emailUsage.sent}), 0)::int` })
                    .from(emailUsage)
                    .where(and(inArray(emailUsage.tenantId, ids), eq(emailUsage.period, periodOf())))
                    .groupBy(emailUsage.tenantId),
            ),
            // Pedidos al asistente con la clave de la plataforma (ADR-S21).
            this.countByTenant(
                this.db
                    .select({ tid: aiUsage.tenantId, n: sql<number>`coalesce(sum(${aiUsage.requests}), 0)::int` })
                    .from(aiUsage)
                    .where(and(inArray(aiUsage.tenantId, ids), eq(aiUsage.period, periodOf())))
                    .groupBy(aiUsage.tenantId),
            ),
            this.ownersByTenant(),
        ]);

        return {
            data: rows.map((t) =>
                this.toPlatformTenant(t, ownerMap.get(t.id) ?? null, {
                    records: recMap.get(t.id) ?? 0,
                    users: userMap.get(t.id) ?? 0,
                    automations: autoMap.get(t.id) ?? 0,
                    storage_bytes: Number(storageMap.get(t.id) ?? 0),
                    emails_month: Number(emailMap.get(t.id) ?? 0),
                    ai_requests_month: Number(aiMap.get(t.id) ?? 0),
                }),
            ),
            meta: { total: Number(totalRow[0]?.n ?? 0), limit, offset },
        };
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
                paid_until: t.paidUntil,
            }),
            archived: t.archivedAt != null,
            subscription_ends_at: t.subscriptionEndsAt ? t.subscriptionEndsAt.toISOString() : null,
            paid_until: t.paidUntil ? t.paidUntil.toISOString() : null,
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
            .select({ user_id: users.id, name: users.name, email: users.email, role: memberships.role, disabledAt: users.disabledAt, invitedAt: users.invitedAt })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(eq(memberships.tenantId, id))
            .orderBy(memberships.createdAt);
        const [limits, emails, smtp, aiUsed, ownAiKey] = await Promise.all([
            this.plans.limits(tenant.plan),
            // Consumo de correo de plataforma del mes (ADR-S18): es lo que le
            // cuesta al operador. Con SMTP propio, el cliente no consume nada.
            this.emailQuota.usedThisMonth(id),
            this.tenantSmtp.ownMail(id),
            // Ídem pedidos al asistente con la clave de la plataforma (ADR-S21).
            this.aiQuota ? this.aiQuota.usedThisMonth(id) : Promise.resolve(0),
            this.aiSettings ? this.aiSettings.tenantHasOwnKey(id) : Promise.resolve(false),
        ]);
        return {
            tenant,
            members: rows.map((m) => ({
                user_id: m.user_id,
                name: m.name,
                email: m.email,
                role: m.role,
                disabled: m.disabledAt != null,
                pending: m.invitedAt != null,
            })),
            limits,
            emails_month: emails,
            own_smtp: smtp,
            ai_requests_month: aiUsed,
            own_ai_key: ownAiKey,
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
        // Los bytes de los adjuntos viven fuera de la base: si no se borran
        // acá quedan ocupando disco para siempre, y el operador pidió borrar
        // la empresa, no dejar sus archivos dando vueltas.
        const files = await this.db
            .select({ key: attachments.storageKey })
            .from(attachments)
            // v0.1.268 (ADR-S36) — sólo lo del servidor de la plataforma: lo
            // que está en el bucket PROPIO de la empresa es suyo, no se toca.
            .where(and(eq(attachments.tenantId, id), isNull(attachments.storageConnectionId)));

        await this.db.transaction(async (tx: Tx) => {
            // Orden por dependencias, hijas primero. La lista es EXPLÍCITA (no
            // hay cascada desde `tenants`), así que toda tabla con `tenant_id`
            // tiene que estar acá: la que falte deja la empresa imborrable con
            // un 500 por violación de FK — fue el caso de attachments,
            // connections, templates, carpetas, menciones, recurrencias y la
            // bitácora, agregadas en releases posteriores al original.
            await tx.delete(mentions).where(eq(mentions.tenantId, id));
            // v0.1.251 — cobros de la empresa (links de pago y su URL de avisos).
            await tx.delete(paymentLinks).where(eq(paymentLinks.tenantId, id));
            await tx.delete(collectionHooks).where(eq(collectionHooks.tenantId, id));
            await tx.delete(bulkEditItems).where(eq(bulkEditItems.tenantId, id));
            await tx.delete(bulkEdits).where(eq(bulkEdits.tenantId, id));
            await tx.delete(syncLinks).where(eq(syncLinks.tenantId, id));
            await tx.delete(connectionSyncs).where(eq(connectionSyncs.tenantId, id));
            await tx.delete(sqlSyncs).where(eq(sqlSyncs.tenantId, id));
            await tx.delete(automationHooks).where(eq(automationHooks.tenantId, id));
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, id));
            await tx.delete(automations).where(eq(automations.tenantId, id));
            await tx.delete(comments).where(eq(comments.tenantId, id));
            await tx.delete(activity).where(eq(activity.tenantId, id));
            await tx.delete(relations).where(eq(relations.tenantId, id));
            await tx.delete(recurrences).where(eq(recurrences.tenantId, id));
            await tx.delete(portalLinks).where(eq(portalLinks.tenantId, id));
            await tx.delete(publicLists).where(eq(publicLists.tenantId, id));
            await tx.delete(savedFilters).where(eq(savedFilters.tenantId, id));
            await tx.delete(savedViews).where(eq(savedViews.tenantId, id));
            // v0.1.266 — plantillas de documentos PDF.
            await tx.delete(documentNumbers).where(eq(documentNumbers.tenantId, id));
            await tx.delete(documentTemplates).where(eq(documentTemplates.tenantId, id));
            // v0.1.275 — formularios públicos.
            await tx.delete(forms).where(eq(forms.tenantId, id));
            await tx.delete(records).where(eq(records.tenantId, id));
            await tx.delete(fields).where(eq(fields.tenantId, id));
            await tx.delete(listSlugHistory).where(eq(listSlugHistory.tenantId, id));
            await tx.delete(dashboards).where(eq(dashboards.tenantId, id));
            await tx.delete(lists).where(eq(lists.tenantId, id));
            await tx.delete(listGroups).where(eq(listGroups.tenantId, id));
            await tx.delete(templates).where(eq(templates.tenantId, id));
            // Adjuntos ANTES que conexiones: `storage_connection_id` (ADR-S36)
            // apunta a la conexión donde quedó cada archivo.
            await tx.delete(attachments).where(eq(attachments.tenantId, id));
            await tx.delete(connections).where(eq(connections.tenantId, id));
            await tx.delete(auditLog).where(eq(auditLog.tenantId, id));
            await tx.delete(emailUsage).where(eq(emailUsage.tenantId, id));
            await tx.delete(aiUsage).where(eq(aiUsage.tenantId, id));
            await tx.delete(billingPayments).where(eq(billingPayments.tenantId, id));
            await tx.delete(billingSubscriptions).where(eq(billingSubscriptions.tenantId, id));
            await tx.delete(personalAccessTokens).where(eq(personalAccessTokens.tenantId, id));
            await tx.delete(memberships).where(eq(memberships.tenantId, id));
            await tx.delete(tenants).where(eq(tenants.id, id));
        });

        // Best-effort: la empresa ya no existe en la base; un byte que no se
        // pueda borrar no tiene que revertir el borrado.
        for (const f of files) {
            await this.storage?.delete(f.key).catch(() => undefined);
        }
    }

    // ─────────── Miembros de una empresa (v0.1.240) ───────────
    //
    // Mismo servicio y mismos guard rails que el panel de Miembros del admin de
    // la empresa (no quedarse sin admin, clientes del portal fuera), salvo el
    // límite de usuarios del plan: acá decide el operador. Cada cambio queda en
    // la bitácora de ESA empresa, con el operador como autor.

    async addTenantMember(tenantId: number, input: AddMemberInput, operatorId: number): Promise<AddMemberResult> {
        await this.getTenant(tenantId); // 404 si no existe.
        const member = await this.requireMembers().add(tenantId, input, { invitedById: null, enforcePlan: false });
        await this.logMember(tenantId, operatorId, 'member.add', member, { role: member.role, invited: member.invited });
        return member;
    }

    async updateTenantMemberRole(
        tenantId: number,
        userId: number,
        input: UpdateMemberRoleInput,
        operatorId: number,
    ): Promise<WorkspaceMember> {
        await this.getTenant(tenantId);
        const member = await this.requireMembers().updateRole(tenantId, userId, input);
        await this.logMember(tenantId, operatorId, 'member.role_change', member, { role: member.role });
        return member;
    }

    async removeTenantMember(tenantId: number, userId: number, operatorId: number): Promise<void> {
        await this.getTenant(tenantId);
        const gone = await this.requireMembers().remove(tenantId, operatorId, userId);
        await this.logMember(tenantId, operatorId, 'member.remove', gone, { role: gone.role });
    }

    async resendTenantInvite(tenantId: number, userId: number, operatorId: number): Promise<void> {
        await this.getTenant(tenantId);
        const { email } = await this.auth.resendInvite(tenantId, userId);
        await this.audit?.log({
            tenantId,
            userId: operatorId,
            action: 'member.invite_resend',
            targetType: 'user',
            targetId: userId,
            targetLabel: email,
            meta: { via: 'platform' },
        });
    }

    /** Invitación de una cuenta creada desde la consola, sin empresa. */
    async resendUserInvite(userId: number): Promise<void> {
        await this.auth.resendInvite(null, userId);
    }

    /** Empresas a las que pertenece una persona (rol incluido; portal también). */
    async userWorkspaces(userId: number): Promise<PlatformUserWorkspace[]> {
        await this.userDto(userId); // 404 si no existe.
        const rows = await this.db
            .select({
                tenant_id: tenants.id,
                name: tenants.name,
                slug: tenants.slug,
                role: memberships.role,
                archivedAt: tenants.archivedAt,
            })
            .from(memberships)
            .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
            .where(eq(memberships.userId, userId))
            .orderBy(asc(tenants.name));
        return rows.map((r) => ({ tenant_id: r.tenant_id, name: r.name, slug: r.slug, role: r.role, archived: r.archivedAt != null }));
    }

    private requireMembers(): MembersService {
        if (!this.members) throw new Error('MembersService no disponible');
        return this.members;
    }

    private async logMember(
        tenantId: number,
        operatorId: number,
        action: AuditAction,
        member: { user_id: number; email: string },
        meta: Record<string, unknown>,
    ): Promise<void> {
        await this.audit?.log({
            tenantId,
            userId: operatorId,
            action,
            targetType: 'user',
            targetId: member.user_id,
            targetLabel: member.email,
            meta: { ...meta, via: 'platform' },
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
                invitedAt: users.invitedAt,
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
            .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt, disabledAt: users.disabledAt, invitedAt: users.invitedAt })
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
            .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt, disabledAt: users.disabledAt, invitedAt: users.invitedAt })
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
        u: { id: number; email: string; name: string; createdAt: Date; disabledAt: Date | null; invitedAt?: Date | null },
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
            pending: u.invitedAt != null,
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
