import { BadRequestException, Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    AGENCY_CLIENTS_MARKER_KEY,
    agencyMonthsText,
    agencyPeriodText,
    jsonbKeyForField,
    readAgencyBilling,
    readAgencyClientPlan,
    zonedToday,
    type AgencyClientsList,
} from '@imagina-base/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { agencyCharges, agencyPayments, lists, memberships, paymentLinks, records, tenants, users } from '../db/schema';
import { registerBillingTick } from '../payments/billing-reminders.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsRepository } from '../records/records.repository';
import { REDIS } from '../redis/redis.module';
import { BlueprintService } from '../templates/blueprint.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { AgencyBillingService, agencyTimeZone } from './agency-billing.service';
import {
    AGENCY_CLIENT_ROLES,
    AGENCY_CLIENT_STATUS,
    PROTECTED_AGENCY_CLIENT_ROLES,
    agencyClientFieldIds,
    agencyClientsBlueprint,
    readAgencyClientsListRef,
    type AgencyClientRole,
    type AgencyClientsListRef,
} from './agency-clients-pack';

/** Dónde guarda la agencia su lista (`tenants.settings` de la AGENCIA). */
const SETTINGS_KEY = 'agency_clients_list';

/**
 * v0.1.452 (I3, ADR-S108) — La lista «Empresas cliente» en el espacio de la
 * AGENCIA: un registro por empresa cliente, con su estado, su plan, hasta
 * cuándo pagó y el link de pago pendiente. De sus registros cuelgan los
 * links del cobro en línea (`payment_links` exige una lista y un registro).
 *
 * El servicio la mantiene al día: cuando cambia un cliente (alta, nombre,
 * pausa, plan, pago, link) y una vez por hora (el estado cambia con los días:
 * «al día» → «por vencer» → «en gracia»). Sólo escribe lo que cambió, como el
 * sistema (`updated_by` = 0), y dispara las automatizaciones de la lista —
 * avisarle por WhatsApp a quien está por vencer es justo para lo que sirve.
 *
 * Es una lista COMÚN de la agencia: si la borra, la próxima vez que haga falta
 * se arma otra; si borra un registro, la próxima sincronización lo rearma.
 */
@Injectable()
export class AgencyClientsListService implements OnModuleInit {
    private readonly logger = new Logger(AgencyClientsListService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly billing: AgencyBillingService,
        private readonly recordsRepo: RecordsRepository,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly automations: AutomationDispatcher,
        @Optional() private readonly audit?: AuditService,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
        @Optional() private readonly moduleRef?: ModuleRef,
    ) {}

    onModuleInit(): void {
        this.billing.onClientChanged((agencyId, clientId) => (clientId === null ? this.syncAll(agencyId) : this.syncClient(agencyId, clientId)));
        // El estado cambia con los días: una vuelta por hora a las agencias con lista.
        registerBillingTick(() => this.tick());
    }

    // Las plantillas dependen de módulos que no conviene importar aquí: se resuelven al usarlas.
    private get blueprints(): BlueprintService {
        const svc = this.moduleRef?.get(BlueprintService, { strict: false });
        if (!svc) throw new Error('BlueprintService no disponible');
        return svc;
    }

    // ── la lista ─────────────────────────────────────────────────────────

    /** La lista de la agencia si existe y está viva (no en la papelera). */
    async listRef(agencyId: number): Promise<(AgencyClientsListRef & { name: string; slug: string }) | null> {
        const [agency] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, agencyId)).limit(1);
        const ref = readAgencyClientsListRef((agency?.settings as Record<string, unknown> | null)?.[SETTINGS_KEY]);
        if (!ref) return null;
        const [l] = await this.db
            .select({ id: lists.id, name: lists.name, slug: lists.slug })
            .from(lists)
            .where(and(eq(lists.tenantId, agencyId), eq(lists.id, ref.list_id), isNull(lists.deletedAt)))
            .limit(1);
        return l ? { ...ref, name: l.name, slug: l.slug } : null;
    }

    async listDto(agencyId: number): Promise<AgencyClientsList | null> {
        const ref = await this.listRef(agencyId);
        return ref ? { id: ref.list_id, name: ref.name, slug: ref.slug } : null;
    }

    /**
     * La lista de la agencia (la arma si no existe). `userId` = quien la pide;
     * sin persona (un aviso automático), la crea a nombre del primer
     * administrador de la agencia.
     */
    async ensure(agencyId: number, userId: number | null): Promise<AgencyClientsListRef & { name: string; slug: string }> {
        const existing = await this.listRef(agencyId);
        if (existing) return existing;
        const lockKey = `agclist:${agencyId}`;
        const got = this.redis ? await this.redis.set(lockKey, '1', 'EX', 60, 'NX').catch(() => 'OK') : 'OK';
        if (got !== 'OK') {
            // Otro pedido la está armando: esperarla un rato.
            for (let i = 0; i < 40; i++) {
                await new Promise((r) => setTimeout(r, 250));
                const ref = await this.listRef(agencyId);
                if (ref) return ref;
            }
            throw new BadRequestException({ code: 'agency_list_busy', message: 'La lista de empresas cliente se está armando: prueba en un momento.', data: { status: 400 } });
        }
        try {
            const again = await this.listRef(agencyId);
            if (again) return again;
            const actor = userId ?? (await this.firstAdmin(agencyId));
            if (!actor) throw new BadRequestException({ code: 'agency_no_admin', message: 'La agencia no tiene administradores.', data: { status: 400 } });
            const [agency] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, agencyId)).limit(1);
            const billing = readAgencyBilling((agency?.settings as Record<string, unknown> | null)?.agency_billing);
            const currency = billing.plans.find((p) => p.active)?.currency ?? billing.plans[0]?.currency ?? 'COP';
            const res = await this.blueprints.materialize(agencyId, actor, agencyClientsBlueprint({ currency }), { includeRecords: false, groupId: null });
            const list = res.lists[0];
            if (!list) throw new Error('La lista de empresas cliente no se creó');
            const ref: AgencyClientsListRef = { list_id: list.id, fields: agencyClientFieldIds(res.fieldIds) };
            await this.db.transaction(async (tx) => {
                const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, agencyId)).for('update').limit(1);
                const settings = { ...((row?.settings as Record<string, unknown> | null) ?? {}) };
                settings[SETTINGS_KEY] = ref;
                await tx.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, agencyId));
                await this.writeMarker(tx, agencyId, ref);
            });
            await this.audit?.log({
                tenantId: agencyId,
                userId: userId,
                action: 'agency.clients_list',
                targetType: 'list',
                targetId: list.id,
                targetLabel: list.name,
                meta: { list_id: list.id },
            });
            await this.syncAll(agencyId);
            return { ...ref, name: list.name, slug: list.slug };
        } finally {
            await this.redis?.del(lockKey).catch(() => undefined);
        }
    }

    /** La marca que deja con candado las columnas que escribe la agencia. */
    private async writeMarker(tx: Tx, agencyId: number, ref: AgencyClientsListRef): Promise<void> {
        const fieldIds = PROTECTED_AGENCY_CLIENT_ROLES.map((r) => ref.fields[r]).filter((x): x is number => typeof x === 'number');
        const marker = { agency_id: agencyId, field_ids: fieldIds };
        await tx
            .update(lists)
            .set({ settings: sql`jsonb_set(coalesce(${lists.settings}, '{}'::jsonb), ${`{${AGENCY_CLIENTS_MARKER_KEY}}`}::text[], ${JSON.stringify(marker)}::jsonb)` })
            .where(and(eq(lists.tenantId, agencyId), eq(lists.id, ref.list_id)));
    }

    // ── los registros ────────────────────────────────────────────────────

    /** El registro de un cliente en la lista (lo arma si falta). `null` si la agencia no tiene lista. */
    async recordFor(agencyId: number, clientId: number): Promise<{ listId: number; recordId: number; email: string | null } | null> {
        const ref = await this.listRef(agencyId);
        if (!ref) return null;
        const synced = await this.syncOne(agencyId, clientId, ref);
        if (!synced) return null;
        const emailField = ref.fields.email;
        const [row] = await this.db.select({ data: records.data }).from(records).where(eq(records.id, synced)).limit(1);
        const email = emailField ? String((row?.data as Record<string, unknown> | null)?.[jsonbKeyForField(emailField)] ?? '').trim() || null : null;
        return { listId: ref.list_id, recordId: synced, email };
    }

    async syncClient(agencyId: number, clientId: number): Promise<void> {
        const ref = await this.listRef(agencyId);
        if (!ref) return;
        await this.syncOne(agencyId, clientId, ref).catch((err: unknown) => this.logger.warn(`Agencia ${agencyId}: no se pudo actualizar a la empresa ${clientId} en su lista: ${String(err)}`));
    }

    async syncAll(agencyId: number): Promise<number> {
        const ref = await this.listRef(agencyId);
        if (!ref) return 0;
        const ids = await this.db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.agencyId, agencyId), isNull(tenants.archivedAt)));
        let n = 0;
        for (const { id } of ids) {
            const ok = await this.syncOne(agencyId, id, ref).catch((err: unknown) => {
                this.logger.warn(`Agencia ${agencyId}: no se pudo actualizar a la empresa ${id} en su lista: ${String(err)}`);
                return null;
            });
            if (ok) n++;
        }
        return n;
    }

    /** Una vuelta por hora: las agencias con lista. */
    async tick(): Promise<number> {
        const rows = await this.db
            .select({ id: tenants.id })
            .from(tenants)
            .where(and(eq(tenants.isAgency, true), isNull(tenants.archivedAt), sql`${tenants.settings} ? ${SETTINGS_KEY}`));
        let n = 0;
        for (const r of rows) n += await this.syncAll(r.id).catch(() => 0);
        return n;
    }

    /**
     * Escribe el registro de un cliente con lo que sabe la agencia. Devuelve el
     * id del registro. Sólo toca las columnas de la agencia (más el correo de
     * cobro la primera vez, si estaba vacío).
     */
    private async syncOne(agencyId: number, clientId: number, ref: AgencyClientsListRef): Promise<number | null> {
        const [client] = await this.db
            .select({
                id: tenants.id,
                name: tenants.name,
                agencyId: tenants.agencyId,
                archivedAt: tenants.archivedAt,
                settings: tenants.settings,
                agencyPaidUntil: tenants.agencyPaidUntil,
                agencyPausedAt: tenants.agencyPausedAt,
            })
            .from(tenants)
            .where(and(eq(tenants.id, clientId), eq(tenants.agencyId, agencyId)))
            .limit(1);
        if (!client || client.archivedAt) return null;
        const [agency] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, agencyId)).limit(1);
        const aSettings = (agency?.settings ?? {}) as Record<string, unknown>;
        const settings = readAgencyBilling(aSettings.agency_billing);
        const tz = agencyTimeZone(aSettings);
        const billing = this.billing.clientBilling(settings, { settings: client.settings as Record<string, unknown> | null, agencyPaidUntil: client.agencyPaidUntil });
        const plan = readAgencyClientPlan((client.settings as Record<string, unknown> | null)?.agency_plan);
        const status = client.agencyPausedAt ? AGENCY_CLIENT_STATUS.paused : AGENCY_CLIENT_STATUS[billing.state];
        const [lastPay] = await this.db
            .select({ paidOn: agencyPayments.paidOn })
            .from(agencyPayments)
            .where(and(eq(agencyPayments.tenantId, agencyId), eq(agencyPayments.clientId, clientId), isNull(agencyPayments.undoneAt)))
            .orderBy(desc(agencyPayments.id))
            .limit(1);
        const payLink = await this.pendingLinkUrl(agencyId, clientId);

        const values: Partial<Record<AgencyClientRole, unknown>> = {
            name: client.name,
            status: status.value,
            plan: plan ? `${plan.name} · ${agencyPeriodText(plan.period_months)}` : null,
            price: plan ? plan.price : null,
            paid_until: client.agencyPaidUntil ? zonedToday(tz, client.agencyPaidUntil) : null,
            last_payment: lastPay?.paidOn ?? null,
            pay_link: payLink,
        };

        const out = await this.tenantDb.withTenant(agencyId, async (tx) => {
            // Una sincronización a la vez por cliente (dos a la vez armarían dos registros).
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agclient:${clientId}`}, 0))`);
            const [fresh] = await tx.select({ recordId: tenants.agencyRecordId }).from(tenants).where(eq(tenants.id, clientId)).limit(1);
            const recordId = fresh?.recordId ?? null;
            const current = recordId ? await this.recordsRepo.findByIdForUpdate(tx, agencyId, ref.list_id, recordId) : null;
            const before = current ? { ...(current.data as Record<string, unknown>) } : {};
            const next: Record<string, unknown> = { ...before };
            for (const role of AGENCY_CLIENT_ROLES) {
                const id = ref.fields[role];
                if (!id || !(role in values)) continue;
                const key = jsonbKeyForField(id);
                const v = values[role];
                if (v === null || v === undefined || v === '') delete next[key];
                else next[key] = v;
            }
            if (!current) {
                // El correo de cobro: el del primer administrador del cliente (la agencia lo cambia si quiere).
                const emailField = ref.fields.email;
                if (emailField) {
                    const email = await this.firstAdminEmail(clientId);
                    if (email) next[jsonbKeyForField(emailField)] = email;
                }
                const inserted = await this.recordsRepo.insert(tx, { tenantId: agencyId, listId: ref.list_id, data: next, createdBy: 0 });
                await this.activity.logInTx(tx, { tenantId: agencyId, listId: ref.list_id, recordId: inserted.id, userId: null, action: 'record_created', diff: computeDiff({}, next) });
                await tx.update(tenants).set({ agencyRecordId: inserted.id }).where(eq(tenants.id, clientId));
                return { recordId: inserted.id, kind: 'created' as const, before: {}, after: next };
            }
            const changed = JSON.stringify(sortKeys(before)) !== JSON.stringify(sortKeys(next));
            if (!changed) return { recordId: current.id, kind: 'same' as const, before, after: next };
            const updated = await this.recordsRepo.updateData(tx, agencyId, ref.list_id, current.id, next, 0);
            if (!updated) return null;
            await this.activity.logInTx(tx, { tenantId: agencyId, listId: ref.list_id, recordId: current.id, userId: null, action: 'record_updated', diff: computeDiff(before, next) });
            return { recordId: current.id, kind: 'updated' as const, before, after: next };
        });
        if (!out) {
            // El registro ya no existe (se borró): la próxima vuelta arma otro.
            await this.db.update(tenants).set({ agencyRecordId: null }).where(eq(tenants.id, clientId));
            return null;
        }
        if (out.kind !== 'same') {
            this.realtime.records(agencyId, ref.list_id);
            this.automations.dispatch({
                tenantId: agencyId,
                listId: ref.list_id,
                recordId: out.recordId,
                trigger: out.kind === 'created' ? 'record_created' : 'record_updated',
                after: out.after,
                ...(out.kind === 'updated' ? { before: out.before } : {}),
            });
        }
        return out.recordId;
    }

    /** El link de pago pendiente del cliente (el último), o null. */
    private async pendingLinkUrl(agencyId: number, clientId: number): Promise<string | null> {
        const [row] = await this.db
            .select({ url: paymentLinks.url, expiresAt: paymentLinks.expiresAt })
            .from(agencyCharges)
            .innerJoin(paymentLinks, eq(paymentLinks.id, agencyCharges.linkId))
            .where(
                and(
                    eq(agencyCharges.tenantId, agencyId),
                    eq(agencyCharges.clientId, clientId),
                    eq(agencyCharges.status, 'pending'),
                    eq(paymentLinks.status, 'pending'),
                ),
            )
            .orderBy(desc(agencyCharges.id))
            .limit(1);
        if (!row) return null;
        if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
        return row.url;
    }

    private async firstAdmin(tenantId: number): Promise<number | null> {
        const [row] = await this.db
            .select({ id: users.id })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'admin'), eq(memberships.viaAgency, false), isNull(users.disabledAt)))
            .orderBy(memberships.userId)
            .limit(1);
        return row?.id ?? null;
    }

    /** El correo del primer administrador PROPIO de una empresa. */
    async firstAdminEmail(tenantId: number): Promise<string | null> {
        const [row] = await this.db
            .select({ email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'admin'), eq(memberships.viaAgency, false), isNull(users.disabledAt)))
            .orderBy(memberships.userId)
            .limit(1);
        return row?.email ?? null;
    }

    /** Los ids de los clientes que tienen registro en la lista (para las pruebas). */
    async recordIds(agencyId: number): Promise<Map<number, number>> {
        const rows = await this.db
            .select({ id: tenants.id, recordId: tenants.agencyRecordId })
            .from(tenants)
            .where(and(eq(tenants.agencyId, agencyId), sql`${tenants.agencyRecordId} IS NOT NULL`));
        return new Map(rows.map((r) => [r.id, r.recordId!]));
    }
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}

/** El texto del período cobrado («Plan Pro · 3 meses · Acme»). */
export function agencyChargeTitle(planName: string, months: number, clientName: string): string {
    return `${planName} · ${agencyMonthsText(months)} · ${clientName}`.slice(0, 200);
}

