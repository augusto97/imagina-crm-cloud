import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    addDaysYmd,
    addMonthsClamped,
    agencyBillingSettingsSchema,
    AGENCY_MANUAL_PAYMENT_METHODS,
    AGENCY_PAYMENT_METHOD_LABELS,
    agencyBillingState,
    agencyMonthlyAmount,
    agencyDebitProviderOk,
    collectionCurrencyError,
    isCollectionProvider,
    extendPaidUntil,
    readAgencyBilling,
    readAgencyClientPlan,
    readAgencySettings,
    resolveTimeZone,
    zonedInstant,
    zonedToday,
    type AgencyBillingSettings,
    type AgencyBillingTotals,
    type AgencyClientBilling,
    type AgencyClientPlan,
    type AgencyPayment,
    type AgencyPaymentMethod,
    type MyAgencyBilling,
    type RegisterAgencyPaymentInput,
    type SetAgencyClientBillingInput,
} from '@imagina-base/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { PlansService } from '../billing/plans.service';
import { CollectionsService } from '../collections/collections.service';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { agencyPayments, tenants, users } from '../db/schema';
import { readSupport } from '../help/help.service';

/** Cuántos pagos se muestran en el historial de un cliente. */
const PAYMENTS_SHOWN = 48;

type AgencyRowLite = { id: number; name: string; plan: string; settings: Record<string, unknown> };

/**
 * v0.1.451 (I3, ADR-S108) — La agencia le cobra a sus clientes: sus planes,
 * el plan y el «pagado hasta» de cada cliente, y los pagos registrados a mano.
 *
 * Corre con la conexión BASE (cruza empresas) y cada consulta filtra por
 * `agency_id = agencia`: un cliente de otra agencia responde 404. El acceso
 * del cliente se recalcula solo en cada pedido (la columna
 * `agency_paid_until` viaja en la subconsulta de la agencia).
 */
@Injectable()
export class AgencyBillingService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly plans: PlansService,
        @Optional() private readonly audit?: AuditService,
        @Optional() private readonly collections?: CollectionsService,
    ) {}

    // ── v0.1.452 — avisos a quien sigue a los clientes (la lista «Empresas cliente») ──

    private readonly clientListeners: Array<(agencyId: number, clientId: number | null) => unknown> = [];

    /** `clientId` null = cambió algo de TODOS los clientes (los planes, las reglas). */
    onClientChanged(fn: (agencyId: number, clientId: number | null) => unknown): void {
        this.clientListeners.push(fn);
    }

    notifyClientChanged(agencyId: number, clientId: number | null): void {
        for (const fn of this.clientListeners) {
            void Promise.resolve()
                .then(() => fn(agencyId, clientId))
                .catch(() => undefined);
        }
    }

    /** Las cuentas de cobro del EQUIPO de la agencia (Mercado Pago, Wompi, PayPal). */
    async collectionConnections(agencyId: number): Promise<Array<{ id: number; name: string; provider: string }>> {
        if (!this.collections) return [];
        const team = await this.collections.teamConnections(agencyId).catch(() => []);
        return team.filter((c) => isCollectionProvider(c.provider)).map((c) => ({ id: c.id, name: c.name, provider: c.provider }));
    }

    // ── ajustes de la agencia ───────────────────────────────────────────

    /** Los planes de la PLATAFORMA que la agencia puede usar como límites de sus planes. */
    async limitPlans(agency: { plan: string; settings: Record<string, unknown> }): Promise<Array<{ slug: string; name: string }>> {
        const s = readAgencySettings(agency.settings.agency);
        const all = await this.plans.list();
        const def = s.client_plan && all.some((p) => p.slug === s.client_plan) ? s.client_plan : agency.plan;
        const slugs = [def, ...s.client_plans.filter((p) => p !== def)];
        return slugs.flatMap((slug) => {
            const p = all.find((x) => x.slug === slug);
            return p ? [{ slug, name: p.name }] : [];
        });
    }

    async updateSettings(agencyId: number, userId: number, input: AgencyBillingSettings, opts: { keepOnline?: boolean } = {}): Promise<AgencyBillingSettings> {
        const next = agencyBillingSettingsSchema.parse(input);
        const agency = await this.agencyRow(agencyId);
        if (opts.keepOnline) next.online = readAgencyBilling(agency.settings.agency_billing).online;
        const allowed = new Set((await this.limitPlans(agency)).map((p) => p.slug));
        for (const p of next.plans) {
            if (p.limits_plan !== null && !allowed.has(p.limits_plan)) {
                throw new BadRequestException({
                    code: 'agency_limits_plan',
                    message: `El plan «${p.name}» usa límites que la plataforma no le permite a tu agencia.`,
                    data: { status: 400 },
                });
            }
        }
        // v0.1.452 — la cuenta de cobro tiene que ser del EQUIPO de la agencia y
        // cobrar en la moneda de sus planes activos (Wompi sólo pesos; PayPal no pesos).
        if (next.online.connection_id !== null) {
            const conn = (await this.collectionConnections(agencyId)).find((c) => c.id === next.online.connection_id);
            if (!conn) {
                throw bad('agency_online_connection', 'Esa cuenta de cobro ya no existe o no es del equipo de la agencia.');
            }
            for (const p of next.plans) {
                if (!p.active || !isCollectionProvider(conn.provider)) continue;
                const err = collectionCurrencyError(conn.provider, p.currency);
                if (err) throw bad('agency_online_currency', `El plan «${p.name}» cobra en ${p.currency}: ${err}`);
            }
            // v0.1.453 — el débito automático sólo existe con Mercado Pago o PayPal.
            if (next.online.debit && !agencyDebitProviderOk(conn.provider)) {
                throw bad('agency_debit_provider', 'El débito automático funciona con Mercado Pago o PayPal: elige una de esas cuentas o apágalo.');
            }
        } else if (next.online.debit) {
            next.online.debit = false;
        }
        await this.db.transaction(async (tx) => {
            const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, agencyId)).for('update').limit(1);
            const settings = { ...((row?.settings as Record<string, unknown> | null) ?? {}) };
            settings.agency_billing = next;
            await tx.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, agencyId));
        });
        await this.audit?.log({
            tenantId: agencyId,
            userId,
            action: 'agency.billing',
            targetType: 'tenant',
            targetId: agencyId,
            meta: {
                plans: next.plans.map((p) => ({ id: p.id, name: p.name, price: p.price, currency: p.currency, period_months: p.period_months })),
                grace_days: next.grace_days,
                remind_days: next.remind_days,
                notify_client: next.notify_client,
                online: next.online,
            },
        });
        this.notifyClientChanged(agencyId, null);
        return next;
    }

    // ── el cobro de cada cliente ────────────────────────────────────────

    /** El cobro de un cliente con los ajustes de su agencia (puro). */
    clientBilling(
        settings: AgencyBillingSettings,
        client: { settings: Record<string, unknown> | null; agencyPaidUntil: Date | null },
        now = new Date(),
    ): AgencyClientBilling {
        const plan = readAgencyClientPlan(client.settings?.agency_plan);
        const st = agencyBillingState({
            has_plan: plan !== null,
            paid_until: client.agencyPaidUntil,
            grace_days: settings.grace_days,
            remind_days: settings.remind_days,
            now,
        });
        return {
            plan,
            paid_until: client.agencyPaidUntil ? client.agencyPaidUntil.toISOString() : null,
            state: st.state,
            due_at: st.due_at,
            cut_at: st.cut_at,
            days_left: st.days_left,
            grace_days: settings.grace_days,
        };
    }

    /** Totales para la consola: cuántos al día, por vencer, vencidos e ingreso mensual por moneda. */
    async totals(agencyId: number, settings: AgencyBillingSettings, now = new Date()): Promise<AgencyBillingTotals> {
        const rows = await this.db
            .select({ settings: tenants.settings, agencyPaidUntil: tenants.agencyPaidUntil })
            .from(tenants)
            .where(and(eq(tenants.agencyId, agencyId), isNull(tenants.archivedAt)));
        const out: AgencyBillingTotals = { ok: 0, due_soon: 0, grace: 0, unpaid: 0, none: 0, monthly: [] };
        const monthly = new Map<string, number>();
        for (const r of rows) {
            const b = this.clientBilling(settings, { settings: r.settings as Record<string, unknown> | null, agencyPaidUntil: r.agencyPaidUntil }, now);
            out[b.state]++;
            if (b.plan && b.state !== 'unpaid') {
                monthly.set(b.plan.currency, (monthly.get(b.plan.currency) ?? 0) + agencyMonthlyAmount(b.plan));
            }
        }
        out.monthly = [...monthly.entries()]
            .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
            .sort((a, b) => b.amount - a.amount);
        return out;
    }

    /**
     * Asignar o quitar el plan de un cliente, ajustar su valor o su «pagado
     * hasta». Al asignar un plan con límites propios, la empresa pasa a ese
     * plan de la plataforma. Sin fecha todavía, queda pagada hasta el fin del
     * primer período (desde hoy).
     */
    async setClientBilling(agencyId: number, userId: number, clientId: number, input: SetAgencyClientBillingInput): Promise<void> {
        const agency = await this.agencyRow(agencyId);
        const settings = readAgencyBilling(agency.settings.agency_billing);
        const tz = agencyTimeZone(agency.settings);
        const allowed = new Set((await this.limitPlans(agency)).map((p) => p.slug));
        const changes: Record<string, unknown> = {};
        let clientName = '';
        await this.db.transaction(async (tx) => {
            const client = await this.lockClient(tx, agencyId, clientId);
            clientName = client.name;
            const cs = { ...((client.settings as Record<string, unknown> | null) ?? {}) };
            let current = readAgencyClientPlan(cs.agency_plan);
            const set: Partial<typeof tenants.$inferInsert> = {};

            if (input.plan_id !== undefined) {
                if (input.plan_id === null) {
                    if (current) changes.plan = { from: current.name, to: null };
                    delete cs.agency_plan;
                    current = null;
                    set.agencyPaidUntil = null;
                } else {
                    const plan = settings.plans.find((p) => p.id === input.plan_id);
                    if (!plan) throw bad('agency_plan_not_found', 'Ese plan ya no existe en tu agencia.');
                    if (!plan.active && current?.plan_id !== plan.id) {
                        throw bad('agency_plan_inactive', `El plan «${plan.name}» está apagado: enciéndelo para asignarlo.`);
                    }
                    const next: AgencyClientPlan = {
                        plan_id: plan.id,
                        name: plan.name,
                        price: input.price ?? (current?.plan_id === plan.id ? current.price : plan.price),
                        currency: plan.currency,
                        period_months: plan.period_months,
                    };
                    if (current?.plan_id !== plan.id) changes.plan = { from: current?.name ?? null, to: plan.name };
                    cs.agency_plan = next;
                    current = next;
                    if (plan.limits_plan && plan.limits_plan !== client.plan) {
                        if (!allowed.has(plan.limits_plan) || !(await this.plans.exists(plan.limits_plan))) {
                            throw bad('agency_limits_plan', `El plan «${plan.name}» usa límites que la plataforma ya no le permite a tu agencia.`);
                        }
                        set.plan = plan.limits_plan;
                        changes.limits_plan = { from: client.plan, to: plan.limits_plan };
                    }
                    if (client.agencyPaidUntil === null && input.paid_until === undefined) {
                        set.agencyPaidUntil = addMonthsClamped(endOfDay(zonedToday(tz), tz), plan.period_months);
                    }
                }
            }
            if (input.price !== undefined && input.plan_id === undefined) {
                if (!current) throw bad('agency_no_plan', 'Primero asígnale un plan a esta empresa.');
                if (current.price !== input.price) changes.price = { from: current.price, to: input.price };
                current = { ...current, price: input.price };
                cs.agency_plan = current;
            }
            if (input.paid_until !== undefined) {
                if (input.paid_until !== null && !current) throw bad('agency_no_plan', 'Primero asígnale un plan a esta empresa.');
                const when = input.paid_until === null ? null : endOfDay(input.paid_until, tz);
                if ((when?.getTime() ?? null) !== (client.agencyPaidUntil?.getTime() ?? null)) {
                    changes.paid_until = { from: client.agencyPaidUntil?.toISOString() ?? null, to: when?.toISOString() ?? null };
                }
                set.agencyPaidUntil = when;
            }
            await tx
                .update(tenants)
                .set({ ...set, settings: cs, updatedAt: new Date() })
                .where(and(eq(tenants.id, clientId), eq(tenants.agencyId, agencyId)));
        });
        if (Object.keys(changes).length > 0) {
            const entry = {
                userId,
                action: 'agency.client_billing' as const,
                targetType: 'tenant',
                targetId: clientId,
                targetLabel: clientName,
                meta: { agency_id: agencyId, ...changes },
            };
            await Promise.all([this.audit?.log({ tenantId: clientId, ...entry }), this.audit?.log({ tenantId: agencyId, ...entry })]);
        }
        this.notifyClientChanged(agencyId, clientId);
    }

    // ── pagos ────────────────────────────────────────────────────────────

    async listPayments(agencyId: number, clientId: number): Promise<AgencyPayment[]> {
        const client = await this.clientRow(agencyId, clientId);
        return this.paymentsOf(clientId, client.agencyPaidUntil, { tenantId: agencyId, withNames: true });
    }

    /**
     * Registrar un pago: extiende el «pagado hasta» desde donde termina (si
     * no venció) o desde hoy, por los meses que cubre. El valor por defecto es
     * el del plan por esos meses. Queda en el historial y en la bitácora.
     */
    async registerPayment(agencyId: number, userId: number, clientId: number, input: RegisterAgencyPaymentInput): Promise<AgencyPayment> {
        const agency = await this.agencyRow(agencyId);
        const tz = agencyTimeZone(agency.settings);
        const today = zonedToday(tz);
        const paidOn = input.paid_on ?? today;
        if (paidOn > today) throw bad('agency_payment_future', 'La fecha del pago no puede ser futura.');
        if (paidOn < addDaysYmd(today, -366 * 5)) throw bad('agency_payment_old', 'La fecha del pago es demasiado antigua.');
        const c = await this.db.transaction((tx) =>
            this.applyPaymentInTx(tx, agencyId, clientId, {
                months: input.months,
                amount: input.amount,
                method: input.method,
                note: input.note,
                paidOn,
                userId,
                tz,
            }),
        );
        await this.logPayment(agencyId, clientId, userId, c, { method: input.method });
        this.notifyClientChanged(agencyId, clientId);
        const list = await this.listPayments(agencyId, clientId);
        const out = list.find((p) => p.id === c.id);
        if (!out) throw new Error('El pago registrado no aparece');
        return out;
    }

    /**
     * v0.1.452 — Registrar un pago dentro de una transacción (con el cliente
     * bloqueado): lo usan el registro a mano y el cobro en línea. Extiende el
     * «pagado hasta» desde donde termina (si no venció) o desde hoy.
     */
    async applyPaymentInTx(
        tx: Tx,
        agencyId: number,
        clientId: number,
        input: {
            months: number;
            amount?: number;
            method: AgencyPaymentMethod;
            note?: string | null;
            paidOn: string;
            userId: number | null;
            tz: string;
            /** v0.1.453 — la cuota del débito automático que pagó esto. */
            subscriptionChargeId?: number | null;
        },
    ): Promise<{ id: number; name: string; amount: number; currency: string; months: number; to: Date }> {
        const client = await this.lockClient(tx, agencyId, clientId);
        const plan = readAgencyClientPlan((client.settings as Record<string, unknown> | null)?.agency_plan);
        if (!plan) throw bad('agency_no_plan', 'Primero asígnale un plan a esta empresa.');
        const amount = input.amount ?? Math.round((plan.price * input.months * 100) / plan.period_months) / 100;
        const todayEnd = endOfDay(zonedToday(input.tz), input.tz);
        const from = client.agencyPaidUntil && client.agencyPaidUntil.getTime() > todayEnd.getTime() ? client.agencyPaidUntil : todayEnd;
        const to = extendPaidUntil(client.agencyPaidUntil, todayEnd, input.months);
        const [row] = await tx
            .insert(agencyPayments)
            .values({
                tenantId: agencyId,
                clientId,
                amount,
                currency: plan.currency,
                months: input.months,
                method: input.method,
                note: input.note?.trim() || null,
                paidOn: input.paidOn,
                periodFrom: from,
                periodTo: to,
                prevPaidUntil: client.agencyPaidUntil,
                createdBy: input.userId,
                subscriptionChargeId: input.subscriptionChargeId ?? null,
            })
            .returning({ id: agencyPayments.id });
        await tx
            .update(tenants)
            .set({ agencyPaidUntil: to, updatedAt: new Date() })
            .where(and(eq(tenants.id, clientId), eq(tenants.agencyId, agencyId)));
        return { id: row!.id, name: client.name, amount, currency: plan.currency, months: input.months, to };
    }

    /** La bitácora de un pago, en la agencia y en el cliente. */
    async logPayment(
        agencyId: number,
        clientId: number,
        userId: number | null,
        c: { id: number; name: string; amount: number; currency: string; months: number; to: Date },
        extra: Record<string, unknown>,
    ): Promise<void> {
        const entry = {
            userId,
            action: 'agency.payment' as const,
            targetType: 'tenant',
            targetId: clientId,
            targetLabel: c.name,
            meta: { agency_id: agencyId, payment_id: c.id, amount: c.amount, currency: c.currency, months: c.months, paid_until: c.to.toISOString(), ...extra },
        };
        await Promise.all([this.audit?.log({ tenantId: clientId, ...entry }), this.audit?.log({ tenantId: agencyId, ...entry })]);
    }

    /**
     * Deshacer el ÚLTIMO pago (un error de tipeo): el «pagado hasta» vuelve al
     * de antes. Sólo si nada lo cambió después (si no, 409: se corrige la
     * fecha a mano).
     */
    async undoPayment(agencyId: number, userId: number, clientId: number, paymentId: number): Promise<void> {
        let label = '';
        let meta: Record<string, unknown> = {};
        await this.db.transaction(async (tx) => {
            const client = await this.lockClient(tx, agencyId, clientId);
            label = client.name;
            const [last] = await tx
                .select()
                .from(agencyPayments)
                .where(and(eq(agencyPayments.tenantId, agencyId), eq(agencyPayments.clientId, clientId), isNull(agencyPayments.undoneAt)))
                .orderBy(desc(agencyPayments.id))
                .limit(1);
            if (!last || last.id !== paymentId) {
                throw new ConflictException({ code: 'agency_payment_not_last', message: 'Sólo se puede deshacer el último pago.', data: { status: 409 } });
            }
            // v0.1.452 — un pago en línea lo confirmó el proveedor: no se deshace
            // desde aquí (si se devolvió el dinero, se corrige el «pagado hasta»).
            if (!isManualMethod(last.method)) {
                throw new ConflictException({
                    code: 'agency_payment_online',
                    message: `Este pago entró por ${AGENCY_PAYMENT_METHOD_LABELS[last.method as AgencyPaymentMethod] ?? 'el cobro en línea'}: no se deshace. Si devolviste el dinero, corrige el «pagado hasta» de la empresa.`,
                    data: { status: 409 },
                });
            }
            if (client.agencyPaidUntil?.getTime() !== last.periodTo.getTime()) {
                throw new ConflictException({
                    code: 'agency_payment_changed',
                    message: 'El «pagado hasta» cambió después de este pago: corrígelo a mano.',
                    data: { status: 409 },
                });
            }
            await tx.update(agencyPayments).set({ undoneAt: new Date(), undoneBy: userId }).where(eq(agencyPayments.id, last.id));
            await tx
                .update(tenants)
                .set({ agencyPaidUntil: last.prevPaidUntil, updatedAt: new Date() })
                .where(and(eq(tenants.id, clientId), eq(tenants.agencyId, agencyId)));
            meta = { agency_id: agencyId, payment_id: last.id, amount: last.amount, currency: last.currency, paid_until: last.prevPaidUntil?.toISOString() ?? null };
        });
        const entry = { userId, action: 'agency.payment_undo' as const, targetType: 'tenant', targetId: clientId, targetLabel: label, meta };
        await Promise.all([this.audit?.log({ tenantId: clientId, ...entry }), this.audit?.log({ tenantId: agencyId, ...entry })]);
        this.notifyClientChanged(agencyId, clientId);
    }

    /** Lo que ve la empresa CLIENTE de su cobro (Ajustes → Suscripción). `null` si no es cliente de una agencia. */
    async mine(clientTenantId: number): Promise<MyAgencyBilling | null> {
        const [client] = await this.db
            .select({ agencyId: tenants.agencyId, settings: tenants.settings, agencyPaidUntil: tenants.agencyPaidUntil })
            .from(tenants)
            .where(eq(tenants.id, clientTenantId))
            .limit(1);
        if (!client?.agencyId) return null;
        const [agency] = await this.db
            .select({ name: tenants.name, settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, client.agencyId))
            .limit(1);
        if (!agency) return null;
        const aSettings = (agency.settings ?? {}) as Record<string, unknown>;
        const billing = this.clientBilling(readAgencyBilling(aSettings.agency_billing), {
            settings: client.settings as Record<string, unknown> | null,
            agencyPaidUntil: client.agencyPaidUntil,
        });
        const support = readSupport(aSettings.agency_support);
        return {
            agency: { name: agency.name },
            billing,
            payments: await this.paymentsOf(clientTenantId, client.agencyPaidUntil, { tenantId: client.agencyId, withNames: false }),
            support: support.email || support.whatsapp || support.url ? support : null,
            // v0.1.452 — lo completa el servicio de cobros en línea.
            online: { enabled: false, provider: null, periods: [], pending: null, debit: { available: false, current: null } },
        };
    }

    // ── internos ─────────────────────────────────────────────────────────

    private async paymentsOf(
        clientId: number,
        paidUntil: Date | null,
        opts: { tenantId: number; withNames: boolean },
    ): Promise<AgencyPayment[]> {
        const rows = await this.db
            .select({ p: agencyPayments, creator: users.name })
            .from(agencyPayments)
            .leftJoin(users, eq(users.id, agencyPayments.createdBy))
            .where(and(eq(agencyPayments.tenantId, opts.tenantId), eq(agencyPayments.clientId, clientId)))
            .orderBy(desc(agencyPayments.id))
            .limit(PAYMENTS_SHOWN);
        const lastActive = rows.find((r) => r.p.undoneAt === null)?.p ?? null;
        return rows.map(({ p, creator }) => ({
            id: p.id,
            client_id: p.clientId,
            amount: Number(p.amount),
            currency: p.currency,
            months: p.months,
            method: p.method as AgencyPaymentMethod,
            note: p.note,
            paid_on: p.paidOn,
            period_from: p.periodFrom.toISOString(),
            period_to: p.periodTo.toISOString(),
            created_at: p.createdAt.toISOString(),
            created_by_name: opts.withNames ? (creator ?? null) : null,
            undone_at: p.undoneAt ? p.undoneAt.toISOString() : null,
            can_undo: opts.withNames && isManualMethod(p.method) && lastActive?.id === p.id && paidUntil?.getTime() === p.periodTo.getTime(),
        }));
    }

    async agencyRow(agencyId: number): Promise<AgencyRowLite> {
        const [row] = await this.db
            .select({ id: tenants.id, name: tenants.name, plan: tenants.plan, isAgency: tenants.isAgency, settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, agencyId))
            .limit(1);
        if (!row || !row.isAgency) {
            throw new BadRequestException({ code: 'not_agency', message: 'Esta empresa no es una agencia.', data: { status: 400 } });
        }
        return { id: row.id, name: row.name, plan: row.plan, settings: (row.settings ?? {}) as Record<string, unknown> };
    }

    private async clientRow(agencyId: number, clientId: number) {
        const [row] = await this.db
            .select({ id: tenants.id, agencyPaidUntil: tenants.agencyPaidUntil })
            .from(tenants)
            .where(and(eq(tenants.id, clientId), eq(tenants.agencyId, agencyId)))
            .limit(1);
        if (!row) throw notFound();
        return row;
    }

    async lockClient(tx: Tx, agencyId: number, clientId: number) {
        const [row] = await tx
            .select({ id: tenants.id, name: tenants.name, plan: tenants.plan, settings: tenants.settings, agencyPaidUntil: tenants.agencyPaidUntil })
            .from(tenants)
            .where(and(eq(tenants.id, clientId), eq(tenants.agencyId, agencyId)))
            .for('update')
            .limit(1);
        if (!row) throw notFound();
        return row;
    }
}

/** Los clientes de varias agencias con plan y fecha (para los avisos). */
export async function clientsWithAgencyPlan(db: Db, agencyIds?: number[]) {
    return db
        .select({
            id: tenants.id,
            name: tenants.name,
            agencyId: tenants.agencyId,
            settings: tenants.settings,
            agencyPaidUntil: tenants.agencyPaidUntil,
        })
        .from(tenants)
        .where(
            and(
                sql`${tenants.agencyId} IS NOT NULL`,
                sql`${tenants.agencyPaidUntil} IS NOT NULL`,
                sql`${tenants.settings} ? 'agency_plan'`,
                isNull(tenants.archivedAt),
                isNull(tenants.agencyPausedAt),
                agencyIds ? inArray(tenants.agencyId, agencyIds) : undefined,
            ),
        );
}

/** La zona horaria de la agencia (sus fechas de pago se leen ahí). */
export function agencyTimeZone(settings: Record<string, unknown>): string {
    const fmt = settings.format as Record<string, unknown> | undefined;
    return resolveTimeZone(fmt?.timezone);
}

/** El último instante de un día en una zona: «pagado hasta el 15» incluye el 15. */
export function endOfDay(ymd: string, tz: string): Date {
    return zonedInstant(ymd, tz, { h: 23, m: 59, s: 59 });
}

function isManualMethod(method: string): boolean {
    return (AGENCY_MANUAL_PAYMENT_METHODS as readonly string[]).includes(method);
}

function bad(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'agency_client_not_found', message: 'Esa empresa no es cliente de tu agencia', data: { status: 404 } });
}
