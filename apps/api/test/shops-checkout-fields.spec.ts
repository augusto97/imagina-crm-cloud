import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Field, type PublicShopOrderInput, type ShopConfig } from '@imagina-base/shared';
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
import { fields as fieldsTable, memberships, records, shopOrders, shops, tenants, users } from '../src/db/schema';
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
 * v0.1.430 — Lo que se pide al pagar: celular, documento y notas se piden o
 * no (y con su nombre), y las preguntas propias se validan en el servidor con
 * la misma regla de la página y quedan cada una en su columna de «Pedidos»
 * (la columna se crea sola al guardar).
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

const IP = '203.0.113.131';

describe('v0.1.430 — tienda: datos y preguntas del pago (Postgres + Redis reales)', () => {
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
            .values({ slug: 'acme-preguntas', name: 'Acme', plan: 'pro', settings: { branding: { primary_color: '#7c3aed' } } })
            .returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'dueno-preguntas@acme.co', name: 'Dueño', passwordHash: 'x' }).returning();
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

    const fieldOf = async (id: number): Promise<{ type: string; config: unknown; label: string }> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(fieldsTable).where(eq(fieldsTable.id, id)));
        return { type: row!.type, config: row!.config, label: row!.label };
    };


    const orderRow = async (token: string): Promise<{ recordId: number; customer: Record<string, unknown> }> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(shopOrders).where(eq(shopOrders.token, token)));
        return { recordId: row!.recordId!, customer: row!.customer as Record<string, unknown> };
    };
    const orderCell = async (recordId: number, fieldId: number): Promise<unknown> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, recordId)));
        return (row!.data as Record<string, unknown>)[`f${fieldId}`];
    };
    let seq = 0;
    /** Cada pedido con su correo: el freno por correo (6 por hora) no es lo que se prueba aquí. */
    const place = (partial: Partial<PublicShopOrderInput> = {}) =>
        tokenOf(shopId).then((t) => {
            const base = order(shopId, partial);
            return publicSvc.placeOrder(t, { ...base, customer: { ...base.customer, email: `ana${++seq}@cliente.co` } }, { ip: IP, userAgent: 'vitest' });
        });

    it('celular, documento y notas: lo que no se pide no se guarda y lo obligatorio se exige, con su nombre', async () => {
        const cur = (await shopsSvc.get(tenantId, shopId)).config;
        await shopsSvc.update(tenantId, shopId, {
            config: { ...cur, checkout: { ...cur.checkout, ask_phone: 'required', ask_document: 'hidden', ask_notes: 'required', labels: { phone: 'WhatsApp', document: '', notes: 'Indicaciones' } } } as never,
        });
        const info = await publicSvc.freshInfo(await tokenOf(shopId));
        expect(info!.meta.checkout.fields).toMatchObject({ phone: 'required', document: 'hidden', notes: 'required', labels: { phone: 'WhatsApp', notes: 'Indicaciones' } });
        await expect(place({ customer: { ...order(shopId).customer, phone: '12', notes: 'Timbre 2' } })).rejects.toMatchObject({ response: { code: 'shop_phone', message: expect.stringContaining('WhatsApp') } });
        await expect(place({ customer: { ...order(shopId).customer, notes: '   ' } })).rejects.toMatchObject({ response: { code: 'shop_notes', message: expect.stringContaining('Indicaciones') } });
        const placed = await place({ customer: { ...order(shopId).customer, notes: 'Timbre 2' } });
        const row = await orderRow(placed!.order_token);
        // El documento llegó, pero la tienda no lo pide: no se guarda.
        expect(row.customer).toMatchObject({ phone: '+573001112233', document: '', notes: 'Timbre 2' });
        const o = (await shopsSvc.get(tenantId, shopId)).config.orders;
        expect(await orderCell(row.recordId, o.fields.document!)).toBeUndefined();
        // Lo de antes: «notas» guardado como sí/no se lee como opcional / no pedirlo.
        await withTenant(pg.db, tenantId, async (tx) => {
            const [s] = await tx.select().from(shops).where(eq(shops.id, shopId));
            const c = s!.config as Record<string, unknown>;
            await tx.update(shops).set({ config: { ...c, checkout: { ...(c.checkout as object), ask_notes: false, ask_phone: undefined } } }).where(eq(shops.id, shopId));
        });
        const legacy = (await shopsSvc.get(tenantId, shopId)).config.checkout;
        expect([legacy.ask_notes, legacy.ask_phone]).toEqual(['hidden', 'optional']);
    });

    it('las preguntas propias: cada una con su columna nueva en «Pedidos» (o la elegida), y una columna de la tienda no se toma', async () => {
        const cur = (await shopsSvc.get(tenantId, shopId)).config;
        const listId = cur.orders.list_id!;
        const referido = await fieldsSvc.create(tenantId, String(listId), { label: 'Referido por', type: 'text' } as never);
        const questions = [
            { id: 'barrio', label: 'Barrio', type: 'text', mode: 'required', place: 'delivery', help: 'Para el repartidor', placeholder: '', options: [], field_id: null },
            { id: 'canal', label: '¿Cómo nos conociste?', type: 'select', mode: 'required', place: 'end', help: '', placeholder: '', options: ['Instagram', 'Recomendación', ' instagram ', ''], field_id: null },
            { id: 'factura', label: 'Necesito factura electrónica', type: 'checkbox', mode: 'optional', place: 'you', help: '', placeholder: '', options: [], field_id: null },
            { id: 'personas', label: 'Personas', type: 'number', mode: 'optional', place: 'end', help: '', placeholder: '', options: [], field_id: cur.orders.fields.total! },
            { id: 'evento', label: 'Fecha del evento', type: 'date', mode: 'optional', place: 'end', help: '', placeholder: '', options: [], field_id: null },
            { id: 'quien', label: '¿Quién te recomendó?', type: 'text', mode: 'optional', place: 'end', help: '', placeholder: '', options: [], field_id: referido.id },
        ];
        const saved = await shopsSvc.update(tenantId, shopId, {
            config: { ...cur, checkout: { ...cur.checkout, ask_phone: 'optional', ask_document: 'optional', ask_notes: 'optional', questions } } as never,
        });
        const qs = saved.dto.config.checkout.questions;
        const byId = Object.fromEntries(qs.map((q) => [q.id, q]));
        expect(byId.canal!.options).toEqual(['Instagram', 'Recomendación']);
        expect(byId.quien!.field_id).toBe(referido.id);
        // «Total» es una columna que escribe la tienda: se suelta y se crea otra.
        expect(byId.personas!.field_id).not.toBe(cur.orders.fields.total);
        const types: Record<string, string> = {};
        for (const q of qs) types[q.id] = (await fieldOf(q.field_id!)).type;
        expect(types).toEqual({ barrio: 'text', canal: 'select', factura: 'checkbox', personas: 'number', evento: 'date', quien: 'text' });
        const canal = await fieldOf(byId.canal!.field_id!);
        expect(canal.label).toBe('¿Cómo nos conociste?');
        expect(((canal.config as { options: Array<{ label: string }> }).options ?? []).map((o) => o.label)).toEqual(['Instagram', 'Recomendación']);
        // Guardar otra vez no crea columnas de más; una opción nueva se suma a la columna.
        const n0 = (await withTenant(pg.db, tenantId, (tx) => tx.select({ id: fieldsTable.id }).from(fieldsTable).where(eq(fieldsTable.listId, listId)))).length;
        await shopsSvc.update(tenantId, shopId, {
            config: { ...saved.dto.config, checkout: { ...saved.dto.config.checkout, questions: qs.map((q) => (q.id === 'canal' ? { ...q, options: [...q.options, 'Google'] } : q)) } } as never,
        });
        const n1 = (await withTenant(pg.db, tenantId, (tx) => tx.select({ id: fieldsTable.id }).from(fieldsTable).where(eq(fieldsTable.listId, listId)))).length;
        expect(n1).toBe(n0);
        expect(((await fieldOf(byId.canal!.field_id!)).config as { options: Array<{ label: string }> }).options.map((o) => o.label)).toEqual(['Instagram', 'Recomendación', 'Google']);
        // La página recibe las preguntas sin la columna.
        const info = await publicSvc.freshInfo(await tokenOf(shopId));
        const pub = info!.meta.checkout.fields.questions;
        expect(pub.map((q) => q.id)).toEqual(['barrio', 'canal', 'factura', 'personas', 'evento', 'quien']);
        expect(JSON.stringify(pub)).not.toContain('field_id');
    });

    it('el pedido valida las respuestas con la regla de la página y las guarda en sus columnas', async () => {
        const cfg = (await shopsSvc.get(tenantId, shopId)).config;
        const col = Object.fromEntries(cfg.checkout.questions.map((q) => [q.id, q.field_id!]));
        // Obligatoria sin responder: dice cuál.
        await expect(place({ answers: { barrio: 'Laureles' } })).rejects.toMatchObject({ response: { code: 'shop_answer', data: { question: 'canal' } } });
        // Una opción que no está en la lista.
        await expect(place({ answers: { barrio: 'Laureles', canal: 'TikTok' } })).rejects.toMatchObject({ response: { code: 'shop_answer', data: { question: 'canal' } } });
        // Una fecha que no existe.
        await expect(place({ answers: { barrio: 'Laureles', canal: 'Instagram', evento: '2026-02-30' } })).rejects.toMatchObject({ response: { code: 'shop_answer', data: { question: 'evento' } } });
        // Con envío a domicilio el barrio es obligatorio.
        await expect(place({ answers: { canal: 'Instagram' } })).rejects.toMatchObject({ response: { code: 'shop_answer', data: { question: 'barrio' } } });
        const placed = await place({ answers: { barrio: 'Laureles', canal: 'recomendacion', factura: true, personas: 12.5, evento: '2026-12-05', quien: 'Juan', ajena: 'x' } as never });
        const row = await orderRow(placed!.order_token);
        expect(await orderCell(row.recordId, col.barrio!)).toBe('Laureles');
        const canalCfg = (await fieldOf(col.canal!)).config as { options: Array<{ value: string; label: string }> };
        expect(await orderCell(row.recordId, col.canal!)).toBe(canalCfg.options.find((o) => o.label === 'Recomendación')!.value);
        expect(await orderCell(row.recordId, col.factura!)).toBe(true);
        expect(await orderCell(row.recordId, col.personas!)).toBe(12.5);
        expect(await orderCell(row.recordId, col.evento!)).toBe('2026-12-05');
        expect(await orderCell(row.recordId, col.quien!)).toBe('Juan');
        // En palabras, para el correo, WhatsApp y la página del pedido.
        expect(row.customer.answers).toEqual([
            { label: 'Barrio', text: 'Laureles' },
            { label: '¿Cómo nos conociste?', text: 'Recomendación' },
            { label: 'Necesito factura electrónica', text: 'Sí' },
            { label: 'Personas', text: '12.5' },
            { label: 'Fecha del evento', text: '05/12/2026' },
            { label: '¿Quién te recomendó?', text: 'Juan' },
        ]);
        // Al recoger en el local no se pide la dirección: el barrio tampoco (y no se guarda aunque llegue).
        const pickup = await place({ delivery_id: 'retiro', customer: { ...order(shopId).customer, address: '', city: '' }, answers: { canal: 'Instagram', barrio: 'Centro' } });
        const prow = await orderRow(pickup!.order_token);
        expect(await orderCell(prow.recordId, col.barrio!)).toBeUndefined();
        expect((prow.customer.answers as Array<{ label: string }>).map((a) => a.label)).toEqual(['¿Cómo nos conociste?']);
        // El mensaje de WhatsApp lleva las respuestas.
        const wa = await place({ payment_method: 'whatsapp', answers: { barrio: 'Envigado', canal: 'Instagram' } });
        const url = await publicSvc.whatsappUrl(await tokenOf(shopId), wa!.order_token);
        const text = decodeURIComponent(new URL(url!).searchParams.get('text') ?? '');
        expect(text).toContain('Barrio: Envigado');
        expect(text).toContain('¿Cómo nos conociste?: Instagram');
    });
});
