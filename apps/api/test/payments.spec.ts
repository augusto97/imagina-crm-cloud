import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    addMonthsClamped,
    BILLING_GRACE_DAYS,
    createCheckoutSchema,
    extendPaidUntil,
    isEffectivelyReadOnly,
    type Currency,
    type PlanPrice,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { loadEnv, type Env } from '../src/config/env';
import type { PlansService } from '../src/billing/plans.service';
import { billingPayments, billingSubscriptions, tenants } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { billingReminderEmail, reminderKindFor } from '../src/payments/billing-reminders.service';
import {
    decodeReference,
    encodeReference,
    paymentMethodLabel,
    type CheckoutRequest,
    type PaymentGateway,
    type PaymentNotice,
    type SubscriptionRequest,
} from '../src/payments/payment.types';
import { PaymentsService } from '../src/payments/payments.service';
import {
    mapMpPaymentStatus,
    MercadoPagoGateway,
    verifyMpSignature,
} from '../src/payments/providers/mercadopago.provider';
import { mapPayPalEvent, PayPalGateway } from '../src/payments/providers/paypal.provider';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const DAY = 24 * 60 * 60 * 1000;

/** PlansService de prueba: precios en memoria (evita tocar la tabla `plans`). */
function fakePlans(sellable: PlanPrice[]): PlansService {
    return {
        sellablePlans: () => Promise.resolve(sellable),
        priceFor: (slug: string, currency: Currency) => {
            const p = sellable.find((s) => s.slug === slug);
            if (!p) return Promise.resolve(null);
            return Promise.resolve(currency === 'USD' ? p.usd : p.cop);
        },
    } as unknown as PlansService;
}
const STARTER: PlanPrice = { slug: 'starter', name: 'Starter', usd: 15, cop: 59_000 };
const PRO: PlanPrice = { slug: 'pro', name: 'Pro', usd: 49, cop: 199_000 };

describe('referencia que viaja al proveedor', () => {
    it('período: tenant, plan, meses y monto', () => {
        const ref = encodeReference(42, 'pro', { mode: 'period', months: 3, amount: 597_000 });
        expect(ref).toBe('p:42:pro:3:597000');
        expect(decodeReference(ref)).toEqual({ tenantId: 42, plan: 'pro', mode: 'period', months: 3, amount: 597_000 });
        expect(decodeReference(encodeReference(1, 'pro', { mode: 'period', months: 1, amount: 49.5 }))?.amount).toBe(49.5);
    });
    it('suscripción', () => {
        expect(decodeReference(encodeReference(7, 'starter', { mode: 'subscription' }))).toEqual({
            tenantId: 7,
            plan: 'starter',
            mode: 'subscription',
            months: 1,
        });
    });
    it('heredada (antes de v0.1.250) = un mes', () => {
        expect(decodeReference('7:growth')).toEqual({ tenantId: 7, plan: 'growth', mode: 'period', months: 1 });
        expect(decodeReference('7:Pro Max')?.plan).toBeUndefined();
        expect(decodeReference('x:pro')).toBeNull();
        expect(decodeReference('p:0:pro:1:10')).toBeNull();
    });
    it('meses absurdos caen a 1', () => {
        expect(decodeReference('p:3:pro:999:10')?.months).toBe(1);
    });
});

describe('período pagado', () => {
    it('sumar meses recorta al último día del mes', () => {
        expect(addMonthsClamped(new Date('2026-01-31T15:00:00Z'), 1).toISOString()).toBe('2026-02-28T15:00:00.000Z');
        expect(addMonthsClamped(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
        expect(addMonthsClamped(new Date('2026-11-15T00:00:00Z'), 3).toISOString()).toBe('2027-02-15T00:00:00.000Z');
        expect(addMonthsClamped(new Date('2026-03-31T00:00:00Z'), -1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    });
    it('pagar por adelantado no pierde días; pagar tarde no regala los que pasaron', () => {
        const now = new Date('2026-06-10T00:00:00Z');
        expect(extendPaidUntil(new Date('2026-06-20T00:00:00Z'), now, 1).toISOString()).toBe('2026-07-20T00:00:00.000Z');
        expect(extendPaidUntil(new Date('2026-05-01T00:00:00Z'), now, 1).toISOString()).toBe('2026-07-10T00:00:00.000Z');
        expect(extendPaidUntil(null, now, 12).toISOString()).toBe('2027-06-10T00:00:00.000Z');
    });
    it('vencido el período + la gracia → solo-lectura', () => {
        const paid = new Date('2026-06-01T00:00:00Z');
        const at = (d: number) => new Date(paid.getTime() + d * DAY);
        expect(isEffectivelyReadOnly({ status: 'active', paid_until: paid, now: at(1) })).toBe(false);
        expect(isEffectivelyReadOnly({ status: 'active', paid_until: paid, now: at(BILLING_GRACE_DAYS - 0.01) })).toBe(false);
        expect(isEffectivelyReadOnly({ status: 'active', paid_until: paid, now: at(BILLING_GRACE_DAYS) })).toBe(true);
        expect(isEffectivelyReadOnly({ status: 'active', paid_until: null, now: at(400) })).toBe(false);
    });
    it('la renovación automática sólo con Mercado Pago', () => {
        expect(createCheckoutSchema.safeParse({ plan: 'pro', provider: 'paypal', mode: 'subscription' }).success).toBe(false);
        expect(createCheckoutSchema.safeParse({ plan: 'pro', provider: 'mercadopago', mode: 'subscription' }).success).toBe(true);
        expect(createCheckoutSchema.safeParse({ plan: 'pro', provider: 'paypal', months: 5 }).success).toBe(false);
        expect(createCheckoutSchema.parse({ plan: 'pro', provider: 'paypal' })).toMatchObject({ mode: 'period', months: 1 });
    });
});

describe('verifyMpSignature', () => {
    const secret = 'mp_secret';
    const sign = (manifest: string) => createHmac('sha256', secret).update(manifest).digest('hex');
    const ts = '1700000000';

    it('acepta una firma válida', () => {
        const v1 = sign(`id:123456;request-id:req-abc;ts:${ts};`);
        expect(verifyMpSignature({ 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-abc' }, '123456', secret)).toBe(true);
    });
    it('el id va en minúsculas (ids alfanuméricos de suscripciones)', () => {
        const v1 = sign(`id:2c938084abc;request-id:r;ts:${ts};`);
        expect(verifyMpSignature({ 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'r' }, '2C938084ABC', secret)).toBe(true);
    });
    it('sin x-request-id se omite del manifest', () => {
        const v1 = sign(`id:9;ts:${ts};`);
        expect(verifyMpSignature({ 'x-signature': `ts=${ts},v1=${v1}` }, '9', secret)).toBe(true);
    });
    it('rechaza firma adulterada y sin secret', () => {
        expect(verifyMpSignature({ 'x-signature': `ts=${ts},v1=deadbeef` }, '9', secret)).toBe(false);
        expect(verifyMpSignature({ 'x-signature': `ts=${ts},v1=${sign(`id:9;ts:${ts};`)}` }, '9', '')).toBe(false);
    });
});

describe('Mercado Pago (pasarela, red simulada)', () => {
    const secret = 'whsec';
    const source = (url = 'https://app.test/api/v1/billing/webhook/mercadopago') => ({
        mercadoPago: () => Promise.resolve({ accessToken: 'APP_USR-tok', webhookSecret: secret }),
        webhookUrl: () => url,
    });
    function fakeFetch(routes: Record<string, unknown>) {
        const calls: Array<{ url: string; method: string; body: unknown; auth: string | null }> = [];
        const impl = (async (url: string | URL | Request, init?: RequestInit) => {
            const u = String(url);
            const method = init?.method ?? 'GET';
            const headers = new Headers(init?.headers);
            calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.get('authorization') });
            const key = `${method} ${u.replace('https://api.mercadopago.com', '')}`;
            if (!(key in routes)) return new Response('{}', { status: 404 });
            return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
        return { impl, calls };
    }
    const signed = (id: string, extra: Record<string, string> = {}) => {
        const ts = '1700000000';
        const v1 = createHmac('sha256', secret).update(`id:${id.toLowerCase()};request-id:r1;ts:${ts};`).digest('hex');
        return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'r1', ...extra };
    };
    const req: CheckoutRequest = {
        tenantId: 7,
        plan: 'pro',
        months: 3,
        amount: 597_000,
        currency: 'COP',
        reference: 'p:7:pro:3:597000',
        title: 'Imagina Base — plan Pro · 3 meses',
        returnUrl: 'https://app.test/#/settings?s=suscripcion&checkout=success',
        cancelUrl: 'https://app.test/#/settings?s=suscripcion&checkout=cancel',
    };

    it('pago por período: preference con el total, la referencia y la URL de avisos', async () => {
        const f = fakeFetch({ 'POST /checkout/preferences': { id: 'pref-1', init_point: 'https://mp.test/pay/pref-1' } });
        const s = await new MercadoPagoGateway(source(), f.impl).createCheckout(req);
        expect(s).toEqual({ url: 'https://mp.test/pay/pref-1', externalId: 'pref-1' });
        const body = f.calls[0]!.body as Record<string, unknown>;
        expect(f.calls[0]!.auth).toBe('Bearer APP_USR-tok');
        expect(body.external_reference).toBe('p:7:pro:3:597000');
        expect((body.items as Array<{ unit_price: number; currency_id: string }>)[0]).toMatchObject({ unit_price: 597_000, currency_id: 'COP' });
        expect(body.notification_url).toBe('https://app.test/api/v1/billing/webhook/mercadopago?source_news=webhooks');
    });

    it('sin https (desarrollo) no manda notification_url', async () => {
        const f = fakeFetch({ 'POST /checkout/preferences': { id: 'p', init_point: 'https://mp.test/x' } });
        await new MercadoPagoGateway(source('http://localhost:5174/api/v1/billing/webhook/mercadopago'), f.impl).createCheckout(req);
        expect((f.calls[0]!.body as Record<string, unknown>).notification_url).toBeUndefined();
    });

    it('renovación automática: preapproval mensual que arranca cuando vence lo pagado', async () => {
        const f = fakeFetch({
            'POST /preapproval': { id: '2c93abc', init_point: 'https://mp.test/sub/2c93abc', status: 'pending', next_payment_date: null },
        });
        const start = new Date(Date.now() + 20 * DAY);
        const sub: SubscriptionRequest = {
            tenantId: 7,
            plan: 'pro',
            amount: 199_000,
            currency: 'COP',
            reference: 's:7:pro',
            title: 'Imagina Base — plan Pro (mensual)',
            payerEmail: 'ana@acme.co',
            startAt: start,
            returnUrl: 'https://app.test/#/settings?s=suscripcion',
        };
        const s = await new MercadoPagoGateway(source(), f.impl).createSubscription(sub);
        expect(s).toMatchObject({ externalId: '2c93abc', url: 'https://mp.test/sub/2c93abc', status: 'pending' });
        const body = f.calls[0]!.body as { auto_recurring: Record<string, unknown>; payer_email: string; status: string };
        expect(body.payer_email).toBe('ana@acme.co');
        expect(body.status).toBe('pending');
        expect(body.auto_recurring).toMatchObject({ frequency: 1, frequency_type: 'months', transaction_amount: 199_000, currency_id: 'COP' });
        expect(body.auto_recurring.start_date).toBe(start.toISOString());
    });

    it('aviso de pago: firma + relectura → cobro con método legible', async () => {
        const f = fakeFetch({
            'GET /v1/payments/555': {
                id: 555,
                status: 'approved',
                external_reference: 'p:7:pro:3:597000',
                transaction_amount: 597_000,
                currency_id: 'COP',
                payment_type_id: 'bank_transfer',
                payment_method_id: 'pse',
            },
        });
        const notices = await new MercadoPagoGateway(source(), f.impl).handleWebhook(
            signed('555'),
            JSON.stringify({ type: 'payment', data: { id: '555' } }),
            { 'data.id': '555', type: 'payment' },
        );
        expect(notices).toEqual([
            {
                kind: 'payment',
                tenantId: 7,
                plan: 'pro',
                mode: 'period',
                months: 3,
                externalId: '555',
                status: 'approved',
                amount: 597_000,
                currency: 'COP',
                method: 'PSE',
                subscriptionExternalId: undefined,
            },
        ]);
    });

    it('un pago por MENOS de lo que dice la referencia no se aplica', async () => {
        const f = fakeFetch({
            'GET /v1/payments/556': { id: 556, status: 'approved', external_reference: 'p:7:pro:3:597000', transaction_amount: 1000, currency_id: 'COP' },
        });
        const [n] = await new MercadoPagoGateway(source(), f.impl).handleWebhook(signed('556'), JSON.stringify({ type: 'payment', data: { id: '556' } }), {});
        expect(n).toMatchObject({ status: 'rejected' });
    });

    it('firma inválida → nada (y no se consulta la API)', async () => {
        const f = fakeFetch({});
        const out = await new MercadoPagoGateway(source(), f.impl).handleWebhook(
            { 'x-signature': 'ts=1,v1=00' },
            JSON.stringify({ type: 'payment', data: { id: '1' } }),
            {},
        );
        expect(out).toEqual([]);
        expect(f.calls).toHaveLength(0);
    });

    it('suscripción y cuota cobrada', async () => {
        const f = fakeFetch({
            'GET /preapproval/2c93abc': {
                id: '2c93abc',
                status: 'authorized',
                external_reference: 's:7:pro',
                next_payment_date: '2026-11-01T00:00:00.000Z',
                auto_recurring: { transaction_amount: 199_000, currency_id: 'COP' },
            },
            'GET /authorized_payments/9001': {
                id: 9001,
                preapproval_id: '2c93abc',
                transaction_amount: 199_000,
                currency_id: 'COP',
                payment: { id: 777, status: 'approved' },
            },
        });
        const gw = new MercadoPagoGateway(source(), f.impl);
        const [sub] = await gw.handleWebhook(signed('2c93abc'), JSON.stringify({ type: 'subscription_preapproval', data: { id: '2c93abc' } }), {});
        expect(sub).toMatchObject({ kind: 'subscription', tenantId: 7, plan: 'pro', status: 'authorized', amount: 199_000 });
        const [pay] = await gw.handleWebhook(signed('9001'), JSON.stringify({ type: 'subscription_authorized_payment', data: { id: '9001' } }), {});
        // El id del PAGO (777), no el de la cuota: el aviso `payment` del mismo cobro cae en la misma fila.
        expect(pay).toMatchObject({ kind: 'payment', tenantId: null, externalId: '777', status: 'approved', subscriptionExternalId: '2c93abc', mode: 'subscription' });
    });

    it('cancelar la renovación', async () => {
        const f = fakeFetch({ 'PUT /preapproval/2c93abc': { id: '2c93abc', status: 'cancelled' } });
        await new MercadoPagoGateway(source(), f.impl).cancelSubscription('2c93abc');
        expect(f.calls[0]).toMatchObject({ method: 'PUT', body: { status: 'cancelled' } });
    });

    it('estados y métodos', () => {
        expect(mapMpPaymentStatus('approved')).toBe('approved');
        expect(mapMpPaymentStatus('in_process')).toBe('pending');
        expect(mapMpPaymentStatus('rejected')).toBe('rejected');
        expect(mapMpPaymentStatus('charged_back')).toBe('refunded');
        expect(paymentMethodLabel('ticket', 'efecty')).toBe('Efecty');
        expect(paymentMethodLabel('credit_card', 'visa')).toBe('Tarjeta de crédito');
    });
});

// SEC-29 (v0.1.228): la orden aprobada se CAPTURA antes de activar el plan.
describe('PayPal: captura antes de activar', () => {
    const ppEnv = {
        PAYPAL_CLIENT_ID: 'id',
        PAYPAL_CLIENT_SECRET: 'secret',
        PAYPAL_WEBHOOK_ID: 'wh',
        PAYPAL_ENV: 'sandbox',
    } as unknown as Env;
    const approved = JSON.stringify({
        event_type: 'CHECKOUT.ORDER.APPROVED',
        resource: { id: 'ORDER-123', purchase_units: [{ custom_id: 'p:7:pro:2:98' }] },
    });

    function fakeFetch(capture: { status: number; body?: unknown }, order?: { status?: string }) {
        const calls: string[] = [];
        const impl = (async (url: string | URL | Request) => {
            const u = String(url);
            calls.push(u);
            const json = (body: unknown, status = 200) =>
                new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
            if (u.endsWith('/v1/oauth2/token')) return json({ access_token: 't' });
            if (u.endsWith('/verify-webhook-signature')) return json({ verification_status: 'SUCCESS' });
            if (u.endsWith('/capture')) return json(capture.body ?? {}, capture.status);
            if (u.endsWith('/v2/checkout/orders/ORDER-123')) return json(order ?? {});
            return json({}, 404);
        }) as typeof fetch;
        return { impl, calls };
    }

    it('captura COMPLETED → cobro aprobado de la orden, con sus meses', async () => {
        const f = fakeFetch({ status: 201, body: { status: 'COMPLETED' } });
        const [n] = await new PayPalGateway(ppEnv, f.impl).handleWebhook({}, approved);
        expect(n).toMatchObject({ kind: 'payment', tenantId: 7, plan: 'pro', months: 2, externalId: 'ORDER-123', status: 'approved', amount: 98, currency: 'USD' });
        expect(f.calls.some((c) => c.endsWith('/v2/checkout/orders/ORDER-123/capture'))).toBe(true);
    });

    it('captura rechazada o PENDIENTE → nada', async () => {
        expect(await new PayPalGateway(ppEnv, fakeFetch({ status: 400, body: { name: 'INSTRUMENT_DECLINED' } }).impl).handleWebhook({}, approved)).toEqual([]);
        expect(await new PayPalGateway(ppEnv, fakeFetch({ status: 201, body: { status: 'PENDING' } }).impl).handleWebhook({}, approved)).toEqual([]);
    });

    it('reintento con la orden ya capturada → consulta y aprueba', async () => {
        const f = fakeFetch({ status: 422, body: { name: 'UNPROCESSABLE_ENTITY' } }, { status: 'COMPLETED' });
        expect(await new PayPalGateway(ppEnv, f.impl).handleWebhook({}, approved)).toHaveLength(1);
    });

    it('la captura se registra contra la ORDEN (misma fila que la aprobación)', async () => {
        const body = JSON.stringify({
            event_type: 'PAYMENT.CAPTURE.COMPLETED',
            resource: {
                id: 'CAP-1',
                status: 'COMPLETED',
                custom_id: 'p:7:pro:2:98',
                amount: { value: '98.00' },
                supplementary_data: { related_ids: { order_id: 'ORDER-123' } },
            },
        });
        const [n] = await new PayPalGateway(ppEnv, fakeFetch({ status: 201 }).impl).handleWebhook({}, body);
        expect(n).toMatchObject({ externalId: 'ORDER-123', status: 'approved', amount: 98 });
        const pending = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { status: 'PENDING', custom_id: '7:pro' } });
        expect(await new PayPalGateway(ppEnv, fakeFetch({ status: 201 }).impl).handleWebhook({}, pending)).toEqual([]);
    });

    it('mapeo', () => {
        expect(mapPayPalEvent('PAYMENT.CAPTURE.COMPLETED')).toBe('approved');
        expect(mapPayPalEvent('PAYMENT.CAPTURE.REFUNDED')).toBe('refunded');
        expect(mapPayPalEvent('CHECKOUT.ORDER.APPROVED')).toBeNull();
        expect(mapPayPalEvent('BILLING.SUBSCRIPTION.ACTIVATED')).toBeNull();
    });
});

describe('avisos de vencimiento', () => {
    const paid = new Date('2026-06-10T00:00:00Z');
    const at = (d: number) => new Date(paid.getTime() + d * DAY);
    it('tres días antes, al vencer y al cortar', () => {
        expect(reminderKindFor(paid, at(-5), false)).toBeNull();
        expect(reminderKindFor(paid, at(-2), false)).toBe('soon');
        expect(reminderKindFor(paid, at(1), false)).toBe('expired');
        expect(reminderKindFor(paid, at(BILLING_GRACE_DAYS + 1), false)).toBe('read_only');
        expect(reminderKindFor(paid, at(60), false)).toBeNull();
    });
    it('con renovación automática sólo se avisa el corte', () => {
        expect(reminderKindFor(paid, at(-2), true)).toBeNull();
        expect(reminderKindFor(paid, at(1), true)).toBeNull();
        expect(reminderKindFor(paid, at(BILLING_GRACE_DAYS + 1), true)).toBe('read_only');
    });
    it('el correo escapa el nombre de la empresa', () => {
        const m = billingReminderEmail('expired', { tenantName: '<b>Acme</b>', paidUntil: paid, link: 'https://app.test/#/settings?s=suscripcion' });
        expect(m.subject).toContain('<b>Acme</b>');
        expect(m.html).not.toContain('<b>Acme</b>');
        expect(m.html).toContain('&lt;b&gt;Acme&lt;/b&gt;');
        expect(m.text).toContain(`${BILLING_GRACE_DAYS} días de gracia`);
    });
});

// ── Registro de pagos con Postgres real ────────────────────────────────

class FakeGateway implements PaymentGateway {
    readonly supportsSubscription: boolean;
    notices: PaymentNotice[] = [];
    cancelled: string[] = [];
    subs = 0;
    lastSubscription: SubscriptionRequest | null = null;
    lastCheckout: CheckoutRequest | null = null;
    constructor(
        readonly provider: 'paypal' | 'mercadopago',
        private readonly enabled = true,
    ) {
        this.supportsSubscription = provider === 'mercadopago';
    }
    isEnabled(): Promise<boolean> {
        return Promise.resolve(this.enabled);
    }
    createCheckout(req: CheckoutRequest) {
        this.lastCheckout = req;
        return Promise.resolve({ url: `https://pay.test/${req.reference}`, externalId: 'pref_1' });
    }
    createSubscription(req: SubscriptionRequest) {
        this.lastSubscription = req;
        this.subs++;
        return Promise.resolve({ url: `https://pay.test/sub/${this.subs}`, externalId: `sub_${this.subs}`, status: 'pending' as const, nextPaymentAt: null });
    }
    cancelSubscription(id: string) {
        this.cancelled.push(id);
        return Promise.resolve();
    }
    handleWebhook(): Promise<PaymentNotice[]> {
        return Promise.resolve(this.notices);
    }
}

const pay = (over: Partial<Extract<PaymentNotice, { kind: 'payment' }>>): PaymentNotice => ({
    kind: 'payment',
    tenantId: null,
    plan: 'pro',
    mode: 'period',
    months: 1,
    externalId: 'x',
    status: 'approved',
    amount: 199_000,
    currency: 'COP',
    method: 'PSE',
    ...over,
});

describe('PaymentsService (Postgres real)', () => {
    let pg: TestPg;
    let mp: FakeGateway;
    let svc: PaymentsService;
    let tA: number;
    let tB: number;
    const env = { ...loadEnv(), APP_BASE_URL: 'https://app.test' } as Env;

    beforeAll(async () => {
        pg = await startPostgres();
        const [a] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME', plan: 'trial', status: 'trialing' }).returning();
        const [b] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        tA = a!.id;
        tB = b!.id;
    }, 120_000);
    afterAll(async () => pg?.stop());

    beforeEach(async () => {
        mp = new FakeGateway('mercadopago');
        svc = new PaymentsService(env, [mp, new FakeGateway('paypal', false)], fakePlans([STARTER, PRO]), new TenantDb(pg.db), pg.db);
        for (const id of [tA, tB]) {
            await withTenant(pg.db, id, async (tx) => {
                await tx.delete(billingPayments).where(eq(billingPayments.tenantId, id));
                await tx.delete(billingSubscriptions).where(eq(billingSubscriptions.tenantId, id));
            });
            await pg.db.update(tenants).set({ paidUntil: null, plan: 'trial', status: 'trialing' }).where(eq(tenants.id, id));
        }
    });

    const tenantRow = async (id: number) => (await pg.db.select().from(tenants).where(eq(tenants.id, id)))[0]!;

    it('config: sólo proveedores con credenciales; renovación sólo donde se puede', async () => {
        expect(await svc.config()).toMatchObject({ providers: ['mercadopago'], subscription_providers: ['mercadopago'] });
    });

    it('checkout de período: total = precio × meses, referencia con el monto', async () => {
        const res = await svc.createCheckout(tA, 'ana@acme.co', { plan: 'pro', provider: 'mercadopago', mode: 'period', months: 3 });
        expect(res).toMatchObject({ mode: 'period', url: `https://pay.test/p:${tA}:pro:3:597000` });
        expect(mp.lastCheckout).toMatchObject({ amount: 597_000, currency: 'COP', returnUrl: 'https://app.test/#/settings?s=suscripcion&checkout=success' });
        await expect(svc.createCheckout(tA, 'a@b.co', { plan: 'pro', provider: 'paypal', mode: 'period', months: 1 })).rejects.toThrow(/no está disponible/);
        await expect(svc.createCheckout(tA, 'a@b.co', { plan: 'enterprise', provider: 'mercadopago', mode: 'period', months: 1 })).rejects.toThrow(/precio/);
    });

    it('un pago aprobado extiende el período UNA vez, aunque el aviso se repita', async () => {
        const before = Date.now();
        mp.notices = [pay({ tenantId: tA, externalId: 'p1', months: 3 })];
        expect(await svc.handleWebhook('mercadopago', {}, '{}')).toBe(1);
        expect(await svc.handleWebhook('mercadopago', {}, '{}')).toBe(0);
        const t = await tenantRow(tA);
        expect(t.plan).toBe('pro');
        expect(t.status).toBe('active');
        const expected = extendPaidUntil(null, new Date(before), 3).getTime();
        expect(Math.abs(t.paidUntil!.getTime() - expected)).toBeLessThan(5_000);
        const info = await svc.subscriptionInfo(tA);
        expect(info.payments).toHaveLength(1);
        expect(info.payments[0]).toMatchObject({ status: 'approved', months: 3, method: 'PSE', period_end: t.paidUntil!.toISOString() });
        expect(info.read_only_at).toBe(new Date(t.paidUntil!.getTime() + BILLING_GRACE_DAYS * DAY).toISOString());
    });

    it('pagar por adelantado suma sobre lo pagado; un pendiente no toca el estado ni deshace', async () => {
        const future = new Date(Date.now() + 10 * DAY);
        await pg.db.update(tenants).set({ paidUntil: future, status: 'active', plan: 'pro' }).where(eq(tenants.id, tA));
        // Pendiente (PSE en proceso): se registra, la empresa sigue igual.
        await svc.apply('mercadopago', pay({ tenantId: tA, externalId: 'p2', status: 'pending' }));
        expect((await tenantRow(tA)).status).toBe('active');
        expect((await tenantRow(tA)).paidUntil!.getTime()).toBe(future.getTime());
        // Aprobado: un mes MÁS sobre lo pagado.
        await svc.apply('mercadopago', pay({ tenantId: tA, externalId: 'p2', status: 'approved' }));
        expect((await tenantRow(tA)).paidUntil!.getTime()).toBe(addMonthsClamped(future, 1).getTime());
        // El aviso viejo (pendiente) que llega tarde no lo deshace.
        expect(await svc.apply('mercadopago', pay({ tenantId: tA, externalId: 'p2', status: 'pending' }))).toBe(false);
        const [row] = (await svc.subscriptionInfo(tA)).payments;
        expect(row?.status).toBe('approved');
    });

    it('un reembolso le quita esos meses al período', async () => {
        await svc.apply('mercadopago', pay({ tenantId: tA, externalId: 'p3', months: 6 }));
        const paid = (await tenantRow(tA)).paidUntil!;
        await svc.apply('mercadopago', pay({ tenantId: tA, externalId: 'p3', status: 'refunded' }));
        expect((await tenantRow(tA)).paidUntil!.getTime()).toBe(addMonthsClamped(paid, -6).getTime());
        expect((await svc.subscriptionInfo(tA)).payments[0]).toMatchObject({ status: 'refunded', period_end: null });
    });

    it('rechazado: queda en el historial y la empresa no cambia', async () => {
        await svc.apply('mercadopago', pay({ tenantId: tA, externalId: 'p4', status: 'rejected' }));
        expect((await tenantRow(tA)).status).toBe('trialing');
        expect((await svc.subscriptionInfo(tA)).payments[0]?.status).toBe('rejected');
    });

    it('renovación automática: arranca al vencer lo pagado; el cobro por los dos caminos cuenta una vez', async () => {
        const future = new Date(Date.now() + 15 * DAY);
        await pg.db.update(tenants).set({ paidUntil: future, status: 'active', plan: 'starter' }).where(eq(tenants.id, tA));
        const res = await svc.createCheckout(tA, 'ana@acme.co', { plan: 'pro', provider: 'mercadopago', mode: 'subscription', months: 1 });
        expect(res).toMatchObject({ mode: 'subscription', external_id: 'sub_1' });
        expect(mp.lastSubscription).toMatchObject({ amount: 199_000, payerEmail: 'ana@acme.co', reference: `s:${tA}:pro` });
        expect(mp.lastSubscription!.startAt!.getTime()).toBe(future.getTime());
        let info = await svc.subscriptionInfo(tA);
        expect(info.auto_renew).toMatchObject({ status: 'pending', authorize_url: 'https://pay.test/sub/1', plan: 'pro' });

        await svc.apply('mercadopago', {
            kind: 'subscription',
            tenantId: tA,
            plan: 'pro',
            externalId: 'sub_1',
            status: 'authorized',
            amount: 199_000,
            currency: 'COP',
            nextPaymentAt: future,
            authorizeUrl: 'https://pay.test/sub/1',
        });
        info = await svc.subscriptionInfo(tA);
        expect(info.auto_renew).toMatchObject({ status: 'authorized', authorize_url: null });

        // La cuota llega SIN empresa (sólo el id de la suscripción) y por dos avisos.
        const cuota = pay({ externalId: 'pay-777', mode: 'subscription', subscriptionExternalId: 'sub_1', plan: null, method: 'Tarjeta' });
        expect(await svc.apply('mercadopago', cuota)).toBe(true);
        expect(await svc.apply('mercadopago', { ...cuota, tenantId: tA, plan: 'pro' })).toBe(false);
        const t = await tenantRow(tA);
        expect(t.plan).toBe('pro');
        expect(t.paidUntil!.getTime()).toBe(addMonthsClamped(future, 1).getTime());

        // Con una activa, abrir otra se rechaza (hay que cancelar primero).
        await expect(svc.createCheckout(tA, 'a@b.co', { plan: 'starter', provider: 'mercadopago', mode: 'subscription', months: 1 })).rejects.toThrow(/cancelala primero/);

        // Cancelar: en el proveedor y acá; lo pagado se conserva.
        info = await svc.cancelAutoRenew(tA);
        expect(mp.cancelled).toEqual(['sub_1']);
        expect(info.auto_renew).toBeNull();
        expect(info.paid_until).toBe(t.paidUntil!.toISOString());
        await expect(svc.cancelAutoRenew(tA)).rejects.toThrow(/No hay/);
    });

    it('un intento sin autorizar se descarta al abrir otro; una nueva autorizada reemplaza a la vieja', async () => {
        await svc.createCheckout(tA, 'a@b.co', { plan: 'pro', provider: 'mercadopago', mode: 'subscription', months: 1 });
        await svc.createCheckout(tA, 'a@b.co', { plan: 'starter', provider: 'mercadopago', mode: 'subscription', months: 1 });
        expect(mp.cancelled).toEqual(['sub_1']);
        // Llega "autorizada" otra que no conocíamos (p. ej. creada en otro intento).
        await svc.apply('mercadopago', {
            kind: 'subscription',
            tenantId: tA,
            plan: 'pro',
            externalId: 'sub_x',
            status: 'authorized',
            amount: 199_000,
            currency: 'COP',
            nextPaymentAt: null,
            authorizeUrl: null,
        });
        expect(mp.cancelled).toEqual(['sub_1', 'sub_2']);
        expect((await svc.subscriptionInfo(tA)).auto_renew).toMatchObject({ plan: 'pro', status: 'authorized' });
    });

    it('aviso sin empresa reconocible o de una empresa borrada → nada', async () => {
        expect(await svc.apply('mercadopago', pay({ externalId: 'zz' }))).toBe(false);
        expect(await svc.apply('mercadopago', pay({ tenantId: 999_999, externalId: 'zz' }))).toBe(false);
    });

    it('RLS: el historial de una empresa no se ve desde otra; la consola ve todo', async () => {
        await svc.apply('mercadopago', pay({ tenantId: tA, externalId: 'rls-a' }));
        await svc.apply('mercadopago', pay({ tenantId: tB, externalId: 'rls-b', plan: 'starter' }));
        expect((await svc.subscriptionInfo(tB)).payments.map((p) => p.plan)).toEqual(['starter']);
        const all = await svc.recentPayments();
        expect(all.map((p) => p.tenant_name).sort()).toEqual(['ACME', 'Otra']);
        // Leer la tabla con el scope de la otra empresa no trae nada ajeno.
        const fromB = await withTenant(pg.db, tB, (tx) => tx.select().from(billingPayments).where(eq(billingPayments.tenantId, tA)));
        expect(fromB).toEqual([]);
    });
});
