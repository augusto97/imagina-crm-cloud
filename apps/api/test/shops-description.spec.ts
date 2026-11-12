import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { type Field, type RichNode, type ShopConfig } from '@imagina-base/shared';
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
import { ShopService } from '../src/shop/shop.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

/**
 * v0.1.420 — La descripción del producto puede ser el DOCUMENTO del registro
 * (con formato): el catálogo lleva el texto (para buscar) y la ficha pide el
 * documento, saneado para afuera (sin menciones internas, imágenes sólo de la
 * tienda). Y una tienda sólo de digitales y servicios no pide entrega.
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


describe('v0.1.420 — tienda: descripción con formato y digitales sin entrega (Postgres + Redis reales)', () => {
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
    let admin: Actor;
    let catalogId: number;
    const mails: Array<{ to: string }> = [];
    const f: Record<string, Field> = {};
    const product: Record<string, number> = {};
    let photoId = 0;
    let otherPhotoId = 0;

    const tokenOf = async (id: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shops).where(eq(shops.id, id)));
        return row!.token;
    };
    const readyConfig = (base: ShopConfig): ShopConfig => ({
        ...base,
        payments: { ...base.payments, transfer: { ...base.payments.transfer, enabled: true, instructions: 'Bancolombia ahorros 123-456789-00.' } },
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
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-shop-desc-'))), env);
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

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-desc', name: 'Acme', plan: 'pro' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'dueno@acme-desc.co', name: 'Dueño', passwordHash: 'x' }).returning();
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
        await add('asesoria', { nombre: 'Asesorías y Capacitaciones', precio: 150000 });
        await add('curso', { nombre: 'Curso grabado', precio: 90000 });

        const doc: RichNode = {
            type: 'doc',
            content: [
                { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '¿Qué puedes aprender?' }] },
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Con ' },
                        { type: 'text', text: 'Ana', marks: [{ type: 'bold' }] },
                        { type: 'mentionUser', attrs: { id: adminId, label: 'Dueño' } },
                    ],
                },
                { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Elementor' }] }] }] },
                { type: 'imageBlock', attrs: { fileId: photoId, alt: 'Portada' } },
                { type: 'fileBlock', attrs: { fileId: otherPhotoId, name: 'costos-internos.xlsx' } },
            ],
        };
        await recordsSvc.updateDescription(tenantId, admin, 'servicios', product.asesoria!, { description: doc } as never);

        const dto = await shopsSvc.create(tenantId, adminId, { list_id: catalogId, name: 'Tienda Acme' });
        shopId = dto.id;
        // Sin un campo de descripción, la tienda nace con la del registro.
        expect(dto.config.description_from).toBe('record');
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

    it('el catálogo lleva el texto de la descripción (para buscar) y marca la que tiene formato', async () => {
        const info = await publicSvc.freshInfo(await tokenOf(shopId));
        const asesoria = info!.products.find((p) => p.id === product.asesoria)!;
        const curso = info!.products.find((p) => p.id === product.curso)!;
        expect(asesoria.rich_description).toBe(true);
        expect(asesoria.description).toContain('¿Qué puedes aprender?');
        expect(asesoria.description).toContain('Elementor');
        expect(curso.rich_description).toBeUndefined();
        expect(curso.description).toBe('');
        // La imagen del documento se sirve como las fotos; el adjunto interno no.
        expect(info!.images.has(`f${photoId}`)).toBe(true);
        expect(info!.images.has(`f${otherPhotoId}`)).toBe(false);
    });

    it('la ficha pide el documento saneado: sin menciones ni adjuntos internos, imágenes con su clave', async () => {
        const token = await tokenOf(shopId);
        const doc = await publicSvc.productDescription(token, product.asesoria!);
        expect(doc?.content?.map((n) => n.type)).toEqual(['heading', 'paragraph', 'bulletList', 'image']);
        const json = JSON.stringify(doc);
        expect(json).not.toContain('Dueño');
        expect(json).not.toContain('costos-internos');
        expect(doc?.content?.[3]?.attrs).toEqual({ src: `img/f${photoId}`, alt: 'Portada' });
        // Un producto sin documento, uno que no es de la tienda o un id raro: nada.
        expect(await publicSvc.productDescription(token, product.curso!)).toBeNull();
        expect(await publicSvc.productDescription(token, 999_999)).toBeNull();
        expect(await publicSvc.productDescription('tokendesconocido00000', product.asesoria!)).toBeNull();
    });

    it('con la descripción de un campo de texto, no se pide el documento', async () => {
        const dto = await shopsSvc.get(tenantId, shopId);
        await shopsSvc.update(tenantId, shopId, { config: { ...dto.config, description_from: 'field' } as never });
        const token = await tokenOf(shopId);
        const info = await publicSvc.freshInfo(token);
        expect(info!.products.find((p) => p.id === product.asesoria)!.rich_description).toBeUndefined();
        expect(await publicSvc.productDescription(token, product.asesoria!)).toBeNull();
        await shopsSvc.update(tenantId, shopId, { config: { ...dto.config, description_from: 'record' } as never });
    });

    it('v0.1.424 — la descripción corta viaja con cada producto y el diseño de la ficha con la tienda', async () => {
        const corta = await fieldsSvc.create(tenantId, 'servicios', { label: 'Descripción corta', type: 'text', slug: 'descripcion_corta' } as never);
        await recordsSvc.update(tenantId, admin, 'servicios', product.asesoria!, { data: { [`f${corta.id}`]: '  Clases en vivo con certificado.  ' } } as never);
        const dto = await shopsSvc.get(tenantId, shopId);
        await shopsSvc.update(tenantId, shopId, {
            config: { ...dto.config, catalog: { ...dto.config.catalog, summary: corta.id }, design: { ...dto.config.design, product: { ...dto.config.design.product, layout: 'wide', image_ratio: 'square' } } } as never,
        });
        const info = await publicSvc.freshInfo(await tokenOf(shopId));
        expect(info!.products.find((p) => p.id === product.asesoria)!.summary).toBe('Clases en vivo con certificado.');
        expect(info!.products.find((p) => p.id === product.curso)!.summary).toBeUndefined();
        expect(info!.meta.design?.product).toMatchObject({ layout: 'wide', image_ratio: 'square', image_fit: 'contain' });
        // Una columna que no es de texto no se acepta como descripción corta.
        await expect(shopsSvc.update(tenantId, shopId, { config: { ...dto.config, catalog: { ...dto.config.catalog, summary: f.precio!.id } } as never })).rejects.toThrow('no sirve para ese papel');
        await shopsSvc.update(tenantId, shopId, { config: dto.config as never });
    });

    it('sólo digitales y servicios: publicar no pide formas de entrega; con un producto físico, sí', async () => {
        const noDelivery = 'Agrega al menos una forma de entrega.';
        const base = await shopsSvc.get(tenantId, shopId);
        // Publicada, guardar sin entrega con productos físicos se rechaza.
        await expect(shopsSvc.update(tenantId, shopId, { config: { ...base.config, delivery: [] } as never })).rejects.toThrow(noDelivery);
        await shopsSvc.update(tenantId, shopId, { config: { ...base.config, delivery: [] } as never, enabled: false });
        // Sin columna «Tipo»: todo es físico → se pide.
        expect((await shopsSvc.get(tenantId, shopId)).problems.map((p) => p.text)).toContain(noDelivery);

        const withKind = await shopsSvc.createKindColumn(tenantId, shopId, 'kind');
        const tipo = (await fieldsSvc.listByListId(tenantId, catalogId)).find((x) => x.slug === 'tipo_de_producto')!;
        expect(withKind.config.kinds.kind_field).toBe(tipo.id);
        await recordsSvc.update(tenantId, admin, 'servicios', product.asesoria!, { data: { [`f${tipo.id}`]: 'service' } } as never);
        await recordsSvc.update(tenantId, admin, 'servicios', product.curso!, { data: { [`f${tipo.id}`]: 'digital' } } as never);
        expect((await shopsSvc.get(tenantId, shopId)).problems.map((p) => p.text)).not.toContain(noDelivery);
        // …y se puede publicar sin formas de entrega.
        expect((await shopsSvc.update(tenantId, shopId, { enabled: true })).dto.enabled).toBe(true);
        await shopsSvc.update(tenantId, shopId, { enabled: false });

        const taza = (await recordsSvc.create(tenantId, admin, 'servicios', { data: { [`f${f.nombre!.id}`]: 'Taza', [`f${f.precio!.id}`]: 20000, [`f${tipo.id}`]: 'physical' } } as never)).id;
        expect((await shopsSvc.get(tenantId, shopId)).problems.map((p) => p.text)).toContain(noDelivery);
        await recordsSvc.remove(tenantId, admin, 'servicios', taza);
        expect((await shopsSvc.get(tenantId, shopId)).problems.map((p) => p.text)).not.toContain(noDelivery);
    });
});
