import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shopProductPath, type Field, type ShopConfig } from '@imagina-base/shared';
import Fastify, { type FastifyInstance } from 'fastify';
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
import { memberships, shops, tenants, users } from '../src/db/schema';
import { DomainsService } from '../src/domains/domains.service';
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
import { ShopPageAssets } from '../src/shop/shop-page-assets';
import { PLATFORM_ROBOTS_TXT, ShopSiteService, siteHeadFor } from '../src/shop/shop-site.service';
import { registerShopSiteRoutes } from '../src/shop/shop-site.routes';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.423 — La tienda en SU dominio: se pide, se prueba con un TXT y se
 * verifica; el host lleva a la tienda (y a ninguna otra cosa); `/`, `/p/…`,
 * `/sitemap.xml` y `/robots.txt` traen lo que Google necesita, y sólo ahí se
 * deja indexar. Los enlaces de los pedidos salen por el dominio sólo si ya
 * abre la tienda.
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


describe('v0.1.423 — tienda con dominio propio y Google (Postgres + Redis reales)', () => {
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
    let domains: DomainsService;
    let site: ShopSiteService;
    let app: FastifyInstance;
    let shopId: number;
    let otherShopId: number;
    let tenantId: number;
    let adminId: number;
    let admin: Actor;
    let catalogId: number;
    const f: Record<string, Field> = {};
    const product: Record<string, number> = {};
    /** DNS falso: TXT publicados por nombre. */
    const txt = new Map<string, string[]>();
    /** Dominios que ya abren la tienda (el sondeo de `/_imagina/site`, sin red). */
    const serving = new Set<string>();
    const DOMAIN = 'tienda.acme.co';

    const tokenOf = async (id: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shops).where(eq(shops.id, id)));
        return row!.token;
    };
    const readyConfig = (base: ShopConfig): ShopConfig => ({
        ...base,
        texts: { ...base.texts, title: 'Tienda Acme', description: 'Camisetas y gorras hechas en Bogotá.' },
        payments: { ...base.payments, transfer: { ...base.payments.transfer, enabled: true, instructions: 'Bancolombia ahorros 123-456789-00.' } },
        seller: { legal_name: 'Acme SAS', document: '900123456-1', address: 'Carrera 7 # 12-30', city: 'Bogotá', email: 'ventas@acme.co', phone: '' },
    });
    const get = (url: string, host = DOMAIN) => app.inject({ method: 'GET', url, headers: { host } });
    /** Que el host se vuelva a resolver (lo mismo que hace el controller al verificar o quitar). */
    const forgetHost = (): void => site.forget(DOMAIN, 'app.test');

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
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-shop-domain-'))), env);
        domains = new DomainsService(pg.db, env, files, redis as never);
        domains.resolveTxt = async (name) => {
            const values = txt.get(name);
            if (!values) throw Object.assign(new Error('no data'), { code: 'ENODATA' });
            return values.map((v) => [v]);
        };
        domains.probeShopServing = async (_id, domain) => serving.has(domain);
        const notify = new NotifyHub();
        notify.subscribe((_e: NotifyEvent) => undefined);
        shopsSvc = new ShopService(pg.db, tenantDb, listsSvc, fieldsSvc, undefined, { get: () => blueprint } as never, undefined, domains);
        const coupons = new ShopCouponsService(tenantDb, shopsSvc);
        const mail = { enqueue: () => Promise.resolve() };
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
            domains,
            undefined,
            undefined,
            pg.db,
            coupons,
        );
        ordersSvc.onModuleInit();
        publicSvc = new ShopPublicService(pg.db, tenantDb, fieldsSvc, files, new ShopImagesService(tenantDb, files, null as never), ordersSvc, undefined, redis as never, undefined, undefined, undefined, coupons);
        site = new ShopSiteService(publicSvc, domains, new ShopPageAssets(env));
        app = Fastify();
        registerShopSiteRoutes(app, site);
        await app.ready();

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-dom', name: 'Acme', plan: 'pro' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'dueno@acme-dom.co', name: 'Dueño', passwordHash: 'x' }).returning();
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
        await add('camiseta', { nombre: 'Camiseta azul', precio: 59900, stock: 4 });
        await add('gorra', { nombre: 'Gorra «Ñandú» & Co', precio: 35000, stock: 0 });

        const dto = await shopsSvc.create(tenantId, adminId, { list_id: catalogId, name: 'Tienda Acme' });
        shopId = dto.id;
        await shopsSvc.update(tenantId, shopId, { config: readyConfig(dto.config) as never, enabled: true });
        otherShopId = (await shopsSvc.create(tenantId, adminId, { list_id: catalogId, name: 'Outlet' })).id;
    }, 120_000);

    beforeEach(async () => {
        await redis.flushall();
        forgetHost();
    });

    afterAll(async () => {
        await app?.close();
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    it('pedir → TXT → verificar: recién ahí el host lleva a la tienda; los dominios no se repiten', async () => {
        await expect(domains.setShop(tenantId, shopId, 'app.test')).rejects.toMatchObject({ response: { code: 'domain_reserved' } });

        const st = await domains.setShop(tenantId, shopId, 'Tienda.Acme.co');
        expect(st!.domain).toBeNull();
        expect(st!.pending).toMatchObject({ domain: DOMAIN, txt_name: `_imagina-verify.${DOMAIN}` });
        // Pedir no es tener: nadie abre la tienda por ese host todavía.
        expect(await domains.resolveShopHost(DOMAIN)).toBeNull();
        // Otra tienda de la empresa no puede pedir el mismo; tampoco el equipo.
        await expect(domains.setShop(tenantId, otherShopId, DOMAIN)).rejects.toMatchObject({ response: { code: 'domain_in_use_other_kind' } });
        await expect(domains.set(tenantId, DOMAIN)).rejects.toMatchObject({ response: { code: 'domain_in_use_other_kind' } });

        // Sin el TXT no verifica; con otro código, tampoco.
        expect((await domains.verifyShop(tenantId, shopId))!.status).toBe('missing');
        txt.set(st!.pending!.txt_name, ['imagina-verify=00000000000000000000000000000000']);
        expect((await domains.verifyShop(tenantId, shopId))!.status).toBe('mismatch');
        txt.set(st!.pending!.txt_name, [st!.pending!.txt_value]);
        const r = await domains.verifyShop(tenantId, shopId);
        expect(r).toMatchObject({ verified: true, status: 'ok' });
        expect(r!.domain.domain).toBe(DOMAIN);
        expect(r!.domain.pending).toBeNull();

        expect(await domains.resolveShopHost(DOMAIN)).toMatchObject({ shopId, tenantId, token: await tokenOf(shopId), domain: DOMAIN });
        // El dominio de la app nunca es el de una tienda.
        expect(await domains.resolveShopHost('app.test')).toBeNull();

        // La consola del operador la lista como dominio de tienda.
        const platform = await domains.listForPlatform();
        const row = platform.domains.find((d) => d.domain === DOMAIN);
        expect(row).toMatchObject({ kind: 'shop', shop_id: shopId, shop_name: 'Tienda Acme' });
    });

    it('en su dominio: inicio y producto con todo lo que lee Google; dirección vieja → 301; producto que no está → 410', async () => {
        const home = await get('/');
        expect(home.statusCode).toBe(200);
        expect(home.headers['x-robots-tag']).toBe('index, follow');
        expect(home.body).toContain(`<link rel="canonical" href="https://${DOMAIN}/" />`);
        expect(home.body).toContain('"@type":"OnlineStore"');
        expect(home.body).toContain('Camisetas y gorras hechas en Bogotá.');
        const camisetaPath = shopProductPath('Camiseta azul', product.camiseta!);
        expect(camisetaPath).toBe(`/p/camiseta-azul-${product.camiseta}`);
        expect(home.body).toContain(`href="${camisetaPath}"`);

        const p = await get(camisetaPath);
        expect(p.statusCode).toBe(200);
        expect(p.body).toContain(`<link rel="canonical" href="https://${DOMAIN}${camisetaPath}" />`);
        expect(p.body).toContain('"@type":"Product"');
        expect(p.body).toContain('"price":"59900"');
        expect(p.body).toContain('"priceCurrency":"COP"');
        expect(p.body).toContain('https://schema.org/InStock');
        expect(p.body).toContain('"@type":"BreadcrumbList"');
        // Un nombre con caracteres raros sigue llevando a una dirección limpia; sin stock, «agotado».
        const gorraPath = shopProductPath('Gorra «Ñandú» & Co', product.gorra!);
        expect(gorraPath).toBe(`/p/gorra-nandu-co-${product.gorra}`);
        expect((await get(gorraPath)).body).toContain('https://schema.org/OutOfStock');

        // Otra forma del nombre (o sin nombre) redirige a la buena, con la consulta.
        const old = await get(`/p/otra-cosa-${product.camiseta}?utm_source=ig`);
        expect(old.statusCode).toBe(301);
        expect(old.headers.location).toBe(`${camisetaPath}?utm_source=ig`);
        expect((await get(`/p/${product.camiseta}`)).headers.location).toBe(camisetaPath);
        // Un producto que no está: 410 (que Google lo saque), con un enlace a la tienda.
        const gone = await get('/p/no-existe-999999');
        expect(gone.statusCode).toBe(410);
        expect(gone.headers['x-robots-tag']).toBe('noindex');

        // Mapa del sitio y robots.txt del dominio.
        const sm = await get('/sitemap.xml');
        expect(sm.statusCode).toBe(200);
        expect(sm.headers['content-type']).toContain('application/xml');
        expect(sm.body).toContain(`<loc>https://${DOMAIN}/</loc>`);
        expect(sm.body).toContain(`<loc>https://${DOMAIN}${camisetaPath}</loc>`);
        const robots = await get('/robots.txt');
        expect(robots.body).toContain('Allow: /');
        expect(robots.body).toContain(`Sitemap: https://${DOMAIN}/sitemap.xml`);
        // El sondeo dice qué tienda abre este dominio (así sabe la app si ya funciona).
        expect(JSON.parse((await get('/_imagina/site')).body)).toEqual({ ok: true, shop_id: shopId });
    });

    it('en cualquier otro host: 404 (el servidor web sirve la app) y el robots.txt de siempre', async () => {
        expect((await get('/', 'app.test')).statusCode).toBe(404);
        expect((await get(`/p/camiseta-azul-${product.camiseta}`, 'app.test')).statusCode).toBe(404);
        expect((await get('/sitemap.xml', 'app.test')).statusCode).toBe(404);
        const robots = await get('/robots.txt', 'app.test');
        expect(robots.statusCode).toBe(200);
        expect(robots.body).toBe(PLATFORM_ROBOTS_TXT);
        expect(JSON.parse((await get('/_imagina/site', 'app.test')).body)).toEqual({ ok: true, shop_id: null });
        expect((await get('/', 'localhost:3001')).statusCode).toBe(404);
    });

    it('«Dejar que Google la muestre» apagado: noindex, sin mapa del sitio; título y descripción propios', async () => {
        const current = await shopsSvc.get(tenantId, shopId);
        await shopsSvc.update(tenantId, shopId, { config: { ...current.config, seo: { index: false, title: 'Camisetas Acme — envíos a todo el país', description: '' } } as never });
        const home = await get('/');
        expect(home.statusCode).toBe(200);
        expect(home.headers['x-robots-tag']).toBe('noindex, nofollow');
        expect(home.body).toContain('<meta name="robots" content="noindex, nofollow" />');
        expect(home.body.match(/name="robots"/g)).toHaveLength(1);
        expect(home.body).toContain('<title>Camisetas Acme — envíos a todo el país</title>');
        expect((await get('/sitemap.xml')).statusCode).toBe(410);
        expect((await get('/robots.txt')).body).not.toContain('Sitemap:');

        // La cabecera pura: sin descripción propia, la de la tienda (recortada en una palabra).
        const info = await publicSvc.freshInfo(await tokenOf(shopId));
        const head = siteHeadFor(info!, DOMAIN, null);
        expect(head.title).toBe('Camisetas Acme — envíos a todo el país');
        expect(head.description).toBe('Camisetas y gorras hechas en Bogotá.');
        expect(head.index).toBe(false);

        await shopsSvc.update(tenantId, shopId, { config: { ...current.config, seo: { index: true, title: '', description: '' } } as never });
    });

    it('tienda sin publicar o plan sin tienda: el host ya no lleva a la tienda', async () => {
        await shopsSvc.update(tenantId, shopId, { enabled: false });
        expect(await domains.resolveShopHost(DOMAIN)).toBeNull();
        forgetHost();
        expect((await get('/')).statusCode).toBe(404);
        await shopsSvc.update(tenantId, shopId, { enabled: true });

        await pg.db.update(tenants).set({ plan: 'trial' }).where(eq(tenants.id, tenantId));
        expect(await domains.resolveShopHost(DOMAIN)).toBeNull();
        await pg.db.update(tenants).set({ plan: 'pro' }).where(eq(tenants.id, tenantId));
        expect(await domains.resolveShopHost(DOMAIN)).not.toBeNull();
    });

    it('los enlaces salen por el dominio sólo cuando ya abre la tienda', async () => {
        const token = await tokenOf(shopId);
        const shopRow = { id: shopId, token, customDomain: DOMAIN };
        // Todavía no responde: el DTO no ofrece el dominio y los pedidos salen por la plataforma.
        const before = await shopsSvc.get(tenantId, shopId);
        expect(before.custom_domain).toBe(DOMAIN);
        expect(before.site_url).toBeNull();
        expect(await ordersSvc.shopPageUrl(tenantId, shopRow, token)).toBe(`https://app.test/api/v1/public/s/${token}`);

        serving.add(DOMAIN);
        await domains.forgetShopServing(shopId, DOMAIN);
        expect((await shopsSvc.get(tenantId, shopId)).site_url).toBe(`https://${DOMAIN}`);
        expect(await ordersSvc.shopPageUrl(tenantId, shopRow, token)).toBe(`https://${DOMAIN}/`);
        // El reporte DNS lo dice («responde»).
        expect((await domains.shopDnsReport(tenantId, shopId))!.serving).toBe('ok');
        serving.delete(DOMAIN);
    });

    it('quitar el dominio: la tienda sigue por la plataforma y el host deja de llevar a ella', async () => {
        const st = await domains.clearShop(tenantId, shopId);
        expect(st).toMatchObject({ domain: null, pending: null });
        forgetHost();
        expect(await domains.resolveShopHost(DOMAIN)).toBeNull();
        expect((await get('/')).statusCode).toBe(404);
        expect((await shopsSvc.get(tenantId, shopId)).custom_domain).toBeNull();
        // El operador lo ve en «Para quitar del servidor».
        expect((await domains.listForPlatform()).retired.map((d) => d.domain)).toContain(DOMAIN);
    });
});
