import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { SHOP_KIND_OPTIONS, type Field, type PublicShopOrderInput, type ShopConfig } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
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
import { bookingPages, memberships, records, shopOrders, shops, tenants, users } from '../src/db/schema';
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
import { ShopPublicService } from '../src/shop/shop-public.service';
import { ShopCouponsService } from '../src/shop/shop-coupons.service';
import { ShopService } from '../src/shop/shop.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.416 — Productos digitales, servicios y «Mis pedidos». Un carrito sólo
 * de descargas no pide entrega; un pedido sin costo nace pagado; las
 * descargas sirven con el pago, por los días y las veces de la tienda (el
 * contador no se pasa del tope); un servicio no va al carrito y lleva a la
 * agenda con el servicio elegido; «Mis pedidos» manda el enlace sólo a quien
 * tiene pedidos y responde lo mismo a todos.
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

describe('v0.1.416 — tienda: descargas, servicios y «Mis pedidos» (Postgres + Redis reales)', () => {
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
    let shopId: number;
    let otherShopId: number;
    let tenantId: number;
    let adminId: number;
    let admin: Actor;
    let catalogId: number;
    let bookingPageId: number;
    const mails: SentMail[] = [];
    const f: Record<string, Field> = {};
    const product: Record<string, number> = {};
    const file: Record<string, number> = {};

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
            { lines: [{ product_id: product.ebook!, qty: 1 }], customer, delivery_id: null, payment_method: 'transfer', terms: true, consent: false, stamp: stampFor(id), ...partial },
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
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-shop-dl-'))), env);
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
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-digital', name: 'Acme', plan: 'pro' }).returning();
        tenantId = t!.id;
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

        const dto = await shopsSvc.create(tenantId, adminId, { list_id: catalogId, name: 'Tienda Acme' });
        shopId = dto.id;
        // Las dos columnas nuevas, creadas desde la tienda.
        const withKind = await shopsSvc.createKindColumn(tenantId, shopId, 'kind');
        const withDl = await shopsSvc.createKindColumn(tenantId, shopId, 'download');
        const all = await fieldsSvc.listByListId(tenantId, catalogId);
        f.tipo = all.find((x) => x.slug === 'tipo_de_producto')!;
        f.archivo = all.find((x) => x.slug === 'archivo_para_descargar')!;
        expect(withKind.config.kinds.kind_field).toBe(f.tipo.id);
        expect(withDl.config.kinds.download_field).toBe(f.archivo.id);
        expect(withDl.config.kinds.kind_field).toBe(f.tipo.id);

        const up = async (key: string, name: string): Promise<void> => {
            file[key] = (await files.upload(tenantId, adminId, name, 'application/pdf', Readable.from(Buffer.from(`%PDF-1.4 ${key}`)))).id;
        };
        await up('ebook', 'guia-de-ventas.pdf');
        await up('plantilla', 'plantilla-presupuesto.xlsx');
        const add = async (key: string, data: Record<string, unknown>): Promise<void> => {
            const byId = Object.fromEntries(Object.entries(data).map(([slug, v]) => [`f${f[slug]!.id}`, v]));
            product[key] = (await recordsSvc.create(tenantId, admin, 'productos', { data: byId } as never)).id;
        };
        // Digital por la columna Tipo y con su archivo.
        await add('ebook', { nombre: 'Guía de ventas', precio: 20000, tipo: 'digital', archivo: [file.ebook] });
        // Sin columna Tipo: con un archivo para descargar, es digital igual.
        await add('plantilla', { nombre: 'Plantilla de presupuesto', precio: 0, archivo: [file.plantilla] });
        await add('taza', { nombre: 'Taza de cerámica', precio: 25000, stock: 3 });
        await add('asesoria', { nombre: 'Asesoría personalizada', precio: 80000, tipo: 'service' });
        await add('masaje', { nombre: 'Masaje', precio: 60000, tipo: 'service' });
        await add('sin_agenda', { nombre: 'Clase grupal', precio: 30000, tipo: 'service' });
        await add('sin_quien', { nombre: 'Taller sin quien lo dicte', precio: 40000, tipo: 'service' });

        const [page] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(bookingPages)
                .values({
                    tenantId,
                    listId: catalogId,
                    name: 'Agenda Acme',
                    token: 'agendaAcmeToken123456',
                    enabled: true,
                    config: {
                        services: [
                            { id: 'svcasesoria', name: 'Asesoria personalizada', duration_min: 60 },
                            { id: 'svcmasaje', name: 'Masaje relajante', duration_min: 45 },
                            { id: 'svcvieja', name: 'Clase grupal', duration_min: 60, active: false },
                            { id: 'svcsola', name: 'Taller sin quien lo dicte', duration_min: 60 },
                        ],
                        staff: [{ id: 'salaa', kind: 'resource', name: 'Sala A', services: ['svcasesoria', 'svcmasaje', 'svcvieja'] }],
                    },
                })
                .returning(),
        );
        bookingPageId = page!.id;

        const base = readyConfig(withDl.config);
        await shopsSvc.update(tenantId, shopId, {
            config: { ...base, kinds: { ...base.kinds, booking_page_id: bookingPageId, service_links: { [String(product.masaje)]: 'svcmasaje' }, download_days: 30, max_downloads: 2 } } as never,
            enabled: true,
        });
        // Otra tienda de la misma empresa (para «Mis pedidos»: cada enlace es de su tienda).
        const other = await shopsSvc.create(tenantId, adminId, { list_id: catalogId, name: 'Tienda 2' });
        otherShopId = other.id;
        await shopsSvc.update(tenantId, otherShopId, { config: readyConfig(other.config) as never, enabled: true });
    }, 120_000);

    beforeEach(async () => {
        await redis.flushall();
        mails.length = 0;
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    it('el catálogo dice el tipo de cada producto; los servicios llevan a la agenda con su servicio y no van al carrito', async () => {
        const token = await tokenOf(shopId);
        const info = await publicSvc.freshInfo(token);
        const byId = new Map(info!.products.map((p) => [p.id, p]));
        expect(byId.get(product.ebook!)).toMatchObject({ kind: 'digital', downloadable: true });
        expect(byId.get(product.plantilla!)).toMatchObject({ kind: 'digital', downloadable: true });
        expect(byId.get(product.taza!)).toMatchObject({ kind: 'physical' });
        // Por el nombre (sin tildes) y por la elección a mano.
        expect(byId.get(product.asesoria!)!.book_url).toBe('/api/v1/public/b/agendaAcmeToken123456?servicio=svcasesoria');
        expect(byId.get(product.masaje!)!.book_url).toBe('/api/v1/public/b/agendaAcmeToken123456?servicio=svcmasaje');
        // El servicio con el mismo nombre está apagado en la agenda: no se agenda.
        expect(byId.get(product.sin_agenda!)!.book_url).toBeNull();
        // Nadie lo atiende: la agenda no lo muestra, así que la tienda tampoco lleva ahí.
        expect(byId.get(product.sin_quien!)!.book_url).toBeNull();
        expect(info!.meta.downloads).toEqual({ days: 30, max: 2 });
        expect(SHOP_KIND_OPTIONS.map((o) => o.value)).toEqual(['physical', 'digital', 'service']);

        // Un servicio no se compra por el carrito.
        await expect(place({ lines: [{ product_id: product.asesoria!, qty: 1 }] })).rejects.toBeTruthy();
        const quote = await publicSvc.quote(token, [{ product_id: product.asesoria!, qty: 1 }], { deliveryId: null, zoneId: null });
        expect(quote!.lines[0]!.problem).toBe('unavailable');

        // Agenda apagada: los servicios quedan sin botón.
        await withTenant(pg.db, tenantId, (tx) => tx.update(bookingPages).set({ enabled: false }).where(eq(bookingPages.id, bookingPageId)));
        const off = await publicSvc.freshInfo(token);
        expect(off!.products.find((p) => p.id === product.asesoria)!.book_url).toBeNull();
        await withTenant(pg.db, tenantId, (tx) => tx.update(bookingPages).set({ enabled: true }).where(eq(bookingPages.id, bookingPageId)));
    });

    it('un carrito sólo de descargas no pide entrega; mezclado con algo físico sí', async () => {
        await expect(place({ lines: [{ product_id: product.ebook!, qty: 1 }, { product_id: product.taza!, qty: 1 }] })).rejects.toMatchObject({ response: { code: 'shop_delivery' } });
        const placed = await place();
        expect(placed!.total).toBe(20000);
        const row = await orderRow(placed!.order_token);
        expect(row.shipping).toBe(0);
        expect(row.delivery).toMatchObject({ id: null, needs_address: false, digital: true });
        const lines = row.lines as Array<{ kind?: string; files?: number[] }>;
        expect(lines[0]).toMatchObject({ kind: 'digital', files: [file.ebook] });
        const pub = await publicSvc.order(await tokenOf(shopId), placed!.order_token);
        expect(pub!.digital_only).toBe(true);
        expect(pub!.downloads).toHaveLength(1);
        expect(pub!.downloads[0]).toMatchObject({ name: 'guia-de-ventas.pdf', url: null, used: 0, max: 2 });
        expect(pub!.downloads_note).toMatch(/confirmemos el pago/);
        // Sin pagar no se baja.
        expect(await publicSvc.download(await tokenOf(shopId), placed!.order_token, product.ebook!, file.ebook!)).toBe('unavailable');
        // El correo del pedido avisa que las descargas llegan con el pago.
        await flush();
        expect(mails.some((m) => m.to === 'ana@cliente.co' && /descarga/i.test(m.text))).toBe(true);
    });

    it('con el pago se descarga, por las veces de la tienda; el correo trae los enlaces y se puede reenviar', async () => {
        const token = await tokenOf(shopId);
        const placed = await place();
        const row = await orderRow(placed!.order_token);
        await expect(ordersSvc.resendDownloads(tenantId, row.recordId!)).rejects.toMatchObject({ response: { code: 'shop_downloads_unavailable' } });
        mails.length = 0;
        await ordersSvc.markPaid(tenantId, adminId, row.recordId!);
        await flush();
        const paidMail = mails.find((m) => m.to === 'ana@cliente.co');
        expect(paidMail).toBeTruthy();
        expect(paidMail!.html).toContain(`/api/v1/public/s/${token}/d/${placed!.order_token}/${product.ebook}/${file.ebook}`);
        expect(paidMail!.text).toMatch(/30 días y hasta 2 descargas/);

        const pub = await publicSvc.order(token, placed!.order_token);
        expect(pub!.downloads[0]!.url).toBe(`/api/v1/public/s/${token}/d/${placed!.order_token}/${product.ebook}/${file.ebook}`);
        expect(pub!.downloads_note).toBeNull();
        expect(pub!.downloads_until).not.toBeNull();

        const first = await publicSvc.download(token, placed!.order_token, product.ebook!, file.ebook!);
        expect(first).toMatchObject({ url: expect.stringContaining('dl=1') });
        // Dos a la vez: el contador no se pasa del tope.
        const both = await Promise.all([
            publicSvc.download(token, placed!.order_token, product.ebook!, file.ebook!),
            publicSvc.download(token, placed!.order_token, product.ebook!, file.ebook!),
        ]);
        expect(both.filter((x) => x === 'limit')).toHaveLength(1);
        expect((await orderRow(placed!.order_token)).downloads).toEqual({ [`${product.ebook}:${file.ebook}`]: 2 });
        const after = await publicSvc.order(token, placed!.order_token);
        expect(after!.downloads[0]).toMatchObject({ used: 2, url: null });
        // Un archivo que no es de este pedido, o el pedido en otra tienda: nada.
        expect(await publicSvc.download(token, placed!.order_token, product.plantilla!, file.plantilla!)).toBeNull();
        expect(await publicSvc.download(await tokenOf(otherShopId), placed!.order_token, product.ebook!, file.ebook!)).toBeNull();

        // El panel de la ficha y «Reenviar las descargas».
        const panel = await ordersSvc.panel(tenantId, row.recordId!);
        expect(panel!.downloads).toMatchObject({ files: 1, used: 2, max: 2 });
        expect(panel!.can_resend).toBe(true);
        mails.length = 0;
        await ordersSvc.resendDownloads(tenantId, row.recordId!);
        await flush();
        expect(mails.filter((m) => m.to === 'ana@cliente.co')).toHaveLength(1);

        // Pasado el plazo (contado desde el pago) ya no se baja.
        await withTenant(pg.db, tenantId, (tx) => tx.update(shopOrders).set({ paidAt: new Date(Date.now() - 31 * 86_400_000), downloads: {} }).where(eq(shopOrders.id, row.id)));
        expect(await publicSvc.download(token, placed!.order_token, product.ebook!, file.ebook!)).toBe('unavailable');
        expect((await publicSvc.order(token, placed!.order_token))!.downloads_note).toMatch(/plazo/);
    });

    it('un pedido sin costo nace pagado y trae sus descargas; «sin costo» con un total mayor se rechaza', async () => {
        await expect(place({ payment_method: 'free' })).rejects.toMatchObject({ response: { code: 'shop_payment' } });
        mails.length = 0;
        const placed = await place({ lines: [{ product_id: product.plantilla!, qty: 1 }], payment_method: 'transfer' });
        expect(placed!.total).toBe(0);
        expect(placed!.payment_method).toBe('free');
        const row = await orderRow(placed!.order_token);
        expect([row.paymentMethod, row.paymentStatus]).toEqual(['free', 'pagado']);
        expect(row.paidAt).not.toBeNull();
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.id, row.recordId!)));
        const cfg = (await shopsSvc.get(tenantId, shopId)).config;
        expect((rec!.data as Record<string, unknown>)[`f${cfg.orders.fields.payment_method}`]).toBe('free');
        await flush();
        const m = mails.find((x) => x.to === 'ana@cliente.co');
        expect(m!.html).toContain(`/d/${placed!.order_token}/${product.plantilla}/${file.plantilla}`);
        const pub = await publicSvc.order(await tokenOf(shopId), placed!.order_token);
        expect(pub!.downloads[0]!.url).not.toBeNull();
    });

    it('«Mis pedidos»: el enlace llega sólo si hay pedidos, responde igual a todos, frena y es de su tienda', async () => {
        const token = await tokenOf(shopId);
        await place();
        await flush();
        mails.length = 0;
        // Un correo sin pedidos: la misma respuesta, ningún correo.
        expect(await publicSvc.requestMyOrders(token, 'nadie@otro.co', '203.0.113.5')).toBe(true);
        await flush();
        expect(mails).toHaveLength(0);
        expect(await publicSvc.requestMyOrders(token, ' ANA@cliente.co ', '203.0.113.5')).toBe(true);
        await flush();
        const m = mails.find((x) => x.to === 'ana@cliente.co');
        expect(m).toBeTruthy();
        const code = /mis-pedidos=([A-Za-z0-9_-]+)/.exec(m!.text)![1]!;
        expect(m!.text).toContain(`https://app.test/api/v1/public/s/${token}?mis-pedidos=${code}`);
        const list = await publicSvc.myOrders(token, code);
        expect(list!.email).toBe('ana@cliente.co');
        expect(list!.orders.length).toBeGreaterThanOrEqual(1);
        expect(list!.orders[0]).toMatchObject({ currency: 'COP', downloads: expect.any(Number), order_token: expect.any(String) });
        // El código es de esta tienda: en otra no sirve, ni un código inventado.
        expect(await publicSvc.myOrders(await tokenOf(otherShopId), code)).toBeNull();
        expect(await publicSvc.myOrders(token, 'x'.repeat(32))).toBeNull();
        // Por correo: el cuarto pedido en la hora no manda otro correo (y no se dice).
        mails.length = 0;
        for (let i = 0; i < 4; i++) expect(await publicSvc.requestMyOrders(token, 'ana@cliente.co', `203.0.113.${40 + i}`)).toBe(true);
        await flush();
        expect(mails.filter((x) => x.to === 'ana@cliente.co')).toHaveLength(2);
        // Por IP: el sexto en 10 minutos se frena.
        for (let i = 0; i < 5; i++) await publicSvc.requestMyOrders(token, `x${i}@otro.co`, '203.0.113.99');
        await expect(publicSvc.requestMyOrders(token, 'y@otro.co', '203.0.113.99')).rejects.toMatchObject({ status: 429 });
    });
});
