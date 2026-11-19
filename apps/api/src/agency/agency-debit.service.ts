import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, type OnModuleInit } from '@nestjs/common';
import {
    COLLECTION_PROVIDER_LABEL,
    agencyDebitCharges,
    agencyDebitProviderOk,
    agencyPeriodText,
    collectionCurrencyError,
    isCollectionProvider,
    isSubscriptionProvider,
    readAgencyBilling,
    readAgencyClientPlan,
    zonedToday,
    type AgencyClientPlan,
    type AgencyDebit,
    type AgencyPaymentMethod,
    type MyAgencyDebit,
    type SubscriptionStatus,
} from '@imagina-base/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { agencyPayments, subscriptionCharges, subscriptionPlans, subscriptions, tenants, type SubscriptionRowDb } from '../db/schema';
import { MailService } from '../mail/mail.service';
import { registerBillingTick } from '../payments/billing-reminders.service';
import { SubscriptionError, SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AgencyBillingService, agencyTimeZone } from './agency-billing.service';
import { AgencyChargesService, formatAmount, simpleEmail } from './agency-charges.service';
import { AgencyClientsListService } from './agency-clients-list.service';

/** Los estados en que la suscripción del débito sigue viva (uno por cliente). */
const LIVE: SubscriptionStatus[] = ['pending', 'active', 'retrying', 'past_due', 'paused'];
/** El débito cobra unos días antes del vencimiento (el pago corre el «pagado hasta» desde donde termina: no se pierde nada). */
const CHARGE_DAYS_BEFORE = 2;
const DAY = 24 * 3600_000;

/**
 * v0.1.453 (I3, ADR-S108) — Débito automático de los clientes de una agencia.
 *
 * El cliente autoriza su tarjeta UNA vez en la cuenta de Mercado Pago o
 * PayPal de la AGENCIA (ADR-S96) y cada período se cobra solo:
 *
 * - La suscripción cuelga del registro del cliente en «Empresas cliente» de
 *   la agencia, con un plan de suscripción que maneja la agencia (uno por
 *   plan suyo, `provider_refs.agency_plan_id`): no se vende ni se edita en
 *   otro lado.
 * - Cobra unos días antes de que venza lo pagado y cada cuota aprobada se
 *   registra sola como pago de la agencia, UNA vez (`agency_payments.
 *   subscription_charge_id` es único): el «pagado hasta» corre un período.
 * - Si el plan de la empresa cambia de período o de moneda (o se le quita),
 *   el débito se cancela; si sólo cambia el valor, se le cambia el valor.
 *   Si la empresa deja la agencia, también se cancela.
 */
@Injectable()
export class AgencyDebitService implements OnModuleInit {
    private readonly logger = new Logger(AgencyDebitService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        private readonly billing: AgencyBillingService,
        private readonly clientsList: AgencyClientsListService,
        private readonly charges: AgencyChargesService,
        private readonly subscriptions: SubscriptionsService,
        private readonly mail: MailService,
        @Optional() private readonly audit?: AuditService,
    ) {}

    onModuleInit(): void {
        // Cada cuota (y la autorización) de una suscripción: si es un débito de agencia, se registra el pago.
        this.subscriptions.registerEventSink((tenantId, sub) => this.onSubscriptionEvent(tenantId, sub));
        // Cambió el plan, el valor o la agencia de un cliente: el débito se ajusta.
        this.billing.onClientChanged((agencyId, clientId) => (clientId === null ? this.reconcileAgency(agencyId) : this.reconcileClient(agencyId, clientId)));
        // Una vuelta por hora: cuotas que no llegaron por aviso y clientes que dejaron la agencia.
        registerBillingTick(() => this.tick());
    }

    // ── ver ──────────────────────────────────────────────────────────────

    /** El débito vivo de un cliente (o null). Con `refresh`, le pregunta al proveedor si sigue por autorizar. */
    async current(agencyId: number, clientId: number, opts: { refresh?: boolean } = {}): Promise<AgencyDebit | null> {
        let sub = await this.liveSub(agencyId, clientId);
        if (sub && opts.refresh && sub.status === 'pending') {
            await this.subscriptions.publicStatus(sub.reference, { returning: true }).catch(() => null);
            await this.registerCharges(agencyId, clientId, sub.id).catch(() => undefined);
            sub = await this.liveSub(agencyId, clientId);
        }
        return sub ? debitDto(sub) : null;
    }

    /** Lo que ve el cliente en su app: si puede activar el débito y el que tiene. */
    async mineFor(clientTenantId: number, opts: { refresh?: boolean } = {}): Promise<MyAgencyDebit> {
        const [client] = await this.db
            .select({ agencyId: tenants.agencyId, settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, clientTenantId))
            .limit(1);
        if (!client?.agencyId) return { available: false, current: null };
        const current = await this.current(client.agencyId, clientTenantId, opts).catch(() => null);
        const plan = readAgencyClientPlan((client.settings as Record<string, unknown> | null)?.agency_plan);
        const available = plan ? (await this.offerFor(client.agencyId, plan)) !== null : false;
        return { available, current };
    }

    /** El débito ya cobra solo: los avisos no mandan links (cobraría dos veces). */
    async isCharging(agencyId: number, clientId: number): Promise<boolean> {
        const sub = await this.liveSub(agencyId, clientId);
        return sub ? agencyDebitCharges({ status: sub.status as SubscriptionStatus }) : false;
    }

    /** El estado del débito de varios clientes (para la lista de la consola). */
    async statusesFor(agencyId: number, recordIds: Map<number, number>): Promise<Map<number, SubscriptionStatus>> {
        const out = new Map<number, SubscriptionStatus>();
        const ids = [...recordIds.values()];
        if (ids.length === 0) return out;
        const rows = await this.db
            .select({ recordId: subscriptions.recordId, status: subscriptions.status, id: subscriptions.id })
            .from(subscriptions)
            .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
            .where(
                and(
                    eq(subscriptions.tenantId, agencyId),
                    inArray(subscriptions.recordId, ids),
                    inArray(subscriptions.status, LIVE),
                    sql`${subscriptionPlans.providerRefs} ? 'agency_plan_id'`,
                ),
            )
            .orderBy(desc(subscriptions.id));
        const byRecord = new Map<number, SubscriptionStatus>();
        for (const r of rows) if (r.recordId !== null && !byRecord.has(r.recordId)) byRecord.set(r.recordId, r.status as SubscriptionStatus);
        for (const [clientId, recordId] of recordIds) {
            const st = byRecord.get(recordId);
            if (st) out.set(clientId, st);
        }
        return out;
    }

    // ── activar ──────────────────────────────────────────────────────────

    /**
     * Arma el débito de un cliente: el link para que autorice su tarjeta. Si
     * ya había uno por autorizar, lo reemplaza (el link viejo deja de servir);
     * si ya hay uno activo, 409.
     */
    async start(
        agencyId: number,
        clientId: number,
        input: { email?: string | null; sendEmail?: boolean; via: 'agency' | 'client'; userId: number | null },
    ): Promise<AgencyDebit> {
        const agency = await this.billing.agencyRow(agencyId);
        const settings = readAgencyBilling(agency.settings.agency_billing);
        const tz = agencyTimeZone(agency.settings);
        const [client] = await this.db
            .select({ id: tenants.id, name: tenants.name, settings: tenants.settings, agencyPaidUntil: tenants.agencyPaidUntil })
            .from(tenants)
            .where(and(eq(tenants.id, clientId), eq(tenants.agencyId, agencyId), isNull(tenants.archivedAt)))
            .limit(1);
        if (!client) throw notFound();
        const plan = readAgencyClientPlan((client.settings as Record<string, unknown> | null)?.agency_plan);
        if (!plan) throw bad('agency_no_plan', 'Primero asígnale un plan a esta empresa.');
        if (!settings.online.debit || settings.online.connection_id === null) {
            throw bad('agency_debit_off', 'Tu agencia no ofrece débito automático: actívalo en «Planes para tus clientes» → «Cobro en línea».');
        }
        const conn = (await this.billing.collectionConnections(agencyId)).find((c) => c.id === settings.online.connection_id);
        if (!conn || !isCollectionProvider(conn.provider)) {
            throw bad('agency_online_connection', 'La cuenta de cobro elegida ya no existe o no es del equipo de la agencia.');
        }
        if (!agencyDebitProviderOk(conn.provider)) {
            throw bad('agency_debit_provider', `El débito automático funciona con Mercado Pago o PayPal: tu cuenta de cobro es de ${COLLECTION_PROVIDER_LABEL[conn.provider]}.`);
        }
        const currencyErr = collectionCurrencyError(conn.provider, plan.currency);
        if (currencyErr) throw bad('agency_online_currency', `El plan «${plan.name}» cobra en ${plan.currency}: ${currencyErr}`);

        const existing = await this.liveSub(agencyId, clientId);
        if (existing && existing.status !== 'pending') {
            throw new ConflictException({
                code: 'agency_debit_exists',
                message: 'Esta empresa ya tiene el débito automático activo. Cancélalo antes de armar otro.',
                data: { status: 409 },
            });
        }
        await this.clientsList.ensure(agencyId, input.userId).catch((err: unknown) => {
            throw err instanceof BadRequestException ? err : bad('agency_list_failed', 'No se pudo armar la lista de empresas cliente de la agencia.');
        });
        const rec = await this.clientsList.recordFor(agencyId, clientId);
        if (!rec) throw bad('agency_list_failed', 'No se pudo armar el registro de la empresa en la lista de la agencia.');
        const email = (input.email ?? rec.email ?? (await this.clientsList.firstAdminEmail(clientId)) ?? '').trim().toLowerCase();
        if (!email) throw bad('agency_debit_email', 'Escribe el correo de la cuenta de Mercado Pago o PayPal con la que se va a pagar.');

        const planRow = await this.managedPlan(agencyId, conn.id, conn.provider, plan, settings.grace_days, input.userId);
        // Cobra unos días antes de que venza lo pagado; si ya venció (o falta poco), al autorizar.
        const paid = client.agencyPaidUntil;
        const firstCharge = paid ? new Date(paid.getTime() - CHARGE_DAYS_BEFORE * DAY) : null;
        const startDate = firstCharge && firstCharge.getTime() > Date.now() + DAY ? zonedToday(tz, firstCharge) : null;
        const base = this.env.APP_BASE_URL.replace(/\/+$/, '');
        let sub;
        try {
            sub = await this.subscriptions.createForAgency(agencyId, {
                planId: planRow,
                listId: rec.listId,
                recordId: rec.recordId,
                payerEmail: email,
                amount: plan.price,
                startDate,
                title: `${plan.name} · ${client.name}`.slice(0, 200),
                userId: input.userId,
                backUrlFor: (reference) => `${base}/api/v1/public/agency-pay/debit/${encodeURIComponent(reference)}`,
            });
        } catch (err) {
            if (err instanceof SubscriptionError) throw bad('agency_debit_failed', err.message);
            throw err;
        }
        const entry = {
            userId: input.userId,
            action: 'agency.debit_start' as const,
            targetType: 'tenant',
            targetId: clientId,
            targetLabel: client.name,
            meta: { agency_id: agencyId, subscription_id: sub.id, amount: plan.price, currency: plan.currency, months: plan.period_months, provider: conn.provider, via: input.via },
        };
        await Promise.all([this.audit?.log({ tenantId: agencyId, ...entry }), this.audit?.log({ tenantId: clientId, ...entry })]);
        this.billing.notifyClientChanged(agencyId, clientId);
        const [row] = await this.db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)).limit(1);
        if (!row) throw new Error('La suscripción del débito no aparece');
        const dto = debitDto(row);
        if (input.sendEmail && dto.url) {
            await this.sendStartEmail(agencyId, clientId, plan, dto).catch((err: unknown) =>
                this.logger.warn(`Agencia ${agencyId}: no salió el link del débito a la empresa ${clientId}: ${String(err)}`),
            );
        }
        return dto;
    }

    /** Cancelar el débito (la agencia o el cliente). Lo ya pagado queda; deja de cobrar. */
    async cancel(agencyId: number, clientId: number, input: { userId: number | null; by: 'agency' | 'client' | 'system'; reason?: string }): Promise<void> {
        const sub = await this.liveSub(agencyId, clientId);
        if (!sub) return;
        const reason = input.reason ?? (input.by === 'client' ? 'Lo canceló la empresa desde su app.' : 'Lo canceló la agencia.');
        try {
            await this.subscriptions.patchInMp(agencyId, sub, { kind: 'status', status: 'cancelled' }, reason);
        } catch (err) {
            if (err instanceof SubscriptionError) throw bad('agency_debit_failed', err.message);
            throw err;
        }
        await this.subscriptions.sync(agencyId, sub.id).catch(() => undefined);
        const [client] = await this.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, clientId)).limit(1);
        const entry = {
            userId: input.userId,
            action: 'agency.debit_cancel' as const,
            targetType: 'tenant',
            targetId: clientId,
            targetLabel: client?.name ?? '',
            meta: { agency_id: agencyId, subscription_id: sub.id, by: input.by, reason },
        };
        await Promise.all([this.audit?.log({ tenantId: agencyId, ...entry }), this.audit?.log({ tenantId: clientId, ...entry })]);
        if (input.by !== 'system') this.billing.notifyClientChanged(agencyId, clientId);
    }

    /** El cliente lo activa desde su app (con su correo de Mercado Pago o PayPal). */
    async startAsClient(clientTenantId: number, userId: number, email: string): Promise<AgencyDebit> {
        const agencyId = await this.agencyOf(clientTenantId);
        const mine = await this.mineFor(clientTenantId);
        if (!mine.available) {
            throw bad('agency_debit_off', 'Tu agencia no ofrece débito automático: escríbele para pagar.');
        }
        return this.start(agencyId, clientTenantId, { email, sendEmail: false, via: 'client', userId });
    }

    async cancelAsClient(clientTenantId: number, userId: number): Promise<void> {
        const agencyId = await this.agencyOf(clientTenantId);
        await this.cancel(agencyId, clientTenantId, { userId, by: 'client' });
    }

    /** La vuelta de autorizar la tarjeta: pregunta al proveedor y lleva a la persona a su app. */
    async returnFromAuthorize(reference: string): Promise<string> {
        const fallback = this.env.APP_BASE_URL.replace(/\/+$/, '');
        if (!/^ibs_[A-Za-z0-9_-]{8,40}$/.test(reference)) return fallback;
        const [sub] = await this.db
            .select({ id: subscriptions.id, tenantId: subscriptions.tenantId, recordId: subscriptions.recordId })
            .from(subscriptions)
            .where(eq(subscriptions.reference, reference))
            .limit(1);
        if (!sub || sub.recordId === null) return fallback;
        const [client] = await this.db
            .select({ id: tenants.id })
            .from(tenants)
            .where(and(eq(tenants.agencyId, sub.tenantId), eq(tenants.agencyRecordId, sub.recordId)))
            .limit(1);
        if (!client) return fallback;
        await this.subscriptions.publicStatus(reference, { returning: true }).catch(() => null);
        await this.registerCharges(sub.tenantId, client.id, sub.id).catch(() => undefined);
        const brand = await this.charges.brand(client.id);
        return `${brand.base}/#/settings?s=suscripcion&debito=1`;
    }

    // ── las cuotas ───────────────────────────────────────────────────────

    private async onSubscriptionEvent(tenantId: number, sub: { id: number; recordId: number | null }): Promise<void> {
        if (sub.recordId === null) return;
        const [client] = await this.db
            .select({ id: tenants.id })
            .from(tenants)
            .where(and(eq(tenants.agencyId, tenantId), eq(tenants.agencyRecordId, sub.recordId)))
            .limit(1);
        if (!client) return;
        await this.registerCharges(tenantId, client.id, sub.id);
        this.billing.notifyClientChanged(tenantId, client.id);
    }

    /**
     * Registra como pago de la agencia cada cuota aprobada del débito que
     * todavía no está registrada (una sola vez: el cliente queda bloqueado y
     * el vínculo a la cuota es único). Devuelve cuántas registró.
     */
    async registerCharges(agencyId: number, clientId: number, subscriptionId: number): Promise<number> {
        const [sub] = await this.db
            .select({ s: subscriptions, refs: subscriptionPlans.providerRefs })
            .from(subscriptions)
            .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
            .where(and(eq(subscriptions.tenantId, agencyId), eq(subscriptions.id, subscriptionId)))
            .limit(1);
        if (!sub || !isManagedRefs(sub.refs) || sub.s.frequencyType !== 'months') return 0;
        const pending = await this.db
            .select({ c: subscriptionCharges })
            .from(subscriptionCharges)
            .leftJoin(agencyPayments, eq(agencyPayments.subscriptionChargeId, subscriptionCharges.id))
            .where(and(eq(subscriptionCharges.subscriptionId, subscriptionId), eq(subscriptionCharges.status, 'approved'), isNull(agencyPayments.id)))
            .orderBy(subscriptionCharges.id);
        if (pending.length === 0) return 0;
        const agency = await this.billing.agencyRow(agencyId);
        const tz = agencyTimeZone(agency.settings);
        const provider = sub.s.provider;
        const method: AgencyPaymentMethod = provider === 'paypal' ? 'paypal' : 'mercadopago';
        let n = 0;
        for (const { c } of pending) {
            const paidAt = c.paidAt ?? c.createdAt;
            const done = await this.db
                .transaction(async (tx) => {
                    await this.billing.lockClient(tx, agencyId, clientId);
                    const [already] = await tx.select({ id: agencyPayments.id }).from(agencyPayments).where(eq(agencyPayments.subscriptionChargeId, c.id)).limit(1);
                    if (already) return null;
                    return this.billing.applyPaymentInTx(tx, agencyId, clientId, {
                        months: sub.s.frequency,
                        amount: Number(c.amount),
                        method,
                        note: `Débito automático con ${COLLECTION_PROVIDER_LABEL[method as 'mercadopago' | 'paypal']}`,
                        paidOn: zonedToday(tz, paidAt),
                        userId: null,
                        tz,
                        subscriptionChargeId: c.id,
                    });
                })
                .catch((err: unknown) => {
                    this.logger.warn(`Agencia ${agencyId}: la cuota ${c.id} del débito de la empresa ${clientId} no se pudo registrar: ${String(err)}`);
                    return null;
                });
            if (!done) continue;
            n++;
            await this.billing.logPayment(agencyId, clientId, null, done, { method, via: 'debit', subscription_id: subscriptionId, subscription_charge_id: c.id });
            await this.charges
                .sendPaidEmails(agencyId, clientId, { amount: done.amount, currency: done.currency, months: done.months, to: done.to, method, debit: true })
                .catch((err: unknown) => this.logger.warn(`Agencia ${agencyId}: no salieron los correos del pago por débito: ${String(err)}`));
        }
        return n;
    }

    // ── mantener al día ──────────────────────────────────────────────────

    /**
     * Ajusta el débito vivo de un cliente a su plan: otro período, otra moneda
     * o sin plan → se cancela; otro valor → se le cambia el valor (si todavía
     * no se autorizó, se cancela: hay que armar el link de nuevo).
     */
    async reconcileClient(agencyId: number, clientId: number): Promise<void> {
        const sub = await this.liveSub(agencyId, clientId).catch(() => null);
        if (!sub) return;
        const [client] = await this.db
            .select({ settings: tenants.settings, archivedAt: tenants.archivedAt })
            .from(tenants)
            .where(and(eq(tenants.id, clientId), eq(tenants.agencyId, agencyId)))
            .limit(1);
        const plan = client && !client.archivedAt ? readAgencyClientPlan((client.settings as Record<string, unknown> | null)?.agency_plan) : null;
        const cancel = (reason: string) => this.cancel(agencyId, clientId, { userId: null, by: 'system', reason }).catch((err: unknown) => this.logger.warn(`Agencia ${agencyId}: no se canceló el débito de ${clientId}: ${String(err)}`));
        if (!plan) return void (await cancel('La empresa ya no tiene un plan con la agencia.'));
        if (plan.period_months !== sub.frequency || plan.currency !== sub.currency) {
            return void (await cancel('Cambió el plan de la empresa (otro período u otra moneda): hay que activar el débito de nuevo.'));
        }
        if (Math.abs(plan.price - Number(sub.amount)) < 0.005) return;
        if (sub.status === 'pending') return void (await cancel('Cambió el valor del plan antes de autorizar: hay que activar el débito de nuevo.'));
        try {
            await this.subscriptions.patchInMp(agencyId, sub, { kind: 'amount', amount: plan.price, currency: sub.currency }, null);
            await this.subscriptions.sync(agencyId, sub.id);
        } catch (err) {
            this.logger.warn(`Agencia ${agencyId}: no se cambió el valor del débito de ${clientId}: ${String(err)}`);
        }
    }

    private async reconcileAgency(agencyId: number): Promise<void> {
        const rows = await this.db
            .select({ id: tenants.id })
            .from(tenants)
            .where(and(eq(tenants.agencyId, agencyId), sql`${tenants.agencyRecordId} IS NOT NULL`));
        for (const r of rows) await this.reconcileClient(agencyId, r.id);
    }

    /**
     * La vuelta horaria: cada débito vivo de una agencia. Registra cuotas que
     * no llegaron por aviso, ajusta el valor y cancela el de una empresa que
     * dejó la agencia (o se archivó).
     */
    async tick(): Promise<number> {
        const rows = await this.db
            .select({ id: subscriptions.id, tenantId: subscriptions.tenantId, recordId: subscriptions.recordId })
            .from(subscriptions)
            .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
            .where(and(inArray(subscriptions.status, LIVE), sql`${subscriptionPlans.providerRefs} ? 'agency_plan_id'`))
            .limit(2000);
        let n = 0;
        for (const r of rows) {
            if (r.recordId === null) continue;
            const [client] = await this.db
                .select({ id: tenants.id, archivedAt: tenants.archivedAt })
                .from(tenants)
                .where(and(eq(tenants.agencyId, r.tenantId), eq(tenants.agencyRecordId, r.recordId)))
                .limit(1);
            if (!client || client.archivedAt) {
                // La empresa dejó la agencia (o se archivó): el débito no sigue cobrando.
                const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.id, r.id)).limit(1);
                if (sub) {
                    await this.subscriptions
                        .patchInMp(r.tenantId, sub, { kind: 'status', status: 'cancelled' }, 'La empresa dejó la agencia.')
                        .then(() => this.subscriptions.sync(r.tenantId, r.id))
                        .catch((err: unknown) => this.logger.warn(`Débito ${r.id}: no se canceló: ${String(err)}`));
                    n++;
                }
                continue;
            }
            n += await this.registerCharges(r.tenantId, client.id, r.id).catch(() => 0);
            await this.reconcileClient(r.tenantId, client.id);
        }
        return n;
    }

    // ── internos ─────────────────────────────────────────────────────────

    /** La cuenta con la que la agencia ofrecería el débito a un cliente con este plan (o null). */
    private async offerFor(agencyId: number, plan: AgencyClientPlan): Promise<{ id: number; provider: string } | null> {
        const agency = await this.billing.agencyRow(agencyId).catch(() => null);
        if (!agency) return null;
        const settings = readAgencyBilling(agency.settings.agency_billing);
        if (!settings.online.debit || settings.online.connection_id === null) return null;
        const conn = (await this.billing.collectionConnections(agencyId)).find((c) => c.id === settings.online.connection_id);
        if (!conn || !isSubscriptionProvider(conn.provider) || collectionCurrencyError(conn.provider, plan.currency)) return null;
        return conn;
    }

    private async agencyOf(clientTenantId: number): Promise<number> {
        const [row] = await this.db.select({ agencyId: tenants.agencyId }).from(tenants).where(eq(tenants.id, clientTenantId)).limit(1);
        if (!row?.agencyId) {
            throw new BadRequestException({ code: 'not_agency_client', message: 'Esta empresa no la administra una agencia.', data: { status: 400 } });
        }
        return row.agencyId;
    }

    /** La suscripción viva del débito de un cliente (la más reciente), o null. */
    private async liveSub(agencyId: number, clientId: number): Promise<SubscriptionRowDb | null> {
        const [client] = await this.db
            .select({ recordId: tenants.agencyRecordId })
            .from(tenants)
            .where(and(eq(tenants.id, clientId), eq(tenants.agencyId, agencyId)))
            .limit(1);
        if (!client?.recordId) return null;
        const [row] = await this.db
            .select({ s: subscriptions })
            .from(subscriptions)
            .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
            .where(
                and(
                    eq(subscriptions.tenantId, agencyId),
                    eq(subscriptions.recordId, client.recordId),
                    inArray(subscriptions.status, LIVE),
                    sql`${subscriptionPlans.providerRefs} ? 'agency_plan_id'`,
                ),
            )
            .orderBy(desc(subscriptions.id))
            .limit(1);
        return row?.s ?? null;
    }

    /**
     * El plan de suscripción que maneja la agencia para uno de sus planes
     * (uno por plan y cuenta). Se crea la primera vez y se pone al día con el
     * valor, la moneda y el período: lo que ya se cobra no cambia (cada
     * suscripción guarda su copia).
     */
    private async managedPlan(agencyId: number, connectionId: number, provider: string, plan: AgencyClientPlan, graceDays: number, userId: number | null): Promise<number> {
        return this.db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agdebitplan:${agencyId}:${connectionId}:${plan.plan_id}`}, 0))`);
            const [row] = await tx
                .select()
                .from(subscriptionPlans)
                .where(
                    and(
                        eq(subscriptionPlans.tenantId, agencyId),
                        eq(subscriptionPlans.connectionId, connectionId),
                        sql`${subscriptionPlans.providerRefs}->>'agency_plan_id' = ${plan.plan_id}`,
                    ),
                )
                .orderBy(desc(subscriptionPlans.id))
                .limit(1);
            const want = {
                name: `${plan.name} (${agencyPeriodText(plan.period_months)})`.slice(0, 120),
                amount: plan.price,
                currency: plan.currency,
                frequency: plan.period_months,
                graceDays: Math.max(0, graceDays),
            };
            if (row) {
                const same =
                    row.name === want.name &&
                    Number(row.amount) === want.amount &&
                    row.currency === want.currency &&
                    row.frequency === want.frequency &&
                    row.frequencyType === 'months' &&
                    row.graceDays === want.graceDays &&
                    row.active &&
                    row.provider === provider;
                if (!same) {
                    await tx
                        .update(subscriptionPlans)
                        .set({ ...want, frequencyType: 'months', provider, active: true, updatedAt: new Date() })
                        .where(eq(subscriptionPlans.id, row.id));
                }
                return row.id;
            }
            const [created] = await tx
                .insert(subscriptionPlans)
                .values({
                    tenantId: agencyId,
                    connectionId,
                    provider,
                    ...want,
                    description: 'Débito automático de los clientes de la agencia (lo maneja la agencia).',
                    frequencyType: 'months',
                    cycles: null,
                    trialDays: 0,
                    onExpire: 'mark',
                    active: true,
                    providerRefs: { agency_plan_id: plan.plan_id },
                    createdBy: userId,
                })
                .returning({ id: subscriptionPlans.id });
            return created!.id;
        });
    }

    private async sendStartEmail(agencyId: number, clientId: number, plan: AgencyClientPlan, debit: AgencyDebit): Promise<void> {
        const n = await this.charges.names(agencyId, clientId);
        const brand = await this.charges.brand(clientId);
        const msg = agencyDebitEmail({ agencyName: n.agency, clientName: n.client, amount: plan.price, currency: plan.currency, months: plan.period_months, provider: debit.provider ?? '', url: debit.url! });
        for (const to of await this.charges.adminEmails(clientId)) {
            await this.mail.enqueue({ to, ...msg, ...(brand.name ? { fromName: brand.name } : {}) });
        }
    }
}

/** El correo con el link para autorizar el débito (puro, para las pruebas). */
export function agencyDebitEmail(o: { agencyName: string; clientName: string; amount: number; currency: string; months: number; provider: string; url: string }): {
    subject: string;
    text: string;
    html: string;
} {
    const money = formatAmount(o.amount, o.currency);
    const every = o.months === 1 ? 'cada mes' : `cada ${o.months} meses`;
    return simpleEmail(
        `Activa el débito automático de tu plan con ${o.agencyName}`,
        [
            `${o.agencyName} te propone pagar el plan de «${o.clientName}» con débito automático${o.provider ? ` de ${o.provider}` : ''}: ${money} ${every}.`,
            'Autorizas tu tarjeta una sola vez y cada período se paga solo, unos días antes de que venza. Lo puedes cancelar cuando quieras desde la app.',
        ],
        'Activar el débito automático',
        o.url,
    );
}

export function debitDto(s: SubscriptionRowDb): AgencyDebit {
    const provider = isCollectionProvider(s.provider) ? COLLECTION_PROVIDER_LABEL[s.provider] : null;
    return {
        subscription_id: s.id,
        status: s.status as SubscriptionStatus,
        provider,
        amount: Number(s.amount),
        currency: s.currency,
        months: s.frequency,
        payer_email: s.payerEmail,
        url: s.status === 'pending' && s.url && /^https?:\/\//.test(s.url) ? s.url : null,
        next_charge_at: s.nextChargeAt ? s.nextChargeAt.toISOString() : null,
        last_failure_reason: s.lastFailureReason,
        created_at: s.createdAt.toISOString(),
    };
}

function isManagedRefs(refs: unknown): boolean {
    return !!refs && typeof refs === 'object' && typeof (refs as Record<string, unknown>).agency_plan_id === 'string';
}

function bad(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'agency_client_not_found', message: 'Esa empresa no es cliente de tu agencia', data: { status: 404 } });
}
