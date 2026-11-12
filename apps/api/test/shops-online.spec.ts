import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Field, type PublicShopOrderInput, type ShopConfig } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.413 (ADR-S103) — La tienda cobra en línea con la cuenta de cobro del
 * equipo. Postgres y Redis reales; lo simulado es el borde: la API de Mercado
 * Pago (`safeWebhookFetch`, como en `booking-payment.spec`) y el correo.
 *
 * Lo que se prueba: el pedido en línea aparta el stock con un plazo y lleva a
 * pagar; el aviso del proveedor (que se RELEE) lo da por pagado una sola vez;
 * si vence sin pagar se cancela y el stock vuelve; un pago tardío revive el
 * pedido si queda stock y, si no, avisa al equipo; al volver del checkout se
 * pregunta al proveedor; marcar pagado o cancelar dejan el link sin uso; y si
 * el proveedor no responde, el pedido no queda a medias.
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
import { memberships, paymentLinks, records, shopOrders, shops, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import type { IncidentHub } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { NotifyHub, type NotifyEvent } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { ShopImagesService } from '../src/shop/shop-images.service';
import { ShopOrdersService } from '../src/shop/shop-orders.service';
import { ShopPublicService } from '../src/shop/shop-public.service';
import { ShopService } from '../src/shop/shop.service';
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

class CapturingMail implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(m: MailMessage): Promise<void> {
        this.sent.push(m);
        return Promise.resolve();
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** El título de un aviso (los de la tienda lo traen; los de comentarios no). */
const titleOf = (n: NotifyEvent): string => ('title' in n && typeof n.title === 'string' ? n.title : '');

describe('v0.1.413 — tienda con pago en línea (Postgres + Redis reales, Mercado Pago simulado)', () => {
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
    let shopsSvc: ShopService;
    let ordersSvc: ShopOrdersService;
    let publicSvc: ShopPublicService;
    const dispatcher = new CapturingDispatcher();
    const mailbox = new CapturingMail();
    const notices: NotifyEvent[] = [];
    const incidents: Array<{ key: string; title: string; message: string }> = [];
    const resolved: string[] = [];
    const payments = new Map<string, Record<string, unknown>>();
    const prefs: Array<Record<string, unknown>> = [];
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
    let ipSeq = 0;
    const nextIp = (): string => `198.51.100.${(ipSeq++ % 250) + 1}`;

    function fakeMercadoPago(): void {
        net.handler = (call) => {
            if (call.url === `${MP}/users/me`) return { status: 200, body: JSON.stringify({ id: 123, nickname: 'ACME', site_id: 'MCO' }) };
            if (call.url === `${MP}/checkout/preferences` && call.method === 'POST') {
                if (mpDown) return { status: 500, body: JSON.stringify({ message: 'internal_error' }) };
                prefs.push(JSON.parse(call.body!) as Record<string, unknown>);
                return { status: 201, body: JSON.stringify({ id: `pref-${prefs.length}`, init_point: `https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=pref-${prefs.length}` }) };
            }
            const m = /\/v1\/payments\/(\d+)$/.exec(call.url);
            if (m) {
                const p = payments.get(m[1]!);
                return p ? { status: 200, body: JSON.stringify(p) } : { status: 404, body: '{}' };
            }
            if (call.url.startsWith(`${MP}/v1/payments/search`)) {
                const ref = new URL(call.url).searchParams.get('external_reference');
                return { status: 200, body: JSON.stringify({ results: [...payments.values()].filter((p) => p.external_reference === ref).reverse() }) };
            }
            return { status: 404, body: '' };
        };
    }

    const stampFor = (id: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('shopstamp', id, ts)}`;
    };
    const order = (partial: Partial<PublicShopOrderInput> = {}): PublicShopOrderInput => ({
        lines: [{ product_id: product.taza!, qty: 1 }],
        customer: { name: 'Ana Gómez', email: 'ana@cliente.co', phone: '+573001112233', document: '1020304050', address: 'Calle 10 # 5-20', city: 'Medellín', notes: '' },
        delivery_id: 'domicilio',
        payment_method: 'online',
        terms: true,
        consent: false,
        stamp: stampFor(shopId),
        ...partial,
    });
    const place = (partial: Partial<PublicShopOrderInput> = {}) => publicSvc.placeOrder(token, order(partial), { ip: nextIp(), userAgent: 'vitest' });
    const stockOf = async (recordId: number): Promise<unknown> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, recordId)));
        return (row!.data as Record<string, unknown>)[`f${f.stock!.id}`];
    };
    const setStock = async (recordId: number, n: number): Promise<void> => {
        await recordsSvc.update(tenantId, admin, 'productos', recordId, { data: { [`f${f.stock!.id}`]: n } } as never);
    };
    const rowOf = async (orderToken: string) => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopOrders).where(eq(shopOrders.token, orderToken)));
        return row!;
    };
    const recordField = async (recordId: number, fieldId: number | null | undefined): Promise<unknown> => {
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, recordId)));
        return (rec!.data as Record<string, unknown>)[`f${fieldId}`];
    };
    const linkOf = async (id: number) => {
        const [l] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(paymentLinks).where(eq(paymentLinks.id, id)));
        return l!;
    };
    const hookToken = async (): Promise<string> => (await collections.hookUrlFor(tenantId, connId, 'mercadopago')).split('/').pop()!;
    /** Mercado Pago tiene el pago aprobado (sin avisar todavía). */
    const approve = (paymentId: string, prefIndex: number, amount: number): void => {
        payments.set(paymentId, {
            id: Number(paymentId),
            status: 'approved',
            status_detail: 'accredited',
            transaction_amount: amount,
            currency_id: 'COP',
            date_approved: new Date().toISOString(),
            payment_method_id: 'pse',
            payment_type_id: 'bank_transfer',
            external_reference: prefs[prefIndex]!.external_reference,
        });
    };
    /** …y avisa: el aviso trae sólo el id; el estado se relee. */
    const pay = async (paymentId: string, prefIndex: number, amount: number): Promise<void> => {
        approve(paymentId, prefIndex, amount);
        expect(await collections.handleHook(await hookToken(), {}, { type: 'payment', data: { id: paymentId } })).toBe('applied');
    };
    /** Lo que sigue al pago corre después de responder al aviso: se espera al pedido. */
    const waitPayment = async (orderToken: string, status: string): Promise<void> => {
        for (let i = 0; i < 80; i++) {
            if ((await rowOf(orderToken)).paymentStatus === status) return;
            await sleep(50);
        }
    };
    const expireNow = async (orderToken: string): Promise<void> => {
        await withTenant(pg.db, tenantId, (tx) => tx.update(shopOrders).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(shopOrders.token, orderToken)));
    };

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        listsSvc = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), listsSvc, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), listsSvc, rt);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', FILES_SIGNING_SECRET: 'shop-online-secret', APP_BASE_URL: 'https://app.test' });
        const audit = new AuditService(tenantDb);
        connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        const automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), listsSvc, new AutomationScheduler(), new FakeHookStore(), connectors);
        const plans = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsSvc);
        const hub = new RecordChangeHub();
        recordsSvc = new RecordsService(tenantDb, new RecordsRepository(), listsSvc, fieldsSvc, rt, activity, dispatcher, new RelationsRepository(), undefined, hub);
        const dashboards = new DashboardsService(tenantDb, null as never, recordsSvc, fieldsSvc);
        const blueprint = new BlueprintService(tenantDb, listsSvc, fieldsSvc, views, automations, new RecordsRepository(), new RelationsRepository(), billing, rt, dashboards);
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-shop-online-'))), env);
        collections = new CollectionsService(tenantDb, pg.db, env, connectors, listsSvc, new RecordsRepository(), activity, rt, dispatcher, audit, fieldsSvc);
        const notify = new NotifyHub();
        notify.subscribe((e) => {
            notices.push(e);
        });
        const incidentHub = {
            report: (i: { key: string; title: string; message: string }) => incidents.push(i),
            resolve: (_t: number, key: string) => resolved.push(key),
        } as unknown as IncidentHub;
        shopsSvc = new ShopService(pg.db, tenantDb, listsSvc, fieldsSvc, undefined, { get: () => blueprint } as never, undefined, undefined, collections);
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
            new MailService(env, mailbox),
            notify,
            hub,
            undefined,
            collections,
            incidentHub,
            pg.db,
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
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-online', name: 'Acme', plan: 'pro', settings: { format: { number_format: 'dot_comma' } } }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'dueno@acme-online.co', name: 'Dueño', passwordHash: 'x' }).returning();
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
        const add = async (key: string, data: Record<string, unknown>): Promise<void> => {
            const byId = Object.fromEntries(Object.entries(data).map(([slug, v]) => [`f${f[slug]!.id}`, v]));
            product[key] = (await recordsSvc.create(tenantId, admin, 'productos', { data: byId } as never)).id;
        };
        await add('taza', { nombre: 'Taza de cerámica', precio: 25000, stock: 10 });
        await add('vela', { nombre: 'Vela aromática', precio: 12000, stock: 1 });
        await add('libro', { nombre: 'Libro', precio: 40000 });

        fakeMercadoPago();
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'mercadopago', {
            fields: { access_token: 'APP_USR-buena' },
            visibility: 'workspace',
        });
        connId = connection.id;

        const dto = await shopsSvc.create(tenantId, adminId, { list_id: catalogId, name: 'Tienda Acme' });
        shopId = dto.id;
        const ready: ShopConfig = {
            ...dto.config,
            payments: {
                ...dto.config.payments,
                transfer: { ...dto.config.payments.transfer, enabled: true, instructions: 'Bancolombia ahorros 123-456789-00.' },
                online: { enabled: true, connection_id: connId, hold_minutes: 30 },
            },
            seller: { legal_name: 'Acme SAS', document: '900123456-1', address: 'Carrera 7 # 12-30', city: 'Bogotá', email: 'ventas@acme.co', phone: '' },
        };
        const saved = (await shopsSvc.update(tenantId, shopId, { config: ready as never, enabled: true })).dto;
        config = saved.config;
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shops).where(eq(shops.id, shopId)));
        token = row!.token;
    }, 120_000);

    beforeEach(async () => {
        // Lo que sigue a un pago (correo, aviso) corre después de responder.
        await sleep(200);
        net.calls.length = 0;
        mailbox.sent.length = 0;
        notices.length = 0;
        incidents.length = 0;
        resolved.length = 0;
        mpDown = false;
        await redis.flushall();
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    it('la cuenta del equipo queda elegida, el pago en línea va primero y una cuenta ajena se descarta', async () => {
        expect(config.payments.online).toEqual({ enabled: true, connection_id: connId, hold_minutes: 30 });
        const dto = await shopsSvc.get(tenantId, shopId);
        expect(dto.problems).toEqual([]);
        const opts = await shopsSvc.options(tenantId, shopId);
        expect(opts.payment_connections).toEqual([expect.objectContaining({ id: connId, provider: 'mercadopago' })]);
        const info = await publicSvc.freshInfo(token);
        expect(info!.meta.payments[0]).toMatchObject({ method: 'online', label: 'Pagar en línea' });
        expect(info!.meta.payments[0]!.instructions).toContain('Mercado Pago');
        // Una cuenta que no es del equipo (o que no existe) no se guarda: con
        // la tienda publicada, el cambio se rechaza; sin publicar, queda sin cuenta.
        const forged = { ...config, payments: { ...config.payments, online: { ...config.payments.online, connection_id: 999_999 } } };
        await expect(shopsSvc.update(tenantId, shopId, { config: forged as never })).rejects.toMatchObject({ response: { code: 'shop_not_ready' } });
        expect((await shopsSvc.get(tenantId, shopId)).config.payments.online.connection_id).toBe(connId);
        const off = (await shopsSvc.update(tenantId, shopId, { config: forged as never, enabled: false })).dto;
        expect(off.config.payments.online.connection_id).toBeNull();
        expect(off.problems.some((p) => p.section === 'payment')).toBe(true);
        const back = (
            await shopsSvc.update(tenantId, shopId, {
                config: { ...off.config, payments: { ...off.config.payments, online: { ...off.config.payments.online, connection_id: connId } } } as never,
                enabled: true,
            })
        ).dto;
        config = back.config;
        expect(back.enabled).toBe(true);
        expect(config.payments.online.connection_id).toBe(connId);
    });

    it('el pedido en línea aparta el stock con un plazo, lleva a pagar y el aviso lo da por pagado una sola vez', async () => {
        const before = Number(await stockOf(product.taza!));
        const placed = await place({ lines: [{ product_id: product.taza!, qty: 2 }] });
        expect(placed!.payment_method).toBe('online');
        expect(placed!.pay_url).toContain('mercadopago.com.co');
        // El monto lo decidió el servidor y la vuelta es a la página del pedido.
        expect(prefs).toHaveLength(1);
        expect((prefs[0]!.items as Array<{ unit_price: number }>)[0]!.unit_price).toBe(placed!.total);
        const back = (prefs[0]!.back_urls as { success: string }).success;
        expect(back).toContain(`?pedido=${placed!.order_token}`);
        expect(back).toContain('&pago=1');
        expect(await stockOf(product.taza!)).toBe(before - 2);

        const row = await rowOf(placed!.order_token);
        expect(row.paymentStatus).toBe('pendiente');
        expect(row.paymentLinkId).not.toBeNull();
        expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
        expect(row.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 1000);
        expect((await linkOf(row.paymentLinkId!)).expiresAt?.getTime()).toBe(row.expiresAt!.getTime());
        // Nadie del equipo se entera de un carrito sin pagar; a quien compra le llega cómo pagar.
        expect(notices).toHaveLength(0);
        await sleep(100);
        expect(mailbox.sent.map((m) => m.subject)).toEqual([expect.stringContaining('Completa el pago')]);
        expect(mailbox.sent[0]!.html).toContain('Pagar mi pedido');

        // La página del pedido muestra el botón para pagar mientras siga a tiempo.
        const pub = await publicSvc.order(token, placed!.order_token);
        expect(pub).toMatchObject({ payment_status: 'pendiente', pay_provider: 'Mercado Pago' });
        expect(pub!.pay_url).toBe(placed!.pay_url);
        expect(pub!.pay_until).not.toBeNull();
        const panel = await ordersSvc.panel(tenantId, row.recordId!);
        expect(panel).toMatchObject({ pay_url: placed!.pay_url, pay_provider: 'Mercado Pago' });

        // Paga: el pedido queda pagado, el equipo se entera y a quien compró le llega la confirmación.
        mailbox.sent.length = 0;
        await pay('7001', 0, placed!.total);
        await waitPayment(placed!.order_token, 'pagado');
        const after = await rowOf(placed!.order_token);
        expect(after.paymentStatus).toBe('pagado');
        expect(after.paidAt).not.toBeNull();
        expect(await recordField(after.recordId!, config.orders.fields.payment_status)).toBe('pagado');
        await sleep(150);
        expect(notices.filter((n) => n.type === 'shop' && titleOf(n).startsWith('Pedido pagado'))).toHaveLength(1);
        expect(mailbox.sent.map((m) => m.subject)).toEqual([expect.stringContaining('Recibimos el pago')]);
        expect((await publicSvc.order(token, placed!.order_token))!.pay_url).toBeNull();
        // El mismo aviso otra vez no paga dos veces.
        await collections.handleHook(await hookToken(), {}, { type: 'payment', data: { id: '7001' } });
        await sleep(150);
        expect(notices.filter((n) => titleOf(n).startsWith('Pedido pagado'))).toHaveLength(1);
        expect(await stockOf(product.taza!)).toBe(before - 2);
    });

    it('vence sin pagar: vuelve el stock; un pago tardío lo revive si todavía alcanza', async () => {
        const before = Number(await stockOf(product.taza!));
        const placed = await place();
        expect(await stockOf(product.taza!)).toBe(before - 1);
        await expireNow(placed!.order_token);
        expect(await ordersSvc.expireDue()).toBe(1);
        const row = await rowOf(placed!.order_token);
        expect(row.paymentStatus).toBe('vencido');
        expect(row.cancelledAt).not.toBeNull();
        expect(row.stockState).toBe('returned');
        expect(await stockOf(product.taza!)).toBe(before);
        expect(await recordField(row.recordId!, config.orders.fields.status)).toBe('cancelado');
        expect(await recordField(row.recordId!, config.orders.fields.payment_status)).toBe('vencido');
        expect((await linkOf(row.paymentLinkId!)).status).toBe('expired');
        const pub = await publicSvc.order(token, placed!.order_token);
        expect(pub!.pay_url).toBeNull();
        expect(pub!.payment_note).toContain('El tiempo para pagar terminó');
        // Barrer otra vez no hace nada.
        expect(await ordersSvc.expireDue()).toBe(0);

        // El pago llega igual y todavía hay tazas: el pedido revive y vuelve a tomar el stock.
        const idx = prefs.length - 1;
        approve('7002', idx, placed!.total);
        await collections.handleHook(await hookToken(), {}, { type: 'payment', data: { id: '7002' } });
        await waitPayment(placed!.order_token, 'pagado');
        const after = await rowOf(placed!.order_token);
        expect(after.cancelledAt).toBeNull();
        expect(after.stockState).toBe('taken');
        expect(await stockOf(product.taza!)).toBe(before - 1);
        expect(await recordField(after.recordId!, config.orders.fields.status)).toBe('nuevo');
        await sleep(100);
        expect(notices.some((n) => titleOf(n).startsWith('Pedido pagado'))).toBe(true);
    });

    it('pago tardío sin stock: el pedido sigue cancelado, queda pagado y el equipo se entera', async () => {
        await setStock(product.vela!, 1);
        const placed = await place({ lines: [{ product_id: product.vela!, qty: 1 }] });
        const idx = prefs.length - 1;
        expect(await stockOf(product.vela!)).toBe(0);
        await expireNow(placed!.order_token);
        await ordersSvc.expireDue();
        expect(await stockOf(product.vela!)).toBe(1);
        // Otra persona se lleva la última vela (por transferencia).
        const other = await place({ lines: [{ product_id: product.vela!, qty: 1 }], payment_method: 'transfer', customer: { ...order().customer, email: 'otra@cliente.co' } });
        expect(other!.pay_url).toBeNull();
        expect(await stockOf(product.vela!)).toBe(0);
        notices.length = 0;

        await pay('7003', idx, placed!.total);
        await waitPayment(placed!.order_token, 'pagado');
        const row = await rowOf(placed!.order_token);
        expect(row.cancelledAt).not.toBeNull();
        expect(row.stockState).toBe('returned');
        expect(await stockOf(product.vela!)).toBe(0);
        await sleep(100);
        expect(notices.some((n) => n.type === 'shop' && titleOf(n).includes('estaba cancelado'))).toBe(true);
        expect(notices.some((n) => titleOf(n).startsWith('Pedido pagado'))).toBe(false);
        expect((await publicSvc.order(token, placed!.order_token))!.payment_note).toContain('Recibimos tu pago, pero el pedido estaba cancelado');
    });

    it('antes de cancelar se le pregunta al proveedor, y al volver del checkout también', async () => {
        // El aviso nunca llegó, pero el pago sí: el barrido lo da por pagado en vez de cancelarlo.
        const a = await place();
        approve('7004', prefs.length - 1, a!.total);
        await expireNow(a!.order_token);
        await ordersSvc.expireDue();
        const rowA = await rowOf(a!.order_token);
        expect(rowA.paymentStatus).toBe('pagado');
        expect(rowA.cancelledAt).toBeNull();

        // Vuelve del checkout: la página pregunta y queda pagado en el acto.
        const b = await place();
        approve('7005', prefs.length - 1, b!.total);
        expect((await publicSvc.order(token, b!.order_token))!.payment_status).toBe('pendiente');
        const pub = await publicSvc.order(token, b!.order_token, { refresh: true, ip: nextIp() });
        expect(pub!.payment_status).toBe('pagado');
        expect(pub!.pay_url).toBeNull();
    });

    it('marcar pagado o cancelar el pedido deja el link sin uso', async () => {
        const a = await place();
        const rowA = await rowOf(a!.order_token);
        await ordersSvc.markPaid(tenantId, adminId, rowA.recordId!);
        expect((await linkOf(rowA.paymentLinkId!)).status).toBe('expired');

        const b = await place();
        const rowB = await rowOf(b!.order_token);
        const before = Number(await stockOf(product.taza!));
        await recordsSvc.update(tenantId, admin, (await shopsSvc.get(tenantId, shopId)).orders!.list_slug, rowB.recordId!, {
            data: { [`f${config.orders.fields.status}`]: 'cancelado' },
        } as never);
        for (let i = 0; i < 60 && (await linkOf(rowB.paymentLinkId!)).status !== 'expired'; i++) await sleep(50);
        expect((await linkOf(rowB.paymentLinkId!)).status).toBe('expired');
        expect(await stockOf(product.taza!)).toBe(before + 1);
        // Cancelado por el equipo no se «vence»: el barrido no lo toca.
        await expireNow(b!.order_token);
        expect(await ordersSvc.expireDue()).toBe(0);
    });

    it('si el proveedor no responde, el pedido no queda a medias: vuelve el stock y se abre un problema', async () => {
        const before = Number(await stockOf(product.taza!));
        const count = (
            await withTenant(pg.db, tenantId, (tx) => tx.select({ id: shopOrders.id }).from(shopOrders).where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.paymentStatus, 'vencido'))))
        ).length;
        mpDown = true;
        await expect(place()).rejects.toMatchObject({ response: { code: 'shop_payment_unavailable' } });
        expect(await stockOf(product.taza!)).toBe(before);
        const vencidos = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ id: shopOrders.id }).from(shopOrders).where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.paymentStatus, 'vencido'))),
        );
        expect(vencidos).toHaveLength(count + 1);
        expect(incidents.map((i) => i.key)).toEqual([`shop-pay:${shopId}`]);
        // Vuelve a funcionar: el problema se cierra solo con el próximo pedido.
        mpDown = false;
        const ok = await place();
        expect(ok!.pay_url).toContain('mercadopago.com.co');
        expect(resolved).toContain(`shop-pay:${shopId}`);
        // Un pedido que no lleva productos con stock (libro) también cobra en línea.
        const book = await place({ lines: [{ product_id: product.libro!, qty: 1 }] });
        expect(book!.pay_url).not.toBeNull();
    });
});
