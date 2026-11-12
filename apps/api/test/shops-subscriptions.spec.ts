import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Field, type PublicShopOrderInput, type ShopConfig } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.417 (ADR-S103) — Suscripciones desde la tienda. Postgres y Redis
 * reales; lo simulado es el borde: la API de Mercado Pago
 * (`safeWebhookFetch`) y el correo.
 *
 * Lo que se prueba: el producto de tipo suscripción toma su plan (elegido o
 * por el nombre, en la moneda de la tienda); «Suscribirme» hace un pedido de
 * una unidad sin stock, cupón ni envío y lleva a autorizar la tarjeta con el
 * precio del producto; al autorizarse (aviso o al volver) el pedido queda
 * pagado una vez; no se mezcla con el carrito; y si Mercado Pago no responde
 * el pedido no queda a medias.
 */
interface FakeCall {
    url: string;
    method?: string;
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
        safeWebhookFetch: async (url: string, opts: { method?: string; body?: string }) => {
            const call = { url, method: opts.method, body: opts.body };
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
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { CollectionsService } from '../src/collections/collections.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { memberships, records, shopOrders, shops, subscriptions, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import type { IncidentHub } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { NotifyHub, type NotifyEvent } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { ShopCouponsService } from '../src/shop/shop-coupons.service';
import { ShopImagesService } from '../src/shop/shop-images.service';
import { ShopOrdersService } from '../src/shop/shop-orders.service';
import { ShopPublicService } from '../src/shop/shop-public.service';
import { ShopService } from '../src/shop/shop.service';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

const MP = 'https://api.mercadopago.com';

class CapturingDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

class FakeHookStore implements HookCaptureStore {
    lpush(): Promise<number> {
        return Promise.resolve(0);
    }
    ltrim(): Promise<string> {
        return Promise.resolve('OK');
    }
    expire(): Promise<number> {
        return Promise.resolve(1);
    }
    lrange(): Promise<string[]> {
        return Promise.resolve([]);
    }
}

interface SentMail {
    to: string;
    subject: string;
    html?: string;
    text?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const titleOf = (n: NotifyEvent): string => ('title' in n && typeof n.title === 'string' ? n.title : '');

describe('v0.1.417 — suscripciones desde la tienda (Postgres + Redis reales, Mercado Pago simulado)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let listsSvc: ListsService;
    let fieldsSvc: FieldsService;
    let recordsSvc: RecordsService;
    let files: FilesService;
    let collections: CollectionsService;
    let connectors: ConnectorsService;
    let subs: SubscriptionsService;
    let shopsSvc: ShopService;
    let ordersSvc: ShopOrdersService;
    let publicSvc: ShopPublicService;
    const mails: SentMail[] = [];
    const notices: NotifyEvent[] = [];
    const incidents: Array<{ key: string; title: string; message: string }> = [];
    const pre = new Map<string, Record<string, unknown>>();
    let mpDown = false;
    let tenantId: number;
    let adminId: number;
    let admin: Actor;
    let catalogId: number;
    let connId: number;
    let shopId: number;
    let token: string;
    let config: ShopConfig;
    const f: Record<string, Field> = {};
    const product: Record<string, number> = {};
    const plan: Record<string, number> = {};
    let ipSeq = 0;
    const nextIp = (): string => `198.51.100.${(ipSeq++ % 250) + 1}`;

    function fakeMercadoPago(): void {
        net.handler = (call) => {
            if (call.url === `${MP}/users/me`) return { status: 200, body: JSON.stringify({ id: 123, nickname: 'ACME', site_id: 'MCO' }) };
            if (call.url === `${MP}/preapproval` && call.method === 'POST') {
                if (mpDown) return { status: 500, body: JSON.stringify({ message: 'internal_error' }) };
                const body = JSON.parse(call.body!) as Record<string, unknown>;
                const id = `pre-${pre.size + 1}`;
                const row = {
                    id,
                    status: 'pending',
                    reason: body.reason,
                    external_reference: body.external_reference,
                    payer_email: body.payer_email,
                    auto_recurring: body.auto_recurring,
                    back_url: body.back_url,
                    init_point: `https://www.mercadopago.com.co/subscriptions/checkout?preapproval_id=${id}`,
                    next_payment_date: null,
                };
                pre.set(id, row);
                return { status: 201, body: JSON.stringify(row) };
            }
            const m = /\/preapproval\/([\w-]+)$/.exec(call.url);
            if (m) {
                const row = pre.get(m[1]!);
                return row ? { status: 200, body: JSON.stringify(row) } : { status: 404, body: '{}' };
            }
            if (call.url.startsWith(`${MP}/authorized_payments/search`)) return { status: 200, body: JSON.stringify({ results: [] }) };
            return { status: 404, body: '' };
        };
    }

    const stampFor = (id: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('shopstamp', id, ts)}`;
    };
    const customer = { name: 'Ana Gómez', email: 'ana@cliente.co', phone: '+573001112233', document: '', address: '', city: '', notes: '' };
    // Un correo por pedido: el freno por correo de la tienda no entra en juego.
    let mailSeq = 0;
    const order = (partial: Partial<PublicShopOrderInput> = {}): PublicShopOrderInput => ({
        lines: [{ product_id: product.club!, qty: 1 }],
        customer: { ...customer, email: `ana+${++mailSeq}@cliente.co` },
        delivery_id: null,
        payment_method: 'subscription',
        terms: true,
        consent: false,
        stamp: stampFor(shopId),
        ...partial,
    });
    const place = (partial: Partial<PublicShopOrderInput> = {}) => publicSvc.placeOrder(token, order(partial), { ip: nextIp(), userAgent: 'vitest' });
    const rowOf = async (orderToken: string) => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopOrders).where(eq(shopOrders.token, orderToken)));
        return row!;
    };
    const waitPayment = async (orderToken: string, status: string): Promise<void> => {
        for (let i = 0; i < 80; i++) {
            if ((await rowOf(orderToken)).paymentStatus === status) return;
            await sleep(50);
        }
    };
    const hookToken = async (): Promise<string> => (await collections.hookUrlFor(tenantId, connId, 'mercadopago')).split('/').pop()!;
    const authorize = (preId: string): void => {
        const row = pre.get(preId)!;
        row.status = 'authorized';
        row.next_payment_date = '2026-12-12T12:00:00.000-05:00';
    };
    const stockOf = async (recordId: number): Promise<unknown> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, recordId)));
        return (row!.data as Record<string, unknown>)[`f${f.stock!.id}`];
    };

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        listsSvc = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), listsSvc, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), listsSvc, rt);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', FILES_SIGNING_SECRET: 'shop-subs-secret', APP_BASE_URL: 'https://app.test' });
        const audit = new AuditService(tenantDb);
        connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        const automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), listsSvc, new AutomationScheduler(), new FakeHookStore(), connectors);
        const plans = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsSvc);
        const dispatcher = new CapturingDispatcher();
        const hub = new RecordChangeHub();
        recordsSvc = new RecordsService(tenantDb, new RecordsRepository(), listsSvc, fieldsSvc, rt, activity, dispatcher, new RelationsRepository(), undefined, hub);
        const dashboards = new DashboardsService(tenantDb, null as never, recordsSvc, fieldsSvc);
        const blueprint = new BlueprintService(tenantDb, listsSvc, fieldsSvc, views, automations, new RecordsRepository(), new RelationsRepository(), billing, rt, dashboards);
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-shop-subs-'))), env);
        collections = new CollectionsService(tenantDb, pg.db, env, connectors, listsSvc, new RecordsRepository(), activity, rt, dispatcher, audit, fieldsSvc);
        subs = new SubscriptionsService(tenantDb, pg.db, env, connectors, listsSvc, new RecordsRepository(), activity, rt, dispatcher, audit, collections, fieldsSvc, undefined, undefined, redis as never);
        subs.onModuleInit();
        const notify = new NotifyHub();
        notify.subscribe((e) => {
            notices.push(e);
        });
        const incidentHub = {
            report: (i: { key: string; title: string; message: string }) => incidents.push(i),
            resolve: () => undefined,
        } as unknown as IncidentHub;
        shopsSvc = new ShopService(pg.db, tenantDb, listsSvc, fieldsSvc, undefined, { get: (t: unknown) => (t === SubscriptionsService ? subs : blueprint) } as never, undefined, undefined, collections);
        const coupons = new ShopCouponsService(tenantDb, shopsSvc);
        const mail = {
            enqueue: (m: SentMail) => {
                mails.push(m);
                return Promise.resolve();
            },
        };
        ordersSvc = new ShopOrdersService(
            tenantDb,
            fieldsSvc,
            new RecordsRepository(),
            new RelationsRepository(),
            activity,
            rt,
            dispatcher,
            files,
            env,
            billing,
            mail as never,
            notify,
            hub,
            undefined,
            collections,
            incidentHub,
            pg.db,
            coupons,
            subs,
        );
        ordersSvc.onModuleInit();
        publicSvc = new ShopPublicService(
            pg.db,
            tenantDb,
            fieldsSvc,
            files,
            new ShopImagesService(tenantDb, files, null as never),
            ordersSvc,
            undefined,
            redis as never,
            undefined,
            undefined,
            collections,
            coupons,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-subs', name: 'Acme', plan: 'pro' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'dueno@acme-subs.co', name: 'Dueño', passwordHash: 'x' }).returning();
        adminId = u!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: adminId, tenantId, role: 'admin' }));
        admin = { userId: adminId, role: 'admin' };

        catalogId = (await listsSvc.create(tenantId, { name: 'Productos' })).id;
        const mk = async (slug: string, label: string, type: string, cfg?: Record<string, unknown>): Promise<void> => {
            f[slug] = await fieldsSvc.create(tenantId, 'productos', { label, type, slug, ...(cfg ? { config: cfg } : {}) } as never);
        };
        await mk('nombre', 'Nombre', 'text');
        await mk('precio', 'Precio', 'currency', { currency: 'COP', precision: 0 });
        await mk('stock', 'Stock', 'number');

        fakeMercadoPago();
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'mercadopago', {
            fields: { access_token: 'APP_USR-buena' },
            visibility: 'workspace',
        });
        connId = connection.id;
        const mkPlan = async (key: string, name: string, extra: Record<string, unknown> = {}): Promise<void> => {
            const p = await subs.createPlan(tenantId, admin, {
                connection_id: connId,
                name,
                description: null,
                amount: 99999,
                currency: 'COP',
                frequency: 1,
                frequency_type: 'months',
                cycles: null,
                trial_days: 0,
                grace_days: 10,
                on_expire: 'mark',
                ...extra,
            } as Parameters<SubscriptionsService['createPlan']>[2]);
            plan[key] = p.id;
        };
        await mkPlan('club', 'Club del café', { trial_days: 7 });
        await mkPlan('caja', 'Caja mensual', { cycles: 6 });
        await mkPlan('dolares', 'Plan en dólares', { currency: 'USD', amount: 10 });

        const dto = await shopsSvc.create(tenantId, adminId, { list_id: catalogId, name: 'Tienda Acme' });
        shopId = dto.id;
        const withKind = await shopsSvc.createKindColumn(tenantId, shopId, 'kind');
        f.tipo = (await fieldsSvc.listByListId(tenantId, catalogId)).find((x) => x.slug === 'tipo_de_producto')!;
        const add = async (key: string, data: Record<string, unknown>): Promise<void> => {
            const byId = Object.fromEntries(Object.entries(data).map(([slug, v]) => [`f${f[slug]!.id}`, v]));
            product[key] = (await recordsSvc.create(tenantId, admin, 'productos', { data: byId } as never)).id;
        };
        // Por el nombre (sin tildes ni mayúsculas): «Club del café».
        await add('club', { nombre: 'Club del Cafe', precio: 80000, stock: 5, tipo: 'subscription' });
        // Elegido a mano: «Caja mensual».
        await add('caja', { nombre: 'Caja sorpresa', precio: 120000, tipo: 'subscription' });
        // Sin plan en la moneda de la tienda.
        await add('pro', { nombre: 'Plan en dólares', precio: 50000, tipo: 'subscription' });
        await add('taza', { nombre: 'Taza de cerámica', precio: 25000, stock: 10 });

        const base = withKind.config;
        const ready: ShopConfig = {
            ...base,
            kinds: { ...base.kinds, subscription_links: { [String(product.caja)]: plan.caja! } },
            payments: { ...base.payments, transfer: { ...base.payments.transfer, enabled: true, instructions: 'Bancolombia ahorros 123-456789-00.' } },
            seller: { legal_name: 'Acme SAS', document: '900123456-1', address: 'Carrera 7 # 12-30', city: 'Bogotá', email: 'ventas@acme.co', phone: '' },
        };
        config = (await shopsSvc.update(tenantId, shopId, { config: ready as never, enabled: true })).dto.config;
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shops).where(eq(shops.id, shopId)));
        token = row!.token;
    }, 120_000);

    beforeEach(async () => {
        await sleep(150);
        net.calls.length = 0;
        mails.length = 0;
        notices.length = 0;
        incidents.length = 0;
        mpDown = false;
        await redis.flushall();
    });

    afterAll(async () => {
        subs?.onApplicationShutdown();
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    it('cada producto de suscripción toma su plan: el elegido o el del mismo nombre, en la moneda de la tienda', async () => {
        expect(config.kinds.subscription_links).toEqual({ [String(product.caja)]: plan.caja });
        const opts = await shopsSvc.options(tenantId, shopId);
        expect(opts.kind_counts.subscription).toBe(3);
        expect(opts.subscription_plans.map((p) => p.name)).toEqual(['Caja mensual', 'Club del café', 'Plan en dólares']);
        const byId = new Map(opts.subscription_products.map((p) => [p.id, p]));
        expect(byId.get(product.club!)).toMatchObject({ linked: null, resolved: plan.club });
        expect(byId.get(product.caja!)).toMatchObject({ linked: plan.caja, resolved: plan.caja });
        expect(byId.get(product.pro!)).toMatchObject({ linked: null, resolved: null });

        const info = await publicSvc.freshInfo(token);
        const pub = new Map(info!.products.map((p) => [p.id, p]));
        expect(pub.get(product.club!)).toMatchObject({
            kind: 'subscription',
            price: 80000,
            subscription: { frequency: 1, frequency_type: 'months', trial_days: 7, cycles: null, provider: 'mercadopago' },
        });
        expect(pub.get(product.caja!)!.subscription).toMatchObject({ cycles: 6, trial_days: 0 });
        expect(pub.get(product.pro!)!.subscription).toBeNull();
        expect(info!.meta.subscriptions).toEqual({ address: false });
    });

    it('«Suscribirme» hace un pedido de una unidad, sin stock ni envío, y lleva a autorizar la tarjeta por el precio del producto', async () => {
        const before = await stockOf(product.club!);
        const placed = await place({ lines: [{ product_id: product.club!, qty: 3 }] });
        expect(placed!.payment_method).toBe('subscription');
        expect(placed!.pay_url).toContain('preapproval_id=');
        const created = [...pre.values()].at(-1)!;
        expect((created.auto_recurring as { transaction_amount: number }).transaction_amount).toBe(80000);
        expect(created.payer_email).toBe(`ana+${mailSeq}@cliente.co`);
        expect(String(created.back_url)).toContain(`?pedido=${placed!.order_token}&suscripcion=1`);
        // Una sola unidad, sin tocar el stock (los cupos sólo cierran la venta en 0).
        expect(placed!.total).toBe(80000);
        expect(await stockOf(product.club!)).toBe(before);

        const row = await rowOf(placed!.order_token);
        expect(row.paymentMethod).toBe('subscription');
        expect(row.paymentStatus).toBe('pendiente');
        expect(row.subscriptionId).not.toBeNull();
        expect(row.expiresAt).toBeNull();
        expect(row.stockState).toBe('none');
        expect(row.delivery).toMatchObject({ name: 'Suscripción', subscription: true });
        const [sub] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptions).where(eq(subscriptions.id, row.subscriptionId!)));
        expect(sub).toMatchObject({ planId: plan.club, recordId: row.recordId, status: 'pending' });

        // Al equipo todavía no le llega nada; a quien se suscribe, cómo activarla.
        await sleep(150);
        expect(notices).toHaveLength(0);
        expect(mails.map((m) => m.subject)).toEqual([expect.stringContaining('Activa tu suscripción')]);
        expect(mails[0]!.text).toContain('cada mes');
        expect(mails[0]!.text).toContain('7 días gratis');

        const pub = await publicSvc.order(token, placed!.order_token);
        expect(pub!.subscription).toMatchObject({ state: 'pending', amount: 80000, frequency: 1, frequency_type: 'months', trial_days: 7, provider: 'mercadopago' });
        expect(pub!.subscription!.url).toContain('preapproval_id=');
    });

    it('al autorizar la tarjeta (aviso de Mercado Pago) el pedido queda pagado una vez; «Marcar como pagado» no aplica', async () => {
        const placed = await place({ customer: { ...customer, email: 'ana@cliente.co' } });
        const row = await rowOf(placed!.order_token);
        // Mientras falta autorizar, el equipo no lo puede dar por pagado a mano.
        await expect(ordersSvc.markPaid(tenantId, adminId, row.recordId!)).rejects.toMatchObject({ response: { code: 'shop_subscription_paid' } });
        const [sub] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptions).where(eq(subscriptions.id, row.subscriptionId!)));
        authorize(sub!.externalId!);
        mails.length = 0;
        expect(await collections.handleHook(await hookToken(), {}, { type: 'subscription_preapproval', data: { id: sub!.externalId } })).toBe('applied');
        await waitPayment(placed!.order_token, 'pagado');
        expect((await rowOf(placed!.order_token)).paymentStatus).toBe('pagado');
        await sleep(150);
        expect(notices.filter((n) => titleOf(n).includes('Suscripción nueva'))).toHaveLength(1);
        expect(mails.some((m) => m.subject.includes('Tu suscripción quedó activa'))).toBe(true);

        // Otro aviso igual no la vuelve a dar por pagada.
        notices.length = 0;
        await collections.handleHook(await hookToken(), {}, { type: 'subscription_preapproval', data: { id: sub!.externalId } });
        await sleep(150);
        expect(notices).toHaveLength(0);

        const pub = await publicSvc.order(token, placed!.order_token);
        expect(pub!.subscription).toMatchObject({ state: 'active', next_charge: '2026-12-12' });
        expect(pub!.subscription!.url).toBeNull();

        const mine = await ordersSvc.myOrders(tenantId, shopId, 'ana@cliente.co');
        const listed = mine.orders.find((o) => o.order_token === placed!.order_token);
        expect(listed!.subscription).toContain('cada mes');
    });

    it('al volver de Mercado Pago se pregunta enseguida y el pedido queda pagado', async () => {
        const placed = await place({ lines: [{ product_id: product.caja!, qty: 1 }] });
        const created = [...pre.values()].at(-1)!;
        expect((created.auto_recurring as { transaction_amount: number }).transaction_amount).toBe(120000);
        authorize(String(created.id));
        // Recién creada se acaba de consultar: al volver se pregunta pasados 2 s.
        await sleep(2100);
        const pub = await publicSvc.order(token, placed!.order_token, { refresh: true, ip: nextIp() });
        expect(pub!.subscription!.state).toBe('active');
        await waitPayment(placed!.order_token, 'pagado');
        expect((await rowOf(placed!.order_token)).paymentStatus).toBe('pagado');
    });

    it('no se mezcla con el carrito: de a una, sin cupón, con plan y nunca por otra forma de pago', async () => {
        await expect(place({ lines: [{ product_id: product.club!, qty: 1 }, { product_id: product.caja!, qty: 1 }] })).rejects.toMatchObject({ response: { code: 'shop_subscription' } });
        await expect(place({ coupon: 'BIENVENIDA' })).rejects.toMatchObject({ response: { code: 'shop_coupon' } });
        await expect(place({ lines: [{ product_id: product.pro!, qty: 1 }] })).rejects.toMatchObject({ response: { code: 'shop_subscription' } });
        // Un producto físico no se suscribe, y una suscripción no se compra por el carrito.
        await expect(place({ lines: [{ product_id: product.taza!, qty: 1 }] })).rejects.toBeTruthy();
        await expect(place({ payment_method: 'transfer', delivery_id: config.delivery[0]!.id, customer: { ...customer, address: 'Calle 1', city: 'Bogotá' } })).rejects.toBeTruthy();
        expect(pre.size).toBeGreaterThan(0);
        const before = pre.size;
        // Con dirección pedida, sin dirección no se suscribe.
        const withAddress = { ...config, kinds: { ...config.kinds, subscription_address: true } };
        config = (await shopsSvc.update(tenantId, shopId, { config: withAddress as never })).dto.config;
        await expect(place()).rejects.toMatchObject({ response: { code: 'shop_address' } });
        const ok = await place({ customer: { ...customer, email: 'otra@cliente.co', address: 'Calle 10 # 5-20', city: 'Medellín' } });
        expect((await rowOf(ok!.order_token)).delivery).toMatchObject({ name: 'Suscripción · con envío', needs_address: true });
        expect(pre.size).toBe(before + 1);
        config = (await shopsSvc.update(tenantId, shopId, { config: { ...config, kinds: { ...config.kinds, subscription_address: false } } as never })).dto.config;
        // Sin cupos (stock en 0) no se suscribe.
        await recordsSvc.update(tenantId, admin, 'productos', product.club!, { data: { [`f${f.stock!.id}`]: 0 } } as never);
        await expect(place()).rejects.toBeTruthy();
        await recordsSvc.update(tenantId, admin, 'productos', product.club!, { data: { [`f${f.stock!.id}`]: 5 } } as never);
    });

    it('si Mercado Pago no responde, el pedido se cancela y queda un Problema', async () => {
        mpDown = true;
        await expect(place()).rejects.toMatchObject({ response: { code: 'shop_payment_unavailable', message: expect.stringContaining('suscripción') } });
        expect(incidents.map((i) => i.key)).toEqual([`shop-sub:${shopId}`]);
        const rows = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopOrders).where(eq(shopOrders.shopId, shopId)));
        const newest = rows.sort((a, b) => b.id - a.id)[0]!;
        expect(newest.paymentMethod).toBe('subscription');
        expect(newest.paymentStatus).toBe('vencido');
        expect(newest.subscriptionId).toBeNull();
    });
});
