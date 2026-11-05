import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectionCurrencyError, collectionCurrencyFor } from '@imagina-base/shared';

/**
 * v0.1.372 — PayPal como cobro de las EMPRESAS, de punta a punta con Postgres
 * real y la API de PayPal simulada en el borde de red (`safeWebhookFetch`):
 * conectar (el ambiente se descubre solo), el link propio que reusa o crea la
 * orden, la CAPTURA al volver (aprobar no es pagar), los avisos que se releen,
 * «Verificar», el rechazo con reintento, el reembolso, el registro automático
 * de la URL de avisos y su limpieza al borrar la conexión.
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
import { renderPaypalPayPage } from '../src/collections/paypal-pay-page';
import {
    paypalAmountValue,
    paypalNotice,
    parseOrder,
    reusableOrder,
    PAYPAL_ORDER_REUSE_MS,
} from '../src/collections/paypal-gateway';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { connections, fields, lists, paymentLinks, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const LIVE = 'https://api-m.paypal.com';
const SANDBOX = 'https://api-m.sandbox.paypal.com';
const APP = 'https://app.imagina.test';

const LIVE_ID = 'AbcLiveClientId0000000000000000000000000001';
const LIVE_SECRET = 'EFghLiveSecret00000000000000000000000000001';
const SB_ID = 'AbcSandboxClientId000000000000000000000001';
const SB_SECRET = 'EFghSandboxSecret000000000000000000000001';

class CapturingDispatcher extends AutomationDispatcher {
    events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

interface FakeOrder {
    id: string;
    status: string;
    purchase_units: Array<Record<string, unknown>>;
    payment_source?: Record<string, unknown>;
    links: Array<{ rel: string; href: string }>;
}

/** Un PayPal con memoria: órdenes, capturas y webhooks, en los dos ambientes. */
function fakePaypal() {
    const orders = new Map<string, FakeOrder>();
    const captures = new Map<string, Record<string, unknown>>();
    const webhooks: Array<{ id: string; url: string; event_types: Array<{ name: string }> }> = [];
    const requestIds: string[] = [];
    let n = 0;
    let declineNextCapture = false;
    const ok = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });
    net.handler = (call) => {
        const base = call.url.startsWith(LIVE) ? LIVE : call.url.startsWith(SANDBOX) ? SANDBOX : null;
        if (!base) return { status: 404, body: '' };
        const path = call.url.slice(base.length);
        if (path === '/v1/oauth2/token') {
            const raw = Buffer.from((call.headers?.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
            const good = base === LIVE ? `${LIVE_ID}:${LIVE_SECRET}` : `${SB_ID}:${SB_SECRET}`;
            return raw === good
                ? ok({ access_token: `tok-${base === LIVE ? 'live' : 'sb'}`, expires_in: 32400, token_type: 'Bearer' })
                : { status: 401, body: JSON.stringify({ error: 'invalid_client', error_description: 'Client Authentication failed' }) };
        }
        if (!/^Bearer tok-/.test(call.headers?.authorization ?? '')) return { status: 401, body: '{}' };
        if (path === '/v2/checkout/orders' && call.method === 'POST') {
            const rid = call.headers?.['paypal-request-id'] ?? '';
            requestIds.push(rid);
            const body = JSON.parse(call.body!) as { purchase_units: Array<Record<string, unknown>> };
            const id = `ORD${String(++n).padStart(6, '0')}`;
            const order: FakeOrder = {
                id,
                status: 'PAYER_ACTION_REQUIRED',
                purchase_units: body.purchase_units,
                links: [{ rel: 'payer-action', href: `https://www.paypal.com/checkoutnow?token=${id}` }],
            };
            orders.set(id, order);
            return ok(order, 200);
        }
        let m = /^\/v2\/checkout\/orders\/([A-Z0-9]+)\/capture$/.exec(path);
        if (m && call.method === 'POST') {
            requestIds.push(call.headers?.['paypal-request-id'] ?? '');
            const o = orders.get(m[1]!);
            if (!o) return { status: 404, body: JSON.stringify({ name: 'RESOURCE_NOT_FOUND' }) };
            if (o.status === 'COMPLETED') return { status: 422, body: JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }) };
            if (o.status !== 'APPROVED') return { status: 422, body: JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] }) };
            if (declineNextCapture) {
                declineNextCapture = false;
                return { status: 422, body: JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] }) };
            }
            const unit = o.purchase_units[0]!;
            const capId = `CAP${String(++n).padStart(6, '0')}`;
            const cap = {
                id: capId,
                status: 'COMPLETED',
                amount: unit.amount,
                create_time: '2026-11-05T15:00:00Z',
                supplementary_data: { related_ids: { order_id: o.id } },
            };
            captures.set(capId, cap);
            o.status = 'COMPLETED';
            o.payment_source = { paypal: { email_address: 'cliente@correo.test' } };
            o.purchase_units = [{ ...unit, payments: { captures: [cap] } }];
            return ok(o, 201);
        }
        m = /^\/v2\/checkout\/orders\/([A-Z0-9]+)$/.exec(path);
        if (m) {
            const o = orders.get(m[1]!);
            return o ? ok(o) : { status: 404, body: JSON.stringify({ name: 'RESOURCE_NOT_FOUND' }) };
        }
        m = /^\/v2\/payments\/captures\/([A-Z0-9]+)$/.exec(path);
        if (m) {
            const c = captures.get(m[1]!);
            return c ? ok(c) : { status: 404, body: '{}' };
        }
        if (path === '/v1/notifications/webhooks' && call.method === 'GET') return ok({ webhooks });
        if (path === '/v1/notifications/webhooks' && call.method === 'POST') {
            const body = JSON.parse(call.body!) as { url: string; event_types: Array<{ name: string }> };
            if (webhooks.some((w) => w.url === body.url)) return { status: 400, body: JSON.stringify({ name: 'WEBHOOK_URL_ALREADY_EXISTS' }) };
            const hook = { id: `WH-${++n}`, url: body.url, event_types: body.event_types };
            webhooks.push(hook);
            return ok(hook, 201);
        }
        m = /^\/v1\/notifications\/webhooks\/(.+)$/.exec(path);
        if (m && call.method === 'DELETE') {
            const i = webhooks.findIndex((w) => w.id === m![1]);
            if (i >= 0) webhooks.splice(i, 1);
            return { status: 204, body: '' };
        }
        return { status: 404, body: '' };
    };
    return {
        orders,
        captures,
        webhooks,
        requestIds,
        /** El cliente aprueba el pago en PayPal (todavía sin cobrar). */
        approve(id: string) {
            const o = orders.get(id)!;
            o.status = 'APPROVED';
            o.payment_source = { paypal: { email_address: 'cliente@correo.test' } };
        },
        declineNext() {
            declineNextCapture = true;
        },
        refund(captureId: string) {
            const c = captures.get(captureId)!;
            c.status = 'REFUNDED';
            const o = orders.get((c.supplementary_data as { related_ids: { order_id: string } }).related_ids.order_id)!;
            o.purchase_units = [{ ...o.purchase_units[0]!, payments: { captures: [c] } }];
        },
        captureCalls: () => net.calls.filter((c) => /\/capture$/.test(c.url)).length,
        orderCreates: () => net.calls.filter((c) => c.url.endsWith('/v2/checkout/orders') && c.method === 'POST').length,
    };
}

describe('Cobros con PayPal (v0.1.372)', () => {
    let pg: TestPg;
    let connectors: ConnectorsService;
    let svc: CollectionsService;
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
        svc = new CollectionsService(
            tenantDb,
            pg.db,
            env,
            connectors,
            listsService,
            new RecordsRepository(),
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            rt,
            dispatcher,
            audit,
            fieldsService,
        );
        svc.onModuleInit();
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME Studio' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme.test', passwordHash: 'x', name: 'Ada' }).returning();
        adminId = u!.id;
        admin.userId = adminId;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        net.calls.length = 0;
        net.handler = () => ({ status: 404, body: '' });
        dispatcher.events.length = 0;
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(paymentLinks).where(eq(paymentLinks.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
            await tx.delete(connections).where(eq(connections.tenantId, tenantId));
        });
    });

    async function connect(id = LIVE_ID, secret = LIVE_SECRET): Promise<number> {
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'paypal', {
            fields: { client_id: id, client_secret: secret },
            visibility: 'workspace',
        });
        return connection.id;
    }

    async function seed(): Promise<{ listId: number; recordId: number }> {
        const list = await listsService.create(tenantId, { name: 'Pedidos', slug: 'pedidos' });
        const total = await fieldsService.create(tenantId, 'pedidos', { label: 'Total', type: 'currency', config: { currency: 'USD', precision: 2 } });
        const [rec] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({ tenantId, listId: list.id, data: { [`f${total.id}`]: 150 }, createdBy: adminId }).returning(),
        );
        await svc.setupFields(tenantId, admin, 'pedidos');
        return { listId: list.id, recordId: rec!.id };
    }

    async function linkRow(id: number) {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(paymentLinks).where(eq(paymentLinks.id, id)));
        return row!;
    }

    async function hookToken(connectionId: number): Promise<string> {
        return (await svc.hookUrlFor(tenantId, connectionId, 'paypal')).split('/').pop()!;
    }

    it('piezas puras: monedas, montos, avisos, órdenes y la página', () => {
        expect(collectionCurrencyError('paypal', 'COP')).toMatch(/no cobra en pesos colombianos/);
        expect(collectionCurrencyError('paypal', 'usd')).toBeNull();
        expect(collectionCurrencyError('wompi', 'USD')).toMatch(/sólo cobra en pesos/);
        expect(collectionCurrencyError('mercadopago', 'COP')).toBeNull();
        expect(collectionCurrencyFor('paypal', 'COP')).toBe('USD');
        expect(collectionCurrencyFor('paypal', 'EUR')).toBe('EUR');

        expect(paypalAmountValue(150, 'USD')).toBe('150.00');
        expect(paypalAmountValue(99.999, 'USD')).toBe('100.00');
        expect(paypalAmountValue(1500.4, 'JPY')).toBe('1500');

        expect(paypalNotice({ event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORD000001' } })).toEqual({ kind: 'order', orderId: 'ORD000001' });
        expect(
            paypalNotice({
                event_type: 'PAYMENT.CAPTURE.COMPLETED',
                resource: { id: 'CAP000002', supplementary_data: { related_ids: { order_id: 'ORD000001' } } },
            }),
        ).toEqual({ kind: 'capture', captureId: 'CAP000002', orderId: 'ORD000001' });
        // Un reembolso trae el reembolso: la captura sale del link «up».
        expect(
            paypalNotice({
                event_type: 'PAYMENT.CAPTURE.REFUNDED',
                resource: { id: 'REF999999', links: [{ rel: 'up', href: 'https://api-m.paypal.com/v2/payments/captures/CAP000002' }] },
            }),
        ).toEqual({ kind: 'capture', captureId: 'CAP000002', orderId: null });
        expect(paypalNotice({ event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-1' } })).toEqual({ kind: 'other', eventType: 'BILLING.SUBSCRIPTION.ACTIVATED' });
        expect(paypalNotice({ event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: "'; drop table" } })).toBeNull();

        const approved = parseOrder(200, JSON.stringify({ id: 'ORD1234', status: 'APPROVED', purchase_units: [{ custom_id: 'ib_x', amount: { value: '10.00', currency_code: 'USD' } }] }));
        expect(approved).toMatchObject({ needsCapture: true, reference: 'ib_x', payment: { status: 'pending' } });
        const pending = parseOrder(
            200,
            JSON.stringify({
                id: 'ORD1234',
                status: 'COMPLETED',
                payment_source: { card: {} },
                purchase_units: [{ custom_id: 'ib_x', payments: { captures: [{ status: 'PENDING', status_details: { reason: 'PENDING_REVIEW' }, amount: { value: '10.00', currency_code: 'USD' } }] } }],
            }),
        );
        expect(pending?.payment).toMatchObject({ status: 'pending', method: 'Tarjeta (PayPal)', note: expect.stringMatching(/revisando/) });
        expect(parseOrder(200, JSON.stringify({ id: 'ORD1234', status: 'CREATED', purchase_units: [{ custom_id: 'ib_x' }] }))?.payment).toBeNull();

        const now = new Date('2026-11-05T12:00:00Z');
        const fresh = { id: 'ORD1', approve_url: 'https://www.paypal.com/x', created_at: new Date(now.getTime() - 10 * 60_000).toISOString() };
        expect(reusableOrder([fresh], now)).toEqual(fresh);
        expect(reusableOrder([{ ...fresh, done: true }], now)).toBeNull();
        expect(reusableOrder([{ ...fresh, created_at: new Date(now.getTime() - PAYPAL_ORDER_REUSE_MS - 1).toISOString() }], now)).toBeNull();

        const html = renderPaypalPayPage({ state: 'paid', company: 'Acme <b>', title: 'Plan "Pro"', amount: 150, currency: 'USD', retryUrl: null, message: null });
        expect(html).toContain('Acme &lt;b&gt;');
        expect(html).toContain('«Plan &quot;Pro&quot;»');
        expect(html).not.toContain('<b>');
    });

    it('conectar: descubre si las credenciales son de producción o de prueba, y una que no sirve no se guarda', async () => {
        fakePaypal();
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'paypal', { fields: { client_id: 'corto', client_secret: LIVE_SECRET }, visibility: 'workspace' }),
        ).rejects.toThrow(/Client ID de PayPal/);
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'paypal', {
                fields: { client_id: LIVE_ID, client_secret: 'EFghOtroSecret000000000000000000000000000001' },
                visibility: 'workspace',
            }),
        ).rejects.toThrow(/ni en producción ni en prueba/);
        expect(await connectors.list(tenantId, adminId, 'admin')).toHaveLength(0);

        const sandbox = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'paypal', {
            fields: { client_id: SB_ID, client_secret: SB_SECRET },
            visibility: 'workspace',
        });
        expect(sandbox.warning).toMatch(/PRUEBA/);
        const live = await connect();
        const conns = await svc.connectionsFor(tenantId, admin);
        expect(conns.map((c) => [c.provider, c.test_mode])).toEqual([
            ['paypal', false],
            ['paypal', true],
        ]);
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, live)));
        expect(JSON.stringify(row!.secrets)).not.toContain(LIVE_SECRET);
        expect((row!.config as { fields: Record<string, string> }).fields.env).toBe('live');
    });

    it('el link es nuestro: crea la orden, reusa al abrir, cobra al volver y escribe el registro', async () => {
        const pp = fakePaypal();
        const conn = await connect();
        const { listId, recordId } = await seed();

        // Pesos colombianos con PayPal: se rechaza con el motivo (no se manda como dólares).
        await expect(
            svc.createForRecord(tenantId, admin, 'pedidos', recordId, { connection_id: conn, title: 'Pedido 1', amount: 150000, currency: 'COP' }),
        ).rejects.toThrow(/no cobra en pesos colombianos/);

        const link = await svc.createForRecord(tenantId, admin, 'pedidos', recordId, {
            connection_id: conn,
            title: 'Pedido 1',
            amount: 150,
            currency: 'USD',
            payer_email: 'cliente@correo.test',
        });
        expect(link.provider).toBe('paypal');
        expect(link.url).toMatch(new RegExp(`^${APP}/api/v1/public/pay/ib_[A-Za-z0-9_-]+$`));
        const reference = link.url.split('/').pop()!;
        const created = net.calls.find((c) => c.url === `${LIVE}/v2/checkout/orders`)!;
        const body = JSON.parse(created.body!) as {
            intent: string;
            purchase_units: Array<{ custom_id: string; amount: { value: string; currency_code: string } }>;
            payment_source: { paypal: { email_address: string; experience_context: Record<string, string> } };
        };
        expect(body.intent).toBe('CAPTURE');
        expect(body.purchase_units[0]).toMatchObject({ custom_id: reference, amount: { value: '150.00', currency_code: 'USD' } });
        expect(body.payment_source.paypal.email_address).toBe('cliente@correo.test');
        expect(body.payment_source.paypal.experience_context).toMatchObject({
            brand_name: 'ACME Studio',
            return_url: `${APP}/api/v1/public/pay/${reference}/return`,
            cancel_url: `${APP}/api/v1/public/pay/${reference}/cancel`,
        });
        expect(pp.requestIds[0]).toBe(`order-${reference}-0`);
        const [orderId] = [...pp.orders.keys()];

        // La dirección de avisos se registró sola en la cuenta.
        await vi.waitFor(() => expect(pp.webhooks).toHaveLength(1));
        expect(pp.webhooks[0]!.url).toBe(await svc.hookUrlFor(tenantId, conn, 'paypal'));
        expect(pp.webhooks[0]!.event_types.map((e) => e.name)).toContain('CHECKOUT.ORDER.APPROVED');
        const detail = await svc.connectionDetail(tenantId, admin, conn);
        expect(detail).toMatchObject({ hook_auto: true, hook_needs_setup: false, hook_error: null });

        // Abrirlo lleva a PayPal con la MISMA orden (no crea otra).
        const visit = await svc.paypalVisit(reference);
        expect(visit).toEqual({ kind: 'redirect', url: `https://www.paypal.com/checkoutnow?token=${orderId}` });
        expect(pp.orderCreates()).toBe(1);

        // Aprobar no es pagar: el link sigue pendiente hasta que la app captura al volver.
        pp.approve(orderId!);
        expect((await linkRow(link.id)).status).toBe('pending');
        const back = await svc.paypalReturn(reference, orderId!);
        expect(back).toMatchObject({ kind: 'page', page: { state: 'paid_now', company: 'ACME Studio' } });
        expect(pp.requestIds).toContain(`capture-${orderId}`);
        const paid = await linkRow(link.id);
        expect(paid).toMatchObject({ status: 'approved', paidAmount: 150, method: 'Cuenta PayPal', paymentId: orderId });
        expect(dispatcher.events.filter((e) => e.trigger === 'payment_received')).toHaveLength(1);

        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(and(eq(records.listId, listId), eq(records.id, recordId))));
        const statusField = (await fieldsService.listByListId(tenantId, listId)).find((f) => f.label === 'Estado del pago')!;
        expect((rec!.data as Record<string, unknown>)[`f${statusField.id}`]).toBe('pagado');

        // Abrirlo otra vez ya no manda a pagar.
        expect(await svc.paypalVisit(reference)).toMatchObject({ kind: 'page', page: { state: 'paid' } });
        // Un link que no existe.
        expect(await svc.paypalVisit('ib_noexisteeeeeeeee')).toMatchObject({ kind: 'page', page: { state: 'not_found' } });
    });

    it('avisos: la aprobación dispara la captura una sola vez y el reembolso se relee', async () => {
        const pp = fakePaypal();
        const conn = await connect();
        const { recordId } = await seed();
        const link = await svc.createForRecord(tenantId, admin, 'pedidos', recordId, { connection_id: conn, title: 'Pedido 2', amount: 80, currency: 'USD' });
        const orderId = [...pp.orders.keys()][0]!;
        const token = await hookToken(conn);

        pp.approve(orderId);
        expect(await svc.handleHook(token, {}, { event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: orderId } })).toBe('applied');
        expect((await linkRow(link.id)).status).toBe('approved');
        // El mismo aviso dos veces no cobra dos veces.
        expect(await svc.handleHook(token, {}, { event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: orderId } })).toBe('ignored');
        expect(pp.captureCalls()).toBe(1);

        // El reembolso llega como el REEMBOLSO: la app busca su captura y relee la orden.
        const capId = [...pp.captures.keys()][0]!;
        pp.refund(capId);
        expect(
            await svc.handleHook(token, {}, {
                event_type: 'PAYMENT.CAPTURE.REFUNDED',
                resource: { id: 'REF000099', links: [{ rel: 'up', href: `${LIVE}/v2/payments/captures/${capId}` }] },
            }),
        ).toBe('applied');
        expect((await linkRow(link.id)).status).toBe('refunded');

        // Avisos que no son de nada nuestro: se contestan sin tocar nada.
        expect(await svc.handleHook(token, {}, { event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORD999999' } })).toBe('ignored');
        expect(await svc.handleHook(token, {}, { event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-ABC' } })).toBe('ignored');
        expect(await svc.handleHook('tokenquenoexiste000000', {}, {})).toBe('unknown_token');
    });

    it('«Verificar» cobra una orden aprobada cuando el aviso no llegó; un rechazo deja reintentar con otra orden', async () => {
        const pp = fakePaypal();
        const conn = await connect();
        const { recordId } = await seed();
        const link = await svc.createForRecord(tenantId, admin, 'pedidos', recordId, { connection_id: conn, title: 'Pedido 3', amount: 25.5, currency: 'USD' });
        const reference = link.url.split('/').pop()!;
        const first = [...pp.orders.keys()][0]!;

        // El medio de pago se rechaza al cobrar: el link queda rechazado (no final).
        pp.approve(first);
        pp.declineNext();
        const back = await svc.paypalReturn(reference, first);
        expect(back).toMatchObject({ kind: 'page', page: { state: 'failed', retryUrl: `${APP}/api/v1/public/pay/${reference}` } });
        expect((await linkRow(link.id)).status).toBe('rejected');

        // Reintentar crea OTRA orden (la anterior ya se usó).
        const retry = await svc.paypalVisit(reference);
        expect(pp.orderCreates()).toBe(2);
        const second = [...pp.orders.keys()][1]!;
        expect(retry).toEqual({ kind: 'redirect', url: `https://www.paypal.com/checkoutnow?token=${second}` });
        expect(pp.requestIds).toContain(`order-${reference}-1`);

        // El cliente paga con otro medio pero no vuelve ni llega el aviso: «Verificar» cobra.
        pp.approve(second);
        const verified = await svc.verifyLink(tenantId, admin, link.id);
        expect(verified).toMatchObject({ status: 'approved', paid_amount: 25.5 });
        expect((await linkRow(link.id)).providerOrders).toHaveLength(2);
    });

    it('una orden vieja se reemplaza, cancelar deja reintentar y una orden ajena no toca el link', async () => {
        const pp = fakePaypal();
        const conn = await connect();
        const { recordId } = await seed();
        const link = await svc.createForRecord(tenantId, admin, 'pedidos', recordId, { connection_id: conn, title: 'Pedido 4', amount: 10, currency: 'EUR' });
        const reference = link.url.split('/').pop()!;

        // Una orden de hace dos horas ya no se reusa.
        const row = await linkRow(link.id);
        const orders = row.providerOrders as Array<{ created_at: string }>;
        orders[0]!.created_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        await withTenant(pg.db, tenantId, (tx) => tx.update(paymentLinks).set({ providerOrders: orders }).where(eq(paymentLinks.id, link.id)));
        await svc.paypalVisit(reference);
        expect(pp.orderCreates()).toBe(2);

        expect(await svc.paypalCancel(reference)).toMatchObject({ kind: 'page', page: { state: 'cancelled_by_payer', retryUrl: expect.stringContaining(reference) } });

        // Una orden de OTRO link (otra referencia) no lo toca aunque esté aprobada.
        const other = await svc.createForRecord(tenantId, admin, 'pedidos', recordId, { connection_id: conn, title: 'Pedido 5', amount: 10, currency: 'EUR' });
        const otherOrder = [...pp.orders.keys()][2]!;
        pp.approve(otherOrder);
        await svc.paypalReturn(reference, otherOrder);
        expect((await linkRow(link.id)).status).toBe('pending');
        expect((await linkRow(other.id)).status).toBe('pending');
        expect(pp.captureCalls()).toBe(0);

        // Anulado desde la app: abrir el link ya no manda a PayPal.
        await svc.cancelLink(tenantId, admin, link.id);
        expect(await svc.paypalVisit(reference)).toMatchObject({ kind: 'page', page: { state: 'cancelled' } });
    });

    it('borrar la conexión saca de PayPal la dirección de avisos que registró la app', async () => {
        const pp = fakePaypal();
        const conn = await connect();
        await svc.ensurePaypalWebhook(tenantId, conn);
        expect(pp.webhooks).toHaveLength(1);
        // Volver a pedirla no registra otra.
        await svc.ensurePaypalWebhook(tenantId, conn, true);
        expect(pp.webhooks).toHaveLength(1);
        await connectors.remove(tenantId, adminId, 'admin', conn, false);
        expect(pp.webhooks).toHaveLength(0);
    });
});
