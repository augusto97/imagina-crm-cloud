import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    helpSupportSchema,
    readAgencyBilling,
    readAgencySettings,
    type HelpSupport,
    type AgencyClient,
    type AgencyEnterResult,
    type AgencyOverview,
    type BillingStatus,
    type CreateAgencyClientInput,
    type UpdateAgencyClientInput,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { PlansService } from '../billing/plans.service';
import { accessOf } from '../billing/tenant-access';
import { AgencyBillingService } from './agency-billing.service';
import { readSupport } from '../help/help.service';
import { DRIZZLE, type Db } from '../db/client';
import { auditLog, memberships, plans, records, tenants, users } from '../db/schema';

/** Tope de empresas cliente que devuelve la consola de una agencia. */
const MAX_LISTED_CLIENTS = 500;

/**
 * v0.1.449 (I3, ADR-S108) — La consola de una AGENCIA: sus empresas cliente.
 *
 * Corre con la conexión BASE (cruza empresas: la agencia lee el estado de sus
 * clientes), y por eso cada consulta filtra SIEMPRE por `agency_id = agencia`
 * — un cliente de otra agencia responde 404. Lo llaman sólo admins directos de
 * la agencia (lo revisa el controller).
 */
@Injectable()
export class AgencyService {
    private readonly logger = new Logger(AgencyService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly auth: AuthService,
        private readonly plans: PlansService,
        private readonly billing: AgencyBillingService,
        @Optional() private readonly audit?: AuditService,
    ) {}

    async overview(agencyId: number): Promise<AgencyOverview> {
        const agency = await this.agencyRow(agencyId);
        const settings = readAgencySettings(agency.settings?.agency);
        const [count] = await this.db
            .select({ n: sql<number>`count(*)::int` })
            .from(tenants)
            .where(and(eq(tenants.agencyId, agencyId), isNull(tenants.archivedAt)));
        const clients = Number(count?.n ?? 0);
        const planSlug = await this.clientPlan(agency.plan, settings.client_plan);
        const planName = (await this.plans.list()).find((p) => p.slug === planSlug)?.name ?? planSlug;
        const billing = readAgencyBilling(agency.settings.agency_billing);
        return {
            agency: { id: agency.id, name: agency.name },
            settings,
            client_plan: { slug: planSlug, name: planName },
            clients,
            can_create: settings.max_clients === null || clients < settings.max_clients,
            billing,
            limit_plans: await this.billing.limitPlans(agency),
            totals: await this.billing.totals(agencyId, billing),
        };
    }

    /**
     * v0.1.450 (ADR-S108) — El contacto de soporte que la agencia les da a sus
     * clientes (lo ven en «Ayuda» en lugar del de la plataforma). Vive en
     * `tenants.settings.agency_support` de la AGENCIA.
     */
    async support(agencyId: number): Promise<HelpSupport> {
        const agency = await this.agencyRow(agencyId);
        return readSupport(agency.settings?.agency_support);
    }

    async setSupport(agencyId: number, userId: number, input: HelpSupport): Promise<HelpSupport> {
        await this.agencyRow(agencyId);
        const next = helpSupportSchema.parse(input);
        await this.db.transaction(async (tx) => {
            const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, agencyId)).for('update').limit(1);
            const settings = { ...((row?.settings as Record<string, unknown> | null) ?? {}) };
            settings.agency_support = next;
            await tx.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, agencyId));
        });
        await this.audit?.log({
            tenantId: agencyId,
            userId,
            action: 'agency.support',
            targetType: 'tenant',
            targetId: agencyId,
            meta: { email: next.email !== null, whatsapp: next.whatsapp !== null, url: next.url !== null },
        });
        return next;
    }

    async listClients(agencyId: number, userId: number, onlyId?: number): Promise<AgencyClient[]> {
        const agency = await this.agencyRow(agencyId);
        const rows = await this.db
            .select({
                id: tenants.id,
                slug: tenants.slug,
                name: tenants.name,
                plan: tenants.plan,
                planName: plans.name,
                status: tenants.status,
                archivedAt: tenants.archivedAt,
                trialEndsAt: tenants.trialEndsAt,
                subscriptionEndsAt: tenants.subscriptionEndsAt,
                paidUntil: tenants.paidUntil,
                agencyPausedAt: tenants.agencyPausedAt,
                agencyPaidUntil: tenants.agencyPaidUntil,
                clientSettings: tenants.settings,
                createdAt: tenants.createdAt,
            })
            .from(tenants)
            .leftJoin(plans, eq(plans.slug, tenants.plan))
            .where(and(eq(tenants.agencyId, agencyId), onlyId !== undefined ? eq(tenants.id, onlyId) : undefined))
            .orderBy(asc(tenants.name), asc(tenants.id))
            .limit(MAX_LISTED_CLIENTS);
        const ids = rows.map((r) => r.id);
        if (ids.length === 0) return [];
        const billingSettings = readAgencyBilling(agency.settings.agency_billing);
        const agencyAccess = {
            plan: agency.plan,
            status: agency.status,
            archived_at: agency.archivedAt,
            trial_ends_at: agency.trialEndsAt,
            subscription_ends_at: agency.subscriptionEndsAt,
            paid_until: agency.paidUntil,
            client_grace_days: billingSettings.grace_days,
        };

        const [userCounts, recordCounts, admins, entered, lastAccess] = await Promise.all([
            this.db
                .select({ tid: memberships.tenantId, n: sql<number>`count(*)::int` })
                .from(memberships)
                .where(
                    and(
                        inArray(memberships.tenantId, ids),
                        ne(memberships.role, 'client'),
                        ne(memberships.role, 'guest'),
                        eq(memberships.viaAgency, false),
                    ),
                )
                .groupBy(memberships.tenantId),
            this.db
                .select({ tid: records.tenantId, n: sql<number>`count(*)::int` })
                .from(records)
                .where(and(inArray(records.tenantId, ids), isNull(records.deletedAt)))
                .groupBy(records.tenantId),
            this.db
                .select({ tid: memberships.tenantId, name: users.name, email: users.email, invitedAt: users.invitedAt })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(inArray(memberships.tenantId, ids), eq(memberships.role, 'admin'), eq(memberships.viaAgency, false)))
                .orderBy(asc(memberships.createdAt)),
            this.db
                .select({ tid: memberships.tenantId })
                .from(memberships)
                .where(and(inArray(memberships.tenantId, ids), eq(memberships.userId, userId))),
            this.db
                .select({ tid: auditLog.tenantId, at: sql<Date | string | null>`max(${auditLog.createdAt})` })
                .from(auditLog)
                .where(and(inArray(auditLog.tenantId, ids), inArray(auditLog.action, ['agency.access', 'agency.enter', 'agency.client_create'])))
                .groupBy(auditLog.tenantId),
        ]);
        const usersBy = new Map(userCounts.map((r) => [Number(r.tid), Number(r.n)]));
        const recordsBy = new Map(recordCounts.map((r) => [Number(r.tid), Number(r.n)]));
        const enteredSet = new Set(entered.map((r) => Number(r.tid)));
        const lastBy = new Map(lastAccess.map((r) => [Number(r.tid), r.at ? new Date(r.at).toISOString() : null]));
        const adminsBy = new Map<number, AgencyClient['admins']>();
        for (const a of admins) {
            const list = adminsBy.get(Number(a.tid)) ?? [];
            if (list.length < 3) list.push({ name: a.name, email: a.email, pending: a.invitedAt !== null });
            adminsBy.set(Number(a.tid), list);
        }

        return rows.map((r) => ({
            id: r.id,
            slug: r.slug,
            name: r.name,
            plan: r.plan,
            plan_name: r.planName ?? null,
            status: (r.status ?? 'active') as BillingStatus,
            access: accessOf({ ...r, agency: { ...agencyAccess, client_paid_until: r.agencyPaidUntil } }),
            paused: r.agencyPausedAt !== null,
            archived: r.archivedAt !== null,
            created_at: r.createdAt.toISOString(),
            users: usersBy.get(r.id) ?? 0,
            records: recordsBy.get(r.id) ?? 0,
            admins: adminsBy.get(r.id) ?? [],
            entered: enteredSet.has(r.id),
            last_agency_access_at: lastBy.get(r.id) ?? null,
            billing: this.billing.clientBilling(billingSettings, {
                settings: r.clientSettings as Record<string, unknown> | null,
                agencyPaidUntil: r.agencyPaidUntil,
            }),
        }));
    }

    /** Una empresa cliente con su estado y su cobro (404 si no es de esta agencia). */
    async clientOf(agencyId: number, userId: number, clientId: number): Promise<AgencyClient> {
        const [out] = await this.listClients(agencyId, userId, clientId);
        if (!out) throw notFound();
        return out;
    }

    async createClient(agencyId: number, userId: number, input: CreateAgencyClientInput): Promise<AgencyClient> {
        const overview = await this.overview(agencyId);
        if (!overview.can_create) {
            throw new ConflictException({
                code: 'agency_client_limit',
                message: `Llegaste al tope de ${overview.settings.max_clients} empresas cliente de tu agencia. Pídele a la plataforma que lo amplíe.`,
                data: { status: 409 },
            });
        }
        const adminEmail = input.admin_email?.trim().toLowerCase() || null;
        const { tenantId, invited } = await this.auth.agencyCreateTenant({
            workspaceName: input.name,
            adminEmail,
            adminName: adminEmail ? input.admin_name?.trim() || adminEmail.split('@')[0] || adminEmail : null,
            plan: overview.client_plan?.slug ?? 'trial',
            agencyId,
            creatorId: userId,
        });
        const meta = { agency_id: agencyId, agency_name: overview.agency.name, admin_email: adminEmail, invited };
        await Promise.all([
            this.audit?.log({ tenantId, userId, action: 'agency.client_create', targetType: 'tenant', targetId: tenantId, targetLabel: input.name, meta }),
            this.audit?.log({ tenantId: agencyId, userId, action: 'agency.client_create', targetType: 'tenant', targetId: tenantId, targetLabel: input.name, meta }),
        ]);
        this.logger.log(`La agencia ${agencyId} creó la empresa cliente ${tenantId}`);
        const [client] = await this.listClients(agencyId, userId, tenantId);
        if (!client) throw new Error('La empresa cliente recién creada no aparece');
        return client;
    }

    async updateClient(agencyId: number, userId: number, clientId: number, input: UpdateAgencyClientInput): Promise<AgencyClient> {
        const client = await this.clientRow(agencyId, clientId);
        const now = new Date();
        const set: Partial<typeof tenants.$inferInsert> = {};
        if (input.name !== undefined && input.name !== client.name) set.name = input.name;
        if (input.paused === true && client.agencyPausedAt === null) set.agencyPausedAt = now;
        if (input.paused === false && client.agencyPausedAt !== null) set.agencyPausedAt = null;
        if (Object.keys(set).length > 0) {
            await this.db
                .update(tenants)
                .set({ ...set, updatedAt: now })
                .where(and(eq(tenants.id, clientId), eq(tenants.agencyId, agencyId)));
            const actions: Array<'agency.client_rename' | 'agency.client_pause' | 'agency.client_resume'> = [];
            if (set.name !== undefined) actions.push('agency.client_rename');
            if (set.agencyPausedAt !== undefined) actions.push(set.agencyPausedAt ? 'agency.client_pause' : 'agency.client_resume');
            for (const action of actions) {
                const entry = {
                    userId,
                    action,
                    targetType: 'tenant',
                    targetId: clientId,
                    targetLabel: input.name ?? client.name,
                    meta: { agency_id: agencyId, ...(action === 'agency.client_rename' ? { from: client.name } : {}) },
                } as const;
                await Promise.all([this.audit?.log({ tenantId: clientId, ...entry }), this.audit?.log({ tenantId: agencyId, ...entry })]);
            }
        }
        const [out] = await this.listClients(agencyId, userId, clientId);
        if (!out) throw notFound();
        return out;
    }

    /**
     * «Entrar»: la persona queda en la empresa cliente como admin «por la
     * agencia» (si ya estaba, no cambia nada). Queda en la bitácora del
     * cliente; las visitas siguientes las anota el guard, una por hora.
     */
    async enter(agencyId: number, userId: number, clientId: number): Promise<AgencyEnterResult> {
        const client = await this.clientRow(agencyId, clientId);
        const [existing] = await this.db
            .select({ role: memberships.role, viaAgency: memberships.viaAgency })
            .from(memberships)
            .where(and(eq(memberships.tenantId, clientId), eq(memberships.userId, userId)))
            .limit(1);
        if (existing && (existing.role === 'client' || existing.role === 'guest')) {
            throw new ConflictException({
                code: 'agency_member_conflict',
                message:
                    existing.role === 'client'
                        ? 'Tu cuenta es cliente del portal de esta empresa: para entrar como agencia usa otra cuenta.'
                        : 'Tu cuenta es invitada en esta empresa: para entrar como agencia usa otra cuenta o pídele a la empresa que te quite como invitada.',
                data: { status: 409 },
            });
        }
        if (!existing) {
            await this.db
                .insert(memberships)
                .values({ userId, tenantId: clientId, role: 'admin', viaAgency: true })
                .onConflictDoNothing();
            await this.audit?.log({
                tenantId: clientId,
                userId,
                action: 'agency.enter',
                targetType: 'tenant',
                targetId: clientId,
                targetLabel: client.name,
                meta: { agency_id: agencyId },
            });
        }
        return { tenant_id: client.id, tenant_slug: client.slug };
    }

    // ── internos ─────────────────────────────────────────────────────────

    private async agencyRow(agencyId: number) {
        const [row] = await this.db
            .select({
                id: tenants.id,
                name: tenants.name,
                plan: tenants.plan,
                status: tenants.status,
                isAgency: tenants.isAgency,
                archivedAt: tenants.archivedAt,
                trialEndsAt: tenants.trialEndsAt,
                subscriptionEndsAt: tenants.subscriptionEndsAt,
                paidUntil: tenants.paidUntil,
                settings: tenants.settings,
            })
            .from(tenants)
            .where(eq(tenants.id, agencyId))
            .limit(1);
        if (!row || !row.isAgency) throw notAgency();
        return { ...row, settings: (row.settings ?? {}) as Record<string, unknown> };
    }

    private async clientRow(agencyId: number, clientId: number) {
        const [row] = await this.db
            .select({ id: tenants.id, slug: tenants.slug, name: tenants.name, agencyPausedAt: tenants.agencyPausedAt })
            .from(tenants)
            .where(and(eq(tenants.id, clientId), eq(tenants.agencyId, agencyId)))
            .limit(1);
        if (!row) throw notFound();
        return row;
    }

    /** El plan con el que nace un cliente: el elegido por el operador si existe, si no el de la agencia. */
    private async clientPlan(agencyPlan: string, chosen: string | null): Promise<string> {
        if (chosen && (await this.plans.exists(chosen))) return chosen;
        return agencyPlan;
    }
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'agency_client_not_found', message: 'Esa empresa no es cliente de tu agencia', data: { status: 404 } });
}

export function notAgency(): ForbiddenException {
    return new ForbiddenException({
        code: 'not_agency',
        message: 'Esta empresa no es una agencia. Pídele a la plataforma que la habilite como agencia.',
        data: { status: 403 },
    });
}
