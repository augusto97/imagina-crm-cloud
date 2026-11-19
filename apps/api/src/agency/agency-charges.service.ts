import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional, type OnModuleInit } from '@nestjs/common';
import {
    AGENCY_PAYMENT_METHOD_LABELS,
    COLLECTION_PROVIDER_LABEL,
    agencyChargeAmount,
    agencyMonthsText,
    agencyPayablePeriods,
    collectionCurrencyError,
    isCollectionProvider,
    readAgencyBilling,
    readAgencyClientPlan,
    zonedToday,
    type AgencyCharge,
    type AgencyChargeStatus,
    type AgencyChargeVia,
    type AgencyPaymentMethod,
    type MyAgencyOnline,
} from '@imagina-base/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { CollectionError, CollectionsService } from '../collections/collections.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { agencyCharges, memberships, paymentLinks, tenants, users, type AgencyChargeRow } from '../db/schema';
import { DomainsService } from '../domains/domains.service';
import { escapeHtml } from '../legal/legal-page';
import { MailService } from '../mail/mail.service';
import { AgencyBillingService, agencyTimeZone } from './agency-billing.service';
import { AgencyClientsListService, agencyChargeTitle } from './agency-clients-list.service';

/** Cuántos días dura un link de pago de la agencia. */
const LINK_DAYS = 7;
/** Un link pendiente se reusa si le quedan al menos estas horas. */
const REUSE_MIN_HOURS = 24;
/** Cuántos cobros se muestran en el historial de un cliente. */
const CHARGES_SHOWN = 20;

type PaymentLinkLite = { id: number; status: string; url: string; provider: string; expiresAt: Date | null; paidAt: Date | null; paidAmount: number | null; reference: string | null };

/**
 * v0.1.452 (I3, ADR-S108) — La agencia cobra EN LÍNEA a sus clientes con SU
 * cuenta de cobro (Mercado Pago, Wompi o PayPal; ADR-S31): el dinero va a la
 * cuenta de la agencia, nunca a la plataforma.
 *
 * - Cada cobro es un link de pago colgado del registro del cliente en la
 *   lista «Empresas cliente» de la agencia (así aparece en «Cobros» de la
 *   ficha y en sus automatizaciones de «Cuando se recibe un pago»).
 * - Lo crea la agencia desde la consola, el cliente desde su app (si la
 *   agencia lo deja) o el aviso automático antes de vencer. Hay UNO pendiente
 *   por cliente: pedir otro igual devuelve el mismo; pedir otro distinto
 *   anula el anterior.
 * - Cuando el proveedor confirma el pago (se relee, nunca se le cree al
 *   aviso), se registra solo como pago de la agencia y corre el «pagado
 *   hasta»: la empresa vuelve a funcionar al instante. Un pago que llega
 *   tarde (link vencido o anulado) también se registra: el dinero entró.
 */
@Injectable()
export class AgencyChargesService implements OnModuleInit {
    private readonly logger = new Logger(AgencyChargesService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        private readonly billing: AgencyBillingService,
        private readonly clientsList: AgencyClientsListService,
        private readonly collections: CollectionsService,
        private readonly mail: MailService,
        @Optional() private readonly audit?: AuditService,
        @Optional() private readonly domains?: DomainsService,
    ) {}

    onModuleInit(): void {
        this.collections.onLinkPaid((e) => this.onLinkPaid(e.tenantId, e.linkId));
    }

    // ── crear ────────────────────────────────────────────────────────────

    /**
     * Un link para que el cliente pague N meses de su plan. Reusa el pendiente
     * si es igual (mismos meses y valor, con al menos un día por delante);
     * si no, anula el anterior y crea otro.
     */
    async create(
        agencyId: number,
        clientId: number,
        input: { months: number; amount?: number; via: AgencyChargeVia; userId: number | null; sendEmail?: boolean },
    ): Promise<{ charge: AgencyCharge; reused: boolean }> {
        const agency = await this.billing.agencyRow(agencyId);
        const settings = readAgencyBilling(agency.settings.agency_billing);
        const connectionId = settings.online.connection_id;
        if (connectionId === null) {
            throw bad('agency_online_off', 'Tu agencia no cobra en línea todavía: elige la cuenta de cobro en «Planes para tus clientes».');
        }
        const conn = (await this.billing.collectionConnections(agencyId)).find((c) => c.id === connectionId);
        if (!conn || !isCollectionProvider(conn.provider)) {
            throw bad('agency_online_connection', 'La cuenta de cobro elegida ya no existe o no es del equipo de la agencia.');
        }
        const [client] = await this.db
            .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
            .from(tenants)
            .where(and(eq(tenants.id, clientId), eq(tenants.agencyId, agencyId), isNull(tenants.archivedAt)))
            .limit(1);
        if (!client) throw notFound();
        const plan = readAgencyClientPlan((client.settings as Record<string, unknown> | null)?.agency_plan);
        if (!plan) throw bad('agency_no_plan', 'Primero asígnale un plan a esta empresa.');
        const currencyErr = collectionCurrencyError(conn.provider, plan.currency);
        if (currencyErr) throw bad('agency_online_currency', `El plan «${plan.name}» cobra en ${plan.currency}: ${currencyErr}`);
        const amount = Math.round((input.amount ?? agencyChargeAmount(plan, input.months)) * 100) / 100;
        if (!(amount > 0)) throw bad('agency_charge_amount', 'El valor a cobrar tiene que ser mayor a cero.');

        const target = await this.clientsList.ensure(agencyId, input.userId).catch((err: unknown) => {
            throw err instanceof BadRequestException ? err : bad('agency_list_failed', 'No se pudo armar la lista de empresas cliente de la agencia.');
        });
        const rec = await this.clientsList.recordFor(agencyId, clientId);
        if (!rec) throw bad('agency_list_failed', 'No se pudo armar el registro de la empresa en la lista de la agencia.');

        let reused: AgencyChargeRow | null = null;
        let replaced: number | null = null;
        const row = await this.db.transaction(async (tx) => {
            // Uno a la vez por cliente (dos clics no arman dos links).
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agcharge:${clientId}`}, 0))`);
            const [pending] = await tx
                .select({ c: agencyCharges, l: paymentLinks })
                .from(agencyCharges)
                .leftJoin(paymentLinks, eq(paymentLinks.id, agencyCharges.linkId))
                .where(and(eq(agencyCharges.tenantId, agencyId), eq(agencyCharges.clientId, clientId), eq(agencyCharges.status, 'pending')))
                .orderBy(desc(agencyCharges.id))
                .limit(1);
            if (pending) {
                const l = pending.l;
                const alive = l && l.status === 'pending' && (!l.expiresAt || l.expiresAt.getTime() - Date.now() > REUSE_MIN_HOURS * 3600_000);
                if (alive && pending.c.months === input.months && Number(pending.c.amount) === amount && pending.c.currency === plan.currency) {
                    reused = pending.c;
                    return pending.c;
                }
                // Otro distinto (o vencido): el anterior queda anulado.
                await tx.update(agencyCharges).set({ status: l && l.status === 'pending' ? 'cancelled' : 'expired' }).where(eq(agencyCharges.id, pending.c.id));
                if (l && l.status === 'pending') replaced = l.id;
            }
            const base = this.env.APP_BASE_URL.replace(/\/+$/, '');
            let link: { id: number; provider: string };
            try {
                link = await this.collections.createForAgency(agencyId, {
                    connectionId,
                    listId: target.list_id,
                    recordId: rec.recordId,
                    title: agencyChargeTitle(plan.name, input.months, client.name),
                    amount,
                    currency: plan.currency,
                    payerEmail: rec.email ?? (await this.clientsList.firstAdminEmail(clientId)),
                    expiresAt: new Date(Date.now() + LINK_DAYS * 24 * 3600_000),
                    returnUrlFor: (reference) => `${base}/api/v1/public/agency-pay/${encodeURIComponent(reference)}`,
                    userId: input.userId,
                    clientId,
                });
            } catch (err) {
                if (err instanceof CollectionError) throw bad('agency_charge_failed', err.message);
                throw err;
            }
            const [inserted] = await tx
                .insert(agencyCharges)
                .values({
                    tenantId: agencyId,
                    clientId,
                    linkId: link.id,
                    months: input.months,
                    amount,
                    currency: plan.currency,
                    via: input.via,
                    createdBy: input.userId,
                })
                .returning();
            return inserted!;
        });
        if (replaced !== null) await this.collections.expireLink(agencyId, replaced, 'Se reemplazó por otro link de pago.').catch(() => undefined);
        const reusedRow = reused as AgencyChargeRow | null;
        if (!reusedRow) {
            const entry = {
                userId: input.userId,
                action: 'agency.charge_create' as const,
                targetType: 'tenant',
                targetId: clientId,
                targetLabel: client.name,
                meta: { agency_id: agencyId, charge_id: row.id, months: input.months, amount, currency: plan.currency, provider: conn.provider, via: input.via },
            };
            await Promise.all([this.audit?.log({ tenantId: agencyId, ...entry }), this.audit?.log({ tenantId: clientId, ...entry })]);
            this.billing.notifyClientChanged(agencyId, clientId);
        }
        const charge = await this.chargeDto(row);
        if (input.sendEmail && charge.url) {
            await this.sendLinkEmail(agencyId, clientId, charge).catch((err: unknown) => this.logger.warn(`Agencia ${agencyId}: no salió el link de pago a la empresa ${clientId}: ${String(err)}`));
        }
        return { charge, reused: reusedRow !== null };
    }

    /** El cliente paga desde su app: N períodos del plan, al valor del plan. */
    async payAsClient(clientTenantId: number, userId: number, periods: number): Promise<AgencyCharge> {
        const [client] = await this.db
            .select({ agencyId: tenants.agencyId, settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, clientTenantId))
            .limit(1);
        if (!client?.agencyId) throw new ForbiddenException({ code: 'not_agency_client', message: 'Esta empresa no es cliente de una agencia.', data: { status: 403 } });
        const online = await this.onlineFor(clientTenantId);
        if (!online.enabled) {
            throw new ForbiddenException({ code: 'agency_online_off', message: 'Tu agencia no recibe pagos en línea desde aquí: escríbele para pagar.', data: { status: 403 } });
        }
        const plan = readAgencyClientPlan((client.settings as Record<string, unknown> | null)?.agency_plan)!;
        if (!online.periods.includes(periods)) throw bad('agency_charge_periods', 'Elige cuántos períodos quieres pagar.');
        const { charge } = await this.create(client.agencyId, clientTenantId, { months: periods * plan.period_months, via: 'client', userId: null });
        void userId;
        return charge;
    }

    /** Un link que el aviso automático manda antes de vencer (un período). `null` si la agencia no cobra en línea. */
    async autoLink(agencyId: number, clientId: number): Promise<string | null> {
        const agency = await this.billing.agencyRow(agencyId);
        const settings = readAgencyBilling(agency.settings.agency_billing);
        if (settings.online.connection_id === null || !settings.online.auto_link) return null;
        const [client] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, clientId)).limit(1);
        const plan = readAgencyClientPlan((client?.settings as Record<string, unknown> | null)?.agency_plan);
        if (!plan) return null;
        const { charge } = await this.create(agencyId, clientId, { months: plan.period_months, via: 'auto', userId: null });
        return charge.status === 'pending' ? charge.url : null;
    }

    // ── ver y anular ─────────────────────────────────────────────────────

    async list(agencyId: number, clientId: number): Promise<AgencyCharge[]> {
        const rows = await this.db
            .select()
            .from(agencyCharges)
            .where(and(eq(agencyCharges.tenantId, agencyId), eq(agencyCharges.clientId, clientId)))
            .orderBy(desc(agencyCharges.id))
            .limit(CHARGES_SHOWN);
        return Promise.all(rows.map((r) => this.chargeDto(r)));
    }

    async cancel(agencyId: number, userId: number, clientId: number, chargeId: number): Promise<void> {
        const [row] = await this.db
            .select()
            .from(agencyCharges)
            .where(and(eq(agencyCharges.tenantId, agencyId), eq(agencyCharges.clientId, clientId), eq(agencyCharges.id, chargeId)))
            .limit(1);
        if (!row) throw new NotFoundException({ code: 'agency_charge_not_found', message: 'Ese cobro no existe.', data: { status: 404 } });
        const dto = await this.chargeDto(row);
        if (dto.status !== 'pending') {
            throw bad('agency_charge_not_pending', dto.status === 'paid' ? 'Ese cobro ya se pagó.' : 'Ese cobro ya no está esperando el pago.');
        }
        const [updated] = await this.db
            .update(agencyCharges)
            .set({ status: 'cancelled' })
            .where(and(eq(agencyCharges.id, chargeId), eq(agencyCharges.status, 'pending')))
            .returning({ id: agencyCharges.id });
        if (!updated) return;
        if (row.linkId) await this.collections.expireLink(agencyId, row.linkId, 'La agencia anuló el cobro.').catch(() => undefined);
        const [client] = await this.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, clientId)).limit(1);
        const entry = {
            userId,
            action: 'agency.charge_cancel' as const,
            targetType: 'tenant',
            targetId: clientId,
            targetLabel: client?.name ?? '',
            meta: { agency_id: agencyId, charge_id: chargeId, amount: Number(row.amount), currency: row.currency },
        };
        await Promise.all([this.audit?.log({ tenantId: agencyId, ...entry }), this.audit?.log({ tenantId: clientId, ...entry })]);
        this.billing.notifyClientChanged(agencyId, clientId);
    }

    /** Lo que ve el cliente del cobro en línea. Con `refresh`, le pregunta al proveedor por el link pendiente. */
    async onlineFor(clientTenantId: number, opts: { refresh?: boolean } = {}): Promise<MyAgencyOnline> {
        const off: MyAgencyOnline = { enabled: false, provider: null, periods: [], pending: null };
        const [client] = await this.db
            .select({ agencyId: tenants.agencyId, settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, clientTenantId))
            .limit(1);
        if (!client?.agencyId) return off;
        const [agency] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, client.agencyId)).limit(1);
        const settings = readAgencyBilling((agency?.settings as Record<string, unknown> | null)?.agency_billing);
        const connectionId = settings.online.connection_id;
        const plan = readAgencyClientPlan((client.settings as Record<string, unknown> | null)?.agency_plan);
        if (connectionId === null || !plan) return off;
        const conn = (await this.billing.collectionConnections(client.agencyId)).find((c) => c.id === connectionId);
        if (!conn || !isCollectionProvider(conn.provider) || collectionCurrencyError(conn.provider, plan.currency)) return off;
        let [pending] = await this.db
            .select()
            .from(agencyCharges)
            .where(and(eq(agencyCharges.tenantId, client.agencyId), eq(agencyCharges.clientId, clientTenantId), eq(agencyCharges.status, 'pending')))
            .orderBy(desc(agencyCharges.id))
            .limit(1);
        if (pending?.linkId && opts.refresh) {
            // Volvió de pagar: preguntarle al proveedor (a lo sumo cada 15 s; el aviso a veces llega después).
            await this.collections.linkState(client.agencyId, pending.linkId, { refresh: true }).catch(() => null);
            await this.settleIfPaid(client.agencyId, pending.linkId).catch(() => undefined);
            [pending] = await this.db.select().from(agencyCharges).where(eq(agencyCharges.id, pending.id)).limit(1);
        }
        const dto = pending ? await this.chargeDto(pending) : null;
        return {
            enabled: settings.online.client_can_pay,
            provider: COLLECTION_PROVIDER_LABEL[conn.provider],
            periods: agencyPayablePeriods(plan.period_months),
            pending: dto && dto.status === 'pending' ? dto : null,
        };
    }

    // ── el pago ──────────────────────────────────────────────────────────

    /** Un link quedó pagado: si es un cobro de agencia, se registra el pago (una sola vez). */
    async onLinkPaid(tenantId: number, linkId: number): Promise<void> {
        await this.settleIfPaid(tenantId, linkId);
    }

    private async settleIfPaid(agencyId: number, linkId: number): Promise<void> {
        const [found] = await this.db
            .select({ id: agencyCharges.id })
            .from(agencyCharges)
            .where(and(eq(agencyCharges.tenantId, agencyId), eq(agencyCharges.linkId, linkId)))
            .limit(1);
        if (!found) return;
        const link = await this.linkOf(linkId);
        if (!link || link.status !== 'approved') return;
        const agency = await this.billing.agencyRow(agencyId);
        const tz = agencyTimeZone(agency.settings);
        const method: AgencyPaymentMethod = isCollectionProvider(link.provider) ? (link.provider as AgencyPaymentMethod) : 'other';
        const done = await this.db.transaction(async (tx) => {
            const [c] = await tx.select().from(agencyCharges).where(eq(agencyCharges.id, found.id)).for('update').limit(1);
            if (!c || c.paymentId !== null) return null;
            const paid = await this.billing.applyPaymentInTx(tx, agencyId, c.clientId, {
                months: c.months,
                amount: link.paidAmount ?? Number(c.amount),
                method,
                note: `Pago en línea con ${AGENCY_PAYMENT_METHOD_LABELS[method]}${c.status !== 'pending' ? ' (llegó después de que el link se anulara o venciera)' : ''}`,
                paidOn: zonedToday(tz, link.paidAt ?? new Date()),
                userId: null,
                tz,
            });
            await tx
                .update(agencyCharges)
                .set({ status: 'paid', paidAt: link.paidAt ?? new Date(), paymentId: paid.id })
                .where(eq(agencyCharges.id, c.id));
            return { charge: c, paid };
        });
        if (!done) return;
        await this.billing.logPayment(agencyId, done.charge.clientId, null, done.paid, { method, via: 'online', charge_id: done.charge.id });
        this.billing.notifyClientChanged(agencyId, done.charge.clientId);
        await this.sendPaidEmails(agencyId, done.charge.clientId, { amount: done.paid.amount, currency: done.paid.currency, months: done.charge.months, to: done.paid.to, method }).catch(
            (err: unknown) => this.logger.warn(`Agencia ${agencyId}: no salieron los avisos del pago de la empresa ${done.charge.clientId}: ${String(err)}`),
        );
    }

    /**
     * La vuelta del checkout (`/api/v1/public/agency-pay/:ref`): le pregunta al
     * proveedor y devuelve adónde llevar a la persona (su app, en Suscripción).
     */
    async returnFromCheckout(reference: string): Promise<string> {
        const fallback = this.env.APP_BASE_URL.replace(/\/+$/, '');
        if (!/^ib_[A-Za-z0-9_-]{8,40}$/.test(reference)) return fallback;
        const [row] = await this.db
            .select({ linkId: paymentLinks.id, agencyId: agencyCharges.tenantId, clientId: agencyCharges.clientId })
            .from(paymentLinks)
            .innerJoin(agencyCharges, eq(agencyCharges.linkId, paymentLinks.id))
            .where(eq(paymentLinks.reference, reference))
            .limit(1);
        if (!row) return fallback;
        await this.collections.linkState(row.agencyId, row.linkId, { refresh: true }).catch(() => null);
        await this.settleIfPaid(row.agencyId, row.linkId).catch(() => undefined);
        const brand = await this.brand(row.clientId);
        return `${brand.base}/#/settings?s=suscripcion&pago=1`;
    }

    // ── internos ─────────────────────────────────────────────────────────

    private async linkOf(linkId: number): Promise<PaymentLinkLite | null> {
        const [l] = await this.db
            .select({
                id: paymentLinks.id,
                status: paymentLinks.status,
                url: paymentLinks.url,
                provider: paymentLinks.provider,
                expiresAt: paymentLinks.expiresAt,
                paidAt: paymentLinks.paidAt,
                paidAmount: paymentLinks.paidAmount,
                reference: paymentLinks.reference,
            })
            .from(paymentLinks)
            .where(eq(paymentLinks.id, linkId))
            .limit(1);
        return l ? { ...l, paidAmount: l.paidAmount === null ? null : Number(l.paidAmount) } : null;
    }

    async chargeDto(row: AgencyChargeRow): Promise<AgencyCharge> {
        const link = row.linkId ? await this.linkOf(row.linkId) : null;
        let status = row.status as AgencyChargeStatus;
        if (status === 'pending') {
            if (!link || link.status === 'expired' || link.status === 'cancelled' || (link.expiresAt && link.expiresAt.getTime() <= Date.now())) status = 'expired';
            else if (link.status === 'approved') status = 'paid';
        }
        return {
            id: row.id,
            client_id: row.clientId,
            months: row.months,
            amount: Number(row.amount),
            currency: row.currency,
            status,
            via: row.via as AgencyChargeVia,
            provider: link && isCollectionProvider(link.provider) ? COLLECTION_PROVIDER_LABEL[link.provider] : null,
            url: status === 'pending' && link ? link.url : null,
            expires_at: link?.expiresAt ? link.expiresAt.toISOString() : null,
            created_at: row.createdAt.toISOString(),
            paid_at: row.paidAt ? row.paidAt.toISOString() : null,
        };
    }

    private async brand(tenantId: number): Promise<{ name: string; base: string }> {
        try {
            if (this.domains) return await this.domains.accountBrand({ tenantId });
        } catch {
            // sin dominio propio: la dirección de la app
        }
        return { name: '', base: this.env.APP_BASE_URL.replace(/\/+$/, '') };
    }

    private async adminEmails(tenantId: number): Promise<string[]> {
        const rows = await this.db
            .select({ email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'admin'), eq(memberships.viaAgency, false), isNull(users.disabledAt)));
        return rows.map((r) => r.email);
    }

    private async names(agencyId: number, clientId: number): Promise<{ agency: string; client: string }> {
        const rows = await this.db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(sql`${tenants.id} IN (${agencyId}, ${clientId})`);
        return { agency: rows.find((r) => r.id === agencyId)?.name ?? '', client: rows.find((r) => r.id === clientId)?.name ?? '' };
    }

    private async sendLinkEmail(agencyId: number, clientId: number, charge: AgencyCharge): Promise<void> {
        const n = await this.names(agencyId, clientId);
        const brand = await this.brand(clientId);
        const msg = agencyLinkEmail({ agencyName: n.agency, clientName: n.client, amount: charge.amount, currency: charge.currency, months: charge.months, url: charge.url! });
        for (const to of await this.adminEmails(clientId)) {
            await this.mail.enqueue({ to, ...msg, ...(brand.name ? { fromName: brand.name } : {}) });
        }
    }

    private async sendPaidEmails(
        agencyId: number,
        clientId: number,
        p: { amount: number; currency: string; months: number; to: Date; method: AgencyPaymentMethod },
    ): Promise<void> {
        const n = await this.names(agencyId, clientId);
        const agency = await this.billing.agencyRow(agencyId);
        const tz = agencyTimeZone(agency.settings);
        const until = p.to.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
        const money = formatAmount(p.amount, p.currency);
        const method = AGENCY_PAYMENT_METHOD_LABELS[p.method];
        const clientBrand = await this.brand(clientId);
        const agencyBrand = await this.brand(agencyId);
        const toClient = simpleEmail(
            `Recibimos tu pago a ${n.agency}`,
            [`Recibimos el pago de «${n.client}» por ${money} (${agencyMonthsText(p.months)}) con ${method}.`, `Tu plan queda pagado hasta el ${until}.`],
            'Ver mi plan',
            `${clientBrand.base}/#/settings?s=suscripcion`,
        );
        const toAgency = simpleEmail(
            `«${n.client}» pagó ${money}`,
            [`«${n.client}» pagó ${money} (${agencyMonthsText(p.months)}) en línea con ${method}.`, `Ya quedó registrado: la empresa está pagada hasta el ${until}.`],
            'Ver en la agencia',
            `${agencyBrand.base}/#/agency`,
        );
        for (const to of await this.adminEmails(clientId)) await this.mail.enqueue({ to, ...toClient, ...(clientBrand.name ? { fromName: clientBrand.name } : {}) });
        for (const to of await this.adminEmails(agencyId)) await this.mail.enqueue({ to, ...toAgency, ...(agencyBrand.name ? { fromName: agencyBrand.name } : {}) });
    }
}

/** «$ 150.000 COP» (sin depender del formato de una empresa: es para un correo). */
export function formatAmount(amount: number, currency: string): string {
    const decimals = currency === 'COP' || currency === 'CLP' ? 0 : 2;
    const n = amount.toLocaleString('es-CO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return `$ ${n} ${currency}`;
}

/** El correo con el link de pago (puro, para las pruebas). */
export function agencyLinkEmail(o: { agencyName: string; clientName: string; amount: number; currency: string; months: number; url: string }): {
    subject: string;
    text: string;
    html: string;
} {
    const money = formatAmount(o.amount, o.currency);
    return simpleEmail(
        `Tu link de pago de ${o.agencyName}`,
        [`Este es el link para pagar el plan de «${o.clientName}» a ${o.agencyName}: ${money} por ${agencyMonthsText(o.months)}.`, 'Al pagar, se registra solo y tu plan queda al día al instante.'],
        'Pagar ahora',
        o.url,
    );
}

function simpleEmail(subject: string, lines: string[], cta: string, link: string): { subject: string; text: string; html: string } {
    const text = `${lines.join('\n\n')}\n\n${cta}: ${link}`;
    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#1f2937">
${lines.map((l) => `<p style="margin:0 0 14px">${escapeHtml(l)}</p>`).join('\n')}
<p style="margin:22px 0"><a href="${escapeHtml(link)}" style="background:#0e7490;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">${escapeHtml(cta)}</a></p>
</div>`;
    return { subject, text, html };
}

function bad(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'agency_client_not_found', message: 'Esa empresa no es cliente de tu agencia', data: { status: 404 } });
}
