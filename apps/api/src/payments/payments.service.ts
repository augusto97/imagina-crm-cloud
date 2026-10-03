import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
    addMonthsClamped,
    BILLING_GRACE_DAYS,
    extendPaidUntil,
    paidReadOnlyAt,
    PROVIDER_CURRENCY,
    type AutoRenew,
    type AutoRenewStatus,
    type BillingPayment,
    type BillingPaymentStatus,
    type CheckoutMode,
    type CheckoutResult,
    type CreateCheckoutInput,
    type PaymentConfig,
    type PaymentProvider,
    type Plan,
    type PlatformPaymentRow,
    type SubscriptionInfo,
} from '@imagina-base/shared';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { PlansService } from '../billing/plans.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { billingPayments, billingSubscriptions, tenants } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { encodeReference, PAYMENT_GATEWAYS, type PaymentGateway, type PaymentNotice } from './payment.types';

type PaymentRow = typeof billingPayments.$inferSelect;
type SubscriptionRow = typeof billingSubscriptions.$inferSelect;

/** Renovaciones que siguen vivas (una empresa tiene a lo sumo una). */
const LIVE_SUBSCRIPTION: AutoRenewStatus[] = ['pending', 'authorized', 'paused'];

/**
 * Cobro de los planes (ADR-S12, rehecho en v0.1.250). Dos formas de pagar:
 *
 *  - **Período**: N meses de una vez. Cada pago aprobado EXTIENDE
 *    `tenants.paid_until`; vencido ese período más los días de gracia, la
 *    empresa pasa a solo-lectura (ADR-S09).
 *  - **Renovación automática**: el proveedor cobra la tarjeta todos los meses
 *    y cada cobro aprobado extiende un mes.
 *
 * Todo cobro pasa por `billing_payments`, UNA fila por cobro del proveedor:
 * los avisos se reintentan y el mismo cobro llega por dos caminos, así que la
 * fila es lo que garantiza que un pago extiende el período UNA sola vez. Un
 * pago pendiente o rechazado ya NO toca el estado de la empresa (antes un PSE
 * pendiente la dejaba "en mora" aunque tuviera meses pagados).
 */
@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);
    private readonly byProvider: Map<PaymentProvider, PaymentGateway>;

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(PAYMENT_GATEWAYS) gateways: PaymentGateway[],
        private readonly plans: PlansService,
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
    ) {
        this.byProvider = new Map(gateways.map((g) => [g.provider, g]));
    }

    private base(): string {
        return this.env.APP_BASE_URL.replace(/\/+$/, '');
    }

    private async enabledGateways(): Promise<PaymentGateway[]> {
        const all = [...this.byProvider.values()];
        const flags = await Promise.all(all.map((g) => g.isEnabled().catch(() => false)));
        return all.filter((_, i) => flags[i]);
    }

    /** Proveedores habilitados (con credenciales) + planes vendibles — para la UI. */
    async config(): Promise<PaymentConfig> {
        const enabled = await this.enabledGateways();
        return {
            providers: enabled.map((g) => g.provider),
            plans: await this.plans.sellablePlans(),
            subscription_providers: enabled.filter((g) => g.supportsSubscription).map((g) => g.provider),
        };
    }

    async createCheckout(tenantId: number, payerEmail: string, input: CreateCheckoutInput): Promise<CheckoutResult> {
        const gateway = this.byProvider.get(input.provider);
        if (!gateway || !(await gateway.isEnabled())) {
            throw new BadRequestException({
                code: 'provider_unavailable',
                message: `El cobro con ${input.provider === 'mercadopago' ? 'Mercado Pago' : 'PayPal'} no está disponible.`,
                data: { status: 400, errors: { provider: 'no configurado' } },
            });
        }
        // El precio sale de la tabla `plans` (editable) → un plan custom se vende
        // apenas tiene precio en la moneda del proveedor. Sin precio → no vendible.
        const currency = PROVIDER_CURRENCY[input.provider];
        const price = await this.plans.priceFor(input.plan, currency);
        if (price === null) {
            throw new BadRequestException({
                code: 'plan_not_sellable',
                message: `El plan ${input.plan} no tiene precio en ${currency}.`,
                data: { status: 400, errors: { plan: 'sin precio' } },
            });
        }
        const planName = (await this.plans.sellablePlans()).find((p) => p.slug === input.plan)?.name ?? input.plan;
        const back = `${this.base()}/#/settings?s=suscripcion`;

        if (input.mode === 'subscription') {
            return this.createSubscription(tenantId, gateway, input.plan, planName, price, currency, payerEmail, back);
        }

        const amount = Math.round(price * input.months * 100) / 100;
        const session = await gateway.createCheckout({
            tenantId,
            plan: input.plan,
            months: input.months,
            amount,
            currency,
            reference: encodeReference(tenantId, input.plan, { mode: 'period', months: input.months, amount }),
            title: `${this.appName()} — plan ${planName} · ${input.months} ${input.months === 1 ? 'mes' : 'meses'}`,
            returnUrl: `${back}&checkout=success`,
            cancelUrl: `${back}&checkout=cancel`,
        });
        return { provider: input.provider, plan: input.plan, mode: 'period', url: session.url, external_id: session.externalId };
    }

    private appName(): string {
        return 'Imagina Base';
    }

    private async createSubscription(
        tenantId: number,
        gateway: PaymentGateway,
        plan: Plan,
        planName: string,
        price: number,
        currency: 'USD' | 'COP',
        payerEmail: string,
        back: string,
    ): Promise<CheckoutResult> {
        if (!gateway.supportsSubscription || !gateway.createSubscription) {
            throw new BadRequestException({
                code: 'subscription_unavailable',
                message: 'La renovación automática sólo está disponible con Mercado Pago.',
                data: { status: 400 },
            });
        }
        const { live, paidUntil } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const live = await tx
                .select()
                .from(billingSubscriptions)
                .where(and(eq(billingSubscriptions.tenantId, tenantId), inArray(billingSubscriptions.status, LIVE_SUBSCRIPTION)));
            const [t] = await tx.select({ paidUntil: tenants.paidUntil }).from(tenants).where(eq(tenants.id, tenantId));
            return { live, paidUntil: t?.paidUntil ?? null };
        });
        if (live.some((s) => s.status === 'authorized' || s.status === 'paused')) {
            throw new ConflictException({
                code: 'auto_renew_active',
                message: 'Ya tenés la renovación automática activa. Para cambiar de plan, cancelala primero: lo que ya pagaste se conserva.',
                data: { status: 409 },
            });
        }
        // Un intento anterior que nunca se autorizó se descarta (en el proveedor
        // y acá): si no, quedaría un enlace viejo cobrable.
        for (const old of live) await this.cancelAt(tenantId, old);

        // El primer cobro cae cuando vence lo ya pagado: nadie paga dos veces el mismo mes.
        const startAt = paidUntil && paidUntil.getTime() > Date.now() ? paidUntil : null;
        const session = await gateway.createSubscription({
            tenantId,
            plan,
            amount: price,
            currency,
            reference: encodeReference(tenantId, plan, { mode: 'subscription' }),
            title: `${this.appName()} — plan ${planName} (mensual)`,
            payerEmail,
            startAt,
            returnUrl: `${back}&checkout=subscription`,
        });
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(billingSubscriptions)
                .values({
                    tenantId,
                    provider: gateway.provider,
                    externalId: session.externalId,
                    plan,
                    status: session.status,
                    amount: price,
                    currency,
                    nextPaymentAt: session.nextPaymentAt,
                    authorizeUrl: session.url,
                })
                .onConflictDoNothing(),
        );
        return { provider: gateway.provider, plan, mode: 'subscription', url: session.url, external_id: session.externalId };
    }

    // ── Avisos ───────────────────────────────────────────────────────────

    /**
     * Procesa un aviso: el gateway lo verifica y lo normaliza; acá se aplica.
     * Un error de lectura del proveedor se RELANZA (500 → el proveedor reintenta);
     * un aviso falso o ajeno no hace nada.
     */
    async handleWebhook(
        provider: PaymentProvider,
        headers: Record<string, string | undefined>,
        rawBody: string,
        query: Record<string, string | undefined> = {},
    ): Promise<number> {
        const gateway = this.byProvider.get(provider);
        if (!gateway) return 0;
        const notices = await gateway.handleWebhook(headers, rawBody, query);
        let applied = 0;
        for (const n of notices) {
            if (await this.apply(provider, n)) applied++;
        }
        return applied;
    }

    /** Aplica un aviso ya verificado. Devuelve si cambió algo. */
    async apply(provider: PaymentProvider, notice: PaymentNotice): Promise<boolean> {
        let tenantId = notice.tenantId;
        let plan = notice.plan;
        const subId = notice.kind === 'subscription' ? notice.externalId : notice.subscriptionExternalId;
        if ((tenantId === null || plan === null) && subId) {
            // Sin referencia: se resuelve por la suscripción que abrimos nosotros.
            // Conexión base (sin RLS): todavía no sabemos de qué empresa es.
            const [sub] = await this.db
                .select({ tenantId: billingSubscriptions.tenantId, plan: billingSubscriptions.plan })
                .from(billingSubscriptions)
                .where(and(eq(billingSubscriptions.provider, provider), eq(billingSubscriptions.externalId, subId)))
                .limit(1);
            tenantId ??= sub?.tenantId ?? null;
            plan ??= sub?.plan ?? null;
        }
        if (tenantId === null || plan === null) {
            this.logger.warn(`aviso ${provider} ${notice.kind} ${notice.externalId} sin empresa reconocible — ignorado`);
            return false;
        }
        const [exists] = await this.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        if (!exists) return false;
        const t = tenantId;
        const p = plan;
        if (notice.kind === 'subscription') return this.applySubscription(provider, t, p, notice);
        return this.tenantDb.withTenant(t, (tx) => this.applyPayment(tx, provider, t, p, notice));
    }

    private async applyPayment(
        tx: Tx,
        provider: PaymentProvider,
        tenantId: number,
        plan: Plan,
        n: Extract<PaymentNotice, { kind: 'payment' }>,
    ): Promise<boolean> {
        // Se bloquea la empresa: dos avisos del mismo cobro en paralelo (el
        // del pago y el de la cuota) no pueden extender dos veces.
        const [tenant] = await tx
            .select({ paidUntil: tenants.paidUntil })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .for('update');
        if (!tenant) return false;
        const [prev] = await tx
            .select()
            .from(billingPayments)
            .where(and(eq(billingPayments.provider, provider), eq(billingPayments.externalId, n.externalId)))
            .limit(1);
        if (prev && prev.status === n.status) return false;
        const now = new Date();
        const months = prev?.months ?? n.months;
        const kind: CheckoutMode = n.mode;

        let periodEnd: Date | null = prev?.periodEnd ?? null;
        if (n.status === 'approved') {
            periodEnd = extendPaidUntil(tenant.paidUntil, now, months);
            await tx
                .update(tenants)
                .set({ plan, status: 'active', paidUntil: periodEnd, updatedAt: now })
                .where(eq(tenants.id, tenantId));
        } else if (n.status === 'refunded') {
            // Devuelto lo que estaba aplicado: se le quitan esos meses al período.
            if (prev?.status === 'approved' && tenant.paidUntil) {
                await tx
                    .update(tenants)
                    .set({ paidUntil: addMonthsClamped(tenant.paidUntil, -prev.months), updatedAt: now })
                    .where(eq(tenants.id, tenantId));
            }
            periodEnd = null;
        } else if (prev && (prev.status === 'approved' || prev.status === 'refunded')) {
            // Un aviso viejo (pendiente) que llega tarde no deshace un cobro ya hecho.
            return false;
        }

        await tx
            .insert(billingPayments)
            .values({
                tenantId,
                provider,
                externalId: n.externalId,
                kind,
                plan,
                months,
                amount: n.amount,
                currency: n.currency || PROVIDER_CURRENCY[provider],
                status: n.status,
                method: n.method,
                periodEnd,
            })
            .onConflictDoUpdate({
                target: [billingPayments.provider, billingPayments.externalId],
                set: {
                    status: n.status,
                    method: n.method ?? prev?.method ?? null,
                    amount: n.amount || prev?.amount || 0,
                    periodEnd,
                    updatedAt: now,
                },
            });
        this.logger.log(`pago ${provider} ${n.externalId}: empresa ${tenantId} → ${n.status} (${months} mes/es, ${plan})`);
        return true;
    }

    private async applySubscription(
        provider: PaymentProvider,
        tenantId: number,
        plan: Plan,
        n: Extract<PaymentNotice, { kind: 'subscription' }>,
    ): Promise<boolean> {
        const others = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const now = new Date();
            await tx
                .insert(billingSubscriptions)
                .values({
                    tenantId,
                    provider,
                    externalId: n.externalId,
                    plan,
                    status: n.status,
                    amount: n.amount,
                    currency: n.currency || PROVIDER_CURRENCY[provider],
                    nextPaymentAt: n.nextPaymentAt,
                    authorizeUrl: n.status === 'pending' ? n.authorizeUrl : null,
                })
                .onConflictDoUpdate({
                    target: [billingSubscriptions.provider, billingSubscriptions.externalId],
                    set: {
                        status: n.status,
                        nextPaymentAt: n.nextPaymentAt,
                        authorizeUrl: n.status === 'pending' ? n.authorizeUrl : null,
                        ...(n.amount ? { amount: n.amount } : {}),
                        updatedAt: now,
                    },
                });
            if (n.status !== 'authorized') return [] as SubscriptionRow[];
            // Una renovación nueva autorizada reemplaza a cualquier otra viva:
            // nadie paga dos suscripciones a la vez.
            return tx
                .select()
                .from(billingSubscriptions)
                .where(
                    and(
                        eq(billingSubscriptions.tenantId, tenantId),
                        ne(billingSubscriptions.externalId, n.externalId),
                        inArray(billingSubscriptions.status, LIVE_SUBSCRIPTION),
                    ),
                );
        });
        for (const old of others) await this.cancelAt(tenantId, old);
        this.logger.log(`renovación ${provider} ${n.externalId}: empresa ${tenantId} → ${n.status}`);
        return true;
    }

    /** Cancela una renovación en el proveedor (si se puede) y la marca cancelada. */
    private async cancelAt(tenantId: number, sub: SubscriptionRow): Promise<void> {
        const gateway = this.byProvider.get(sub.provider as PaymentProvider);
        try {
            await gateway?.cancelSubscription?.(sub.externalId);
        } catch (err) {
            // Se registra pero se marca igual: si el proveedor ya la había
            // cancelado, reintentar no sirve; si no, el aviso la reactivaría.
            this.logger.warn(`no se pudo cancelar la renovación ${sub.externalId} en el proveedor: ${String(err)}`);
        }
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(billingSubscriptions)
                .set({ status: 'cancelled', authorizeUrl: null, updatedAt: new Date() })
                .where(eq(billingSubscriptions.id, sub.id)),
        );
    }

    // ── Consultas y acciones de la empresa ───────────────────────────────

    async subscriptionInfo(tenantId: number): Promise<SubscriptionInfo> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [t] = await tx
                .select({ plan: tenants.plan, paidUntil: tenants.paidUntil, endsAt: tenants.subscriptionEndsAt })
                .from(tenants)
                .where(eq(tenants.id, tenantId));
            const [sub] = await tx
                .select()
                .from(billingSubscriptions)
                .where(and(eq(billingSubscriptions.tenantId, tenantId), inArray(billingSubscriptions.status, LIVE_SUBSCRIPTION)))
                .orderBy(desc(billingSubscriptions.updatedAt))
                .limit(1);
            const rows = await tx
                .select()
                .from(billingPayments)
                .where(eq(billingPayments.tenantId, tenantId))
                .orderBy(desc(billingPayments.createdAt), desc(billingPayments.id))
                .limit(50);
            return {
                plan: t?.plan ?? 'trial',
                paid_until: t?.paidUntil ? t.paidUntil.toISOString() : null,
                read_only_at: t?.paidUntil ? paidReadOnlyAt(t.paidUntil).toISOString() : null,
                grace_days: BILLING_GRACE_DAYS,
                manual_ends_at: t?.endsAt ? t.endsAt.toISOString() : null,
                auto_renew: sub ? toAutoRenew(sub) : null,
                payments: rows.map(toPayment),
            };
        });
    }

    /** Cancela la renovación automática. Lo ya pagado se conserva hasta su vencimiento. */
    async cancelAutoRenew(tenantId: number): Promise<SubscriptionInfo> {
        const live = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(billingSubscriptions)
                .where(and(eq(billingSubscriptions.tenantId, tenantId), inArray(billingSubscriptions.status, LIVE_SUBSCRIPTION))),
        );
        if (live.length === 0) {
            throw new BadRequestException({
                code: 'no_auto_renew',
                message: 'No hay una renovación automática activa.',
                data: { status: 400 },
            });
        }
        for (const sub of live) {
            const gateway = this.byProvider.get(sub.provider as PaymentProvider);
            // Acá SÍ se exige que el proveedor la cancele: si no, la tarjeta se
            // seguiría cobrando con la pantalla diciendo "cancelada".
            if (gateway?.cancelSubscription) await gateway.cancelSubscription(sub.externalId);
            await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .update(billingSubscriptions)
                    .set({ status: 'cancelled', authorizeUrl: null, updatedAt: new Date() })
                    .where(eq(billingSubscriptions.id, sub.id)),
            );
        }
        return this.subscriptionInfo(tenantId);
    }

    /** Últimos pagos de todas las empresas (consola de Plataforma). Conexión base. */
    async recentPayments(limit = 100): Promise<PlatformPaymentRow[]> {
        const rows = await this.db
            .select({ p: billingPayments, tenantName: tenants.name })
            .from(billingPayments)
            .innerJoin(tenants, eq(tenants.id, billingPayments.tenantId))
            .orderBy(desc(billingPayments.createdAt), desc(billingPayments.id))
            .limit(Math.min(Math.max(limit, 1), 500));
        return rows.map((r) => ({ ...toPayment(r.p), tenant_id: r.p.tenantId, tenant_name: r.tenantName }));
    }
}

function toPayment(r: PaymentRow): BillingPayment {
    return {
        id: r.id,
        provider: r.provider as PaymentProvider,
        kind: r.kind as CheckoutMode,
        plan: r.plan,
        months: r.months,
        amount: Number(r.amount),
        currency: r.currency,
        status: r.status as BillingPaymentStatus,
        method: r.method,
        period_end: r.periodEnd ? r.periodEnd.toISOString() : null,
        created_at: r.createdAt.toISOString(),
    };
}

function toAutoRenew(r: SubscriptionRow): AutoRenew {
    return {
        provider: r.provider as PaymentProvider,
        plan: r.plan,
        status: r.status as AutoRenewStatus,
        amount: Number(r.amount),
        currency: r.currency,
        next_payment_at: r.nextPaymentAt ? r.nextPaymentAt.toISOString() : null,
        authorize_url: r.status === 'pending' ? r.authorizeUrl : null,
        updated_at: r.updatedAt.toISOString(),
    };
}
