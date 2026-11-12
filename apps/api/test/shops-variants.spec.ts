import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Field, type PublicShopOrderInput, type ShopConfig } from '@imagina-base/shared';
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
import { memberships, records, relations, shopOrders, shops, tenants, users } from '../src/db/schema';
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
import { ShopVariantsService } from '../src/shop/shop-variants.service';
import { ShopService } from '../src/shop/shop.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.414 — Productos con variantes: cada variante es una subtarea del
 * producto. El catálogo arma las opciones, el producto con variantes no se
 * compra directamente, el pedido descuenta el stock de la variante y el
 * generador crea sólo las combinaciones que faltan.
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

describe('v0.1.414 — tienda: productos con variantes (Postgres + Redis reales)', () => {
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
    let variantsSvc: ShopVariantsService;
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
        variantsSvc = new ShopVariantsService(tenantDb, fieldsSvc, recordsSvc, shopsSvc);

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
        await shopsSvc.update(tenantId, shopId, { config: readyConfig(dto.config) as never, enabled: true });
    }, 120_000);

    // Los frenos por IP y por correo cuentan también los intentos rechazados.
    beforeEach(async () => {
        await redis.flushall();
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });


    it('sin variantes encendidas, las subtareas no se venden y el producto es simple', async () => {
        const info = await publicSvc.freshInfo(await tokenOf(shopId));
        const cam = info!.products.find((p) => p.id === product.camiseta)!;
        expect(cam.variants).toBeUndefined();
        expect(cam.price).toBe(50000);
        expect(info!.products.some((p) => p.id === product.m_rojo)).toBe(false);
        const q = await publicSvc.quote(await tokenOf(shopId), [{ product_id: product.m_rojo!, qty: 1 }], null);
        expect(q!.lines[0]!.problem).toBe('unavailable');
    });

    it('con variantes: opciones en el orden del campo, precio desde y el producto no se compra solo', async () => {
        const [shop] = await shopsSvc.listForList(tenantId, catalogId);
        // Un atributo inválido (el precio, que ya es un papel) se descarta al guardar.
        const saved = (
            await shopsSvc.update(tenantId, shopId, {
                config: { ...shop!.config, variants: { enabled: true, attributes: [f.talla!.id, f.color!.id, f.precio!.id] } } as never,
            })
        ).dto;
        expect(saved.config.variants.attributes).toEqual([f.talla!.id, f.color!.id]);
        const info = await publicSvc.freshInfo(await tokenOf(shopId));
        const cam = info!.products.find((p) => p.id === product.camiseta)!;
        expect(cam.options).toEqual([
            { name: 'Talla', values: ['M', 'L'] },
            { name: 'Color', values: ['Rojo'] },
        ]);
        expect(cam.variants!.map((v) => [v.id, v.label, v.price, v.stock])).toEqual([
            [product.m_rojo, 'M / Rojo', 55000, 2],
            [product.l_rojo, 'L / Rojo', 50000, 0],
        ]);
        // El producto: el precio más bajo y el stock como suma.
        expect(cam.price).toBe(50000);
        expect(cam.stock).toBe(2);
        // La subtarea nunca aparece como producto suelto.
        expect(info!.products.some((p) => p.id === product.m_rojo)).toBe(false);
        const q = await publicSvc.quote(
            await tokenOf(shopId),
            [
                { product_id: product.camiseta!, qty: 1 },
                { product_id: product.m_rojo!, qty: 1 },
                { product_id: product.l_rojo!, qty: 1 },
            ],
            null,
        );
        expect(q!.lines.map((l) => [l.title, l.problem])).toEqual([
            ['', 'unavailable'],
            ['Camiseta · M / Rojo', null],
            ['Camiseta · L / Rojo', 'no_stock'],
        ]);
    });

    it('el pedido descuenta el stock de la variante y cancelar se lo devuelve', async () => {
        const token = await tokenOf(shopId);
        // El producto con variantes no se puede pedir directamente.
        await expect(publicSvc.placeOrder(token, order(shopId, { lines: [{ product_id: product.camiseta!, qty: 1 }] }), { ip: IP, userAgent: 'vitest' })).rejects.toMatchObject({
            response: { code: 'shop_cart_changed' },
        });
        const placed = await publicSvc.placeOrder(token, order(shopId, { lines: [{ product_id: product.m_rojo!, qty: 2 }] }), { ip: IP, userAgent: 'vitest' });
        expect(placed!.total).toBe(110_000);
        expect(await stockOf(product.m_rojo!)).toBe(0);
        // El padre no controla stock propio: no se toca.
        expect(await stockOf(product.camiseta!)).toBeUndefined();
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopOrders).where(eq(shopOrders.token, placed!.order_token)));
        const lines = row!.lines as Array<{ product_id: number; title: string; sku: string; parent_id?: number | null }>;
        expect(lines).toEqual([expect.objectContaining({ product_id: product.m_rojo, title: 'Camiseta · M / Rojo', sku: 'CAM-01-M-ROJO', parent_id: product.camiseta })]);
        // La línea del pedido queda vinculada a la variante.
        const o = (await shopsSvc.get(tenantId, shopId)).config.orders;
        const rel = await withTenant(pg.db, tenantId, (tx) => tx.select().from(relations).where(eq(relations.fieldId, o.line_fields.product!)));
        expect(rel.some((r) => r.targetRecordId === product.m_rojo)).toBe(true);
        expect(await ordersSvc.expireOrder(tenantId, row!.id, 'prueba')).toBe(true);
        expect(await stockOf(product.m_rojo!)).toBe(2);
    });

    it('el generador crea sólo las combinaciones que faltan, con su referencia y precio', async () => {
        const before = await variantsSvc.forProduct(tenantId, shopId, product.camiseta!, [f.talla!.id, f.color!.id]);
        expect(before.attributes).toEqual([
            { field_id: f.talla!.id, label: 'Talla', type: 'select', values: ['S', 'M', 'L'] },
            { field_id: f.color!.id, label: 'Color', type: 'text', values: ['Rojo'] },
        ]);
        expect(before.variants.map((v) => v.values)).toEqual([
            ['M', 'Rojo'],
            ['L', 'Rojo'],
        ]);
        // Una talla que no es opción del campo: se pide agregarla primero.
        await expect(
            variantsSvc.generate(tenantId, admin, shopId, product.camiseta!, { attributes: [f.talla!.id, f.color!.id], values: [['XL'], ['Rojo']] }),
        ).rejects.toMatchObject({ response: { code: 'invalid_shop_variants' } });
        const out = await variantsSvc.generate(tenantId, admin, shopId, product.camiseta!, {
            attributes: [f.talla!.id, f.color!.id],
            values: [
                ['s', 'M'],
                ['rojo', 'Azul'],
            ],
            price: 48000,
            stock: 5,
        });
        expect(out).toEqual({ created: 3, existing: 1, truncated: false, error: null });
        const after = await variantsSvc.forProduct(tenantId, shopId, product.camiseta!, [f.talla!.id, f.color!.id]);
        const created = after.variants.slice(2);
        expect(created.map((v) => [v.label, v.price, v.stock, v.sku])).toEqual([
            ['S / Rojo', 48000, 5, 'CAM-01-S-ROJO'],
            ['S / Azul', 48000, 5, 'CAM-01-S-AZUL'],
            ['M / Azul', 48000, 5, 'CAM-01-M-AZUL'],
        ]);
        // Las nuevas son subtareas del producto (el padre no cambia).
        const kids = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ id: records.id }).from(records).where(and(eq(records.parentId, product.camiseta!), isNull(records.deletedAt))).orderBy(asc(records.id)),
        );
        expect(kids.length).toBe(5);
        // Volver a pedir lo mismo no crea nada.
        const again = await variantsSvc.generate(tenantId, admin, shopId, product.camiseta!, {
            attributes: [f.talla!.id, f.color!.id],
            values: [['S'], ['Rojo', 'azul']],
        });
        expect(again.created).toBe(0);
        expect(again.existing).toBe(2);
        // La lista de productos dice cuántas variantes tiene cada uno.
        const products = await variantsSvc.products(tenantId, shopId, 'cami');
        expect(products).toEqual([expect.objectContaining({ id: product.camiseta, title: 'Camiseta', variants: 5 })]);
        // Otra empresa no ve el producto.
        await expect(variantsSvc.forProduct(otherTenantId, shopId, product.camiseta!, [])).rejects.toBeDefined();
    });
});
