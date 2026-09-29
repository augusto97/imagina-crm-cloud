import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.206 — la sincronización con una tienda WooCommerce, con Postgres y
 * Redis reales. La tienda se simula en el borde de red (`safeWebhookFetch`)
 * con una API en memoria que respeta lo que usa el motor: paginación con
 * `X-WP-Total`, `orderby=modified` + `modified_after`, variaciones por
 * producto y ajustes generales.
 */
interface FakeCall {
    url: string;
    method?: string;
    body?: string;
}
type Row = Record<string, unknown>;
const store = vi.hoisted(() => ({
    clock: Date.UTC(2026, 0, 1),
    customers: [] as Row[],
    products: [] as Row[],
    variations: {} as Record<number, Row[]>,
    orders: [] as Row[],
    nextId: 10_000,
    calls: [] as FakeCall[],
    ignoreModifiedAfter: false,
    webhooks: [] as Row[],
    readOnly: false,
}));
vi.mock('../src/common/safe-fetch', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/common/safe-fetch')>();
    return {
        ...real,
        safeWebhookFetch: async (url: string, opts: { method?: string; body?: string }) => {
            store.calls.push({ url, method: opts.method, body: opts.body });
            const u = new URL(url);
            const method = opts.method ?? 'GET';
            const input = opts.body ? (JSON.parse(opts.body) as Row) : {};
            const ok = (o: unknown) => ({ status: 200, body: JSON.stringify(o), headers: {} });
            const denied = { status: 401, body: '{"code":"woocommerce_rest_cannot_create","message":"No tenés permiso"}', headers: {} };
            const touchRow = (o: Row) => {
                store.clock += 60_000;
                o.date_modified_gmt = new Date(store.clock).toISOString().slice(0, 19);
            };
            if (method !== 'GET') {
                const p = u.pathname.replace('/wp-json/wc/v3', '');
                if (store.readOnly) return denied;
                if (p === '/webhooks' && method === 'POST') {
                    const wh = { id: store.nextId++, name: input.name, topic: input.topic, delivery_url: input.delivery_url, secret: input.secret, status: input.status ?? 'active' };
                    store.webhooks.push(wh);
                    return { status: 201, body: JSON.stringify({ ...wh, secret: undefined }), headers: {} };
                }
                let m = /^\/webhooks\/(\d+)$/.exec(p);
                if (m) {
                    const wh = store.webhooks.find((w) => w.id === Number(m![1]));
                    if (method === 'DELETE') store.webhooks = store.webhooks.filter((w) => w !== wh);
                    else if (wh) Object.assign(wh, input);
                    return ok(wh ?? {});
                }
                const apply = (o: Row | undefined) => {
                    if (!o) return { status: 404, body: '{"code":"not_found","message":"ID no válido"}', headers: {} };
                    const { billing, meta_data, ...rest } = input as Row & { billing?: Row; meta_data?: Row[] };
                    Object.assign(o, rest);
                    if (billing) o.billing = { ...(o.billing as Row), ...billing };
                    for (const md of meta_data ?? []) {
                        const list = (o.meta_data as Row[]) ?? (o.meta_data = []);
                        const hit = (list as Row[]).find((x) => x.key === md.key);
                        if (hit) hit.value = md.value;
                        else (list as Row[]).push(md);
                    }
                    if (rest.regular_price !== undefined || rest.sale_price !== undefined) o.price = (o.sale_price as string) || (o.regular_price as string);
                    touchRow(o);
                    return ok(o);
                };
                if ((m = /^\/products\/(\d+)\/variations\/(\d+)$/.exec(p))) {
                    return apply((store.variations[Number(m[1])] ?? []).find((v) => v.id === Number(m![2])));
                }
                if ((m = /^\/products\/(\d+)$/.exec(p))) return apply(store.products.find((x) => x.id === Number(m![1])));
                if ((m = /^\/orders\/(\d+)$/.exec(p))) return apply(store.orders.find((x) => x.id === Number(m![1])));
                if ((m = /^\/customers\/(\d+)$/.exec(p))) return apply(store.customers.find((x) => x.id === Number(m![1])));
                return { status: 404, body: '{"code":"rest_no_route","message":"No existe"}', headers: {} };
            }
            if (u.pathname === '/wp-json/') return { status: 200, body: '{"name":"Tienda Test"}', headers: {} };
            const path = u.pathname.replace('/wp-json/wc/v3', '');
            const q = u.searchParams;
            const page = (items: Row[]) => {
                const per = Number(q.get('per_page') ?? 10);
                const p = Number(q.get('page') ?? 1);
                const slice = items.slice((p - 1) * per, p * per);
                return {
                    status: 200,
                    body: JSON.stringify(slice),
                    headers: { 'x-wp-total': String(items.length), 'x-wp-totalpages': String(Math.ceil(items.length / per)) },
                };
            };
            const byModified = (items: Row[]) => {
                let out = [...items];
                const after = q.get('modified_after');
                if (after && !store.ignoreModifiedAfter) {
                    out = out.filter((x) => String(x.date_modified_gmt) > after.replace(/Z$/, '').slice(0, 19));
                }
                const created = q.get('after');
                if (created) out = out.filter((x) => String(x.date_created_gmt) > created.slice(0, 19));
                if (q.get('orderby') === 'modified') {
                    out.sort((a, b) => String(a.date_modified_gmt).localeCompare(String(b.date_modified_gmt)) || Number(a.id) - Number(b.id));
                }
                return out;
            };
            // Un producto o una variación sueltos (v0.1.209: sumar stock lee el valor de ese momento).
            const one = /^\/products\/(\d+)$/.exec(path);
            if (one) {
                const hit = store.products.find((x) => x.id === Number(one[1]));
                return hit ? { status: 200, body: JSON.stringify(hit), headers: {} } : { status: 404, body: '{"code":"not_found","message":"ID no válido"}', headers: {} };
            }
            const oneVar = /^\/products\/(\d+)\/variations\/(\d+)$/.exec(path);
            if (oneVar) {
                const hit = (store.variations[Number(oneVar[1])] ?? []).find((v) => v.id === Number(oneVar[2]));
                return hit ? { status: 200, body: JSON.stringify(hit), headers: {} } : { status: 404, body: '{"code":"not_found","message":"ID no válido"}', headers: {} };
            }
            if (path === '/settings/products') {
                return { status: 200, body: JSON.stringify([{ id: 'woocommerce_notify_low_stock_amount', value: '5' }]), headers: {} };
            }
            if (path === '/products' && q.get('include')) {
                const ids = q.get('include')!.split(',').map(Number);
                return page(store.products.filter((p) => ids.includes(Number(p.id))));
            }
            const vinc = /^\/products\/(\d+)\/variations$/.exec(path);
            if (vinc && q.get('include')) {
                const ids = q.get('include')!.split(',').map(Number);
                store.calls.push({ url: `include-variations:${ids.join(',')}` });
                return page((store.variations[Number(vinc[1])] ?? []).filter((v) => ids.includes(Number(v.id))));
            }
            if (path === '/settings/general') {
                return {
                    status: 200,
                    body: JSON.stringify([
                        { id: 'woocommerce_currency', value: 'COP' },
                        { id: 'woocommerce_price_num_decimals', value: '0' },
                        { id: 'woocommerce_default_country', value: 'CO:ANT' },
                    ]),
                    headers: {},
                };
            }
            if (path === '/customers') {
                const list = [...store.customers].sort((a, b) =>
                    q.get('order') === 'desc' ? Number(b.id) - Number(a.id) : Number(a.id) - Number(b.id),
                );
                return page(list);
            }
            const vm = /^\/products\/(\d+)\/variations$/.exec(path);
            if (vm) return page(store.variations[Number(vm[1])] ?? []);
            if (path === '/products') return page(byModified(store.products));
            if (path === '/webhooks') return page(store.webhooks);
            if (path === '/orders') return page(byModified(store.orders));
            return { status: 404, body: '{"code":"rest_no_route","message":"No existe"}', headers: {} };
        },
    };
});

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
import { connectionSyncs, dashboards, lists, plans, records, relations, savedViews, storeHooks, syncLinks, tenants, users, memberships } from '../src/db/schema';
import { INVENTORY_FIELD_SLUGS, RESTOCK_FIELD_SLUGS } from '../src/sync/woocommerce/woo-pack';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListGroupsService } from '../src/lists/list-groups.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { StoreSyncEngine } from '../src/sync/store-sync.engine';
import { StoreSyncQueue, type StoreSyncPushJob } from '../src/sync/store-sync.queue';
import { StoreRealtimeService } from '../src/sync/store-realtime.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { StoreSyncService } from '../src/sync/store-sync.service';
import { StorePurchasingService } from '../src/sync/store-purchasing.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';

class NoHooks implements HookCaptureStore {
    lpush(): Promise<number> {
        return Promise.resolve(1);
    }
    ltrim(): Promise<unknown> {
        return Promise.resolve('OK');
    }
    expire(): Promise<unknown> {
        return Promise.resolve(1);
    }
    lrange(): Promise<string[]> {
        return Promise.resolve([]);
    }
}
class CapturingDispatcher extends AutomationDispatcher {
    events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}
class CapturingQueue extends StoreSyncQueue {
    runs: Array<{ tenantId: number; syncId: number; opts: { full?: boolean; only?: string[] } }> = [];
    pushes: StoreSyncPushJob[] = [];
    override enqueueRun(tenantId: number, syncId: number, opts: { full?: boolean; only?: string[] }): void {
        this.runs.push({ tenantId, syncId, opts });
    }
    /** Sin cola: el aviso se procesa en el acto (el camino "sin Redis" del service). */
    override enqueueHook(): boolean {
        return false;
    }
    override enqueuePush(job: StoreSyncPushJob): void {
        this.pushes.push(job);
    }
    /** Sin cola: los trabajos de compras se procesan en el acto (el camino "sin Redis"). */
    override enqueuePurchase(): boolean {
        return false;
    }
}

// ── Tienda falsa ───────────────────────────────────────────────────────────

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);
function tick(): string {
    store.clock += 60_000;
    return iso(store.clock);
}
function touch(o: Row): void {
    const d = tick();
    o.date_modified_gmt = d;
    o.date_modified = d;
}
function customer(id: number, first: string, email: string): Row {
    const d = tick();
    return { id, email, first_name: first, last_name: 'Pérez', date_created_gmt: d, billing: { email, phone: '3001112233', city: 'Bogotá', country: 'CO' }, meta_data: [] };
}
function orderFor(opts: { customerId: number; email: string; lines: Array<{ product: number; variation?: number; qty: number; price: number }>; status?: string }): Row {
    const id = store.nextId++;
    const d = tick();
    const line_items = opts.lines.map((l) => ({
        id: store.nextId++,
        name: l.variation ? 'Camiseta' : 'Taza',
        product_id: l.product,
        variation_id: l.variation ?? 0,
        quantity: l.qty,
        subtotal: String(l.price * l.qty),
        total: String(l.price * l.qty),
        price: l.price,
        sku: '',
    }));
    return {
        id,
        number: String(id),
        status: opts.status ?? 'completed',
        currency: 'COP',
        date_created_gmt: d,
        date_modified_gmt: d,
        total: String(line_items.reduce((s, l) => s + Number(l.total), 0)),
        shipping_total: '0',
        discount_total: '0',
        total_tax: '0',
        customer_id: opts.customerId,
        billing: { first_name: 'Invitada', last_name: 'Uno', email: opts.email, phone: '', city: 'Cali', country: 'CO' },
        payment_method_title: 'Transferencia',
        line_items,
        meta_data: [{ key: 'nit', value: '900123' }],
    };
}
function seedStore(orderCount: number): void {
    store.clock = Date.UTC(2026, 0, 1);
    store.nextId = 10_000;
    store.ignoreModifiedAfter = false;
    store.customers = [customer(1, 'Ana', 'ana@x.co'), customer(2, 'Beto', 'beto@x.co'), customer(3, 'Caro', 'caro@x.co')];
    store.products = [
        { id: 10, name: 'Taza', type: 'simple', status: 'publish', price: '20000', regular_price: '20000', manage_stock: true, stock_quantity: 50, stock_status: 'instock', categories: [{ name: 'Cocina', slug: 'cocina' }], date_modified_gmt: tick(), meta_data: [{ key: 'garantia_meses', value: '12' }, { key: '_edit_lock', value: 'x' }] },
        { id: 20, name: 'Camiseta', type: 'variable', status: 'publish', price: '30000', stock_status: 'instock', categories: [{ name: 'Ropa', slug: 'ropa' }], date_modified_gmt: tick(), meta_data: [] },
    ];
    store.variations = {
        20: [
            // S: stock 5 con el umbral general de la tienda (5) → stock bajo.
            { id: 21, parent_id: 20, price: '30000', manage_stock: true, stock_quantity: 5, stock_status: 'instock', attributes: [{ name: 'Talla', option: 'S' }], date_modified_gmt: tick(), meta_data: [] },
            // M: stock llevado por el PADRE ("parent") y en cero → agotado.
            { id: 22, parent_id: 20, price: '32000', manage_stock: 'parent', stock_quantity: 0, stock_status: 'outofstock', attributes: [{ name: 'Talla', option: 'M' }], date_modified_gmt: tick(), meta_data: [] },
        ],
    };
    store.orders = [];
    for (let i = 0; i < orderCount; i++) {
        const who = i % 4;
        store.orders.push(
            who === 3
                ? orderFor({ customerId: 0, email: 'Invitada@Correo.co', lines: [{ product: 10, qty: 1, price: 20000 }] })
                : orderFor({ customerId: who + 1, email: `${['ana', 'beto', 'caro'][who]}@x.co`, lines: [{ product: 10, qty: 2, price: 20000 }, { product: 20, variation: 21 + (i % 2), qty: 1, price: 30000 }] }),
        );
    }
}

// ── Test ───────────────────────────────────────────────────────────────────

describe('Sincronización con WooCommerce (v0.1.206)', () => {
    let pg: TestPg;
    let rds: TestRedis;
    let redis: Redis;
    let tenantDb: TenantDb;
    let connectors: ConnectorsService;
    let svc: StoreSyncService;
    let fieldsService: FieldsService;
    let recordsService: RecordsService;
    let dispatcher: CapturingDispatcher;
    let queue: CapturingQueue;
    let realtime: StoreRealtimeService;
    let purchasing: StorePurchasingService;
    let tenantId: number;
    let otherTenant: number;
    let adminId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        rds = await startRedis();
        redis = new Redis(rds.url);
        tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY });
        const rt = new RealtimeService();
        const audit = new AuditService(tenantDb);
        const listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps());
        const automationsService = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsService,
            new AutomationScheduler(),
            new NoHooks(),
            connectors,
        );
        const plansService = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plansService, new EmailQuotaService(pg.db, plansService), new TenantSmtpService(pg.db, env));
        const blueprints = new BlueprintService(
            tenantDb,
            listsService,
            fieldsService,
            new ViewsService(tenantDb, new ViewsRepository(), listsService, rt),
            automationsService,
            new RecordsRepository(),
            new RelationsRepository(),
            billing,
            rt,
            new DashboardsService(tenantDb, null as never, null as never, null as never),
        );
        dispatcher = new CapturingDispatcher();
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        const hub = new RecordChangeHub();
        recordsService = new RecordsService(tenantDb, new RecordsRepository(), listsService, fieldsService, rt, activity, dispatcher, new RelationsRepository(), undefined, hub);
        const engine = new StoreSyncEngine(tenantDb, fieldsService, billing, rt, dispatcher, activity, redis);
        queue = new CapturingQueue();
        realtime = new StoreRealtimeService(tenantDb, pg.db, env, engine, queue);
        svc = new StoreSyncService(tenantDb, pg.db, connectors, blueprints, listsService, new ListGroupsService(tenantDb), fieldsService, audit, engine, queue, realtime);
        realtime.setCredsResolver((t, s) => svc.credsForSync(t, s));
        hub.subscribe((c) => realtime.onRecordChange(c));
        purchasing = new StorePurchasingService(tenantDb, redis, engine, queue, rt, recordsService, svc);
        hub.subscribe((c) => purchasing.onRecordChange(c));

        await pg.db.insert(plans).values({ slug: 'grande', name: 'Grande', maxRecords: null }).onConflictDoNothing();
        await pg.db.insert(plans).values({ slug: 'mini', name: 'Mini', maxRecords: 30 }).onConflictDoNothing();
        const [t] = await pg.db.insert(tenants).values({ slug: 'tienda-co', name: 'Tienda Co', plan: 'grande' }).returning();
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra-co', name: 'Otra Co', plan: 'grande' }).returning();
        tenantId = t!.id;
        otherTenant = t2!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@tienda.co', name: 'Admin', passwordHash: 'x' }).returning();
        adminId = u!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: adminId, role: 'admin' }));
    }, 180_000);

    afterAll(async () => {
        redis?.disconnect();
        await rds?.stop();
        await pg?.stop();
    });

    async function connect(tId: number): Promise<number> {
        const { connection } = await connectors.connectIntegrationKey(tId, adminId, 'admin', 'woocommerce', {
            fields: { store_url: 'tienda.test', consumer_key: 'ck_test_1234', consumer_secret: 'cs_test_5678' },
            visibility: 'workspace',
        });
        return connection.id;
    }
    async function syncIdOf(tId: number, connectionId: number): Promise<number> {
        const [row] = await withTenant(pg.db, tId, (tx) =>
            tx.select({ id: connectionSyncs.id }).from(connectionSyncs).where(eq(connectionSyncs.connectionId, connectionId)),
        );
        return row!.id;
    }
    async function rows(tId: number, listId: number): Promise<Array<Record<string, unknown>>> {
        return withTenant(pg.db, tId, (tx) =>
            tx.select({ id: records.id, data: records.data }).from(records).where(and(eq(records.listId, listId), isNull(records.deletedAt))),
        ).then((r) => r.map((x) => ({ id: x.id, ...x.data })));
    }

    let connId: number;
    let syncId: number;
    let st: Awaited<ReturnType<StoreSyncService['status']>>;
    let fieldIds: Record<string, Record<string, number>>;

    it('alta: carpeta con cinco listas vinculadas + tablero, moneda de la tienda, y encola la importación', async () => {
        seedStore(230);
        connId = await connect(tenantId);
        st = await svc.setup(tenantId, adminId, 'admin', connId, {
            resources: { customers: true, products: true, orders: true },
            orders_since: null,
            mode: 'interval',
            interval_minutes: 15,
        });
        syncId = await syncIdOf(tenantId, connId);
        expect(st.configured).toBe(true);
        expect(st.store_name).toContain('Tienda Test');
        expect(Object.keys(st.lists).sort()).toEqual(['customers', 'line_items', 'orders', 'products', 'variations']);
        expect(st.dashboard_id).not.toBeNull();
        expect(st.inventory_dashboard_id).not.toBeNull();
        expect(st.folder_id).not.toBeNull();
        // v0.1.208 — la vista «Para reponer» nace en Productos y Variaciones
        // (una config inválida se saltaba con un aviso en el log, en silencio).
        const reponer = await withTenant(pg.db, tenantId, (tx) => tx.select().from(savedViews).where(eq(savedViews.name, 'Para reponer')));
        expect(reponer).toHaveLength(2);
        const [invDash] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboards).where(eq(dashboards.id, st.inventory_dashboard_id!)));
        expect((invDash!.widgets as unknown[]).length).toBe(11);
        // Las tablas de los tableros eligen sus columnas (la clave que lee el widget).
        const tables = (invDash!.widgets as Array<{ type: string; config: Record<string, unknown> }>).filter((w) => w.type === 'table');
        expect(tables.every((w) => Array.isArray(w.config.visible_field_ids) && (w.config.visible_field_ids as unknown[]).length === 6)).toBe(true);
        // v0.1.209 — las listas de compras nacen con el pack y cada lista lleva su marca.
        expect(st.purchase_lists.suppliers).not.toBeNull();
        expect(st.purchase_lists.orders).not.toBeNull();
        expect(st.purchase_lists.lines).not.toBeNull();
        const marked = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: lists.id, settings: lists.settings }).from(lists));
        const roleOf = (id: number) => (marked.find((l) => l.id === id)!.settings as { store_sync?: { role: string; connection_id: number } }).store_sync;
        expect(roleOf(st.lists.products!.id)).toEqual({ connection_id: connId, role: 'products' });
        expect(roleOf(st.purchase_lists.orders!.id)).toEqual({ connection_id: connId, role: 'purchase_orders' });
        expect(queue.runs).toEqual([{ tenantId, syncId, opts: { full: true } }]);

        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)));
        fieldIds = (row!.settings as { fields: Record<string, Record<string, number>> }).fields;
        // La moneda y los decimales de la tienda van a los campos de dinero.
        const precio = await fieldsService.listByListId(tenantId, st.lists.products!.id);
        expect(precio.find((f) => f.slug === 'precio')!.config).toMatchObject({ currency: 'COP', precision: 0 });
        // Una segunda alta para la misma tienda se rechaza.
        await expect(
            svc.setup(tenantId, adminId, 'admin', connId, { resources: { customers: true, products: true, orders: true }, orders_since: null, mode: 'interval', interval_minutes: 15 }),
        ).rejects.toThrow();
    });

    it('importación inicial: clientes (con invitados), productos, variaciones, pedidos paginados y líneas — sin disparar automatizaciones', async () => {
        expect(await svc.runJob(tenantId, syncId, { full: true })).toBe(true);
        st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.last_error).toBeNull();
        expect(st.initial_done).toBe(true);
        expect(st.progress.customers!.count).toBe(4); // 3 registrados + la invitada
        expect(st.progress.products!.count).toBe(2);
        expect(st.progress.variations!.count).toBe(2);
        expect(st.progress.orders!.count).toBe(230); // 3 páginas de 100
        expect(st.progress.line_items!.count).toBe(173 * 2 + 57);
        expect(dispatcher.events).toHaveLength(0);

        // La invitada existe UNA vez (su email normalizado) aunque tenga 57 pedidos.
        const customers = await rows(tenantId, st.lists.customers!.id);
        const email = `f${fieldIds.customers!.email}`;
        expect(customers.filter((c) => String(c[email]).toLowerCase() === 'invitada@correo.co')).toHaveLength(1);

        // Variación vinculada a su producto; línea a pedido + producto + variación.
        const variations = await rows(tenantId, st.lists.variations!.id);
        const vNombre = `f${fieldIds.variations!.nombre}`;
        expect(variations.map((v) => v[vNombre]).sort()).toEqual(['Camiseta — M', 'Camiseta — S']);
        const rel = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(relations).where(eq(relations.fieldId, fieldIds.line_items!.variacion!)),
        );
        expect(rel.length).toBe(173);

        // Los rollups calculan: unidades vendidas de la taza y total de la invitada.
        const res = await recordsService.list(tenantId, { userId: adminId, role: 'admin' }, st.lists.products!.slug, { limit: 10 } as never);
        const taza = res.data.find((r) => r.data[`f${fieldIds.products!.nombre}`] === 'Taza')!;
        expect(taza.data[`f${fieldIds.products!.unidades_vendidas}`]).toBe(173 * 2 + 57);
        const cl = await recordsService.list(tenantId, { userId: adminId, role: 'admin' }, st.lists.customers!.slug, { limit: 10 } as never);
        const guest = cl.data.find((r) => String(r.data[email]).toLowerCase() === 'invitada@correo.co')!;
        expect(guest.data[`f${fieldIds.customers!.total_comprado}`]).toBe(57 * 20000);

        // Meta descubierta, con los internos marcados.
        const keys = st.meta_keys.products ?? [];
        expect(keys.find((k) => k.key === 'garantia_meses')).toMatchObject({ private: false, suggested_type: 'number', field_id: null });
        expect(keys.find((k) => k.key === '_edit_lock')).toMatchObject({ private: true });

        // v0.1.208 — INVENTARIO: estado, umbral general de la tienda (5), valor
        // en stock, y la variación cuyo stock lleva el padre ("parent").
        const inv = (resource: 'products' | 'variations', slug: string) => `f${fieldIds[resource]![slug]}`;
        const byWoo = async (resource: 'products' | 'variations', wooId: string) =>
            (await rows(tenantId, st.lists[resource]!.id)).find((r) => r[inv(resource, 'woo_id')] === wooId)!;
        const taza10 = await byWoo('products', '10');
        expect(taza10[inv('products', 'estado_inventario')]).toBe('en_stock');
        expect(taza10[inv('products', 'controla_stock')]).toBe(true);
        expect(taza10[inv('products', 'valor_inventario')]).toBe(50 * 20000);
        const s21 = await byWoo('variations', '21');
        expect(s21[inv('variations', 'estado_inventario')]).toBe('bajo');
        const m22 = await byWoo('variations', '22');
        expect(m22[inv('variations', 'estado_inventario')]).toBe('agotado');
        expect(m22[inv('variations', 'controla_stock')]).toBe(true);
        expect(m22[inv('variations', 'stock')]).toBe(0);
        expect(st.inventory_dashboard_id).not.toBeNull();
        // El producto variable suma el stock de sus variaciones (rollup).
        const prods = await recordsService.list(tenantId, { userId: adminId, role: 'admin' }, st.lists.products!.slug, { limit: 10 } as never);
        const camiseta = prods.data.find((r) => r.data[inv('products', 'woo_id')] === '20')!;
        expect(camiseta.data[inv('products', 'stock_variaciones')]).toBe(5);
        // Un producto variable sin stock propio lo lleva en sus variaciones.
        expect(camiseta.data[inv('products', 'estado_inventario')]).toBe('por_variacion');
    });

    it('re-correr no duplica nada, y lo que no cambió no se re-escribe', async () => {
        const before = (await rows(tenantId, st.lists.orders!.id)).length;
        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        expect(await svc.runJob(tenantId, syncId, { full: true })).toBe(true);
        expect((await rows(tenantId, st.lists.orders!.id)).length).toBe(before);
        expect((await rows(tenantId, st.lists.line_items!.id)).length).toBe(173 * 2 + 57);
        expect(dispatcher.events).toHaveLength(0);
    });

    it('incremental: trae sólo lo modificado, borra la línea que el pedido ya no tiene y dispara las automatizaciones', async () => {
        const calls = store.calls.length;
        const edited = store.orders[5]!;
        edited.status = 'refunded';
        (edited.line_items as Row[]).pop();
        touch(edited);
        const fresh = orderFor({ customerId: 2, email: 'beto@x.co', lines: [{ product: 20, variation: 22, qty: 3, price: 32000 }] });
        store.orders.push(fresh);

        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.last_error).toBeNull();
        expect(st.progress.orders!.count).toBe(231);
        // El pedido editado perdió su segunda línea: 1 menos + 1 del pedido nuevo.
        expect(st.progress.line_items!.count).toBe(173 * 2 + 57);
        // Pidió los pedidos modificados desde el cursor (no la tienda entera).
        const orderCalls = store.calls.slice(calls).filter((c) => c.url.includes('/wc/v3/orders'));
        expect(orderCalls.every((c) => c.url.includes('modified_after='))).toBe(true);

        const orderEvents = dispatcher.events.filter((e) => e.listId === st.lists.orders!.id);
        expect(orderEvents.map((e) => e.trigger).sort()).toEqual(['record_created', 'record_updated']);
        const upd = orderEvents.find((e) => e.trigger === 'record_updated')!;
        expect(upd.after![`f${fieldIds.orders!.estado}`]).toBe('refunded');
        expect(upd.before![`f${fieldIds.orders!.estado}`]).toBe('completed');
    });

    it('una tienda que IGNORA modified_after igual termina (pagina por número) sin duplicar', async () => {
        store.ignoreModifiedAfter = true;
        store.orders.push(orderFor({ customerId: 1, email: 'ana@x.co', lines: [{ product: 10, qty: 1, price: 20000 }] }));
        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.last_error).toBeNull();
        expect(st.progress.orders!.count).toBe(232);
        store.ignoreModifiedAfter = false;
    });

    it('la invitada que se registra ADOPTA su registro (no aparece duplicada)', async () => {
        store.customers.push(customer(4, 'Invitada', 'invitada@correo.co'));
        expect(await svc.runJob(tenantId, syncId, { full: true })).toBe(true);
        const customers = await rows(tenantId, st.lists.customers!.id);
        const email = `f${fieldIds.customers!.email}`;
        const hers = customers.filter((c) => String(c[email]).toLowerCase() === 'invitada@correo.co');
        expect(hers).toHaveLength(1);
        expect(hers[0]![`f${fieldIds.customers!.registrado}`]).toBe(true);
        // Las dos claves apuntan al mismo registro: los pedidos viejos de invitada siguen sumando ahí.
        const all = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(syncLinks).where(and(eq(syncLinks.syncId, syncId), eq(syncLinks.recordId, Number(hers[0]!.id)))),
        );
        expect(all.map((l) => l.externalId).sort()).toEqual(['email:invitada@correo.co', 'id:4']);
        // Una segunda vuelta completa no la vuelve a crear como invitada.
        expect(await svc.runJob(tenantId, syncId, { full: true })).toBe(true);
        expect((await rows(tenantId, st.lists.customers!.id)).length).toBe(customers.length);

        // Al revés: alguien CON cuenta compra sin iniciar sesión → va a su registro.
        store.orders.push(orderFor({ customerId: 0, email: 'BETO@x.co', lines: [{ product: 10, qty: 1, price: 20000 }] }));
        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        const now = await rows(tenantId, st.lists.customers!.id);
        expect(now.length).toBe(customers.length);
        st = await svc.status(tenantId, adminId, 'admin', connId);
        // Cuatro personas, aunque haya cinco claves (el conteo es de registros).
        expect(st.progress.customers!.count).toBe(4);
    });

    it('inventario: una venta baja el stock SIN tocar la fecha del producto y el pedido lo trae igual', async () => {
        // Lo que hace WooCommerce al vender una talla: baja el stock de la
        // variación; el producto padre no cambia de fecha → el incremental por
        // fecha jamás se enteraría. El pedido es la señal.
        store.variations[20]![0]!.stock_quantity = 2;
        store.products.find((p) => p.id === 10)!.stock_quantity = 40;
        const venta = orderFor({ customerId: 1, email: 'ana@x.co', lines: [{ product: 10, qty: 1, price: 20000 }, { product: 20, variation: 21, qty: 1, price: 30000 }] });
        venta.date_created_gmt = new Date().toISOString().slice(0, 19);
        store.orders.push(venta);
        const calls = store.calls.length;
        dispatcher.events.length = 0;
        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.last_error).toBeNull();
        const k = (resource: 'products' | 'variations', slug: string) => `f${fieldIds[resource]![slug]}`;
        const vars = await rows(tenantId, st.lists.variations!.id);
        const s21 = vars.find((r) => r[k('variations', 'woo_id')] === '21')!;
        expect(s21[k('variations', 'stock')]).toBe(2);
        expect(s21[k('variations', 'estado_inventario')]).toBe('bajo');
        const prods = await rows(tenantId, st.lists.products!.id);
        expect(prods.find((r) => r[k('products', 'woo_id')] === '10')![k('products', 'stock')]).toBe(40);
        // Pidió sólo lo vendido (por `include=`), no el catálogo entero.
        expect(store.calls.slice(calls).some((c) => c.url === 'include-variations:21')).toBe(true);
        // El cambio de stock dispara automatizaciones (p. ej. «Aviso de stock bajo»).
        expect(dispatcher.events.some((e) => e.recordId === Number(s21.id) && e.trigger === 'record_updated')).toBe(true);
        // Rotación: vendidas en 30 días y meses de cobertura (stock ÷ vendidas).
        const list = await recordsService.list(tenantId, { userId: adminId, role: 'admin' }, st.lists.variations!.slug, { limit: 10 } as never);
        const s21r = list.data.find((r) => r.id === Number(s21.id))!;
        expect(s21r.data[k('variations', 'vendidas_30d')]).toBe(1);
        expect(s21r.data[k('variations', 'cobertura_meses')]).toBe(2);
    });

    it('un campo de otro plugin se trae a una columna y se rellena en los registros existentes', async () => {
        queue.runs.length = 0;
        st = await svc.mapMeta(tenantId, adminId, 'admin', connId, { resource: 'products', key: 'garantia_meses', label: 'Garantía', type: 'number' });
        expect(queue.runs).toEqual([{ tenantId, syncId, opts: { full: true, only: ['products'] } }]);
        const mapped = st.meta_keys.products!.find((k) => k.key === 'garantia_meses')!;
        expect(mapped.field_id).not.toBeNull();
        expect(await svc.runJob(tenantId, syncId, { full: true, only: ['products'] })).toBe(true);
        const products = await rows(tenantId, st.lists.products!.id);
        expect(products.find((p) => p[`f${fieldIds.products!.nombre}`] === 'Taza')![`f${mapped.field_id}`]).toBe(12);
        // Dejar de traerla conserva la columna (los datos son de la empresa).
        st = await svc.unmapMeta(tenantId, adminId, 'admin', connId, { resource: 'products', key: 'garantia_meses' });
        expect(st.meta_keys.products!.find((k) => k.key === 'garantia_meses')!.field_id).toBeNull();
        expect((await fieldsService.listByListId(tenantId, st.lists.products!.id)).some((f) => f.id === mapped.field_id)).toBe(true);
    });

    it('pausar: el tick no la encola; reanudar sí', async () => {
        await svc.update(tenantId, adminId, 'admin', connId, { enabled: false });
        await pg.db.update(connectionSyncs).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(connectionSyncs.id, syncId));
        queue.runs.length = 0;
        await svc.tick();
        expect(queue.runs).toHaveLength(0);
        await svc.update(tenantId, adminId, 'admin', connId, { enabled: true });
        await pg.db.update(connectionSyncs).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(connectionSyncs.id, syncId));
        await svc.tick();
        expect(queue.runs.map((r) => r.syncId)).toEqual([syncId]);
    });

    // ── Fase 3: tiempo real + edición en los dos sentidos (v0.1.207) ──────────

    const hookOf = () => {
        const wh = store.webhooks[0]!;
        const token = String(wh.delivery_url).split('/').pop()!;
        return { token, secret: String(wh.secret) };
    };
    const deliver = async (topic: string, payload: Row, opts: { secret?: string; token?: string } = {}) => {
        const { token, secret } = hookOf();
        const raw = JSON.stringify(payload);
        const sig = createHmac('sha256', opts.secret ?? secret).update(raw).digest('base64');
        await realtime.receive(opts.token ?? token, { 'x-wc-webhook-topic': topic, 'x-wc-webhook-signature': sig }, raw, JSON.parse(raw));
    };

    it('tiempo real: con una clave de sólo lectura NO cambia de modo y dice por qué', async () => {
        store.readOnly = true;
        await expect(svc.update(tenantId, adminId, 'admin', connId, { mode: 'realtime' })).rejects.toThrow(/permiso de escritura/);
        st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.mode).toBe('interval');
        expect(store.webhooks).toHaveLength(0);
        store.readOnly = false;
    });

    it('tiempo real: registra un aviso por tema, firmado con un secreto propio', async () => {
        st = await svc.update(tenantId, adminId, 'admin', connId, { mode: 'realtime' });
        expect(st.mode).toBe('realtime');
        expect(st.realtime).toMatchObject({ active: true, webhooks: 10, error: null });
        expect(store.webhooks.map((w) => w.topic).sort()).toEqual(
            ['customer.created', 'customer.updated', 'order.created', 'order.deleted', 'order.restored', 'order.updated', 'product.created', 'product.deleted', 'product.restored', 'product.updated'],
        );
        const urls = new Set(store.webhooks.map((w) => w.delivery_url));
        expect(urls.size).toBe(1);
        expect([...urls][0]).toMatch(/^http:\/\/localhost:5174\/api\/v1\/public\/store-hooks\/[A-Za-z0-9_-]{32}$/);
        // El secreto viaja a la tienda pero en la base está cifrado.
        const [row] = await pg.db.select().from(storeHooks).where(eq(storeHooks.syncId, syncId));
        expect(row!.secretEnc).not.toContain(hookOf().secret);
    });

    it('recibir: ping ok, token desconocido 404, firma mala 401 — nada se escribe', async () => {
        const { token } = hookOf();
        await expect(realtime.receive(token, {}, 'webhook_id=5', { webhook_id: '5' })).resolves.toBeUndefined();
        await expect(realtime.receive('x'.repeat(32), { 'x-wc-webhook-topic': 'order.updated' }, '{}', {})).rejects.toThrow(/Not found/);
        const before = dispatcher.events.length;
        await expect(deliver('order.updated', { ...store.orders[0]!, status: 'cancelled' }, { secret: 'otro' })).rejects.toThrow(/Firma/);
        expect(dispatcher.events.length).toBe(before);
    });

    it('recibir: un pedido que cambia en la tienda se actualiza al instante y dispara automatizaciones', async () => {
        const order = store.orders[10]!;
        order.status = 'cancelled';
        touch(order);
        dispatcher.events.length = 0;
        await deliver('order.updated', order);
        const orders = await rows(tenantId, st.lists.orders!.id);
        const rec = orders.find((o) => o[`f${fieldIds.orders!.woo_id}`] === String(order.id))!;
        expect(rec[`f${fieldIds.orders!.estado}`]).toBe('cancelled');
        expect(dispatcher.events.some((e) => e.trigger === 'record_updated' && e.recordId === rec.id)).toBe(true);
        st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.realtime.received).toBe(1);
        expect(st.realtime.last_received_at).not.toBeNull();
    });

    it('recibir: una variación llega como product.updated y se reconoce; un borrado manda a la papelera sin borrar', async () => {
        const v = store.variations[20]![0]!;
        v.stock_quantity = 1;
        v.type = 'variation';
        touch(v);
        await deliver('product.updated', v);
        const vars = await rows(tenantId, st.lists.variations!.id);
        expect(vars.find((x) => x[`f${fieldIds.variations!.woo_id}`] === '21')![`f${fieldIds.variations!.stock}`]).toBe(1);

        await deliver('product.deleted', { id: 10 });
        const prods = await rows(tenantId, st.lists.products!.id);
        const taza = prods.find((x) => x[`f${fieldIds.products!.woo_id}`] === '10')!;
        expect(taza[`f${fieldIds.products!.estado}`]).toBe('trash');
        // Un borrado de algo que nunca se trajo no crea nada.
        await deliver('product.deleted', { id: 999 });
        expect((await rows(tenantId, st.lists.products!.id)).length).toBe(prods.length);
    });

    it('red de seguridad: un aviso desactivado se reactiva y uno borrado se vuelve a crear', async () => {
        store.webhooks[0]!.status = 'disabled';
        const gone = store.webhooks.pop()!;
        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        expect(store.webhooks).toHaveLength(10);
        expect(store.webhooks.every((w) => w.status === 'active')).toBe(true);
        expect(store.webhooks.some((w) => w.topic === gone.topic)).toBe(true);
    });

    it('edición en los dos sentidos: SÓLO lo que cambió viaja a la tienda, y sin rebote', async () => {
        const actor = { userId: adminId, role: 'admin' as const };
        const prods = await rows(tenantId, st.lists.products!.id);
        const camiseta = prods.find((x) => x[`f${fieldIds.products!.woo_id}`] === '20')!;
        // Apagada: editar no manda nada.
        queue.pushes.length = 0;
        await recordsService.update(tenantId, actor, st.lists.products!.slug, Number(camiseta.id), { data: { [`f${fieldIds.products!.precio_normal}`]: 31000 } } as never);
        await new Promise((r) => setTimeout(r, 100));
        expect(queue.pushes).toHaveLength(0);

        st = await svc.update(tenantId, adminId, 'admin', connId, { write_back: true });
        expect(st.write_back).toBe(true);
        const priceKey = `f${fieldIds.products!.precio_normal}`;
        await recordsService.update(tenantId, actor, st.lists.products!.slug, Number(camiseta.id), { data: { [priceKey]: 35000 } } as never);
        // El oyente de cambios es asíncrono (no frena la edición de la persona).
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        expect(queue.pushes[0]).toMatchObject({ syncId, resource: 'products', recordId: Number(camiseta.id), fieldIds: [fieldIds.products!.precio_normal] });

        const calls = store.calls.length;
        await realtime.processPush(queue.pushes[0]!);
        const put = store.calls.slice(calls).find((c) => c.method === 'PUT')!;
        expect(put.url).toContain('/wc/v3/products/20');
        // Sólo el precio: el stock (que la tienda pudo haber bajado) no se toca.
        expect(JSON.parse(put.body!)).toEqual({ regular_price: '35000' });
        expect(store.products.find((p) => p.id === 20)!.regular_price).toBe('35000');
        st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.write_back_status).toMatchObject({ pushed: 1, failed: 0, last_error: null });

        // El aviso que la tienda manda después no encuentra diferencias: nada rebota.
        dispatcher.events.length = 0;
        queue.pushes.length = 0;
        await deliver('product.updated', store.products.find((p) => p.id === 20)!);
        await new Promise((r) => setTimeout(r, 100));
        expect(dispatcher.events.filter((e) => e.recordId === Number(camiseta.id))).toHaveLength(0);
        expect(queue.pushes).toHaveLength(0);
    });

    it('edición en los dos sentidos: variaciones, clientes (no invitados) y un fallo visible', async () => {
        const actor = { userId: adminId, role: 'admin' as const };
        const vars = await rows(tenantId, st.lists.variations!.id);
        const s22 = vars.find((x) => x[`f${fieldIds.variations!.woo_id}`] === '22')!;
        queue.pushes.length = 0;
        await recordsService.update(tenantId, actor, st.lists.variations!.slug, Number(s22.id), { data: { [`f${fieldIds.variations!.stock}`]: 7 } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        const calls = store.calls.length;
        await realtime.processPush(queue.pushes[0]!);
        const put = store.calls.slice(calls).find((c) => c.method === 'PUT')!;
        expect(put.url).toContain('/wc/v3/products/20/variations/22');
        expect(JSON.parse(put.body!)).toEqual({ manage_stock: true, stock_quantity: 7 });

        // Cliente registrado: el teléfono va a la facturación; la invitada no tiene a quién.
        const customers = await rows(tenantId, st.lists.customers!.id);
        const email = `f${fieldIds.customers!.email}`;
        const beto = customers.find((c) => c[email] === 'beto@x.co')!;
        queue.pushes.length = 0;
        await recordsService.update(tenantId, actor, st.lists.customers!.slug, Number(beto.id), { data: { [`f${fieldIds.customers!.telefono}`]: '+573009998877' } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        const c2 = store.calls.length;
        await realtime.processPush(queue.pushes[0]!);
        const put2 = store.calls.slice(c2).find((c) => c.method === 'PUT')!;
        expect(put2.url).toContain('/wc/v3/customers/2');
        expect(JSON.parse(put2.body!)).toEqual({ billing: { phone: '+573009998877' } });

        // La tienda rechaza (clave sin escritura): queda contado y con el motivo.
        store.readOnly = true;
        queue.pushes.length = 0;
        await recordsService.update(tenantId, actor, st.lists.variations!.slug, Number(s22.id), { data: { [`f${fieldIds.variations!.stock}`]: 8 } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        await realtime.processPush(queue.pushes[0]!);
        store.readOnly = false;
        st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.write_back_status.failed).toBe(1);
        expect(st.write_back_status.last_error).toMatch(/permiso de escritura/);
    });

    it('volver a intervalos borra los avisos de la tienda y el token deja de valer', async () => {
        const { token } = hookOf();
        st = await svc.update(tenantId, adminId, 'admin', connId, { mode: 'interval', write_back: false });
        expect(st.mode).toBe('interval');
        expect(st.realtime.active).toBe(false);
        expect(store.webhooks).toHaveLength(0);
        await expect(realtime.receive(token, { 'x-wc-webhook-topic': 'order.updated' }, '{}', {})).rejects.toThrow(/Not found/);
    });

    // ── Reposición: órdenes de compra y «Sumar al stock» (v0.1.209) ──────────

    const admin = () => ({ userId: adminId, role: 'admin' as const });
    const settingsNow = async () => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)));
        return row!.settings as {
            fields: Record<string, Record<string, number>>;
            purchase_lists: Record<string, number>;
            purchase_fields: Record<string, Record<string, number>>;
        };
    };
    const recordOf = async (id: number) => {
        const [r] = await withTenant(pg.db, tenantId, (tx) => tx.select({ data: records.data }).from(records).where(eq(records.id, id)));
        return r!.data as Record<string, unknown>;
    };
    const byWooId = async (resource: 'products' | 'variations', woo: string) =>
        (await rows(tenantId, st.lists[resource]!.id)).find((r) => r[`f${fieldIds[resource]!.woo_id}`] === woo)!;
    const putsTo = (from: number, path: string) => store.calls.slice(from).filter((c) => c.method === 'PUT' && c.url.includes(path));

    it('reposición: crear una orden desde Variaciones con la cantidad sugerida; la línea se completa sola y «En camino» sube', async () => {
        const S = await settingsNow();
        const L = S.purchase_fields.lines!;
        const O = S.purchase_fields.orders!;
        const s21 = await byWooId('variations', '21');
        const preview = await purchasing.preview(tenantId, admin(), connId, { resource: 'variations', record_ids: [Number(s21.id)] });
        expect(preview).toHaveLength(1);
        const p = preview[0]!;
        // Sin alerta propia: la de la tienda (5). Un mes de venta + la alerta − lo que hay − lo que viene.
        expect(p.threshold).toBe(5);
        expect(p.suggested).toBe(Math.max(1, p.sold_30d + 5 - (p.stock ?? 0) - p.in_transit));
        expect(p.blocked).toBeNull();
        // Un producto con variaciones no se pide entero.
        const camiseta = await byWooId('products', '20');
        const [blocked] = await purchasing.preview(tenantId, admin(), connId, { resource: 'products', record_ids: [Number(camiseta.id)] });
        expect(blocked!.blocked).toMatch(/variaciones/);

        const made = await purchasing.createOrder(tenantId, admin(), connId, {
            resource: 'variations',
            items: [{ record_id: Number(s21.id), quantity: 10, cost: 12000 }],
            supplier_name: 'Textiles SA',
            status: 'enviada',
        });
        expect(made).toMatchObject({ order_number: 'OC-0001', lines: 1, warnings: [] });
        const order = await recordOf(made.order_id);
        expect(order[`f${O.estado}`]).toBe('enviada');
        expect(order[`f${O.fecha}`]).toBe(new Date().toISOString().slice(0, 10));
        const [line] = await recordsService
            .list(tenantId, admin(), String(S.purchase_lists.lines), { limit: 10, related_to: `${L.orden}:${made.order_id}` } as never)
            .then((r) => r.data);
        expect(line!.data[`f${L.articulo}`]).toMatch(/Camiseta/);
        expect(line!.data[`f${L.subtotal}`]).toBe(120000);
        expect(line!.data[`f${L.pendiente}`]).toBe(10);
        // La variación trae su producto padre: «En camino» del producto también la cuenta.
        expect(line!.relations?.[`f${L.producto}`]).toEqual([Number(camiseta.id)]);
        const vars = await recordsService.list(tenantId, admin(), st.lists.variations!.slug, { limit: 10, ids: String(s21.id) } as never);
        expect(vars.data[0]!.data[`f${fieldIds.variations!.en_camino}`]).toBe(10);
        const prods = await recordsService.list(tenantId, admin(), st.lists.products!.slug, { limit: 10, ids: String(camiseta.id) } as never);
        expect(prods.data[0]!.data[`f${fieldIds.products!.en_camino}`]).toBe(10);
        // El proveedor nuevo quedó vinculado.
        const [supplier] = await rows(tenantId, S.purchase_lists.suppliers!);
        expect(supplier![`f${S.purchase_fields.suppliers!.nombre}`]).toBe('Textiles SA');
    });

    it('reposición: recibir la orden SUMA en la tienda sobre el stock de ese momento; recibir de nuevo no suma dos veces', async () => {
        const S = await settingsNow();
        const L = S.purchase_fields.lines!;
        const O = S.purchase_fields.orders!;
        const [orderRow] = await rows(tenantId, S.purchase_lists.orders!);
        const orderId = Number(orderRow!.id);
        const v21 = store.variations[20]!.find((v) => v.id === 21)!;
        // Una venta que la app todavía no vio: la tienda tiene MENOS de lo que dice la app.
        v21.stock_quantity = 3;
        const calls = store.calls.length;
        await recordsService.update(tenantId, admin(), String(S.purchase_lists.orders), orderId, { data: { [`f${O.estado}`]: 'recibida' } } as never);
        await vi.waitFor(() => expect(v21.stock_quantity).toBe(13));
        const puts = putsTo(calls, '/products/20/variations/21');
        expect(puts).toHaveLength(1);
        expect(JSON.parse(puts[0]!.body!)).toEqual({ manage_stock: true, stock_quantity: 13 });
        await vi.waitFor(async () => expect((await recordOf(orderId))[`f${O.resultado}`]).toMatch(/Se sumaron 10 unidades/));
        const order = await recordOf(orderId);
        expect(typeof order[`f${O.recibida_el}`]).toBe('string');
        const lineId = (await rows(tenantId, S.purchase_lists.lines!))[0]!.id as number;
        const line = await recordOf(lineId);
        expect(line[`f${L.aplicada}`]).toBe(10);
        expect(line[`f${L.pendiente}`]).toBe(0);
        const s21 = await byWooId('variations', '21');
        expect(s21[`f${fieldIds.variations!.stock}`]).toBe(13);
        expect(s21[`f${fieldIds.variations!.ultimo_movimiento}`]).toBe('+10 por OC-0001 → stock 13');

        // Marcarla de nuevo (o ir y volver de estado) no suma otra vez.
        const again = store.calls.length;
        await recordsService.update(tenantId, admin(), String(S.purchase_lists.orders), orderId, { data: { [`f${O.estado}`]: 'recibida_parcial' } } as never);
        await recordsService.update(tenantId, admin(), String(S.purchase_lists.orders), orderId, { data: { [`f${O.estado}`]: 'recibida' } } as never);
        await new Promise((r) => setTimeout(r, 600));
        expect(putsTo(again, '/variations/21')).toHaveLength(0);
        expect(v21.stock_quantity).toBe(13);

        // Corregir lo recibido (llegaron 8, no 10) descuenta SÓLO la diferencia.
        await recordsService.update(tenantId, admin(), String(S.purchase_lists.lines), lineId, { data: { [`f${L.recibida}`]: 8 } } as never);
        await vi.waitFor(() => expect(v21.stock_quantity).toBe(11));
        await vi.waitFor(async () => expect((await recordOf(lineId))[`f${L.aplicada}`]).toBe(8));
    });

    it('reposición: «recibida en parte» suma sólo lo recibido; una variación con el stock en el padre suma en el producto', async () => {
        const S = await settingsNow();
        const L = S.purchase_fields.lines!;
        const O = S.purchase_fields.orders!;
        // Talla M lleva su stock en el producto (manage_stock: parent).
        const camiseta = store.products.find((p) => p.id === 20)!;
        camiseta.manage_stock = true;
        camiseta.stock_quantity = 3;
        // (la edición en dos sentidos de más arriba le había puesto stock propio)
        store.variations[20]!.find((v) => v.id === 22)!.manage_stock = 'parent';
        const v21 = store.variations[20]!.find((v) => v.id === 21)!;
        const start21 = Number(v21.stock_quantity);
        const s21 = await byWooId('variations', '21');
        const s22 = await byWooId('variations', '22');
        const made = await purchasing.createOrder(tenantId, admin(), connId, {
            resource: 'variations',
            items: [
                { record_id: Number(s21.id), quantity: 6 },
                { record_id: Number(s22.id), quantity: 6, cost: 9000 },
            ],
            status: 'enviada',
        });
        expect(made.order_number).toBe('OC-0002');
        const lines = (await recordsService.list(tenantId, admin(), String(S.purchase_lists.lines), { limit: 10, related_to: `${L.orden}:${made.order_id}` } as never)).data;
        const l21 = lines.find((l) => (l.relations?.[`f${L.variacion}`] ?? [])[0] === Number(s21.id))!;
        // El costo de la última compra se reusa si no se dice otro.
        expect(l21.data[`f${L.costo}`]).toBe(12000);

        await recordsService.update(tenantId, admin(), String(S.purchase_lists.lines), l21.id, { data: { [`f${L.recibida}`]: 2 } } as never);
        await recordsService.update(tenantId, admin(), String(S.purchase_lists.orders), made.order_id, { data: { [`f${O.estado}`]: 'recibida_parcial' } } as never);
        await vi.waitFor(() => expect(v21.stock_quantity).toBe(start21 + 2));
        expect(camiseta.stock_quantity).toBe(3); // la línea de M no tiene cantidad recibida: no se toca
        await vi.waitFor(async () => expect((await recordOf(l21.id))[`f${L.pendiente}`]).toBe(4));

        // Recibida entera: M (sin cantidad escrita) = lo pedido, y va al PRODUCTO.
        await recordsService.update(tenantId, admin(), String(S.purchase_lists.orders), made.order_id, { data: { [`f${O.estado}`]: 'recibida' } } as never);
        await vi.waitFor(() => expect(camiseta.stock_quantity).toBe(9));
        expect(v21.stock_quantity).toBe(start21 + 2); // lo escrito manda: llegaron 2
        const sm = await byWooId('variations', '22');
        await vi.waitFor(async () =>
            expect((await recordOf(Number(sm.id)))[`f${fieldIds.variations!.ultimo_movimiento}`]).toBe('+6 por OC-0002 (el stock lo lleva el producto) → stock 9'),
        );
    });

    it('«Sumar al stock»: suma sobre la tienda, vacía la celda y deja el movimiento; si la tienda rechaza, lo dice', async () => {
        const taza = store.products.find((p) => p.id === 10)!;
        taza.stock_quantity = 21; // la tienda vendió algo que la app todavía no vio
        const rec = await byWooId('products', '10');
        const sumar = `f${fieldIds.products!.sumar_stock}`;
        const mov = `f${fieldIds.products!.ultimo_movimiento}`;
        await recordsService.update(tenantId, admin(), st.lists.products!.slug, Number(rec.id), { data: { [sumar]: 7 } } as never);
        await vi.waitFor(() => expect(taza.stock_quantity).toBe(28));
        await vi.waitFor(async () => expect((await recordOf(Number(rec.id)))[mov]).toBe('+7 desde «Sumar al stock» → stock 28'));
        const after = await recordOf(Number(rec.id));
        expect(after[sumar]).toBeUndefined();
        expect(after[`f${fieldIds.products!.stock}`]).toBe(28);

        store.readOnly = true;
        await recordsService.update(tenantId, admin(), st.lists.products!.slug, Number(rec.id), { data: { [sumar]: 3 } } as never);
        await vi.waitFor(async () => expect((await recordOf(Number(rec.id)))[mov]).toMatch(/^No se pudo sumar 3: .*permiso/));
        store.readOnly = false;
        expect(taza.stock_quantity).toBe(28);
        expect((await recordOf(Number(rec.id)))[sumar]).toBeUndefined();
    });

    it('listado: `ids` y `related_to` traen filas concretas; un campo que no es relación de la lista se rechaza', async () => {
        const S = await settingsNow();
        const [first] = await rows(tenantId, S.purchase_lists.orders!);
        const page = await recordsService.list(tenantId, admin(), String(S.purchase_lists.lines), {
            limit: 50,
            related_to: `${S.purchase_fields.lines!.orden}:${first!.id}`,
        } as never);
        expect(page.data).toHaveLength(1);
        await expect(
            recordsService.list(tenantId, admin(), String(S.purchase_lists.lines), { limit: 50, related_to: `${S.purchase_fields.lines!.cantidad}:${first!.id}` } as never),
        ).rejects.toThrow(/relación/);
        const two = (await rows(tenantId, S.purchase_lists.lines!)).slice(0, 2).map((r) => r.id);
        const picked = await recordsService.list(tenantId, admin(), String(S.purchase_lists.lines), { limit: 50, ids: two.join(',') } as never);
        expect(picked.data.map((r) => r.id).sort()).toEqual([...two].sort());
    });

    it('actualización del pack: una sincronización creada ANTES del inventario recibe campos, vista y tablero solos', async () => {
        // Simula el pack 1 (v0.1.206): sin campos de inventario, sin vista ni tablero.
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)));
        const settings = row!.settings as Record<string, unknown> & { fields: Record<string, Record<string, number>> };
        for (const r of ['products', 'variations'] as const) {
            for (const slug of INVENTORY_FIELD_SLUGS) {
                const id = settings.fields[r]?.[slug];
                if (!id) continue;
                await fieldsService.remove(tenantId, String(st.lists[r]!.id), String(id));
                delete settings.fields[r]![slug];
            }
        }
        // El pack 1 guardaba las columnas de las tablas del tablero de ventas en `columns`.
        const [sales] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboards).where(eq(dashboards.id, st.dashboard_id!)));
        const oldWidgets = (sales!.widgets as Array<{ type: string; config: Record<string, unknown> }>).map((w) => {
            if (w.type !== 'table') return w;
            const { visible_field_ids, ...rest } = w.config;
            return { ...w, config: { ...rest, columns: visible_field_ids } };
        });
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.update(dashboards).set({ widgets: oldWidgets }).where(eq(dashboards.id, st.dashboard_id!));
            await tx.delete(savedViews).where(eq(savedViews.name, 'Para reponer'));
            await tx.delete(dashboards).where(eq(dashboards.id, st.inventory_dashboard_id!));
            await tx
                .update(connectionSyncs)
                .set({ settings: { ...settings, pack_version: 1, inventory_dashboard_id: null, low_stock_amount: null } })
                .where(eq(connectionSyncs.id, syncId));
        });
        queue.runs.length = 0;
        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        const [after] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)));
        const s2 = after!.settings as { pack_version: number; low_stock_amount: number; inventory_dashboard_id: number; fields: Record<string, Record<string, number>> };
        expect(s2.pack_version).toBe(3);
        expect(s2.low_stock_amount).toBe(5);
        expect(s2.inventory_dashboard_id).toBeGreaterThan(0);
        for (const slug of INVENTORY_FIELD_SLUGS) expect(s2.fields.products![slug], slug).toBeGreaterThan(0);
        const views = await withTenant(pg.db, tenantId, (tx) => tx.select().from(savedViews).where(eq(savedViews.name, 'Para reponer')));
        expect(views).toHaveLength(2);
        const [salesAfter] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboards).where(eq(dashboards.id, st.dashboard_id!)));
        for (const w of salesAfter!.widgets as Array<{ type: string; config: Record<string, unknown> }>) {
            if (w.type !== 'table') continue;
            expect(w.config.columns).toBeUndefined();
            expect((w.config.visible_field_ids as unknown[]).length).toBe(4);
        }
        // Encola la vuelta completa de productos que llena los campos nuevos.
        expect(queue.runs).toContainEqual({ tenantId, syncId, opts: { full: true, only: ['products'] } });
        expect(await svc.runJob(tenantId, syncId, { full: true, only: ['products'] })).toBe(true);
        const vars = await rows(tenantId, st.lists.variations!.id);
        expect(vars.every((v) => typeof v[`f${s2.fields.variations!.estado_inventario}`] === 'string')).toBe(true);
        // Una segunda vuelta no vuelve a actualizar nada.
        queue.runs.length = 0;
        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        expect(queue.runs).toHaveLength(0);
    });

    it('actualización del pack 2 → 3: una tienda conectada con inventario recibe las compras y «En camino» sola', async () => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)));
        const settings = row!.settings as Record<string, unknown> & {
            fields: Record<string, Record<string, number>>;
            purchase_lists: Record<string, number>;
            inventory_dashboard_id: number;
            folder_id: number;
        };
        // Simula el pack 2 (v0.1.208): sin listas de compras ni columnas de reposición.
        const oldEnCamino = [settings.fields.products!.en_camino, settings.fields.variations!.en_camino];
        for (const r of ['products', 'variations'] as const) {
            for (const slug of RESTOCK_FIELD_SLUGS) {
                const id = settings.fields[r]?.[slug];
                if (!id) continue;
                await fieldsService.remove(tenantId, String(st.lists[r]!.id), String(id));
                delete settings.fields[r]![slug];
            }
        }
        const oldPurchase = Object.values(settings.purchase_lists);
        const [inv] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboards).where(eq(dashboards.id, settings.inventory_dashboard_id)));
        const trimmed = (inv!.widgets as Array<{ type: string; config: Record<string, unknown> }>).map((w) =>
            w.type === 'table' ? { ...w, config: { ...w.config, visible_field_ids: (w.config.visible_field_ids as number[]).filter((x) => !oldEnCamino.includes(x)) } } : w,
        );
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.update(dashboards).set({ widgets: trimmed }).where(eq(dashboards.id, settings.inventory_dashboard_id));
            await tx.delete(lists).where(inArray(lists.id, oldPurchase));
            await tx
                .update(connectionSyncs)
                .set({ settings: { ...settings, pack_version: 2, purchase_lists: {}, purchase_fields: {} } })
                .where(eq(connectionSyncs.id, syncId));
        });
        const tablesBefore = (trimmed as Array<{ type: string; config: { visible_field_ids?: number[] } }>).filter((w) => w.type === 'table');
        const lenBefore = tablesBefore.map((w) => w.config.visible_field_ids!.length);

        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        const [after] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)));
        const s3 = after!.settings as {
            pack_version: number;
            fields: Record<string, Record<string, number>>;
            purchase_lists: Record<string, number>;
            purchase_fields: Record<string, Record<string, number>>;
        };
        expect(s3.pack_version).toBe(3);
        for (const slug of RESTOCK_FIELD_SLUGS) expect(s3.fields.variations![slug], slug).toBeGreaterThan(0);
        expect(Object.keys(s3.purchase_lists).sort()).toEqual(['lines', 'orders', 'suppliers']);
        expect(s3.purchase_fields.lines!.pendiente).toBeGreaterThan(0);
        // Las listas nuevas nacen en la carpeta de la tienda, con su marca.
        const newLists = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ id: lists.id, groupId: lists.groupId, settings: lists.settings }).from(lists).where(inArray(lists.id, Object.values(s3.purchase_lists))),
        );
        expect(newLists.every((l) => l.groupId === settings.folder_id)).toBe(true);
        expect(newLists.map((l) => (l.settings as { store_sync?: { role: string } }).store_sync?.role).sort()).toEqual(['purchase_lines', 'purchase_orders', 'suppliers']);
        // Las tablas «para reponer» del tablero de inventario suman «En camino».
        const [invAfter] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(dashboards).where(eq(dashboards.id, settings.inventory_dashboard_id)));
        const tablesAfter = (invAfter!.widgets as Array<{ type: string; list_id: number; config: { visible_field_ids: number[] } }>).filter((w) => w.type === 'table');
        tablesAfter.forEach((w, i) => {
            expect(w.config.visible_field_ids.length).toBe(lenBefore[i]! + 1);
            const res = w.list_id === st.lists.products!.id ? 'products' : 'variations';
            expect(w.config.visible_field_ids).toContain(s3.fields[res]!.en_camino);
        });
        // Idempotente.
        queue.runs.length = 0;
        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        expect(queue.runs).toHaveLength(0);
    });

    it('otra empresa no ve la sincronización ni sus vínculos (RLS)', async () => {
        const syncs = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(connectionSyncs));
        const links = await withTenant(pg.db, otherTenant, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(syncLinks));
        expect(syncs).toHaveLength(0);
        expect(links[0]!.n).toBe(0);
        // Y ni siquiera puede pedir el estado con un id ajeno.
        await expect(svc.status(otherTenant, adminId, 'admin', connId)).rejects.toThrow();
    });

    it('el límite de registros del plan corta la importación con un motivo claro (sin dejar nada a medias)', async () => {
        await withTenant(pg.db, otherTenant, (tx) => tx.insert(memberships).values({ tenantId: otherTenant, userId: adminId, role: 'admin' }));
        await pg.db.update(tenants).set({ plan: 'mini' }).where(eq(tenants.id, otherTenant));
        seedStore(40);
        const c2 = await connect(otherTenant);
        const s2 = await svc.setup(otherTenant, adminId, 'admin', c2, {
            resources: { customers: true, products: true, orders: true },
            orders_since: null,
            mode: 'interval',
            interval_minutes: 60,
        });
        const id2 = await syncIdOf(otherTenant, c2);
        await svc.runJob(otherTenant, id2, { full: true });
        const after = await svc.status(otherTenant, adminId, 'admin', c2);
        expect(after.last_error).toMatch(/plan/i);
        expect(after.initial_done).toBe(false);
        expect(after.running).toBe(false);
        // Nunca más registros que el límite.
        const total = await withTenant(pg.db, otherTenant, (tx) =>
            tx.select({ n: sql<number>`count(*)::int` }).from(records).innerJoin(lists, eq(lists.id, records.listId)).where(isNull(records.deletedAt)),
        );
        expect(total[0]!.n).toBeLessThanOrEqual(30);
        void s2;
    });

    it('dejar de sincronizar conserva las listas y sus datos', async () => {
        const productsList = st.lists.products!.id;
        await svc.remove(tenantId, adminId, 'admin', connId);
        expect((await svc.status(tenantId, adminId, 'admin', connId)).configured).toBe(false);
        expect((await rows(tenantId, productsList)).length).toBe(2);
        const links = await withTenant(pg.db, tenantId, (tx) => tx.select().from(syncLinks).where(eq(syncLinks.syncId, syncId)));
        expect(links).toHaveLength(0);
    });
});
