import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { applyShopDesignPreset, type Field, type ShopConfig } from '@imagina-base/shared';
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
import { renderShopPage } from '../src/shop/shop-page';
import { ShopService } from '../src/shop/shop.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.422 — El estilo de la tienda (`config.design`): el servidor arma el CSS
 * y las clases, la foto de la portada tiene que ser una imagen de la empresa,
 * el CSS propio sólo lo cambia un administrador y se guarda limpio, y la
 * página sale con el estilo desde el primer pintado.
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


describe('v0.1.422 — tienda: estilo (Postgres + Redis reales)', () => {
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
    let tenantId: number;
    let adminId: number;
    let managerId: number;
    let admin: Actor;
    let catalogId: number;
    const mails: Array<{ to: string }> = [];
    const f: Record<string, Field> = {};
    const product: Record<string, number> = {};
    let photoId = 0;
    let otherPhotoId = 0;
    let textId = 0;

    const tokenOf = async (id: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shops).where(eq(shops.id, id)));
        return row!.token;
    };
    const readyConfig = (base: ShopConfig): ShopConfig => ({
        ...base,
        payments: { ...base.payments, transfer: { ...base.payments.transfer, enabled: true, instructions: 'Bancolombia ahorros 123-456789-00.' } },
        seller: { legal_name: 'Acme SAS', document: '900123456-1', address: 'Carrera 7 # 12-30', city: 'Bogotá', email: 'ventas@acme.co', phone: '' },
    });
    const current = async (): Promise<ShopConfig> => (await shopsSvc.get(tenantId, shopId)).config;
    const manager = (): { isAdmin: boolean; file: { userId: number; role: 'manager' } } => ({ isAdmin: false, file: { userId: managerId, role: 'manager' } });

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
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-shop-design-'))), env);
        const notify = new NotifyHub();
        notify.subscribe((_e: NotifyEvent) => undefined);
        shopsSvc = new ShopService(pg.db, tenantDb, listsSvc, fieldsSvc, undefined, { get: () => blueprint } as never);
        const coupons = new ShopCouponsService(tenantDb, shopsSvc);
        const mail = {
            enqueue: (m: { to: string }) => {
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

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-design', name: 'Acme', plan: 'pro' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'dueno@acme-design.co', name: 'Dueño', passwordHash: 'x' }).returning();
        adminId = u!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: adminId, tenantId, role: 'admin' }));
        admin = { userId: adminId, role: 'admin' };

        catalogId = (await listsSvc.create(tenantId, { name: 'Servicios' })).id;
        const mk = async (slug: string, label: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = await fieldsSvc.create(tenantId, 'servicios', { label, type, slug, ...(config ? { config } : {}) } as never);
        };
        await mk('nombre', 'Nombre', 'text');
        await mk('precio', 'Precio', 'currency', { currency: 'COP', precision: 0 });
        await mk('fotos', 'Fotos', 'file');

        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        photoId = (await files.upload(tenantId, adminId, 'portada.png', 'image/png', Readable.from(png))).id;
        otherPhotoId = (await files.upload(tenantId, adminId, 'interna.png', 'image/png', Readable.from(png))).id;
        const add = async (key: string, data: Record<string, unknown>): Promise<void> => {
            const byId = Object.fromEntries(Object.entries(data).map(([slug, v]) => [`f${f[slug]!.id}`, v]));
            product[key] = (await recordsSvc.create(tenantId, admin, 'servicios', { data: byId } as never)).id;
        };
        await add('taza', { nombre: 'Taza', precio: 18000 });
        textId = (await files.upload(tenantId, adminId, 'notas.txt', 'text/plain', Readable.from(Buffer.from('hola')))).id;
        const [u2] = await pg.db.insert(users).values({ email: 'gerente@acme-design.co', name: 'Gerente', passwordHash: 'x' }).returning();
        managerId = u2!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: managerId, tenantId, role: 'manager' }));

        const dto = await shopsSvc.create(tenantId, adminId, { list_id: catalogId, name: 'Tienda Acme' });
        shopId = dto.id;
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

    it('sin tocar nada la tienda se ve como antes, y la página sale con el estilo desde el primer pintado', async () => {
        const info = await publicSvc.freshInfo(await tokenOf(shopId));
        const d = info!.meta.design!;
        expect(d.classes).toBe('s-cards-border s-head-light s-hero-simple');
        expect(d.css).toContain('--s-bg:#f6f7f9');
        expect(d.css).toContain('--s-card:#ffffff');
        expect(d.css).not.toContain('prefers-color-scheme');
        expect(d.hero_image).toBeNull();
        const html = renderShopPage({ title: 'Tienda', token: 'x', meta: info!.meta, products: info!.products, client: 'void 0', captchaScripts: {} });
        expect(html).toContain('<style id="s-design">');
        expect(html).toContain('<body class="s-cards-border s-head-light s-hero-simple">');
    });

    it('una plantilla con portada y foto: la foto se sirve por la ruta de la tienda; letra y modo oscuro van en el CSS', async () => {
        const base = await current();
        const design = { ...applyShopDesignPreset(base.design, 'boutique'), mode: 'auto' as const, hero: { ...applyShopDesignPreset(base.design, 'boutique').hero, image_file_id: photoId } };
        await shopsSvc.update(tenantId, shopId, { config: { ...base, design } as never });
        const info = await publicSvc.freshInfo(await tokenOf(shopId));
        const d = info!.meta.design!;
        expect(d.classes).toContain('s-hero-banner');
        expect(d.classes).toContain('s-hero-img');
        expect(d.classes).toContain('s-head-center');
        expect(d.hero_image).toBe(`img/f${photoId}`);
        expect(info!.images.has(`f${photoId}`)).toBe(true);
        expect(d.css).toContain("font-family:'Playfair Display'");
        expect(d.css).toContain('/email-fonts/playfair-400-normal.woff2');
        expect(d.css).toContain('@media (prefers-color-scheme: dark)');
        expect(d.css).toContain(':root[data-scheme=dark]');
        expect(d.auto).toBe(true);
        // La vista previa usa la URL firmada.
        const prev = await publicSvc.previewData(tenantId, (await shopsSvc.row(tenantId, shopId)), { ...base, design });
        expect(prev.meta.design!.hero_image).toContain(`/files/${photoId}/signed`);
    });

    it('la portada sólo acepta una imagen de esta empresa', async () => {
        const base = await current();
        const withHero = (id: number): ShopConfig => ({ ...base, design: { ...base.design, hero: { ...base.design.hero, style: 'banner', image_file_id: id } } });
        await expect(shopsSvc.update(tenantId, shopId, { config: withHero(textId) as never })).rejects.toMatchObject({ response: { code: 'invalid_image' } });
        await expect(shopsSvc.update(tenantId, shopId, { config: withHero(999_999) as never })).rejects.toMatchObject({ response: { code: 'invalid_image' } });
        // Un gerente que ve todos los registros puede usar las imágenes sueltas de la
        // empresa (la misma regla que formularios y agenda), pero nunca algo que no es imagen.
        const ok = await shopsSvc.update(tenantId, shopId, { config: withHero(otherPhotoId) as never }, manager());
        expect(ok.dto.config.design.hero.image_file_id).toBe(otherPhotoId);
        await expect(shopsSvc.update(tenantId, shopId, { config: withHero(textId) as never }, manager())).rejects.toMatchObject({ response: { code: 'invalid_image' } });
        // La vista previa tampoco firma algo que no es una imagen.
        const prev = await publicSvc.previewData(tenantId, await shopsSvc.row(tenantId, shopId), withHero(textId), manager());
        expect(prev.meta.design!.hero_image).toBeNull();
    });

    it('el CSS propio lo cambia sólo un administrador y se guarda limpio', async () => {
        const base = await current();
        const css = '.s-title{letter-spacing:1px}\n.s-hero{background:url(https://evil.example/x.png)}';
        await expect(
            shopsSvc.update(tenantId, shopId, { config: { ...base, design: { ...base.design, custom_css: css } } as never }, manager()),
        ).rejects.toMatchObject({ response: { code: 'custom_css_admin_only' } });
        const { dto } = await shopsSvc.update(tenantId, shopId, { config: { ...base, design: { ...base.design, custom_css: css } } as never });
        expect(dto.config.design.custom_css).toContain('letter-spacing:1px');
        expect(dto.config.design.custom_css).not.toContain('evil.example');
        // Quien no es admin puede seguir cambiando el resto (el CSS guardado no cambia).
        const again = await shopsSvc.update(tenantId, shopId, { config: { ...dto.config, design: { ...dto.config.design, corners: 'round' } } as never }, manager());
        expect(again.dto.config.design.corners).toBe('round');
        const info = await publicSvc.freshInfo(await tokenOf(shopId));
        expect(info!.meta.design!.css).toContain('/* CSS propio */');
        expect(info!.meta.design!.css).not.toContain('evil.example');
    });
});
