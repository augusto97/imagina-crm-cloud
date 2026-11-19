import { Reflector } from '@nestjs/core';
import { Redis } from 'ioredis';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgencyBillingService } from '../src/agency/agency-billing.service';
import { AgencyService } from '../src/agency/agency.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv, type Env } from '../src/config/env';
import { billingSubscriptions, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { MembersRepository } from '../src/members/members.repository';
import { MembersService } from '../src/members/members.service';
import type {
    CheckoutRequest,
    PaymentGateway,
    PaymentNotice,
    SubscriptionRequest,
} from '../src/payments/payment.types';
import { PaymentsService } from '../src/payments/payments.service';
import { MercadoPagoGateway } from '../src/payments/providers/mercadopago.provider';
import { PlatformService } from '../src/platform/platform.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantGuard } from '../src/tenancy/tenant.guard';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * v0.1.454 (I3, ADR-S108) — Lo que la PLATAFORMA le cobra a una agencia: el
 * precio de su plan más cada empresa cliente por encima de las que incluye.
 * Se cuenta lo que hay al pagar (sin archivadas ni pausadas), el operador
 * puede ponerle a una agencia un trato propio, y con la renovación automática
 * el monto se ajusta en el proveedor cuando cambian las empresas.
 */

class FakeGateway implements PaymentGateway {
    readonly provider = 'mercadopago' as const;
    readonly supportsSubscription = true;
    lastCheckout: CheckoutRequest | null = null;
    lastSubscription: SubscriptionRequest | null = null;
    amounts: Array<{ id: string; amount: number }> = [];
    failNext = false;
    isEnabled(): Promise<boolean> {
        return Promise.resolve(true);
    }
    createCheckout(req: CheckoutRequest) {
        this.lastCheckout = req;
        return Promise.resolve({ url: `https://pay.test/${req.reference}`, externalId: 'pref_1' });
    }
    createSubscription(req: SubscriptionRequest) {
        this.lastSubscription = req;
        return Promise.resolve({ url: 'https://pay.test/sub', externalId: `sub_${Date.now()}`, status: 'pending' as const, nextPaymentAt: null });
    }
    cancelSubscription(): Promise<void> {
        return Promise.resolve();
    }
    updateSubscriptionAmount(id: string, amount: number): Promise<void> {
        if (this.failNext) {
            this.failNext = false;
            return Promise.reject(new Error('mp caído'));
        }
        this.amounts.push({ id, amount });
        return Promise.resolve();
    }
    handleWebhook(): Promise<PaymentNotice[]> {
        return Promise.resolve([]);
    }
}

describe('v0.1.454 — la plataforma le cobra a la agencia', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let gw: FakeGateway;
    let payments: PaymentsService;
    let platform: PlatformService;
    let agencySvc: AgencyService;
    let plans: PlansService;
    let agency: number;
    let n = 0;
    const env = (url: string, db: string) =>
        ({ ...loadEnv({ REDIS_URL: url, DATABASE_URL: db }), APP_BASE_URL: 'https://app.test' }) as Env;

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const e = env(redisBox.url, pg.container.getConnectionUri());
        const tenantDb = new TenantDb(pg.db);
        const mail = new MailService(e, { name: 'test', send: async () => undefined });
        const auth = new AuthService(pg.db, redis, e, mail, new SessionService(redis, e));
        plans = new PlansService(pg.db);
        const emailQuota = new EmailQuotaService(pg.db, plans);
        const tenantSmtp = new TenantSmtpService(pg.db, e);
        const billing = new BillingService(tenantDb, plans, emailQuota, tenantSmtp);
        const audit = new AuditService(tenantDb);
        const members = new MembersService(tenantDb, new MembersRepository(), auth, billing, undefined, undefined, undefined, pg.db);
        gw = new FakeGateway();
        payments = new PaymentsService(e, [gw], plans, tenantDb, pg.db);
        platform = new PlatformService(
            pg.db,
            e,
            billing,
            auth,
            plans,
            emailQuota,
            tenantSmtp,
            undefined,
            undefined,
            undefined,
            members,
            audit,
            payments,
        );
        agencySvc = new AgencyService(pg.db, auth, plans, new AgencyBillingService(pg.db, plans, audit), audit, undefined, undefined, payments);
        void new TenantGuard(tenantDb, new Reflector(), audit, redis);
        // Un plan de agencia: 49 USD / 199.000 COP con 2 empresas incluidas y 10 USD / 39.000 COP por cada extra.
        await plans.create({
            slug: 'agencia',
            name: 'Agencia',
            max_records: null,
            max_users: null,
            max_automations: null,
            max_storage_mb: null,
            max_emails_month: null,
            max_ai_requests_month: null,
            max_guests: null,
            price_usd: 49,
            price_cop: 199_000,
            agency_included_clients: 2,
            agency_extra_usd: 10,
            agency_extra_cop: 39_000,
            is_active: true,
        });
    }, 120_000);

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    beforeEach(async () => {
        n++;
        gw.amounts = [];
        gw.lastCheckout = null;
        gw.lastSubscription = null;
        const [a] = await pg.db
            .insert(tenants)
            .values({ slug: `agencia-${n}`, name: `Agencia ${n}`, plan: 'agencia', status: 'active', isAgency: true })
            .returning();
        agency = a!.id;
    });

    async function addClients(count: number, opts: { paused?: boolean; archived?: boolean } = {}): Promise<number[]> {
        const ids: number[] = [];
        for (let i = 0; i < count; i++) {
            const [c] = await pg.db
                .insert(tenants)
                .values({
                    slug: `cli-${n}-${Math.random().toString(36).slice(2, 8)}`,
                    name: 'Cliente',
                    plan: 'trial',
                    status: 'active',
                    agencyId: agency,
                    agencyPausedAt: opts.paused ? new Date() : null,
                    archivedAt: opts.archived ? new Date() : null,
                })
                .returning();
            ids.push(c!.id);
        }
        return ids;
    }

    it('el precio: la base con las incluidas, y cada extra suma (sin pausadas ni archivadas)', async () => {
        await addClients(2);
        expect(await payments.agencyPricing(agency)).toMatchObject({
            plan: 'agencia',
            plan_name: 'Agencia',
            clients: 2,
            included: 2,
            extras: 0,
            total_usd: 49,
            total_cop: 199_000,
            custom: false,
        });
        await addClients(3);
        await addClients(1, { paused: true });
        await addClients(1, { archived: true });
        expect(await payments.agencyPricing(agency)).toMatchObject({ clients: 5, extras: 3, total_usd: 79, total_cop: 199_000 + 3 * 39_000 });

        // Una empresa común no tiene precio de agencia: paga el plan como siempre.
        const [common] = await pg.db.insert(tenants).values({ slug: `comun-${n}`, name: 'Común', plan: 'agencia' }).returning();
        expect(await payments.agencyPricing(common!.id)).toBeNull();

        // Lo que ve la agencia al pagar: el total con el desglose.
        const cfg = await payments.config(agency);
        expect(cfg.plans.find((p) => p.slug === 'agencia')).toMatchObject({ usd: 79, cop: 316_000, agency: { extras: 3 } });
        // Y en su consola.
        const overview = await agencySvc.overview(agency);
        expect(overview.platform).toMatchObject({ plan: 'agencia', clients: 5, extras: 3, total_usd: 79 });
    });

    it('el pago por período cobra el total con las extras (y la referencia lleva ese monto)', async () => {
        await addClients(4);
        const res = await payments.createCheckout(agency, 'pagos@agencia.test', { plan: 'agencia', provider: 'mercadopago', mode: 'period', months: 3 });
        const total = (199_000 + 2 * 39_000) * 3;
        expect(res.url).toBe(`https://pay.test/p:${agency}:agencia:3:${total}`);
        expect(gw.lastCheckout).toMatchObject({ amount: total, currency: 'COP' });
        expect(gw.lastCheckout!.title).toContain('4 empresas cliente');
    });

    it('con extras y sin valor por extra en esa moneda, no se vende (y lo dice)', async () => {
        await plans.update('agencia', { agency_extra_cop: null });
        try {
            await addClients(3);
            await expect(
                payments.createCheckout(agency, 'p@a.test', { plan: 'agencia', provider: 'mercadopago', mode: 'period', months: 1 }),
            ).rejects.toMatchObject({ response: { code: 'plan_not_sellable', message: expect.stringContaining('1 empresas cliente más') } });
            // Sin extras se vende igual.
            await pg.db.update(tenants).set({ agencyPausedAt: new Date() }).where(eq(tenants.agencyId, agency));
            await expect(
                payments.createCheckout(agency, 'p@a.test', { plan: 'agencia', provider: 'mercadopago', mode: 'period', months: 1 }),
            ).resolves.toMatchObject({ mode: 'period' });
        } finally {
            await plans.update('agencia', { agency_extra_cop: 39_000 });
        }
    });

    it('el trato propio de una agencia pisa lo del plan y se mezcla con sus ajustes', async () => {
        await platform.updateTenant(agency, { agency_settings: { client_plan: 'trial', max_clients: 50 } });
        await platform.updateTenant(agency, { agency_settings: { included_clients: 10, extra_cop: 25_000 } });
        const t = await platform.getTenant(agency);
        expect(t.agency_settings).toMatchObject({ client_plan: 'trial', max_clients: 50, included_clients: 10, extra_cop: 25_000, extra_usd: null });
        await addClients(12);
        await addClients(1, { paused: true });
        expect((await platform.getTenant(agency)).agency_billed_clients).toBe(12);
        expect(await payments.agencyPricing(agency)).toMatchObject({ included: 10, extras: 2, extra_usd: 10, extra_cop: 25_000, total_cop: 249_000, custom: true });
    });

    it('la renovación automática se ajusta en el proveedor cuando cambian las empresas', async () => {
        const [c1] = await addClients(2);
        await withTenant(pg.db, agency, (tx) =>
            tx.insert(billingSubscriptions).values({
                tenantId: agency,
                provider: 'mercadopago',
                externalId: `pre-${n}`,
                plan: 'agencia',
                status: 'authorized',
                amount: 199_000,
                currency: 'COP',
            }),
        );
        // Sin cambios no se toca el proveedor.
        expect(await payments.syncAgencyRenewal(agency)).toBe(false);
        expect(gw.amounts).toEqual([]);

        // Una empresa más → una extra.
        await addClients(1);
        expect(await payments.syncAgencyRenewal(agency)).toBe(true);
        expect(gw.amounts).toEqual([{ id: `pre-${n}`, amount: 238_000 }]);
        const amountOf = async () =>
            Number(
                (
                    await withTenant(pg.db, agency, (tx) =>
                        tx.select().from(billingSubscriptions).where(and(eq(billingSubscriptions.tenantId, agency), eq(billingSubscriptions.externalId, `pre-${n}`))),
                    )
                )[0]!.amount,
            );
        expect(await amountOf()).toBe(238_000);

        // Si el proveedor falla, el monto guardado no cambia y la revisión de cada hora lo reintenta.
        gw.failNext = true;
        await pg.db.update(tenants).set({ agencyPausedAt: new Date() }).where(eq(tenants.id, c1!));
        expect(await payments.syncAgencyRenewal(agency)).toBe(false);
        expect(await amountOf()).toBe(238_000);
        expect(await payments.syncAgencyRenewals()).toBeGreaterThanOrEqual(1);
        expect(gw.amounts.at(-1)).toEqual({ id: `pre-${n}`, amount: 199_000 });
        expect(await amountOf()).toBe(199_000);
    });

    it('Mercado Pago: el monto de la renovación se cambia con PUT /preapproval/:id', async () => {
        const calls: Array<{ url: string; method: string; body: unknown }> = [];
        const impl = (async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
            return new Response(JSON.stringify({ id: 'pre-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
        const source = { mercadoPago: () => Promise.resolve({ accessToken: 'APP_USR-tok', webhookSecret: 's' }), webhookUrl: () => 'https://app.test/hook' };
        await new MercadoPagoGateway(source as never, impl).updateSubscriptionAmount!('pre-1', 238_000);
        expect(calls[0]).toMatchObject({
            url: 'https://api.mercadopago.com/preapproval/pre-1',
            method: 'PUT',
            body: { auto_recurring: { transaction_amount: 238_000 } },
        });
    });
});
