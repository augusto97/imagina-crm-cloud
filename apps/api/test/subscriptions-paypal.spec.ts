import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUBSCRIPTION_STATUS_OPTIONS } from '@imagina-base/shared';

/**
 * v0.1.373 (addendum ADR-S96) — Suscripciones de las empresas con SU cuenta
 * de PayPal, de punta a punta con Postgres real y la API de suscripciones de
 * PayPal (Billing v1) simulada en el borde de red (`safeWebhookFetch`): el
 * producto y el plan de PayPal que se crean UNA vez, el valor de cada cliente
 * en línea, la aprobación, los cobros que se releen (nunca se le cree al
 * aviso), el cobro fallido que PayPal informa aparte, la suspensión por
 * fallos (mora, no pausa), pausar/reanudar/cambiar el valor/cancelar, la
 * pendiente que PayPal no deja cancelar, y los textos públicos con PayPal.
 */
interface FakeCall {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}
const net = vi.hoisted(() => ({
    calls: [] as FakeCall[],
    handler: (_call: FakeCall): { status: number; body: string } => ({ status: 404, body: '' }),
}));
vi.mock('../src/common/safe-fetch', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/common/safe-fetch')>();
    return {
        ...real,
        safeWebhookFetch: async (url: string, opts: { method?: string; headers?: Record<string, string>; body?: string }) => {
            const call = { url, method: opts.method, headers: opts.headers, body: opts.body };
            net.calls.push(call);
            const res = net.handler(call);
            return { status: res.status, body: res.body, contentType: 'application/json' };
        },
    };
});

import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { CollectionsService } from '../src/collections/collections.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { connections, fields, lists, records, subscriptionCharges, subscriptionPlans, subscriptions, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import {
    createPaypalSubscriptionRequest,
    failedPaymentCharge,
    mapPaypalSubscriptionStatus,
    parsePaypalSubscription,
    parsePaypalTransactions,
    paypalChargeState,
    paypalPlanKey,
    paypalSubscriptionNotice,
} from '../src/subscriptions/paypal-subscriptions';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const LIVE = 'https://api-m.paypal.com';
const APP = 'https://app.imagina.test';
const LIVE_ID = 'AbcLiveClientId0000000000000000000000000001';
const LIVE_SECRET = 'EFghLiveSecret00000000000000000000000000001';
const DAY = 24 * 60 * 60 * 1000;

class CapturingDispatcher extends AutomationDispatcher {
    events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

interface FakeSub {
    id: string;
    status: string;
    plan_id: string;
    custom_id: string;
    start_time: string;
    subscriber: { email_address: string };
    price: { value: string; currency_code: string };
    cycle: Record<string, unknown>;
    return_url: string;
    cancel_url: string;
    failed: number;
    last_failed: { amount: Record<string, string>; time: string; reason_code: string } | null;
    last_payment: { amount: Record<string, string>; time: string } | null;
    reason?: string;
}

/** Un PayPal con memoria: productos, planes, suscripciones, cobros, ventas y webhooks. */
function fakePaypal() {
    const products = new Map<string, Record<string, unknown>>();
    const plans = new Map<string, Record<string, unknown>>();
    const subs = new Map<string, FakeSub>();
    const tx = new Map<string, Array<Record<string, unknown>>>();
    const sales = new Map<string, Record<string, unknown>>();
    const webhooks: Array<{ id: string; url: string }> = [];
    const byRequestId = new Map<string, string>();
    let n = 0;
    const ok = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });
    const view = (s: FakeSub) => ({
        id: s.id,
        status: s.status,
        plan_id: s.plan_id,
        custom_id: s.custom_id,
        start_time: s.start_time,
        subscriber: s.subscriber,
        plan: { billing_cycles: [{ ...s.cycle, pricing_scheme: { fixed_price: s.price } }] },
        billing_info: {
            failed_payments_count: s.failed,
            ...(s.last_payment ? { last_payment: s.last_payment } : {}),
            ...(s.last_failed ? { last_failed_payment: s.last_failed } : {}),
            ...(s.status === 'ACTIVE' ? { next_billing_time: new Date(Date.now() + 30 * DAY).toISOString() } : {}),
        },
        links: s.status === 'APPROVAL_PENDING' ? [{ rel: 'approve', href: `https://www.paypal.com/webapps/billing/subscriptions?ba_token=${s.id}` }] : [],
    });
    net.handler = (call) => {
        if (!call.url.startsWith(LIVE)) return { status: 404, body: '' };
        const path = call.url.slice(LIVE.length);
        if (path === '/v1/oauth2/token') {
            const raw = Buffer.from((call.headers?.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
            return raw === `${LIVE_ID}:${LIVE_SECRET}` ? ok({ access_token: 'tok-live', expires_in: 32400 }) : { status: 401, body: '{"error":"invalid_client"}' };
        }
        if (!/^Bearer tok-/.test(call.headers?.authorization ?? '')) return { status: 401, body: '{}' };
        const body = call.body ? (JSON.parse(call.body) as Record<string, unknown> & unknown[]) : null;
        const rid = call.headers?.['paypal-request-id'];
        const remembered = (kind: string, make: () => string): string => {
            const k = rid ? `${kind}:${rid}` : null;
            if (k && byRequestId.has(k)) return byRequestId.get(k)!;
            const id = make();
            if (k) byRequestId.set(k, id);
            return id;
        };
        if (path === '/v1/catalogs/products' && call.method === 'POST') {
            const id = remembered('product', () => {
                const id = `PROD-${String(++n).padStart(6, '0')}`;
                products.set(id, { id, ...body });
                return id;
            });
            return ok(products.get(id), 201);
        }
        if (path === '/v1/billing/plans' && call.method === 'POST') {
            if (!products.has(String(body?.product_id))) return { status: 400, body: '{"name":"INVALID_REQUEST"}' };
            const id = remembered('plan', () => {
                const id = `P-${String(++n).padStart(8, '0')}`;
                plans.set(id, { id, status: 'ACTIVE', ...body });
                return id;
            });
            return ok(plans.get(id), 201);
        }
        if (path === '/v1/billing/subscriptions' && call.method === 'POST') {
            const plan = plans.get(String(body?.plan_id));
            if (!plan) return { status: 422, body: JSON.stringify({ details: [{ issue: 'PLAN_NOT_FOUND' }] }) };
            const id = remembered('sub', () => {
                const id = `I-${String(++n).padStart(8, '0')}`;
                const ctx = body!.application_context as Record<string, string>;
                const cycles = plan.billing_cycles as Array<Record<string, unknown>>;
                const inline = (body!.plan as { billing_cycles: Array<{ pricing_scheme: { fixed_price: FakeSub['price'] } }> }).billing_cycles[0]!.pricing_scheme.fixed_price;
                subs.set(id, {
                    id,
                    status: 'APPROVAL_PENDING',
                    plan_id: String(body!.plan_id),
                    custom_id: String(body!.custom_id),
                    start_time: String(body!.start_time ?? new Date().toISOString()),
                    subscriber: body!.subscriber as FakeSub['subscriber'],
                    price: inline,
                    cycle: cycles[0]!,
                    return_url: ctx.return_url!,
                    cancel_url: ctx.cancel_url!,
                    failed: 0,
                    last_failed: null,
                    last_payment: null,
                });
                tx.set(id, []);
                return id;
            });
            return ok(view(subs.get(id)!), 201);
        }
        let m = /^\/v1\/billing\/subscriptions\/([A-Z0-9-]+)\/transactions\?/.exec(path);
        if (m) return subs.has(m[1]!) ? ok({ transactions: tx.get(m[1]!) ?? [] }) : { status: 404, body: '{}' };
        m = /^\/v1\/billing\/subscriptions\/([A-Z0-9-]+)\/(suspend|activate|cancel)$/.exec(path);
        if (m && call.method === 'POST') {
            const s = subs.get(m[1]!);
            if (!s) return { status: 404, body: '{}' };
            const allowed = { suspend: ['ACTIVE'], activate: ['SUSPENDED'], cancel: ['ACTIVE', 'SUSPENDED'] }[m[2] as 'suspend' | 'activate' | 'cancel'];
            if (!allowed.includes(s.status)) return { status: 422, body: JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'SUBSCRIPTION_STATUS_INVALID' }] }) };
            s.status = { suspend: 'SUSPENDED', activate: 'ACTIVE', cancel: 'CANCELLED' }[m[2] as 'suspend' | 'activate' | 'cancel'];
            s.reason = (body as Record<string, string> | null)?.reason;
            return { status: 204, body: '' };
        }
        m = /^\/v1\/billing\/subscriptions\/([A-Z0-9-]+)(\?.*)?$/.exec(path);
        if (m) {
            const s = subs.get(m[1]!);
            if (!s) return { status: 404, body: '{}' };
            if (call.method === 'PATCH') {
                const op = (body as unknown as Array<{ path: string; value: FakeSub['price'] }>)[0]!;
                if (!/fixed_price$/.test(op.path)) return { status: 422, body: '{}' };
                s.price = op.value;
                return { status: 204, body: '' };
            }
            return ok(view(s));
        }
        m = /^\/v1\/payments\/sale\/([A-Z0-9-]+)$/.exec(path);
        if (m) return sales.has(m[1]!) ? ok(sales.get(m[1]!)) : { status: 404, body: '{}' };
        if (path === '/v1/notifications/webhooks' && call.method === 'GET') return ok({ webhooks });
        if (path === '/v1/notifications/webhooks' && call.method === 'POST') {
            const hook = { id: `WH-${++n}`, url: String(body?.url) };
            webhooks.push(hook);
            return ok(hook, 201);
        }
        return { status: 404, body: '' };
    };
    return {
        products,
        plans,
        subs,
        sales,
        approve(id: string) {
            subs.get(id)!.status = 'ACTIVE';
        },
        /** Un cobro de la cuota: bien (venta COMPLETED) o fallido (al 3.º PayPal la suspende). */
        charge(id: string, good: boolean, at = new Date(), reason = 'PAYMENT_DENIED'): string | null {
            const s = subs.get(id)!;
            const time = at.toISOString();
            if (good) {
                const saleId = `SALE${String(++n).padStart(6, '0')}`;
                tx.get(id)!.push({ id: saleId, status: 'COMPLETED', time, amount_with_breakdown: { gross_amount: { ...s.price } } });
                sales.set(saleId, { id: saleId, state: 'completed', billing_agreement_id: id });
                s.last_payment = { amount: { ...s.price }, time };
                s.failed = 0;
                s.last_failed = null;
                return saleId;
            }
            s.failed += 1;
            s.last_failed = { amount: { ...s.price }, time, reason_code: reason };
            if (s.failed >= 3) s.status = 'SUSPENDED';
            return null;
        },
        calls: (re: RegExp, method?: string) => net.calls.filter((c) => re.test(c.url) && (!method || c.method === method)),
    };
}

describe('Suscripciones de las empresas — PayPal (v0.1.373)', () => {
    let pg: TestPg;
    let connectors: ConnectorsService;
    let collections: CollectionsService;
    let subs: SubscriptionsService;
    let fieldsService: FieldsService;
    let listsService: ListsService;
    let dispatcher: CapturingDispatcher;
    let tenantId: number;
    let adminId: number;
    const admin = { userId: 0, role: 'admin' as const };

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: APP });
        const store = memoryOAuthStore();
        const audit = new AuditService(tenantDb);
        connectors = new ConnectorsService(tenantDb, pg.db, env, store, audit, new IntegrationAppsService(store, env));
        const rt = new RealtimeService();
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        dispatcher = new CapturingDispatcher();
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        collections = new CollectionsService(tenantDb, pg.db, env, connectors, listsService, new RecordsRepository(), activity, rt, dispatcher, audit, fieldsService);
        subs = new SubscriptionsService(tenantDb, pg.db, env, connectors, listsService, new RecordsRepository(), activity, rt, dispatcher, audit, collections, fieldsService);
        subs.onModuleInit();
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME Studio', settings: { format: { timezone: 'America/Bogota' } } }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme.test', passwordHash: 'x', name: 'Ada' }).returning();
        adminId = u!.id;
        admin.userId = adminId;
    });

    afterAll(async () => {
        subs?.onApplicationShutdown();
        await pg?.stop();
    });

    beforeEach(async () => {
        net.calls.length = 0;
        net.handler = () => ({ status: 404, body: '' });
        dispatcher.events.length = 0;
        await withTenant(pg.db, tenantId, async (t) => {
            await t.delete(subscriptionCharges).where(eq(subscriptionCharges.tenantId, tenantId));
            await t.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId));
            await t.delete(subscriptionPlans).where(eq(subscriptionPlans.tenantId, tenantId));
            await t.delete(records).where(eq(records.tenantId, tenantId));
            await t.delete(fields).where(eq(fields.tenantId, tenantId));
            await t.delete(lists).where(eq(lists.tenantId, tenantId));
            await t.delete(connections).where(eq(connections.tenantId, tenantId));
        });
    });

    async function connect(): Promise<number> {
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'paypal', {
            fields: { client_id: LIVE_ID, client_secret: LIVE_SECRET },
            visibility: 'workspace',
        });
        return connection.id;
    }

    async function seedClient(): Promise<{ listId: number; slug: string; recordId: number; recordId2: number }> {
        const list = await listsService.create(tenantId, { name: 'Clientes', slug: 'clientes' });
        const nombre = await fieldsService.create(tenantId, 'clientes', { label: 'Nombre', type: 'text' });
        const [r1, r2] = await withTenant(pg.db, tenantId, (t) =>
            t
                .insert(records)
                .values([
                    { tenantId, listId: list.id, data: { [`f${nombre.id}`]: 'Studio Lumen' }, createdBy: adminId },
                    { tenantId, listId: list.id, data: { [`f${nombre.id}`]: 'Café Aurora' }, createdBy: adminId },
                ])
                .returning(),
        );
        return { listId: list.id, slug: 'clientes', recordId: r1!.id, recordId2: r2!.id };
    }

    async function recordData(listId: number, recordId: number): Promise<Record<string, unknown>> {
        const [r] = await withTenant(pg.db, tenantId, (t) => t.select().from(records).where(and(eq(records.listId, listId), eq(records.id, recordId))));
        return r!.data as Record<string, unknown>;
    }

    async function plan(connectionId: number, extra: Record<string, unknown> = {}) {
        return subs.createPlan(tenantId, admin, {
            connection_id: connectionId,
            name: 'Soporte mensual',
            description: null,
            amount: 49,
            currency: 'USD',
            frequency: 1,
            frequency_type: 'months',
            cycles: null,
            trial_days: 0,
            grace_days: 5,
            on_expire: 'mark',
            ...extra,
        } as Parameters<SubscriptionsService['createPlan']>[2]);
    }

    async function refOf(id: number): Promise<string> {
        const [r] = await withTenant(pg.db, tenantId, (t) => t.select({ reference: subscriptions.reference }).from(subscriptions).where(eq(subscriptions.id, id)));
        return r!.reference;
    }

    async function hookToken(connectionId: number): Promise<string> {
        return (await collections.hookUrlFor(tenantId, connectionId, 'paypal')).split('/').pop()!;
    }

    // ── Piezas puras ────────────────────────────────────────────────────

    it('piezas puras: el pedido de suscripción, estados, cobros fallidos y avisos', () => {
        const now = new Date('2026-11-05T12:00:00Z');
        expect(paypalPlanKey({ frequency: 3, frequencyType: 'months', cycles: 12, currency: 'usd' })).toBe('MONTH-3-12-USD');
        expect(paypalPlanKey({ frequency: 15, frequencyType: 'days', cycles: null, currency: 'EUR' })).toBe('DAY-15-0-EUR');

        const req = createPaypalSubscriptionRequest(
            LIVE,
            'tok',
            {
                planId: 'P-1',
                reference: 'ibs_abc12345',
                payerEmail: 'a@b.co',
                amount: 49.999,
                currency: 'usd',
                startAt: new Date('2026-12-01T05:00:00Z'),
                brandName: 'ACME',
                returnUrl: `${APP}/vuelta`,
                cancelUrl: `${APP}/vuelta?cancelado=1`,
            },
            now,
        );
        expect(req.headers['paypal-request-id']).toBe('ibs_abc12345');
        const body = JSON.parse(req.body!) as Record<string, unknown> & { plan: { billing_cycles: Array<{ pricing_scheme: { fixed_price: unknown } }> }; application_context: Record<string, string> };
        expect(body).toMatchObject({ plan_id: 'P-1', custom_id: 'ibs_abc12345', start_time: '2026-12-01T05:00:00.000Z', subscriber: { email_address: 'a@b.co' } });
        // El valor de ESTE cliente va en línea (no hace falta otro plan de PayPal).
        expect(body.plan.billing_cycles[0]!.pricing_scheme.fixed_price).toEqual({ value: '50.00', currency_code: 'USD' });
        expect(body.application_context).toMatchObject({ user_action: 'SUBSCRIBE_NOW', shipping_preference: 'NO_SHIPPING', cancel_url: `${APP}/vuelta?cancelado=1` });
        // Un inicio en el pasado no se manda (PayPal lo rechaza): cobra al aprobar.
        const past = createPaypalSubscriptionRequest(LIVE, 'tok', { planId: 'P-1', reference: 'r', payerEmail: 'a@b.co', amount: 1, currency: 'USD', startAt: new Date('2026-01-01'), brandName: '', returnUrl: 'x', cancelUrl: 'y' }, now);
        expect((JSON.parse(past.body!) as Record<string, unknown>).start_time).toBeUndefined();

        expect(mapPaypalSubscriptionStatus('APPROVAL_PENDING')).toBe('pending');
        expect(mapPaypalSubscriptionStatus('ACTIVE')).toBe('authorized');
        expect(mapPaypalSubscriptionStatus('SUSPENDED')).toBe('paused');
        expect(mapPaypalSubscriptionStatus('EXPIRED')).toBe('cancelled');

        const base = { id: 'I-1234ABCD', status: 'ACTIVE', custom_id: 'ibs_x', plan: { billing_cycles: [{ tenure_type: 'REGULAR', pricing_scheme: { fixed_price: { value: '49.00', currency_code: 'USD' } } }] } };
        const failing = parsePaypalSubscription(
            200,
            JSON.stringify({
                ...base,
                billing_info: {
                    failed_payments_count: 1,
                    last_payment: { time: '2026-10-05T12:00:00Z', amount: { value: '49.00', currency_code: 'USD' } },
                    last_failed_payment: { time: '2026-11-05T12:00:00Z', amount: { value: '49.00', currency_code: 'USD' }, reason_code: 'PAYER_CANNOT_PAY' },
                },
            }),
        )!;
        expect(failing).toMatchObject({ reference: 'ibs_x', amount: 49, currency: 'USD', failedCount: 1 });
        // Activa con el último cobro fallido: PayPal lo reintenta.
        expect(paypalChargeState(failing)).toEqual({ providerStatus: 'authorized', retrying: true, failedFinal: false });
        // El fallo es un cobro rechazado con un id estable (dos lecturas = una fila) y el motivo en palabras.
        const f1 = failedPaymentCharge(failing, 'USD')!;
        expect(f1).toMatchObject({ paymentStatus: 'rejected', failureReason: expect.stringMatching(/no puede pagar/) });
        expect(failedPaymentCharge(failing, 'USD')!.paymentId).toBe(f1.paymentId);
        // Suspendida por los fallos: es mora, no una pausa.
        const suspended = parsePaypalSubscription(200, JSON.stringify({ ...base, status: 'SUSPENDED', billing_info: { failed_payments_count: 3, last_failed_payment: { time: '2026-11-08T12:00:00Z', reason_code: 'PAYMENT_DENIED' } } }))!;
        expect(paypalChargeState(suspended)).toEqual({ providerStatus: 'authorized', retrying: false, failedFinal: true });
        // Suspendida sin fallos: la pausó alguien.
        const paused = parsePaypalSubscription(200, JSON.stringify({ ...base, status: 'SUSPENDED', billing_info: { failed_payments_count: 0 } }))!;
        expect(paypalChargeState(paused).providerStatus).toBe('paused');

        const invoices = parsePaypalTransactions(
            200,
            JSON.stringify({
                transactions: [
                    { id: 'SALE1', status: 'COMPLETED', time: '2026-10-05T12:00:00Z', amount_with_breakdown: { gross_amount: { value: '49.00', currency_code: 'USD' } } },
                    { id: 'SALE2', status: 'REFUNDED', time: '2026-09-05T12:00:00Z', amount_with_breakdown: { gross_amount: { value: '49.00', currency_code: 'USD' } } },
                    { id: "'; drop", status: 'COMPLETED' },
                ],
            }),
            'I-1',
        )!;
        expect(invoices.map((i) => [i.paymentId, i.paymentStatus, i.amount])).toEqual([
            ['SALE1', 'approved', 49],
            ['SALE2', 'refunded', 49],
        ]);
        expect(parsePaypalTransactions(404, '', 'I-1')).toEqual([]);
        expect(parsePaypalTransactions(500, '', 'I-1')).toBeNull();

        expect(paypalSubscriptionNotice({ event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-1234ABCD' } })).toEqual({ kind: 'subscription', id: 'I-1234ABCD' });
        expect(paypalSubscriptionNotice({ event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE1', billing_agreement_id: 'I-1234ABCD' } })).toEqual({ kind: 'subscription', id: 'I-1234ABCD' });
        expect(paypalSubscriptionNotice({ event_type: 'PAYMENT.SALE.REFUNDED', resource: { id: 'REF1', sale_id: 'SALE1' } })).toEqual({ kind: 'sale', saleId: 'SALE1', subscriptionId: null });
        expect(paypalSubscriptionNotice({ event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORD1' } })).toBeNull();
    });

    // ── Planes y suscribir ──────────────────────────────────────────────

    it('planes en dólares; el producto y el plan de PayPal se crean UNA vez y cada cliente lleva su valor', async () => {
        const pp = fakePaypal();
        const connId = await connect();
        await expect(plan(connId, { currency: 'COP' })).rejects.toThrow(/pesos colombianos/);
        const p = await plan(connId);
        expect(p.provider).toBe('paypal');
        const c = await seedClient();
        const mapping = await subs.setupFields(tenantId, admin, c.slug);

        const s1 = await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'Pagos@Lumen.test' });
        expect(s1).toMatchObject({ provider: 'paypal', status: 'pending', amount: 49, currency: 'USD' });
        expect(s1.url).toMatch(/^https:\/\/www\.paypal\.com\//);
        const s2 = await subs.createForRecord(tenantId, admin, c.slug, c.recordId2, { plan_id: p.id, payer_email: 'cafe@aurora.test', amount: 39.5 });
        expect(s2.amount).toBe(39.5);

        // Un producto y un plan para los dos clientes; los ids quedan en el plan.
        expect(pp.products.size).toBe(1);
        expect(pp.plans.size).toBe(1);
        const [row] = await withTenant(pg.db, tenantId, (t) => t.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, p.id)));
        expect(row!.providerRefs).toMatchObject({ product_id: [...pp.products.keys()][0], plans: { 'MONTH-1-0-USD': [...pp.plans.keys()][0] } });
        // Cada suscripción con el valor de su cliente y nuestra referencia; el plan de PayPal tiene el valor del plan.
        const created = [...pp.subs.values()];
        expect(created.map((s) => s.price.value)).toEqual(['49.00', '39.50']);
        expect(created[0]!.custom_id).toBe(await refOf(s1.id));
        expect(created[0]!.subscriber.email_address).toBe('pagos@lumen.test');
        expect(created[0]!.cancel_url).toMatch(/cancelado=1$/);
        // El link para autorizar quedó en la columna del registro.
        expect((await recordData(c.listId, c.recordId))[`f${mapping.link!}`]).toBe(s1.url);

        // Otra forma de cobro (cada 3 meses) necesita OTRO plan de PayPal, con el mismo producto.
        await subs.updatePlan(tenantId, admin, p.id, { frequency: 3 });
        const [c3] = await withTenant(pg.db, tenantId, (t) =>
            t.insert(records).values({ tenantId, listId: c.listId, data: {}, createdBy: adminId }).returning(),
        );
        await subs.createForRecord(tenantId, admin, c.slug, c3!.id, { plan_id: p.id, payer_email: 'tres@x.test' });
        expect(pp.products.size).toBe(1);
        expect(pp.plans.size).toBe(2);
    });

    it('aprobar y cobrar: el estado se relee de PayPal, los avisos sólo dicen qué mirar y una venta se cuenta una vez', async () => {
        const pp = fakePaypal();
        const connId = await connect();
        const p = await plan(connId);
        const c = await seedClient();
        const mapping = await subs.setupFields(tenantId, admin, c.slug);
        const sub = await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'pagos@lumen.test' });
        const ppId = [...pp.subs.keys()][0]!;
        const token = await hookToken(connId);

        // Un aviso con datos inventados no cambia nada: se relee y sigue pendiente.
        expect(await collections.handleHook(token, {}, { event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: ppId, status: 'ACTIVE' } })).toBe('applied');
        let [row] = await withTenant(pg.db, tenantId, (t) => t.select().from(subscriptions).where(eq(subscriptions.id, sub.id)));
        expect(row!.status).toBe('pending');

        // El cliente aprueba y PayPal cobra la primera cuota.
        pp.approve(ppId);
        const saleId = pp.charge(ppId, true)!;
        expect(await collections.handleHook(token, {}, { event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: ppId } })).toBe('applied');
        // La venta llega por su propio aviso; sin `billing_agreement_id` se busca en la venta.
        expect(await collections.handleHook(token, {}, { event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: saleId } })).toBe('applied');
        [row] = await withTenant(pg.db, tenantId, (t) => t.select().from(subscriptions).where(eq(subscriptions.id, sub.id)));
        expect(row).toMatchObject({ status: 'active', chargesPaid: 1, url: null });
        const charges = await withTenant(pg.db, tenantId, (t) => t.select().from(subscriptionCharges).where(eq(subscriptionCharges.subscriptionId, sub.id)));
        expect(charges).toHaveLength(1);
        expect(charges[0]).toMatchObject({ status: 'approved', provider: 'paypal', providerPaymentId: saleId });
        expect(row!.paidUntil!.getTime()).toBeGreaterThan(Date.now() + 25 * DAY);
        expect((await recordData(c.listId, c.recordId))[`f${mapping.status}`]).toBe(SUBSCRIPTION_STATUS_OPTIONS.active.value);
        expect(dispatcher.events.some((e) => e.subscription?.evento === 'activated')).toBe(true);
        expect(dispatcher.events.some((e) => e.subscription?.evento === 'charged')).toBe(true);

        // Una venta de otra cosa (no de una suscripción) no se confunde.
        pp.sales.set('SALE999', { id: 'SALE999', state: 'completed' });
        expect(await collections.handleHook(token, {}, { event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE999' } })).toBe('ignored');

        // Lo que ve el cliente al volver y en su portal dice PayPal.
        const pub = await subs.publicStatus(await refOf(sub.id));
        expect(pub).toMatchObject({ provider: 'paypal', status: 'active', url: null });
        const portal = await subs.portalSubscriptions(tenantId, c.listId, c.recordId);
        expect(portal[0]).toMatchObject({ provider: 'paypal', status: 'active', charges: [{ status: 'approved', amount: 49, currency: 'USD' }] });
        const formPlans = await subs.formPlans(tenantId, [p.id]);
        expect(formPlans[0]).toMatchObject({ provider: 'paypal', currency: 'USD' });
    });

    it('cobros fallidos: PayPal reintenta (reintentando) y al tercero la suspende (en mora, no pausada)', async () => {
        const pp = fakePaypal();
        const connId = await connect();
        const p = await plan(connId, { grace_days: 10 });
        const c = await seedClient();
        const sub = await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'pagos@lumen.test' });
        const ppId = [...pp.subs.keys()][0]!;
        pp.approve(ppId);
        // Pagó hace 35 días: el mes que cubría ya terminó (y quedan días de gracia).
        const paidAt = new Date(Date.now() - 35 * DAY);
        pp.charge(ppId, true, paidAt);

        pp.charge(ppId, false, new Date(Date.now() - DAY), 'PAYER_CANNOT_PAY');
        let out = await subs.sync(tenantId, sub.id);
        expect(out).toMatchObject({ status: 'retrying', last_charge_status: 'rejected' });
        expect(out.last_failure_reason).toMatch(/no puede pagar/);
        expect(dispatcher.events.some((e) => e.subscription?.evento === 'charge_failed')).toBe(true);

        // Dos fallos más: PayPal la suspende. No es «pausada»: debe cuotas.
        pp.charge(ppId, false, new Date(Date.now() - 2 * 60 * 1000));
        pp.charge(ppId, false, new Date(Date.now() - 60 * 1000));
        out = await subs.sync(tenantId, sub.id);
        expect(pp.subs.get(ppId)!.status).toBe('SUSPENDED');
        expect(out.status).not.toBe('paused');
        expect(['past_due', 'expired']).toContain(out.status);
        // Cada intento fallido que se vio es su fila (el de ayer y el último);
        // el mismo fallo leído otra vez no suma otra.
        await subs.sync(tenantId, sub.id);
        const charges = await withTenant(pg.db, tenantId, (t) => t.select().from(subscriptionCharges).where(eq(subscriptionCharges.subscriptionId, sub.id)));
        expect(charges.filter((x) => x.status === 'rejected')).toHaveLength(2);
        expect(charges.filter((x) => x.status === 'approved')).toHaveLength(1);
    });

    it('pausar, reanudar, cambiar el valor y cancelar llaman a PayPal; una pendiente se cancela aquí', async () => {
        const pp = fakePaypal();
        const connId = await connect();
        const p = await plan(connId);
        const c = await seedClient();
        const mapping = await subs.setupFields(tenantId, admin, c.slug);
        const sub = await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'pagos@lumen.test' });
        const ppId = [...pp.subs.keys()][0]!;
        pp.approve(ppId);
        pp.charge(ppId, true);
        await subs.verify(tenantId, admin, sub.id);

        expect((await subs.pause(tenantId, admin, sub.id)).status).toBe('paused');
        expect(pp.subs.get(ppId)!.status).toBe('SUSPENDED');
        expect((await subs.resume(tenantId, admin, sub.id)).status).toBe('active');
        expect(pp.subs.get(ppId)!.status).toBe('ACTIVE');
        const changed = await subs.changeAmount(tenantId, admin, sub.id, 59);
        expect(changed.amount).toBe(59);
        expect(pp.subs.get(ppId)!.price).toEqual({ value: '59.00', currency_code: 'USD' });
        expect((await recordData(c.listId, c.recordId))[`f${mapping.amount}`]).toBe(59);
        const cancelled = await subs.cancel(tenantId, admin, sub.id, 'Cerró el estudio');
        expect(cancelled).toMatchObject({ status: 'cancelled', cancel_reason: 'Cerró el estudio' });
        expect(pp.subs.get(ppId)).toMatchObject({ status: 'CANCELLED', reason: 'Cerró el estudio' });

        // PayPal no deja cancelar una suscripción que nunca se aprobó: se cancela
        // aquí y la relectura (que sigue diciendo «por aprobar») no la revive.
        const pending = await subs.createForRecord(tenantId, admin, c.slug, c.recordId2, { plan_id: p.id, payer_email: 'cafe@aurora.test' });
        const out = await subs.cancel(tenantId, admin, pending.id, null);
        expect(out).toMatchObject({ status: 'cancelled', url: null });
        expect((await subs.sync(tenantId, pending.id)).status).toBe('cancelled');
        expect(await subs.publicStatus(await refOf(pending.id))).toMatchObject({ status: 'cancelled', url: null });
    });

    it('una pendiente se reemplaza al crear otra, y una clave rechazada no cambia el estado', async () => {
        const pp = fakePaypal();
        const connId = await connect();
        const p = await plan(connId);
        const c = await seedClient();
        const first = await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'pagos@lumen.test' });
        const second = await subs.createForRecord(tenantId, admin, c.slug, c.recordId, { plan_id: p.id, payer_email: 'pagos@lumen.test', amount: 45 });
        const rows = await withTenant(pg.db, tenantId, (t) => t.select().from(subscriptions).where(eq(subscriptions.recordId, c.recordId)));
        expect(rows.find((r) => r.id === first.id)!.status).toBe('cancelled');
        expect(rows.find((r) => r.id === second.id)!.status).toBe('pending');
        expect(pp.subs.size).toBe(2);

        // PayPal deja de aceptar la clave: la relectura no cambia el estado.
        const prev = net.handler;
        net.handler = (call) => (call.url.endsWith('/v1/oauth2/token') ? prev(call) : /\/v1\/billing\/subscriptions\//.test(call.url) ? { status: 403, body: '{"name":"NOT_AUTHORIZED"}' } : prev(call));
        const out = await subs.sync(tenantId, second.id);
        expect(out.status).toBe('pending');
    });
});
