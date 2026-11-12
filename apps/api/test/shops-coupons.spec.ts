import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shopCouponInputSchema, type Field, type PublicShopOrderInput, type ShopConfig } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
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
import { fields as fieldsTable, lists, memberships, records, shopCoupons, shopOrders, shops, tenants, users } from '../src/db/schema';
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
 * v0.1.415 — Envíos por zona y cupones. El servidor valida el cupón (fechas,
 * usos, compra mínima, una vez por cliente, productos y categorías), cuenta
 * cada uso con su pedido (cancelar lo devuelve) y el envío lo pone la zona
 * elegida, con envío gratis desde un monto.
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

const IP = '203.0.113.121';

describe('v0.1.415 — tienda: envíos por zona y cupones (Postgres + Redis reales)', () => {
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
    let couponsSvc: ShopCouponsService;
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
    const orderRow = async (token: string): Promise<typeof shopOrders.$inferSelect> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopOrders).where(eq(shopOrders.token, token)));
        return row!;
    };
    let ipSeq = 10;
    /** Cada pedido desde otra IP: los frenos por IP no son lo que se prueba aquí. */
    const place = async (partial: Partial<PublicShopOrderInput> = {}) =>
        publicSvc.placeOrder(await tokenOf(shopId), order(shopId, partial), { ip: `198.51.100.${ipSeq++}`, userAgent: 'vitest' });
    const coupon = (input: Record<string, unknown>) => couponsSvc.create(tenantId, adminId, shopId, shopCouponInputSchema.parse(input));
    const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const camiseta = (qty = 1) => [{ product_id: product.camiseta!, qty }];
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
        couponsSvc = new ShopCouponsService(tenantDb, shopsSvc);
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
            undefined,
            undefined,
            undefined,
            pg.db,
            couponsSvc,
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
            couponsSvc,
        );

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
        await mk('talla', 'Talla', 'select', {
            options: [
                { value: 's', label: 'S' },
                { value: 'm', label: 'M' },
                { value: 'l', label: 'L' },
            ],
        });
        await mk('color', 'Color', 'text');
        const add = async (key: string, data: Record<string, unknown>): Promise<void> => {
            const byId = Object.fromEntries(Object.entries(data).map(([slug, v]) => [`f${f[slug]!.id}`, v]));
            product[key] = (await recordsSvc.create(tenantId, admin, 'productos', { data: byId } as never)).id;
        };
        await add('taza', { nombre: 'Taza de cerámica', precio: 25000, stock: 3, sku: 'TAZ-01', categoria: 'cocina' });
        await add('camiseta', { nombre: 'Camiseta', precio: 50000, sku: 'CAM-01', categoria: 'ropa' });
        // Dos variantes ya cargadas a mano: M/Rojo (con precio propio) y L/Rojo (hereda el precio).
        const sub = async (key: string, data: Record<string, unknown>): Promise<void> => {
            const byId = Object.fromEntries(Object.entries(data).map(([slug, v]) => [`f${f[slug]!.id}`, v]));
            product[key] = (await recordsSvc.create(tenantId, admin, 'productos', { data: byId, parent_id: product.camiseta! } as never)).id;
        };
        await sub('m_rojo', { nombre: 'M roja', talla: 'm', color: 'Rojo', precio: 55000, stock: 2, sku: 'CAM-01-M-ROJO' });
        await sub('l_rojo', { nombre: 'L roja', talla: 'l', color: 'Rojo', stock: 0 });

        const dto = await shopsSvc.create(tenantId, adminId, { list_id: catalogId, name: 'Tienda Acme' });
        shopId = dto.id;
        const base = readyConfig(dto.config);
        await shopsSvc.update(tenantId, shopId, {
            config: {
                ...base,
                delivery: base.delivery.map((dl) =>
                    dl.id === 'domicilio'
                        ? {
                              ...dl,
                              price: 9000,
                              free_over: 100000,
                              eta: '2 a 4 días',
                              zones: [
                                  { id: 'norte', name: 'Norte', price: 12000, free_over: null, eta: '', active: true },
                                  { id: 'sur', name: 'Sur', price: 6000, free_over: 60000, eta: '1 día', active: true },
                                  { id: 'cerrada', name: 'Cerrada', price: 1, free_over: null, eta: '', active: false },
                              ],
                          }
                        : dl,
                ),
            } as never,
            enabled: true,
        });
    }, 120_000);

    // Los frenos por IP y por correo cuentan también los intentos rechazados.
    beforeEach(async () => {
        await redis.flushall();
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    it('el envío lo pone la zona elegida, con envío gratis desde el monto de la zona (o el de la forma de entrega)', async () => {
        const token = await tokenOf(shopId);
        const info = await publicSvc.freshInfo(token);
        const dom = info!.meta.delivery.find((x) => x.id === 'domicilio')!;
        // La zona apagada no se ofrece.
        expect(dom.zones.map((z) => z.id)).toEqual(['norte', 'sur']);
        expect(dom.eta).toBe('2 a 4 días');
        const norte = await publicSvc.quote(token, camiseta(), { deliveryId: 'domicilio', zoneId: 'norte' });
        expect([norte!.shipping, norte!.total, norte!.free_shipping_missing]).toEqual([12000, 62000, 50000]);
        const sur = await publicSvc.quote(token, camiseta(), { deliveryId: 'domicilio', zoneId: 'sur' });
        expect([sur!.shipping, sur!.free_shipping_missing]).toEqual([6000, 10000]);
        const surGratis = await publicSvc.quote(token, camiseta(2), { deliveryId: 'domicilio', zoneId: 'sur' });
        expect([surGratis!.shipping, surGratis!.free_shipping, surGratis!.total]).toEqual([0, true, 100000]);

        await expect(place({ lines: camiseta(), delivery_id: 'domicilio' })).rejects.toMatchObject({ response: { code: 'shop_zone' } });
        await expect(place({ lines: camiseta(), delivery_id: 'domicilio', zone_id: 'cerrada' })).rejects.toMatchObject({ response: { code: 'shop_zone' } });
        const placed = await place({ lines: camiseta(), delivery_id: 'domicilio', zone_id: 'sur' });
        expect(placed!.total).toBe(56000);
        const row = await orderRow(placed!.order_token);
        expect([row.shipping, row.discount, row.couponCode]).toEqual([6000, 0, '']);
        expect(row.delivery).toMatchObject({ id: 'domicilio', name: 'Envío a domicilio · Sur', zone_id: 'sur', zone_name: 'Sur' });
        const pub = await publicSvc.order(token, placed!.order_token);
        expect(pub!.delivery).toBe('Envío a domicilio · Sur');
        // Recoger en el local no tiene zonas: no se pide.
        const retiro = await place({ lines: camiseta(), delivery_id: 'retiro' });
        expect(retiro!.total).toBe(50000);
    });

    it('crea cupones, rechaza repetidos y le agrega las columnas a una tienda de antes', async () => {
        // Una tienda creada antes de esta versión: sin «Descuento» ni el papel de «Cupón».
        const before = (await shopsSvc.get(tenantId, shopId)).config;
        const discountField = before.orders.fields.discount!;
        const couponField = before.orders.fields.coupon!;
        expect(typeof discountField).toBe('number');
        const oldFields = { ...before.orders.fields };
        delete oldFields.discount;
        delete oldFields.coupon;
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.update(shops).set({ config: { ...before, orders: { ...before.orders, fields: oldFields } } }).where(eq(shops.id, shopId));
            await tx.delete(fieldsTable).where(eq(fieldsTable.id, discountField));
        });
        expect((await shopsSvc.get(tenantId, shopId)).config.orders.fields.discount).toBeUndefined();

        const c = await coupon({ code: ' bienvenida10 ', kind: 'percent', value: 10 });
        expect([c.code, c.uses, c.discounted, c.active]).toEqual(['BIENVENIDA10', 0, 0, true]);
        const after = (await shopsSvc.get(tenantId, shopId)).config.orders.fields;
        // «Descuento» se creó de nuevo y «Cupón» se reusó (mismo nombre y tipo).
        expect(after.discount).not.toBe(discountField);
        expect(after.coupon).toBe(couponField);
        const [created] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(fieldsTable).where(eq(fieldsTable.id, after.discount!)));
        expect([created!.slug, created!.type]).toEqual(['descuento', 'currency']);
        // Las dos columnas quedan con candado (las escribe la tienda).
        const [ordersList] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(lists).where(eq(lists.id, before.orders.list_id!)));
        const marker = (ordersList!.settings as { shop_orders_of?: { field_ids?: number[] } }).shop_orders_of;
        expect(marker?.field_ids).toEqual(expect.arrayContaining([after.discount, after.coupon]));

        await expect(coupon({ code: 'BIENVENIDA10', kind: 'fixed', value: 5000 })).rejects.toMatchObject({ response: { code: 'shop_coupon_exists' } });
        expect(shopCouponInputSchema.safeParse({ code: 'MAL', kind: 'percent', value: 150 }).success).toBe(false);
        expect(shopCouponInputSchema.safeParse({ code: 'MAL', kind: 'fixed', value: 0 }).success).toBe(false);
        expect(shopCouponInputSchema.safeParse({ code: 'FECHAS', kind: 'percent', value: 5, starts_on: day(5), ends_on: day(1) }).success).toBe(false);
        expect((await couponsSvc.list(tenantId, shopId)).map((x) => x.code)).toEqual(['BIENVENIDA10']);
        expect((await publicSvc.freshInfo(await tokenOf(shopId)))!.meta.coupons).toBe(true);
    });

    it('la cotización valida vigencia, compra mínima y envío gratis, y frena a quien prueba códigos', async () => {
        const token = await tokenOf(shopId);
        await coupon({ code: 'VENCIDO', kind: 'percent', value: 10, ends_on: day(-1) });
        await coupon({ code: 'FUTURO', kind: 'percent', value: 10, starts_on: day(2) });
        await coupon({ code: 'PAUSADO', kind: 'percent', value: 10, active: false });
        await coupon({ code: 'MINIMO', kind: 'fixed', value: 10000, min_subtotal: 80000 });
        await coupon({ code: 'ENVIO', kind: 'free_shipping', value: 0 });
        const q = (code: string, qty = 1) => publicSvc.quote(token, camiseta(qty), { deliveryId: 'domicilio', zoneId: 'norte', coupon: code, ip: IP });
        expect((await q('vencido'))!.coupon_error).toMatch(/venció/);
        expect((await q('futuro'))!.coupon_error).toMatch(/todavía no/);
        expect((await q('pausado'))!.coupon_error).toMatch(/no existe/);
        expect((await q('no-existe'))!.coupon_error).toMatch(/no existe/);
        const corto = await q('minimo');
        expect(corto!.coupon_rule?.code).toBe('MINIMO');
        expect([corto!.coupon_problem, corto!.discount]).toEqual(['min_subtotal', 0]);
        const largo = await q('minimo', 2);
        expect([largo!.discount, largo!.total, largo!.coupon?.code]).toEqual([10000, 90000 + 12000, 'MINIMO']);
        const envio = await q(' envio ');
        expect([envio!.shipping, envio!.free_shipping, envio!.discount]).toEqual([0, true, 0]);

        // Freno: 30 códigos que fallan desde una IP; el 31 se rechaza (también uno válido). Otra IP sigue.
        await redis.flushall();
        for (let i = 0; i < 30; i++) {
            const r = await publicSvc.quote(token, camiseta(), { deliveryId: 'retiro', coupon: `NOPE${i}`, ip: '192.0.2.50' });
            expect(r!.coupon_error).not.toBeNull();
        }
        await expect(publicSvc.quote(token, camiseta(), { deliveryId: 'retiro', coupon: 'ENVIO', ip: '192.0.2.50' })).rejects.toMatchObject({ response: { code: 'rate_limited' } });
        // Los códigos válidos no suman al freno.
        for (let i = 0; i < 35; i++) await publicSvc.quote(token, camiseta(), { deliveryId: 'retiro', coupon: 'ENVIO', ip: '192.0.2.51' });
        expect((await publicSvc.quote(token, camiseta(), { deliveryId: 'retiro', coupon: 'ENVIO', ip: '192.0.2.51' }))!.coupon_error).toBeNull();
    });

    it('el pedido con cupón guarda el descuento y cuenta los usos: máximo, uno por cliente y cancelar lo devuelve', async () => {
        const c = await coupon({ code: 'DOS', kind: 'percent', value: 10, max_uses: 2, once_per_customer: true });
        const as = (email: string) => ({ lines: camiseta(), delivery_id: 'retiro', coupon: 'dos', customer: { ...order(shopId).customer, email } });
        const a = await place(as('ana@cliente.co'));
        expect(a!.total).toBe(45000);
        const row = await orderRow(a!.order_token);
        expect([row.discount, row.couponCode, row.couponId, row.subtotal, row.total]).toEqual([5000, 'DOS', c.id, 50000, 45000]);
        const cfg = (await shopsSvc.get(tenantId, shopId)).config.orders.fields;
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, row.recordId!)));
        const data = rec!.data as Record<string, unknown>;
        expect([data[`f${cfg.discount}`], data[`f${cfg.coupon}`]]).toEqual([5000, 'DOS']);
        expect((await publicSvc.order(await tokenOf(shopId), a!.order_token))).toMatchObject({ discount: 5000, coupon_code: 'DOS' });

        await expect(place(as('ANA@cliente.co'))).rejects.toMatchObject({ response: { code: 'shop_coupon', message: expect.stringMatching(/Ya usaste/) } });
        await place(as('beto@cliente.co'));
        const listed = (await couponsSvc.list(tenantId, shopId)).find((x) => x.code === 'DOS')!;
        expect([listed.uses, listed.discounted]).toEqual([2, 10000]);
        await expect(place(as('caro@cliente.co'))).rejects.toMatchObject({ response: { code: 'shop_coupon', message: expect.stringMatching(/todas las veces/) } });
        // Cancelar el pedido de Ana devuelve el uso (y Ana puede volver a usarlo).
        expect(await ordersSvc.expireOrder(tenantId, row.id, 'prueba')).toBe(true);
        expect((await couponsSvc.list(tenantId, shopId)).find((x) => x.code === 'DOS')!.uses).toBe(1);
        await place(as('ana@cliente.co'));
        // Un cupón que no alcanza la compra mínima no se cobra en silencio: el pedido lo rechaza.
        await coupon({ code: 'CARO', kind: 'fixed', value: 1000, min_subtotal: 500000 });
        await expect(place({ lines: camiseta(), delivery_id: 'retiro', coupon: 'CARO' })).rejects.toMatchObject({ response: { code: 'shop_coupon' } });
        // Borrar el cupón no toca los pedidos que lo usaron.
        await couponsSvc.remove(tenantId, shopId, c.id);
        const kept = await orderRow(a!.order_token);
        expect([kept.couponCode, kept.discount, kept.couponId]).toEqual(['DOS', 5000, null]);
    });

    it('dos compras a la vez por el último uso: lo gana una sola', async () => {
        await coupon({ code: 'UNICO', kind: 'fixed', value: 2000, max_uses: 1 });
        const mk = (email: string) => place({ lines: camiseta(), delivery_id: 'retiro', coupon: 'UNICO', customer: { ...order(shopId).customer, email } });
        const res = await Promise.allSettled([mk('uno@cliente.co'), mk('dos@cliente.co'), mk('tres@cliente.co')]);
        expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        for (const r of res.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) expect(r.reason).toMatchObject({ response: { code: 'shop_coupon' } });
        expect((await couponsSvc.list(tenantId, shopId)).find((x) => x.code === 'UNICO')!.uses).toBe(1);
    });

    it('cupones para algunos productos o categorías: con variantes, el producto cubre todas', async () => {
        const [shop] = await shopsSvc.listForList(tenantId, catalogId);
        await shopsSvc.update(tenantId, shopId, { config: { ...shop!.config, variants: { enabled: true, attributes: [f.talla!.id, f.color!.id] } } as never });
        const token = await tokenOf(shopId);
        const cats = await shopsSvc.options(tenantId, shopId);
        expect(cats.categories).toEqual(['Cocina', 'Ropa']);
        await coupon({ code: 'ROPA20', kind: 'percent', value: 20, categories: ['ropa'] });
        const mixed = [
            { product_id: product.taza!, qty: 1 },
            { product_id: product.m_rojo!, qty: 1 },
        ];
        const r = await publicSvc.quote(token, mixed, { deliveryId: 'retiro', coupon: 'ROPA20' });
        expect([r!.subtotal, r!.discount]).toEqual([80000, 11000]);
        // Elegir la variante se guarda como su producto.
        const cami = await coupon({ code: 'CAMI', kind: 'fixed', value: 5000, product_ids: [product.m_rojo!, product.camiseta!, 999999] });
        expect(cami.product_ids).toEqual([product.camiseta]);
        expect((await publicSvc.quote(token, mixed, { deliveryId: 'retiro', coupon: 'CAMI' }))!.discount).toBe(5000);
        await coupon({ code: 'SOLOTAZA', kind: 'fixed', value: 3000, product_ids: [product.taza!] });
        const sinTaza = await publicSvc.quote(token, [{ product_id: product.m_rojo!, qty: 1 }], { deliveryId: 'retiro', coupon: 'SOLOTAZA' });
        expect([sinTaza!.coupon_problem, sinTaza!.discount]).toEqual(['no_eligible', 0]);
        await expect(place({ lines: [{ product_id: product.m_rojo!, qty: 1 }], delivery_id: 'retiro', coupon: 'SOLOTAZA' })).rejects.toMatchObject({
            response: { code: 'shop_coupon', message: expect.stringMatching(/no aplica/) },
        });
        const ok = await place({ lines: mixed, delivery_id: 'retiro', coupon: 'ROPA20' });
        expect(ok!.total).toBe(69000);
    });

    it('los cupones de una empresa no se ven ni se usan desde otra', async () => {
        await expect(couponsSvc.list(otherTenantId, shopId)).rejects.toBeTruthy();
        const rows = await withTenant(pg.db, otherTenantId, (tx) => tx.select().from(shopCoupons).where(and(eq(shopCoupons.shopId, shopId))));
        expect(rows).toHaveLength(0);
    });
});
