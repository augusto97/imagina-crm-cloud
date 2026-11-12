import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formStatSourceLabel, type Field, type PublicShopOrderInput, type ShopConfig } from '@imagina-base/shared';
import { eq, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { memberships, records, shopOrders, shops, shopStats, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
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
import { ShopImagesService } from '../src/shop/shop-images.service';
import { panelOrigin, ShopOrdersService } from '../src/shop/shop-orders.service';
import { ShopPublicService } from '../src/shop/shop-public.service';
import { ShopCouponsService } from '../src/shop/shop-coupons.service';
import { ShopService } from '../src/shop/shop.service';
import { ShopStatsService } from '../src/shop/shop-stats.service';
import { ShopAiTools } from '../src/shop/shop-ai-tools';
import { AiToolRegistry } from '../src/ai/tools/registry';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.418 — Estadísticas y conversiones de la tienda. Lo que pasa en la
 * página se suma en Redis y se vuelca sumando (sin contar productos que la
 * tienda no vende); los pedidos guardan de dónde llegaron (columnas, ficha y
 * resumen); la compra para Google y Meta sólo sale con el pedido hecho y
 * nunca cancelado, con el correo sólo si la tienda lo pide; y la página
 * recibe las etiquetas del enlace directo.
 */

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


type SentMail = { to: string; subject: string; html: string; text: string };

describe('v0.1.418 — tienda: estadísticas, origen y conversiones (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let listsSvc: ListsService;
    let fieldsSvc: FieldsService;
    let recordsSvc: RecordsService;
    let files: FilesService;
    let shopsSvc: ShopService;
    let ordersSvc: ShopOrdersService;
    let publicSvc: ShopPublicService;
    let statsSvc: ShopStatsService;
    let ordersListId: number;
    let shopId: number;
    let tenantId: number;
    let adminId: number;
    let admin: Actor;
    let catalogId: number;
    const mails: SentMail[] = [];
    const f: Record<string, Field> = {};
    const product: Record<string, number> = {};

    const stampFor = (id: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('shopstamp', id, ts)}`;
    };
    const tokenOf = async (id: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shops).where(eq(shops.id, id)));
        return row!.token;
    };
    const orderRow = async (token: string): Promise<typeof shopOrders.$inferSelect> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopOrders).where(eq(shopOrders.token, token)));
        return row!;
    };
    let ipSeq = 10;
    const customer = { name: 'Ana Gómez', email: 'ana@cliente.co', phone: '+573001112233', document: '', address: '', city: '', notes: '' };
    const place = async (partial: Partial<PublicShopOrderInput> = {}, id = shopId) =>
        publicSvc.placeOrder(
            await tokenOf(id),
            { lines: [{ product_id: product.taza!, qty: 1 }], customer, delivery_id: 'retiro', payment_method: 'transfer', terms: true, consent: false, stamp: stampFor(id), ...partial },
            { ip: `198.51.100.${ipSeq++}`, userAgent: 'vitest' },
        );
    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 120));
    const readyConfig = (base: ShopConfig): ShopConfig => ({
        ...base,
        payments: {
            ...base.payments,
            transfer: { ...base.payments.transfer, enabled: true, instructions: 'Bancolombia ahorros 123-456789-00.' },
        },
        seller: { legal_name: 'Acme SAS', document: '900123456-1', address: 'Carrera 7 # 12-30', city: 'Bogotá', email: 'ventas@acme.co', phone: '' },
    });

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        listsSvc = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), listsSvc, rt);
        const views = new ViewsService(tenantDb, new ViewsRepository(), listsSvc, rt);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', FILES_SIGNING_SECRET: 'shop-secret', APP_BASE_URL: 'https://app.test' });
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        const automations = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), listsSvc, new AutomationScheduler(), new FakeHookStore(), connectors);
        const plans = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plans, new EmailQuotaService(pg.db, plans), new TenantSmtpService(pg.db, env));
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsSvc);
        const dispatcher = new CapturingDispatcher();
        const hub = new RecordChangeHub();
        recordsSvc = new RecordsService(tenantDb, new RecordsRepository(), listsSvc, fieldsSvc, rt, activity, dispatcher, new RelationsRepository(), undefined, hub);
        const dashboards = new DashboardsService(tenantDb, null as never, recordsSvc, fieldsSvc);
        const blueprint = new BlueprintService(tenantDb, listsSvc, fieldsSvc, views, automations, new RecordsRepository(), new RelationsRepository(), billing, rt, dashboards);
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-shop-stats-'))), env);
        const notify = new NotifyHub();
        notify.subscribe((_e: NotifyEvent) => undefined);
        shopsSvc = new ShopService(pg.db, tenantDb, listsSvc, fieldsSvc, undefined, { get: () => blueprint } as never);
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
            undefined,
            undefined,
            pg.db,
            coupons,
        );
        ordersSvc.onModuleInit();
        // Sin TenantTimeZones: la zona es UTC (la empresa no eligió otra).
        statsSvc = new ShopStatsService(tenantDb, redis as never);
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
            undefined,
            coupons,
            statsSvc,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-medir', name: 'Acme', plan: 'pro' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'dueno@medir.co', name: 'Dueño', passwordHash: 'x' }).returning();
        adminId = u!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: adminId, tenantId, role: 'admin' }));
        admin = { userId: adminId, role: 'admin' };

        catalogId = (await listsSvc.create(tenantId, { name: 'Productos' })).id;
        const mk = async (slug: string, label: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = await fieldsSvc.create(tenantId, 'productos', { label, type, slug, ...(config ? { config } : {}) } as never);
        };
        await mk('nombre', 'Nombre', 'text');
        await mk('precio', 'Precio', 'currency', { currency: 'COP', precision: 0 });
        await mk('stock', 'Stock', 'number');

        const add = async (key: string, data: Record<string, unknown>): Promise<void> => {
            const byId = Object.fromEntries(Object.entries(data).map(([slug, v]) => [`f${f[slug]!.id}`, v]));
            product[key] = (await recordsSvc.create(tenantId, admin, 'productos', { data: byId } as never)).id;
        };
        await add('taza', { nombre: 'Taza de cerámica', precio: 25000, stock: 20 });
        await add('libreta', { nombre: 'Libreta', precio: 12000, stock: 20 });

        const dto = await shopsSvc.create(tenantId, adminId, { list_id: catalogId, name: 'Tienda Acme' });
        shopId = dto.id;
        ordersListId = dto.config.orders.list_id!;
        await shopsSvc.update(tenantId, shopId, { config: readyConfig(dto.config) as never, enabled: true });
    }, 120_000);

    beforeEach(async () => {
        await redis.flushall();
        mails.length = 0;
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    const target = () => ({ tenantId, shopId, timeZone: 'UTC' });
    const summary = async (days = 7) => statsSvc.summary({ ...target(), ...(await shopsSvc.statsTarget(tenantId, shopId)) }, days);

    it('lo que pasa en la página se suma en Redis, se ve antes de volcarse y el volcado SUMA', async () => {
        const token = await tokenOf(shopId);
        const visit = [
            { kind: 'view' as const, src: 'u:google', dev: 'mobile' as const },
            { kind: 'product' as const, item: product.taza!, first: true },
            // Un producto que la tienda no vende no suma nada.
            { kind: 'product' as const, item: 999_999, first: true },
            { kind: 'add' as const, item: product.taza!, first: true },
            { kind: 'checkout' as const },
        ];
        expect(await publicSvc.recordStats(token, visit, '203.0.113.5')).toBe(true);
        // Antes del volcado ya se ve (sale de Redis).
        let s = await summary();
        expect(s.totals.visits).toBe(1);
        expect(s.funnel.map((x) => [x.key, x.count])).toEqual([
            ['visits', 1],
            ['product', 1],
            ['cart', 1],
            ['checkout', 1],
            ['orders', 0],
            ['paid', 0],
        ]);
        expect(s.devices.mobile).toBe(1);
        expect(s.products.map((p) => [p.title, p.views, p.adds])).toEqual([['Taza de cerámica', 1, 1]]);

        expect(await statsSvc.flush()).toBe(1);
        // Otra visita, que se vuelca encima: el UPSERT suma.
        await publicSvc.recordStats(token, [{ kind: 'view', dev: 'desktop' }, { kind: 'product', item: product.libreta!, first: true }], '203.0.113.6');
        await statsSvc.flush();
        const rows = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopStats).where(eq(shopStats.shopId, shopId)));
        expect(rows).toHaveLength(1);
        expect(rows[0]!.counts).toMatchObject({ v: 2, pvv: 2, av: 1, c: 1, 'src:u:google': 1, 'src:d': 1, 'dev:m': 1, 'dev:d': 1, [`p:${product.taza}`]: 1, [`p:${product.libreta}`]: 1 });
        expect(Object.keys(rows[0]!.counts as object)).not.toContain('p:999999');
        s = await summary();
        expect(s.totals.visits).toBe(2);
        expect(s.sources.map((x) => [x.key, x.visits])).toEqual(expect.arrayContaining([['u:google', 1], ['d', 1]]));

        // Una tienda que no existe no cuenta.
        expect(await publicSvc.recordStats('tokenQueNoExiste123456', visit, '203.0.113.7')).toBe(false);
        // Las estadísticas son de su empresa: otra no las ve.
        const [other] = await pg.db.insert(tenants).values({ slug: 'otra-medir', name: 'Otra', plan: 'pro' }).returning();
        const seen = await withTenant(pg.db, other!.id, (tx) => tx.select().from(shopStats));
        expect(seen).toHaveLength(0);
    });

    it('el pedido guarda de dónde llegó: columnas, ficha y resumen', async () => {
        const placed = await place({
            lines: [
                { product_id: product.taza!, qty: 2 },
                { product_id: product.libreta!, qty: 1 },
            ],
            origin: {
                page: 'https://acme.co/navidad?utm_campaign=navidad',
                src: 'u:google',
                attribution: { utm_source: 'google', utm_campaign: 'navidad', gclid: 'Cj0KCQabc123', page_url: 'https://acme.co/navidad?utm_campaign=navidad', inventada: 'x' },
            },
        });
        const row = await orderRow(placed!.order_token);
        expect(row.origin).toMatchObject({ src: 'u:google', attribution: { utm_source: 'google', utm_campaign: 'navidad', gclid: 'Cj0KCQabc123', page_url: 'https://acme.co/navidad' } });
        expect((row.origin as { attribution: Record<string, unknown> }).attribution.inventada).toBeUndefined();

        // Las columnas del pedido.
        const { config } = (await shopsSvc.listForList(tenantId, catalogId))[0]!;
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, row.recordId!)));
        const data = rec!.data as Record<string, unknown>;
        expect(data[`f${config.orders.fields.source}`]).toBe(formStatSourceLabel('u:google'));
        expect(data[`f${config.orders.fields.campaign}`]).toBe('navidad');

        // La ficha del pedido.
        const panel = await ordersSvc.panel(tenantId, row.recordId!);
        expect(panel!.origin).toEqual({ source: 'Campaña: google', campaign: 'navidad', ad: 'google', page: 'https://acme.co/navidad' });

        // Un origen con forma rara cuenta como directo; sin origen, la ficha no dice nada.
        const raro = await place({ origin: { src: 'u:<script>' } });
        expect((await orderRow(raro!.order_token)).origin).toMatchObject({ src: 'd' });
        expect(panelOrigin({})).toBeNull();
        expect(panelOrigin({ src: 'd', attribution: { fbclid: 'IwAR0abc' } })).toMatchObject({ source: 'Directo', ad: 'meta' });

        // El resumen: pedidos, pagados, lo vendido y de dónde.
        let s = await summary();
        expect(s.totals).toMatchObject({ orders: 2, paid: 0, revenue: 0 });
        await ordersSvc.markPaid(tenantId, adminId, row.recordId!);
        s = await summary();
        expect(s.totals).toMatchObject({ orders: 2, paid: 1, revenue: row.total });
        expect(s.products.map((p) => [p.title, p.units])).toEqual([
            ['Taza de cerámica', 2],
            ['Libreta', 1],
        ]);
        const google = s.sources.find((x) => x.key === 'u:google')!;
        expect(google).toMatchObject({ orders: 1, paid: 1, revenue: row.total });
        expect(s.sources.find((x) => x.key === 'd')).toMatchObject({ orders: 1, paid: 0 });
    });

    it('la compra para Google y Meta: con el pedido hecho, nunca cancelado, y el correo sólo si se pide', async () => {
        const token = await tokenOf(shopId);
        const placed = await place({ lines: [{ product_id: product.taza!, qty: 1 }] });
        let pub = await publicSvc.order(token, placed!.order_token);
        expect(pub!.conversion).toMatchObject({
            transaction_id: placed!.number,
            value: placed!.total,
            currency: 'COP',
            items: [{ item_id: String(product.taza), item_name: 'Taza de cerámica', price: 25000, quantity: 1 }],
        });
        expect(pub!.conversion!.user_data).toBeUndefined();

        // Con «compartir el correo y el teléfono»: van normalizados.
        const base = (await shopsSvc.listForList(tenantId, catalogId))[0]!.config;
        await shopsSvc.update(tenantId, shopId, { config: { ...base, conversion: { ...base.conversion, share_contact: true } } as never });
        const conCorreo = await place({ customer: { ...customer, email: '  Ana@Cliente.CO ' } });
        pub = await publicSvc.order(token, conCorreo!.order_token);
        expect(pub!.conversion!.user_data).toEqual({ email: 'ana@cliente.co', phone_number: '+573001112233' });

        // Cancelado, no hay compra que contar.
        const row = await orderRow(placed!.order_token);
        const { config } = (await shopsSvc.listForList(tenantId, catalogId))[0]!;
        const ordersSlug = (await listsSvc.get(tenantId, String(ordersListId))).slug;
        await recordsSvc.update(tenantId, admin, ordersSlug, row.recordId!, { data: { [`f${config.orders.fields.status}`]: 'cancelado' } } as never);
        for (let i = 0; i < 40 && (await orderRow(placed!.order_token)).cancelledAt === null; i++) await flush();
        pub = await publicSvc.order(token, placed!.order_token);
        expect(pub!.conversion).toBeNull();
    });

    it('la página recibe la etiqueta de Google Ads, el aviso a Meta y las etiquetas del enlace directo', async () => {
        const token = await tokenOf(shopId);
        expect((await publicSvc.freshInfo(token))!.meta.conversion).toBeNull();
        const base = (await shopsSvc.listForList(tenantId, catalogId))[0]!.config;
        await shopsSvc.update(tenantId, shopId, {
            config: {
                ...base,
                conversion: { ...base.conversion, google_ads: 'AW-123456789/AbCdEf12', meta_event: true, direct_tags: true, google_tag_id: 'G-ABC1234', meta_pixel_id: '1234567890123', cookie_notice: true },
            } as never,
        });
        const conv = (await publicSvc.freshInfo(token))!.meta.conversion!;
        expect(conv).toMatchObject({
            google_ads: 'AW-123456789/AbCdEf12',
            meta_event: true,
            direct: { google_ads: 'AW-123456789/AbCdEf12', google_ads_id: 'AW-123456789', google_tag_id: 'G-ABC1234', meta_pixel_id: '1234567890123' },
        });
        expect(conv.direct!.notice).toBeTruthy();
        // Lo que no tiene forma de etiqueta no se guarda.
        const { dto: saved } = await shopsSvc.update(tenantId, shopId, {
            config: { ...base, conversion: { ...base.conversion, google_ads: '<script>', direct_tags: true, google_tag_id: 'x', meta_pixel_id: 'abc' } } as never,
        });
        expect(saved.config.conversion).toMatchObject({ google_ads: null, google_tag_id: null, meta_pixel_id: null });
        expect((await publicSvc.freshInfo(token))!.meta.conversion).toBeNull();
    });

    it('una tienda de antes recibe las columnas de origen con un clic (y reusa las que ya existen)', async () => {
        const before = (await shopsSvc.listForList(tenantId, catalogId))[0]!.config.orders.fields;
        expect(typeof before.source).toBe('number');
        // Como una tienda de antes: sin esas columnas en su configuración.
        await withTenant(pg.db, tenantId, (tx) =>
            tx.execute(sql`UPDATE shops SET config = jsonb_set(config, '{orders,fields}', (config->'orders'->'fields') - 'source' - 'campaign') WHERE id = ${shopId}`),
        );
        expect((await shopsSvc.listForList(tenantId, catalogId))[0]!.config.orders.fields.source).toBeUndefined();
        await shopsSvc.ensureOrderColumns(tenantId, shopId, 'origin');
        const after = (await shopsSvc.listForList(tenantId, catalogId))[0]!.config.orders.fields;
        // Las mismas columnas de antes (por nombre y tipo), no otras.
        expect(after.source).toBe(before.source);
        expect(after.campaign).toBe(before.campaign);
        const fields = await fieldsSvc.listByListId(tenantId, ordersListId);
        expect(fields.filter((x) => x.slug === 'llego_desde')).toHaveLength(1);
    });

    it('v0.1.419 — el asistente y el MCP: la tienda en get_list_schema y get_shop_stats', async () => {
        const registry = new AiToolRegistry();
        const tools = new ShopAiTools(shopsSvc, statsSvc, registry);
        tools.onModuleInit();
        // Registrar dos veces no duplica la herramienta.
        tools.registerInto(registry);
        const ctx = { tenantId, userId: adminId, role: 'admin' as const };

        const catalog = (await registry.listSchemaExtras(ctx, { id: catalogId, slug: 'productos' })) as { shops: { items: Array<Record<string, unknown>> } };
        expect(catalog.shops.items).toHaveLength(1);
        expect(catalog.shops.items[0]).toMatchObject({ id: shopId, name: 'Tienda Acme', role: 'catalog', published: true, currency: 'COP' });
        expect((catalog.shops.items[0]!.payments as Record<string, boolean>).transfer).toBe(true);
        const orders = (await registry.listSchemaExtras(ctx, { id: ordersListId, slug: 'pedidos' })) as { shops: { items: Array<Record<string, unknown>> } };
        expect(orders.shops.items[0]!.role).toBe('orders');
        // Quien no administra listas no ve la tienda (como en la app).
        expect(await registry.listSchemaExtras({ ...ctx, role: 'agent' }, { id: catalogId, slug: 'productos' })).toEqual({});

        await place();
        const tool = registry.get('get_shop_stats')!;
        expect(tool.capability).toBe('manage_lists');
        const res = await tool.run(ctx, { shop_id: shopId, days: 30 });
        expect(res.isError).toBeFalsy();
        const content = res.content as { shop: { id: number }; totals: { orders: number }; days: Array<{ orders: number }> };
        expect(content.shop.id).toBe(shopId);
        expect(content.totals.orders).toBeGreaterThanOrEqual(1);
        // Sólo los días con movimiento.
        expect(content.days.every((d) => d.orders > 0 || (d as unknown as { visits: number }).visits > 0)).toBe(true);
        const missing = await tool.run(ctx, { shop_id: 999_999, days: 7 });
        expect(missing.isError).toBe(true);
    });
});
