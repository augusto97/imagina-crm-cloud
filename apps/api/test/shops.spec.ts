import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readShopConfig, readShopListMarker, type Field, type PublicShopOrderInput, type ShopConfig } from '@imagina-base/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
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
import { lists as listsTable, memberships, records, relations, shopOrders, shops, tenants, users } from '../src/db/schema';
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
import { ShopOrdersService } from '../src/shop/shop-orders.service';
import { renderShopPage, shopPageCsp } from '../src/shop/shop-page';
import { ShopPublicService } from '../src/shop/shop-public.service';
import { ShopService } from '../src/shop/shop.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.412 (ADR-S103) — La tienda: crearla arma su pack de listas, no se
 * publica sin lo que pide la ley, lo público no lleva el número de WhatsApp,
 * el pedido relee precios y stock de la base, cancelar devuelve el stock, el
 * equipo marca pagado y la plataforma la suspende.
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

const IP = '203.0.113.120';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('v0.1.412 — tienda desde una lista (Postgres + Redis reales)', () => {
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
    let dispatcher: CapturingDispatcher;
    const notices: NotifyEvent[] = [];
    let tenantId: number;
    let otherTenantId: number;
    let adminId: number;
    let admin: Actor;
    let catalogId: number;
    const f: Record<string, Field> = {};
    const product: Record<string, number> = {};

    const stampFor = (shopId: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('shopstamp', shopId, ts)}`;
    };
    const tokenOf = async (id: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shops).where(eq(shops.id, id)));
        return row!.token;
    };
    const stockOf = async (recordId: number): Promise<unknown> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, recordId)));
        return (row!.data as Record<string, unknown>)[`f${f.stock!.id}`];
    };
    const countIn = async (listId: number): Promise<number> => {
        const rows = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ id: records.id }).from(records).where(and(eq(records.listId, listId), isNull(records.deletedAt))),
        );
        return rows.length;
    };
    const order = (shopId: number, partial: Partial<PublicShopOrderInput> = {}): PublicShopOrderInput => ({
        lines: [{ product_id: product.taza!, qty: 1 }],
        customer: { name: 'Ana Gómez', email: 'ana@cliente.co', phone: '+573001112233', document: '1020304050', address: 'Calle 10 # 5-20', city: 'Medellín', notes: '' },
        delivery_id: 'domicilio',
        payment_method: 'transfer',
        terms: true,
        consent: false,
        stamp: stampFor(shopId),
        ...partial,
    });
    /** La configuración lista para publicar (lo que pide la Ley 1480 + una forma de pago). */
    const readyConfig = (base: ShopConfig): ShopConfig => ({
        ...base,
        payments: {
            ...base.payments,
            whatsapp: { ...base.payments.whatsapp, enabled: true, phone: '+573109998877' },
            transfer: { ...base.payments.transfer, enabled: true, instructions: 'Bancolombia ahorros 123-456789-00 a nombre de Acme SAS.' },
            cod: { ...base.payments.cod, enabled: true },
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
        dispatcher = new CapturingDispatcher();
        const hub = new RecordChangeHub();
        recordsSvc = new RecordsService(tenantDb, new RecordsRepository(), listsSvc, fieldsSvc, rt, activity, dispatcher, new RelationsRepository(), undefined, hub);
        const dashboards = new DashboardsService(tenantDb, null as never, recordsSvc, fieldsSvc);
        const blueprint = new BlueprintService(tenantDb, listsSvc, fieldsSvc, views, automations, new RecordsRepository(), new RelationsRepository(), billing, rt, dashboards);
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-shop-'))), env);
        const notify = new NotifyHub();
        notify.subscribe((e) => {
            notices.push(e);
        });
        shopsSvc = new ShopService(pg.db, tenantDb, listsSvc, fieldsSvc, undefined, { get: () => blueprint } as never);
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
            undefined,
            notify,
            hub,
        );
        ordersSvc.onModuleInit();
        publicSvc = new ShopPublicService(pg.db, tenantDb, fieldsSvc, files, new ShopImagesService(tenantDb, files, null as never), ordersSvc, undefined, redis as never);

        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'acme-tienda', name: 'Acme', plan: 'pro', settings: { branding: { primary_color: '#7c3aed' } } })
            .returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra-tienda', name: 'Otra', plan: 'pro' }).returning();
        otherTenantId = o!.id;
        const [u] = await pg.db.insert(users).values({ email: 'dueno@acme.co', name: 'Dueño', passwordHash: 'x' }).returning();
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
        await mk('sku', 'SKU', 'text');
        await mk('categoria', 'Categoría', 'select', { options: [{ value: 'cocina', label: 'Cocina' }, { value: 'ropa', label: 'Ropa' }] });
        const add = async (key: string, data: Record<string, unknown>): Promise<void> => {
            const byId = Object.fromEntries(Object.entries(data).map(([slug, v]) => [`f${f[slug]!.id}`, v]));
            product[key] = (await recordsSvc.create(tenantId, admin, 'productos', { data: byId } as never)).id;
        };
        await add('taza', { nombre: 'Taza de cerámica', precio: 25000, stock: 3, sku: 'TAZ-01', categoria: 'cocina' });
        await add('camiseta', { nombre: 'Camiseta', precio: 50000, sku: 'CAM-01', categoria: 'ropa' });
        await add('agotado', { nombre: 'Delantal', precio: 18000, stock: 0, categoria: 'cocina' });
        await add('vela', { nombre: 'Vela aromática', precio: 12000, stock: 1, categoria: 'cocina' });
    }, 120_000);

    // Los frenos por IP y por correo cuentan también los intentos rechazados.
    beforeEach(async () => {
        await redis.flushall();
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    it('crear arma el pack de pedidos, sugiere el catálogo y no publica sin lo que pide la ley', async () => {
        const dto = await shopsSvc.create(tenantId, adminId, { list_id: catalogId, name: 'Tienda Acme' });
        expect(dto.enabled).toBe(false);
        expect(dto.config.catalog.price).toBe(f.precio!.id);
        expect(dto.config.catalog.stock).toBe(f.stock!.id);
        expect(dto.config.catalog.sku).toBe(f.sku!.id);
        expect(dto.config.catalog.category).toBe(f.categoria!.id);
        expect(dto.config.currency).toBe('COP');
        expect(dto.config.seller.legal_name).toBe('Acme');
        expect(dto.orders).not.toBeNull();
        expect(dto.orders!.lines_list_id).not.toBeNull();
        expect(dto.orders!.customers_list_id).not.toBeNull();
        // Las tres listas llevan la marca de la tienda (columnas con candado).
        const ordersList = await listsSvc.get(tenantId, String(dto.orders!.list_id));
        expect(readShopListMarker(ordersList.settings)?.role).toBe('orders');
        // Sin forma de pago ni datos de quien vende: no se publica.
        await expect(shopsSvc.update(tenantId, dto.id, { enabled: true })).rejects.toMatchObject({ response: { code: 'shop_not_ready' } });
        // Una lista de pedidos no puede ser el catálogo de otra tienda.
        await expect(shopsSvc.create(tenantId, adminId, { list_id: dto.orders!.list_id, name: 'Otra' })).rejects.toMatchObject({ response: { code: 'shop_orders_list' } });
        // El navegador no puede cambiar dónde caen los pedidos.
        const forged = { ...readyConfig(dto.config), orders: { ...dto.config.orders, list_id: catalogId } };
        const saved = (await shopsSvc.update(tenantId, dto.id, { config: forged as never, enabled: true })).dto;
        expect(saved.enabled).toBe(true);
        expect(saved.config.orders.list_id).toBe(dto.orders!.list_id);
        expect(saved.problems).toEqual([]);
        // Otra empresa no la ve ni la toca.
        expect(await shopsSvc.listForList(otherTenantId, catalogId)).toEqual([]);
        await expect(shopsSvc.get(otherTenantId, dto.id)).rejects.toMatchObject({ response: { code: 'shop_not_found' } });
    });

    it('lo público: el catálogo con lo que se vende y sin el número de WhatsApp', async () => {
        const [shop] = await shopsSvc.listForList(tenantId, catalogId);
        const token = await tokenOf(shop!.id);
        const info = await publicSvc.freshInfo(token);
        expect(info).not.toBeNull();
        const titles = info!.products.map((p) => p.title);
        expect(titles).toEqual(['Taza de cerámica', 'Camiseta', 'Delantal', 'Vela aromática']);
        expect(info!.products.find((p) => p.title === 'Delantal')!.stock).toBe(0);
        expect(info!.products.find((p) => p.title === 'Camiseta')!.stock).toBeNull();
        expect(info!.meta.payments.map((p) => p.method)).toEqual(['whatsapp', 'transfer', 'cod']);
        expect(info!.meta.closed).toBeNull();
        expect(info!.meta.accent_color).toBe('#7c3aed');
        const serialized = JSON.stringify({ meta: info!.meta, products: info!.products });
        expect(serialized).not.toContain('3109998877');
        // La página: noindex y CSP cerrada; el número tampoco viaja en el HTML.
        const html = renderShopPage({ meta: info!.meta, products: info!.products, token, title: info!.title, client: 'void 0', captchaScripts: {} });
        expect(html).not.toContain('3109998877');
        expect(html).toContain('noindex');
        expect(shopPageCsp("'sha256-x'", info!.allowedDomains)).toContain("default-src 'none'");
        // Una tienda desconocida y un token mal formado: nada.
        expect(await publicSvc.freshInfo('x'.repeat(24))).toBeNull();
        expect(await publicSvc.freshInfo('../../etc')).toBeNull();
    });

    it('el pedido relee precio y stock, descuenta el stock y escribe pedido, líneas y cliente', async () => {
        const [shop] = await shopsSvc.listForList(tenantId, catalogId);
        const token = await tokenOf(shop!.id);
        const o = shop!.config.orders;
        dispatcher.events.length = 0;
        notices.length = 0;

        const placed = await publicSvc.placeOrder(
            token,
            order(shop!.id, { lines: [{ product_id: product.taza!, qty: 2 }, { product_id: product.camiseta!, qty: 1 }] }),
            { ip: IP, userAgent: 'vitest' },
        );
        expect(placed).not.toBeNull();
        expect(placed!.total).toBe(100_000);
        expect(placed!.payment_method).toBe('transfer');
        expect(placed!.whatsapp_path).toBeNull();
        // El stock de la taza bajó; la camiseta no controla stock.
        expect(await stockOf(product.taza!)).toBe(1);
        expect(await stockOf(product.camiseta!)).toBeUndefined();

        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopOrders).where(eq(shopOrders.token, placed!.order_token)));
        expect(row!.stockState).toBe('taken');
        expect(row!.paymentStatus).toBe('pendiente');
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data, listId: records.listId }).from(records).where(eq(records.id, row!.recordId!)));
        const data = rec!.data as Record<string, unknown>;
        expect(rec!.listId).toBe(o.list_id);
        expect(data[`f${o.fields.status}`]).toBe('nuevo');
        expect(data[`f${o.fields.payment_status}`]).toBe('pendiente');
        expect(data[`f${o.fields.total}`]).toBe(100_000);
        expect(String(data[`f${o.fields.title}`])).toContain('Ana Gómez');
        expect(await countIn(o.lines_list_id!)).toBe(2);
        expect(await countIn(o.customers_list_id!)).toBe(1);
        // Las líneas cuelgan del pedido.
        const links = await withTenant(pg.db, tenantId, (tx) => tx.select().from(relations).where(eq(relations.targetRecordId, row!.recordId!)));
        expect(links.length).toBeGreaterThanOrEqual(2);
        // Las automatizaciones se enteran después del commit; el equipo, por la campana.
        expect(dispatcher.events.some((e) => e.trigger === 'record_created' && e.listId === o.list_id)).toBe(true);
        expect(notices.some((n) => n.type === 'shop' && n.userIds.includes(adminId))).toBe(true);

        // Lo que ve quien compró.
        const pub = await publicSvc.order(token, placed!.order_token);
        expect(pub).toMatchObject({ status: 'nuevo', payment_status: 'pendiente', total: 100_000 });
        expect(pub!.payment_instructions).toContain('Bancolombia');
        expect(await publicSvc.order(token, 'z'.repeat(32))).toBeNull();
    });

    it('rechaza lo que cambió, lo que no alcanza y lo que no pidió bien', async () => {
        const [shop] = await shopsSvc.listForList(tenantId, catalogId);
        const token = await tokenOf(shop!.id);
        // Quedó 1 taza: pedir 5 no crea el pedido y dice qué pasó.
        await expect(publicSvc.placeOrder(token, order(shop!.id, { lines: [{ product_id: product.taza!, qty: 5 }] }), { ip: IP, userAgent: null })).rejects.toMatchObject({
            response: { code: 'shop_cart_changed' },
        });
        await expect(publicSvc.placeOrder(token, order(shop!.id, { lines: [{ product_id: product.agotado!, qty: 1 }] }), { ip: IP, userAgent: null })).rejects.toMatchObject({
            response: { code: 'shop_cart_changed' },
        });
        expect(await stockOf(product.taza!)).toBe(1);
        // Envío a domicilio sin dirección, sin aceptar términos, la trampa y un sello recién hecho.
        await expect(
            publicSvc.placeOrder(token, order(shop!.id, { customer: { ...order(shop!.id).customer, address: '', city: '' } }), { ip: IP, userAgent: null }),
        ).rejects.toMatchObject({ response: { code: 'shop_address' } });
        await expect(publicSvc.placeOrder(token, order(shop!.id, { terms: false }), { ip: IP, userAgent: null })).rejects.toMatchObject({ response: { code: 'shop_terms' } });
        await expect(publicSvc.placeOrder(token, order(shop!.id, { website: 'http://spam' }), { ip: IP, userAgent: null })).rejects.toMatchObject({ response: { code: 'shop_stale' } });
        const fresh = `${Date.now()}.${files.signParts('shopstamp', shop!.id, Date.now())}`;
        await expect(publicSvc.placeOrder(token, order(shop!.id, { stamp: fresh }), { ip: IP, userAgent: null })).rejects.toMatchObject({ response: { code: 'shop_too_fast' } });
        await expect(publicSvc.placeOrder(token, order(shop!.id, { stamp: `${Date.now() - 10_000}.firmafalsa` }), { ip: IP, userAgent: null })).rejects.toMatchObject({
            response: { code: 'shop_stale' },
        });
        // Un producto de OTRA lista (aunque sea de la empresa) no se vende.
        const otherList = (await listsSvc.create(tenantId, { name: 'Internos' })).id;
        const foreign = (await recordsSvc.create(tenantId, admin, String(otherList), { data: {} } as never)).id;
        await expect(publicSvc.placeOrder(token, order(shop!.id, { lines: [{ product_id: foreign, qty: 1 }] }), { ip: IP, userAgent: null })).rejects.toMatchObject({
            response: { code: 'shop_cart_changed' },
        });
    });

    it('WhatsApp: el número sale sólo en la redirección y el mismo cliente no se duplica', async () => {
        const [shop] = await shopsSvc.listForList(tenantId, catalogId);
        const token = await tokenOf(shop!.id);
        const placed = await publicSvc.placeOrder(
            token,
            order(shop!.id, { payment_method: 'whatsapp', delivery_id: 'retiro', lines: [{ product_id: product.camiseta!, qty: 2 }], customer: { ...order(shop!.id).customer, email: 'ANA@cliente.co' } }),
            { ip: '203.0.113.121', userAgent: null },
        );
        expect(placed!.whatsapp_path).toBe(`/api/v1/public/s/${token}/wa/${placed!.order_token}`);
        // La página del pedido (al volver a abrirla) trae el mismo botón, nunca el número.
        expect((await publicSvc.order(token, placed!.order_token))!.whatsapp_url).toBe(placed!.whatsapp_path);
        const url = await publicSvc.whatsappUrl(token, placed!.order_token);
        expect(url).toMatch(/^https:\/\/wa\.me\/573109998877\?text=/);
        expect(decodeURIComponent(url!.split('text=')[1]!)).toContain(placed!.number);
        // Un pedido por transferencia no tiene redirección a WhatsApp.
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopOrders).where(eq(shopOrders.paymentMethod, 'transfer')).orderBy(asc(shopOrders.id)));
        expect(await publicSvc.whatsappUrl(token, row!.token)).toBeNull();
        // Mismo correo (otra capitalización) → mismo cliente.
        expect(await countIn(shop!.config.orders.customers_list_id!)).toBe(1);
    });

    it('la última unidad: dos compras a la vez, una sola se lleva el producto', async () => {
        const [shop] = await shopsSvc.listForList(tenantId, catalogId);
        const token = await tokenOf(shop!.id);
        const buy = (email: string, ip: string): Promise<unknown> =>
            publicSvc.placeOrder(
                token,
                order(shop!.id, { lines: [{ product_id: product.vela!, qty: 1 }], customer: { ...order(shop!.id).customer, email } }),
                { ip, userAgent: null },
            );
        const results = await Promise.allSettled([buy('uno@cliente.co', '203.0.113.131'), buy('dos@cliente.co', '203.0.113.132')]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect((failed.reason as { response?: { code?: string } }).response?.code).toBe('shop_cart_changed');
        expect(await stockOf(product.vela!)).toBe(0);
    });

    it('cancelar devuelve el stock, sacarlo de cancelado lo vuelve a tomar, y el equipo marca pagado', async () => {
        const [shop] = await shopsSvc.listForList(tenantId, catalogId);
        const o = shop!.config.orders;
        const ordersSlug = shop!.orders!.list_slug;
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopOrders).where(eq(shopOrders.paymentMethod, 'transfer')).orderBy(asc(shopOrders.id)));
        const statusField = (await fieldsSvc.listByListId(tenantId, o.list_id!)).find((x) => x.id === o.fields.status)!;
        expect(await stockOf(product.taza!)).toBe(1);

        await recordsSvc.update(tenantId, admin, ordersSlug, row!.recordId!, { data: { [`f${statusField.id}`]: 'cancelado' } } as never);
        for (let i = 0; i < 40 && (await stockOf(product.taza!)) !== 3; i++) await sleep(50);
        expect(await stockOf(product.taza!)).toBe(3);
        const [after] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopOrders).where(eq(shopOrders.id, row!.id)));
        expect(after!.stockState).toBe('returned');
        expect(after!.cancelledAt).not.toBeNull();

        await recordsSvc.update(tenantId, admin, ordersSlug, row!.recordId!, { data: { [`f${statusField.id}`]: 'en_preparacion' } } as never);
        for (let i = 0; i < 40 && (await stockOf(product.taza!)) !== 1; i++) await sleep(50);
        expect(await stockOf(product.taza!)).toBe(1);

        // Pagó por transferencia: el equipo lo marca.
        const res = await ordersSvc.markPaid(tenantId, adminId, row!.recordId!);
        expect(res.number).toBe(row!.number);
        const panel = await ordersSvc.panel(tenantId, row!.recordId!);
        expect(panel).toMatchObject({ payment_status: 'pagado', stock_state: 'taken', cancelled: false });
        expect(panel!.paid_at).not.toBeNull();
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, row!.recordId!)));
        expect((rec!.data as Record<string, unknown>)[`f${o.fields.payment_status}`]).toBe('pagado');
        // Marcar dos veces no rompe nada.
        await ordersSvc.markPaid(tenantId, adminId, row!.recordId!);
        // Un registro que no es un pedido no tiene panel.
        expect(await ordersSvc.panel(tenantId, product.taza!)).toBeNull();
        await expect(ordersSvc.markPaid(tenantId, adminId, product.taza!)).rejects.toMatchObject({ response: { code: 'shop_order_not_found' } });
    });

    it('la plataforma la suspende, un plan sin tienda la apaga, y borrarla deja los pedidos', async () => {
        const [shop] = await shopsSvc.listForList(tenantId, catalogId);
        const token = await tokenOf(shop!.id);
        expect(await shopsSvc.tenantOf(shop!.id)).toBe(tenantId);
        const plat = await shopsSvc.platformList(tenantId);
        expect(plat[0]).toMatchObject({ id: shop!.id, enabled: true, suspended: false });
        expect(plat[0]!.orders_count).toBeGreaterThanOrEqual(2);

        await shopsSvc.setSuspended(tenantId, shop!.id, true, 'Vende productos prohibidos');
        expect(await publicSvc.freshInfo(token)).toBeNull();
        await expect(shopsSvc.update(tenantId, shop!.id, { enabled: true })).rejects.toMatchObject({ response: { code: 'shop_suspended' } });
        await shopsSvc.setSuspended(tenantId, shop!.id, false, null);
        await shopsSvc.update(tenantId, shop!.id, { enabled: true });
        expect(await publicSvc.freshInfo(token)).not.toBeNull();

        // ADR-S87: la prueba no incluye la tienda.
        await pg.db.update(tenants).set({ plan: 'trial' }).where(eq(tenants.id, tenantId));
        expect(await publicSvc.freshInfo(token)).toBeNull();
        await pg.db.update(tenants).set({ plan: 'pro' }).where(eq(tenants.id, tenantId));
        expect(await publicSvc.freshInfo(token)).not.toBeNull();

        // Borrarla: los pedidos quedan y las listas pierden la marca.
        const ordersListId = shop!.config.orders.list_id!;
        const before = await countIn(ordersListId);
        await shopsSvc.remove(tenantId, shop!.id);
        expect(await publicSvc.freshInfo(token)).toBeNull();
        expect(await countIn(ordersListId)).toBe(before);
        const [l] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: listsTable.settings }).from(listsTable).where(eq(listsTable.id, ordersListId)));
        expect(readShopListMarker(l!.settings)).toBeNull();
        expect(readShopConfig({}).orders.list_id).toBeNull();
    });
});
