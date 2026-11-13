import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readShopListMarker, type Field, type PublicShopOrderInput, type ShopConfig } from '@imagina-base/shared';
import { asc, eq } from 'drizzle-orm';
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
import { fields as fieldsTable, lists, memberships, records, shopOrders, shops, tenants, users } from '../src/db/schema';
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
import { ShopService } from '../src/shop/shop.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.429 — Unidades de venta: cada producto dice en qué se vende (hora,
 * kg) y cuánto se puede comprar (mínimo, máximo, de a cuánto). El catálogo
 * las lleva a la página, las variantes heredan lo que dejan vacío, el pedido
 * corrige la cantidad (409 si cambió), descuenta stock con decimales y la
 * línea guarda la unidad. «Crear las columnas» las arma en la lista.
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

const IP = '203.0.113.129';

describe('v0.1.429 — tienda: unidades de venta (Postgres + Redis reales)', () => {
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
    const add = async (key: string, data: Record<string, unknown>, parent?: number): Promise<void> => {
        const byId = Object.fromEntries(Object.entries(data).map(([slug, v]) => [`f${f[slug]!.id}`, v]));
        product[key] = (await recordsSvc.create(tenantId, admin, 'productos', { data: byId, ...(parent ? { parent_id: parent } : {}) } as never)).id;
    };
    const order = (shopId: number, partial: Partial<PublicShopOrderInput> = {}): PublicShopOrderInput => ({
        lines: [{ product_id: product.camiseta!, qty: 1 }],
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
            .values({ slug: 'acme-unidades', name: 'Acme', plan: 'pro', settings: { branding: { primary_color: '#7c3aed' } } })
            .returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra-unidades', name: 'Otra', plan: 'pro' }).returning();
        otherTenantId = o!.id;
        const [u] = await pg.db.insert(users).values({ email: 'dueno-unidades@acme.co', name: 'Dueño', passwordHash: 'x' }).returning();
        adminId = u!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: adminId, tenantId, role: 'admin' }));
        admin = { userId: adminId, role: 'admin' };

        catalogId = (await listsSvc.create(tenantId, { name: 'Productos' })).id;
        const mk = async (slug: string, label: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = await fieldsSvc.create(tenantId, 'productos', { label, type, slug, ...(config ? { config } : {}) } as never);
        };
        await mk('nombre', 'Nombre', 'text');
        await mk('precio', 'Precio', 'currency', { currency: 'COP', precision: 0 });
        await mk('stock', 'Stock', 'number', { precision: 3 });
        await mk('formato', 'Formato', 'text');
        await add('asesoria', { nombre: 'Asesoría', precio: 50000 });
        await add('cafe', { nombre: 'Café de origen', precio: 32000, stock: 3.2 });
        await add('camiseta', { nombre: 'Camiseta', precio: 40000, stock: 5 });

        const dto = await shopsSvc.create(tenantId, adminId, { list_id: catalogId, name: 'Tienda Acme' });
        shopId = dto.id;
        await shopsSvc.update(tenantId, shopId, { config: readyConfig(dto.config) as never, enabled: true });
    }, 120_000);

    beforeEach(async () => {
        await redis.flushall();
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    const setData = async (key: string, data: Record<string, unknown>): Promise<void> => {
        const byId = Object.fromEntries(Object.entries(data).map(([slug, v]) => [`f${f[slug]!.id}`, v]));
        await recordsSvc.update(tenantId, admin, 'productos', product[key]!, { data: byId } as never);
    };
    const fieldOf = async (id: number): Promise<{ type: string; config: unknown; label: string }> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(fieldsTable).where(eq(fieldsTable.id, id)));
        return { type: row!.type, config: row!.config, label: row!.label };
    };

    it('«Crear las columnas» arma las cuatro en la lista y quedan elegidas; repetir no duplica', async () => {
        const before = await shopsSvc.get(tenantId, shopId);
        expect([before.config.catalog.unit, before.config.catalog.qty_min, before.config.catalog.qty_max, before.config.catalog.qty_step]).toEqual([null, null, null, null]);
        const after = await shopsSvc.createUnitColumns(tenantId, shopId);
        const c = after.config.catalog;
        expect(await fieldOf(c.unit!)).toMatchObject({ type: 'text', label: 'Unidad de venta' });
        for (const id of [c.qty_min!, c.qty_max!, c.qty_step!]) {
            const fd = await fieldOf(id);
            expect(fd.type).toBe('number');
            expect((fd.config as { precision?: number }).precision).toBe(3);
        }
        const again = await shopsSvc.createUnitColumns(tenantId, shopId);
        expect(again.config.catalog).toMatchObject({ unit: c.unit, qty_min: c.qty_min, qty_max: c.qty_max, qty_step: c.qty_step });
        const all = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: fieldsTable.id }).from(fieldsTable).where(eq(fieldsTable.listId, catalogId)));
        expect(all.length).toBe(8);
        f.unidad = { id: c.unit! } as Field;
        f.min = { id: c.qty_min! } as Field;
        f.max = { id: c.qty_max! } as Field;
        f.paso = { id: c.qty_step! } as Field;
        // Las líneas del pedido tienen «Unidad» y la cantidad con decimales.
        const o = after.config.orders;
        expect(typeof o.line_fields.unit).toBe('number');
        expect(((await fieldOf(o.line_fields.qty!)).config as { precision?: number }).precision).toBe(3);
        const [l] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, o.lines_list_id!)));
        expect(readShopListMarker(l!.settings)!.field_ids).toContain(o.line_fields.unit);
    });

    it('el catálogo lleva la unidad y la regla; lo vacío no viaja', async () => {
        await setData('asesoria', { unidad: 'hora', min: 2, max: 40 });
        await setData('cafe', { unidad: 'kg', paso: 0.5 });
        const info = await publicSvc.freshInfo(await tokenOf(shopId));
        const by = new Map(info!.products.map((p) => [p.id, p]));
        expect(by.get(product.asesoria!)).toMatchObject({ unit: { one: 'hora', many: 'horas' }, qty: { min: 2, max: 40, step: 1 } });
        expect(by.get(product.cafe!)).toMatchObject({ unit: { one: 'kg', many: 'kg' }, qty: { min: 0.5, max: null, step: 0.5 }, stock: 3.2 });
        const cam = by.get(product.camiseta!)!;
        expect('unit' in cam).toBe(false);
        expect('qty' in cam).toBe(false);
    });

    it('la cotización corrige la cantidad; el pedido rechaza lo que cambió y cobra los decimales', async () => {
        const token = await tokenOf(shopId);
        const q = await publicSvc.quote(
            token,
            [
                { product_id: product.asesoria!, qty: 1 },
                { product_id: product.cafe!, qty: 1.5 },
            ],
            { deliveryId: null },
        );
        expect(q!.lines.map((l) => [l.qty, l.subtotal, l.adjusted ?? false, l.unit?.many])).toEqual([
            [2, 100000, true, 'horas'],
            [1.5, 48000, false, 'kg'],
        ]);
        // Una hora no alcanza el mínimo: el pedido vuelve con el carrito corregido.
        await expect(publicSvc.placeOrder(token, order(shopId, { lines: [{ product_id: product.asesoria!, qty: 1 }] }), { ip: IP, userAgent: 'vitest' })).rejects.toMatchObject({
            response: { code: 'shop_cart_changed' },
        });
        // Pasa el stock del café: no se vende más de lo que hay (en pasos de 0,5).
        const low = await publicSvc.quote(token, [{ product_id: product.cafe!, qty: 5 }], { deliveryId: null });
        expect(low!.lines[0]).toMatchObject({ problem: 'low_stock', available: 3 });

        const placed = await publicSvc.placeOrder(
            token,
            order(shopId, {
                lines: [
                    { product_id: product.asesoria!, qty: 3 },
                    { product_id: product.cafe!, qty: 1.5 },
                ],
            }),
            { ip: IP, userAgent: 'vitest' },
        );
        expect(placed!.total).toBe(198_000);
        expect(await stockOf(product.cafe!)).toBe(1.7);
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopOrders).where(eq(shopOrders.token, placed!.order_token)));
        const lines = row!.lines as Array<{ product_id: number; qty: number; unit?: { many: string } }>;
        expect(lines.map((l) => [l.qty, l.unit?.many])).toEqual([
            [3, 'horas'],
            [1.5, 'kg'],
        ]);
        // La lista de líneas guarda la cantidad con decimales y la unidad en palabras.
        const o = (await shopsSvc.get(tenantId, shopId)).config.orders;
        const lineRows = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ data: records.data }).from(records).where(eq(records.listId, o.lines_list_id!)).orderBy(asc(records.id)),
        );
        const cells = lineRows.map((r) => {
            const d = r.data as Record<string, unknown>;
            return [d[`f${o.line_fields.qty}`], d[`f${o.line_fields.unit}`]];
        });
        expect(cells).toEqual([
            [3, 'horas'],
            [1.5, 'kg'],
        ]);
        // Cancelar devuelve el stock con sus decimales.
        expect(await ordersSvc.expireOrder(tenantId, row!.id, 'prueba')).toBe(true);
        expect(await stockOf(product.cafe!)).toBe(3.2);
    });

    it('las variantes heredan lo que dejan vacío y pueden tener lo suyo', async () => {
        const [shop] = await shopsSvc.listForList(tenantId, catalogId);
        await shopsSvc.update(tenantId, shopId, { config: { ...shop!.config, variants: { enabled: true, attributes: [f.formato!.id] } } as never });
        await add('molido', { nombre: 'Molido', formato: 'Molido', precio: 34000, stock: 2 }, product.cafe);
        await add('grano', { nombre: 'Grano', formato: 'Grano', paso: 1, unidad: 'bolsa de 500 g' }, product.cafe);
        const info = await publicSvc.freshInfo(await tokenOf(shopId));
        const cafe = info!.products.find((p) => p.id === product.cafe)!;
        const molido = cafe.variants!.find((v) => v.id === product.molido)!;
        const grano = cafe.variants!.find((v) => v.id === product.grano)!;
        expect(molido).toMatchObject({ unit: { one: 'kg', many: 'kg' }, qty: { min: 0.5, max: null, step: 0.5 } });
        // Su paso es 1 y su unidad, la propia: la regla queda en lo de siempre.
        expect(grano.unit).toEqual({ one: 'bolsa de 500 g', many: 'bolsas de 500 g' });
        expect('qty' in grano).toBe(false);
        const q = await publicSvc.quote(await tokenOf(shopId), [{ product_id: product.molido!, qty: 1.2 }], { deliveryId: null });
        expect(q!.lines[0]).toMatchObject({ qty: 1, subtotal: 34000, adjusted: true });
    });

    it('una tienda de antes recupera la columna «Unidad» de las líneas al elegir una unidad', async () => {
        const dto = await shopsSvc.get(tenantId, shopId);
        const unitLine = dto.config.orders.line_fields.unit!;
        // Como estaba antes de v0.1.429: sin la columna elegida.
        const stripped = { ...dto.config, orders: { ...dto.config.orders, line_fields: { ...dto.config.orders.line_fields, unit: undefined } } };
        await withTenant(pg.db, tenantId, (tx) => tx.update(shops).set({ config: stripped }).where(eq(shops.id, shopId)));
        const out = await shopsSvc.update(tenantId, shopId, { config: { ...stripped, catalog: { ...stripped.catalog, unit: dto.config.catalog.unit } } as never });
        // Reusa la que ya existía (mismo nombre interno), no crea otra.
        expect(out.dto.config.orders.line_fields.unit).toBe(unitLine);
        await expect(shopsSvc.createUnitColumns(otherTenantId, shopId)).rejects.toBeDefined();
    });
});
