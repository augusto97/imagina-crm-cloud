import { and, eq, isNull, sql } from 'drizzle-orm';
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
    terms: { categories: [] as Row[], tags: [] as Row[] },
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
                const tax = /^\/products\/(categories|tags)$/.exec(p);
                if (tax && method === 'POST') {
                    const list = store.terms[tax[1] as 'categories' | 'tags'];
                    if (list.some((t) => String(t.name).toLowerCase() === String(input.name).toLowerCase())) {
                        return { status: 400, body: '{"code":"term_exists","message":"Ya existe un término con ese nombre."}', headers: {} };
                    }
                    const t = { id: store.nextId++, name: input.name, slug: input.slug ?? String(input.name).toLowerCase() };
                    list.push(t);
                    return { status: 201, body: JSON.stringify(t), headers: {} };
                }
                const apply = (o: Row | undefined) => {
                    if (!o) return { status: 404, body: '{"code":"not_found","message":"ID no válido"}', headers: {} };
                    const { billing, meta_data, categories, tags, ...rest } = input as Row & { billing?: Row; meta_data?: Row[]; categories?: Row[]; tags?: Row[] };
                    if (typeof rest.sku === 'string' && rest.sku !== '') {
                        const all = [...store.products, ...Object.values(store.variations).flat()];
                        if (all.some((x) => x !== o && x.sku === rest.sku)) {
                            return { status: 400, body: '{"code":"product_invalid_sku","message":"SKU no válido o duplicado."}', headers: {} };
                        }
                    }
                    if (typeof rest.slug === 'string') {
                        // Como WordPress: limpia y hace único (`taza-2`).
                        let clean = rest.slug.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                        const taken = (v: string) => store.products.some((x) => x !== o && x.slug === v);
                        let n = 2;
                        const base = clean;
                        while (taken(clean)) clean = `${base}-${n++}`;
                        rest.slug = clean;
                        o.permalink = `https://tienda.test/producto/${clean}/`;
                    }
                    if (categories) o.categories = categories.map((c) => store.terms.categories.find((t) => t.id === c.id)).filter(Boolean);
                    if (tags) o.tags = tags.map((c) => store.terms.tags.find((t) => t.id === c.id)).filter(Boolean);
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
            const taxGet = /^\/products\/(categories|tags)$/.exec(path);
            if (taxGet) {
                let list = store.terms[taxGet[1] as 'categories' | 'tags'];
                if (q.get('slug')) list = list.filter((t) => t.slug === q.get('slug'));
                if (q.get('search')) list = list.filter((t) => String(t.name).toLowerCase().includes(q.get('search')!.toLowerCase()));
                return page(list);
            }
            const oneCustomer = /^\/customers\/(\d+)$/.exec(path);
            if (oneCustomer) {
                const hit = store.customers.find((x) => x.id === Number(oneCustomer[1]));
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
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { ImportService } from '../src/import/import.service';
import { automationRuns, automations, connectionSyncs, dashboards, lists, plans, records, relations, savedViews, storeHooks, syncLinks, tenants, users, memberships } from '../src/db/schema';
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
    store.terms = {
        categories: [
            { id: 16, name: 'Cocina', slug: 'cocina' },
            { id: 17, name: 'Ropa', slug: 'ropa' },
        ],
        tags: [{ id: 19, name: 'Regalo', slug: 'regalo' }],
    };
    store.customers = [customer(1, 'Ana', 'ana@x.co'), customer(2, 'Beto', 'beto@x.co'), customer(3, 'Caro', 'caro@x.co')];
    store.products = [
        { id: 10, name: 'Taza', slug: 'taza', type: 'simple', status: 'publish', price: '20000', regular_price: '20000', manage_stock: true, stock_quantity: 50, stock_status: 'instock', categories: [{ id: 16, name: 'Cocina', slug: 'cocina' }], tags: [{ id: 19, name: 'Regalo', slug: 'regalo' }], date_modified_gmt: tick(), meta_data: [{ key: 'garantia_meses', value: '12' }, { key: '_edit_lock', value: 'x' }] },
        { id: 20, name: 'Camiseta', slug: 'camiseta', type: 'variable', status: 'publish', price: '30000', stock_status: 'instock', categories: [{ id: 17, name: 'Ropa', slug: 'ropa' }], date_modified_gmt: tick(), meta_data: [] },
    ];
    store.variations = {
        20: [
            // S: stock 5 con el umbral general de la tienda (5) → stock bajo.
            { id: 21, parent_id: 20, sku: 'CAM-S', permalink: 'https://tienda.test/camiseta/?attribute_talla=S', price: '30000', manage_stock: true, stock_quantity: 5, stock_status: 'instock', attributes: [{ name: 'Talla', option: 'S' }], date_modified_gmt: tick(), meta_data: [] },
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
    let aggregate: AggregateService;
    let importer: ImportService;
    let listsSvc: ListsService;
    let dispatcher: CapturingDispatcher;
    let queue: CapturingQueue;
    let realtime: StoreRealtimeService;
    let tenantId: number;
    let otherTenant: number;
    let adminId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        rds = await startRedis();
        redis = new Redis(rds.url);
        tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.test' });
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
        aggregate = new AggregateService(tenantDb, listsService, fieldsService);
        importer = new ImportService(tenantDb, listsService, fieldsService, new RecordsRepository(), billing, rt);
        listsSvc = listsService;
        const engine = new StoreSyncEngine(tenantDb, fieldsService, billing, rt, dispatcher, activity, redis);
        queue = new CapturingQueue();
        realtime = new StoreRealtimeService(tenantDb, pg.db, env, engine, queue);
        svc = new StoreSyncService(tenantDb, pg.db, connectors, blueprints, listsService, new ListGroupsService(tenantDb), fieldsService, audit, engine, queue, realtime);
        realtime.setCredsResolver((t, s) => svc.credsForSync(t, s));
        hub.subscribe((c) => realtime.onRecordChange(c));

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


    /** Filas de primer nivel (pedidos, productos) y subtareas (líneas, variaciones). */
    async function tree(tId: number, listId: number) {
        const all = await withTenant(pg.db, tId, (tx) =>
            tx
                .select({ id: records.id, parentId: records.parentId, data: records.data })
                .from(records)
                .where(and(eq(records.listId, listId), isNull(records.deletedAt))),
        );
        type TreeRow = Record<string, unknown> & { id: number; parentId: number | null };
        const flat = (r: (typeof all)[number]): TreeRow => ({ ...(r.data as Record<string, unknown>), id: r.id, parentId: r.parentId });
        return {
            roots: all.filter((r) => r.parentId === null).map(flat),
            children: all.filter((r) => r.parentId !== null).map(flat),
        };
    }

    let connId: number;
    let syncId: number;
    let st: Awaited<ReturnType<StoreSyncService['status']>>;
    let F: Record<string, Record<string, number>>;
    const k = (resource: string, slug: string) => `f${F[resource]![slug]}`;
    const admin = () => ({ userId: adminId, role: 'admin' as const });

    it('alta: carpeta con TRES listas (variaciones y líneas viven en su padre), dos tableros y la marca de cada lista', async () => {
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
        expect(st.lists.variations!.id).toBe(st.lists.products!.id);
        expect(st.lists.line_items!.id).toBe(st.lists.orders!.id);
        const inFolder = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: lists.id }).from(lists).where(eq(lists.groupId, st.folder_id!)));
        expect(inFolder).toHaveLength(3);
        expect(st.dashboard_id).not.toBeNull();
        expect(st.inventory_dashboard_id).not.toBeNull();
        const reponer = await withTenant(pg.db, tenantId, (tx) => tx.select().from(savedViews).where(eq(savedViews.name, 'Para reponer')));
        expect(reponer).toHaveLength(1);
        expect(queue.runs).toEqual([{ tenantId, syncId, opts: { full: true } }]);

        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)));
        F = (row!.settings as { fields: Record<string, Record<string, number>> }).fields;
        expect(F.variations).toEqual(F.products);
        expect(F.line_items).toEqual(F.orders);
        // Cada lista lleva su marca: qué columnas son de la tienda y si se edita desde la app.
        const marked = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: lists.id, settings: lists.settings }).from(lists));
        const marker = (id: number) => (marked.find((l) => l.id === id)!.settings as { store_sync?: Record<string, unknown> }).store_sync;
        expect(marker(st.lists.products!.id)).toMatchObject({ connection_id: connId, role: 'products', write_back: false, fields: F.products });
        expect(marker(st.lists.orders!.id)).toMatchObject({ role: 'orders' });
        const precio = await fieldsService.listByListId(tenantId, st.lists.products!.id);
        expect(precio.find((f) => f.slug === 'precio')!.config).toMatchObject({ currency: 'COP', precision: 0 });
        await expect(
            svc.setup(tenantId, adminId, 'admin', connId, { resources: { customers: true, products: true, orders: true }, orders_since: null, mode: 'interval', interval_minutes: 15 }),
        ).rejects.toThrow();
    });

    it('importación inicial: variaciones como SUBTAREAS del producto y líneas como SUBTAREAS del pedido — sin disparar automatizaciones', async () => {
        expect(await svc.runJob(tenantId, syncId, { full: true })).toBe(true);
        st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.last_error).toBeNull();
        expect(st.initial_done).toBe(true);
        expect(st.progress.customers!.count).toBe(4);
        expect(st.progress.products!.count).toBe(2);
        expect(st.progress.variations!.count).toBe(2);
        expect(st.progress.orders!.count).toBe(230);
        expect(st.progress.line_items!.count).toBe(173 * 2 + 57);
        expect(dispatcher.events).toHaveLength(0);

        const products = await tree(tenantId, st.lists.products!.id);
        expect(products.roots).toHaveLength(2);
        const camiseta = products.roots.find((r) => r[k('products', 'woo_id')] === '20')!;
        // Las dos tallas cuelgan de la camiseta.
        expect(products.children.map((c) => [c.parentId, c[k('products', 'nombre')], c[k('products', 'tipo')]]).sort()).toEqual([
            [camiseta.id, 'Camiseta — M', 'variacion'],
            [camiseta.id, 'Camiseta — S', 'variacion'],
        ]);
        const orders = await tree(tenantId, st.lists.orders!.id);
        expect(orders.roots).toHaveLength(230);
        expect(orders.children).toHaveLength(173 * 2 + 57);
        expect(orders.roots.every((o) => o[k('orders', 'tipo')] === 'pedido')).toBe(true);
        expect(orders.children.every((l) => l[k('orders', 'tipo')] === 'linea')).toBe(true);
        // La línea de una talla apunta al producto Y a la variación.
        const rel = await withTenant(pg.db, tenantId, (tx) => tx.select().from(relations).where(eq(relations.fieldId, F.orders!.producto!)));
        expect(rel.length).toBe(173 * 2 + 57 + 173);

        // Rollups: la camiseta suma TODAS sus tallas y cada talla las suyas.
        const res = await recordsService.list(tenantId, admin(), st.lists.products!.slug, { limit: 10, include_subtasks: true } as never);
        const byWoo = (w: string) => res.data.find((r) => r.data[k('products', 'woo_id')] === w)!;
        expect(byWoo('10').data[k('products', 'unidades_vendidas')]).toBe(173 * 2 + 57);
        expect(byWoo('20').data[k('products', 'unidades_vendidas')]).toBe(173);
        expect(Number(byWoo('21').data[k('products', 'unidades_vendidas')]) + Number(byWoo('22').data[k('products', 'unidades_vendidas')])).toBe(173);
        const cl = await recordsService.list(tenantId, admin(), st.lists.customers!.slug, { limit: 10 } as never);
        const guest = cl.data.find((r) => String(r.data[k('customers', 'email')]).toLowerCase() === 'invitada@correo.co')!;
        // Suma PEDIDOS (las líneas no tienen cliente y además se filtra por tipo).
        expect(guest.data[k('customers', 'total_comprado')]).toBe(57 * 20000);
        expect(guest.data[k('customers', 'pedidos')]).toBe(57);

        // Inventario: la camiseta es el RESUMEN de sus tallas (S=5 → bajo, M=0 → agotado).
        expect(camiseta[k('products', 'stock')]).toBe(5);
        expect(camiseta[k('products', 'estado_inventario')]).toBe('bajo');
        expect(camiseta[k('products', 'valor_inventario')]).toBe(5 * 30000);
        const taza = products.roots.find((r) => r[k('products', 'woo_id')] === '10')!;
        expect(taza[k('products', 'estado_inventario')]).toBe('en_stock');
        expect(taza[k('products', 'valor_inventario')]).toBe(50 * 20000);
        const m22 = products.children.find((r) => r[k('products', 'woo_id')] === '22')!;
        expect(m22[k('products', 'estado_inventario')]).toBe('agotado');
        expect(m22[k('products', 'controla_stock')]).toBe(true);

        const keys = st.meta_keys.products ?? [];
        expect(keys.find((x) => x.key === 'garantia_meses')).toMatchObject({ private: false, suggested_type: 'number', field_id: null });
    });

    it('el listado muestra sólo el primer nivel (con cuántas subtareas tiene); el pie y los grupos cuentan lo que se ve', async () => {
        const page = await recordsService.list(tenantId, admin(), st.lists.orders!.slug, { limit: 5, with_total: true } as never);
        expect(page.meta.total).toBe(230);
        expect(page.data.every((r) => (r.subtask_count ?? 0) >= 1)).toBe(true);
        // El pie suma los TOTALES de los pedidos, no pedidos + líneas.
        const foot = await aggregate.footer(tenantId, st.lists.orders!.slug, { fieldIds: [F.orders!.total!] });
        const expected = store.orders.reduce((sum, o) => sum + Number(o.total), 0);
        expect(foot.totals.total!.sum).toBe(expected);
        // Agrupar por estado cuenta pedidos.
        const g = await aggregate.run(tenantId, st.lists.orders!.slug, { metric: 'count', group_by_field_id: F.orders!.estado }, { rootsOnly: true });
        expect(g.groups!.reduce((sum, x) => sum + Number(x.value), 0)).toBe(230);
    });

    it('re-correr no duplica nada', async () => {
        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        expect(await svc.runJob(tenantId, syncId, { full: true })).toBe(true);
        const orders = await tree(tenantId, st.lists.orders!.id);
        expect(orders.roots).toHaveLength(230);
        expect(orders.children).toHaveLength(173 * 2 + 57);
        expect((await tree(tenantId, st.lists.products!.id)).children).toHaveLength(2);
        expect(dispatcher.events).toHaveLength(0);
    });

    it('incremental: trae lo modificado, saca la línea que el pedido ya no tiene y dispara las automatizaciones', async () => {
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
        expect(st.progress.line_items!.count).toBe(173 * 2 + 57);
        const orderCalls = store.calls.slice(calls).filter((c) => c.url.includes('/wc/v3/orders'));
        expect(orderCalls.every((c) => c.url.includes('modified_after='))).toBe(true);
        // La línea nueva cuelga del pedido nuevo, y la del pedido editado copia su estado.
        const orders = await tree(tenantId, st.lists.orders!.id);
        const freshRec = orders.roots.find((o) => o[k('orders', 'woo_id')] === String(fresh.id))!;
        const freshLines = orders.children.filter((l) => l.parentId === freshRec.id);
        expect(freshLines).toHaveLength(1);
        expect(freshLines[0]![k('orders', 'cantidad')]).toBe(3);
        const editedRec = orders.roots.find((o) => o[k('orders', 'woo_id')] === String(edited.id))!;
        const editedLines = orders.children.filter((l) => l.parentId === editedRec.id);
        expect(editedLines).toHaveLength(1);
        expect(editedLines[0]![k('orders', 'estado')]).toBe('refunded');

        const orderEvents = dispatcher.events.filter((e) => e.listId === st.lists.orders!.id && e.after?.[k('orders', 'tipo')] === 'pedido');
        expect(orderEvents.map((e) => e.trigger).sort()).toEqual(['record_created', 'record_updated']);
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
        const email = k('customers', 'email');
        const hers = customers.filter((c) => String(c[email]).toLowerCase() === 'invitada@correo.co');
        expect(hers).toHaveLength(1);
        expect(hers[0]![k('customers', 'registrado')]).toBe(true);
        expect(await svc.runJob(tenantId, syncId, { full: true })).toBe(true);
        expect((await rows(tenantId, st.lists.customers!.id)).length).toBe(customers.length);
        st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.progress.customers!.count).toBe(4);
    });

    it('inventario: una venta baja el stock de la talla y el producto recalcula su resumen', async () => {
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
        const products = await tree(tenantId, st.lists.products!.id);
        const s21 = products.children.find((r) => r[k('products', 'woo_id')] === '21')!;
        expect(s21[k('products', 'stock')]).toBe(2);
        expect(s21[k('products', 'estado_inventario')]).toBe('bajo');
        const camiseta = products.roots.find((r) => r[k('products', 'woo_id')] === '20')!;
        expect(camiseta[k('products', 'stock')]).toBe(2);
        expect(products.roots.find((r) => r[k('products', 'woo_id')] === '10')![k('products', 'stock')]).toBe(40);
        expect(store.calls.slice(calls).some((c) => c.url === 'include-variations:21')).toBe(true);
        expect(dispatcher.events.some((e) => e.recordId === Number(s21.id) && e.trigger === 'record_updated')).toBe(true);
        // El resumen del padre NO dispara automatizaciones (ya lo hizo la talla).
        expect(dispatcher.events.some((e) => e.recordId === Number(camiseta.id))).toBe(false);
        const list = await recordsService.list(tenantId, admin(), st.lists.products!.slug, { limit: 10, parent: camiseta.id } as never);
        const s21r = list.data.find((r) => r.id === Number(s21.id))!;
        expect(s21r.data[k('products', 'vendidas_30d')]).toBe(1);
        expect(s21r.data[k('products', 'cobertura_meses')]).toBe(2);
    });

    it('un campo de otro plugin se trae a una columna (de sólo lectura) y se rellena', async () => {
        queue.runs.length = 0;
        st = await svc.mapMeta(tenantId, adminId, 'admin', connId, { resource: 'products', key: 'garantia_meses', label: 'Garantía', type: 'number' });
        expect(queue.runs).toEqual([{ tenantId, syncId, opts: { full: true, only: ['products'] } }]);
        const mapped = st.meta_keys.products!.find((x) => x.key === 'garantia_meses')!;
        expect(await svc.runJob(tenantId, syncId, { full: true, only: ['products'] })).toBe(true);
        const products = await rows(tenantId, st.lists.products!.id);
        const taza = products.find((p) => p[k('products', 'nombre')] === 'Taza')!;
        expect(taza[`f${mapped.field_id}`]).toBe(12);
        await expect(
            recordsService.update(tenantId, admin(), st.lists.products!.slug, Number(taza.id), { data: { [`f${mapped.field_id}`]: 24 } } as never),
        ).rejects.toThrow(/Viene de WooCommerce/);
        // Dejar de traerla: la columna queda y pasa a ser propia (editable).
        st = await svc.unmapMeta(tenantId, adminId, 'admin', connId, { resource: 'products', key: 'garantia_meses' });
        await recordsService.update(tenantId, admin(), st.lists.products!.slug, Number(taza.id), { data: { [`f${mapped.field_id}`]: 24 } } as never);
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

    // ── Lo que WooCommerce no permitiría (v0.1.213) ───────────────────────────

    it('no se crean, borran ni importan registros en una lista de la tienda', async () => {
        await expect(
            recordsService.create(tenantId, admin(), st.lists.products!.slug, { data: { [k('products', 'nombre')]: 'Nuevo' } } as never),
        ).rejects.toThrow(/se crean en WooCommerce/);
        const [one] = await rows(tenantId, st.lists.orders!.id);
        await expect(recordsService.remove(tenantId, admin(), st.lists.orders!.slug, Number(one!.id))).rejects.toThrow(/se borran en WooCommerce/);
        const bulk = await recordsService.bulk(tenantId, admin(), st.lists.orders!.slug, 'delete', [Number(one!.id)], {});
        expect(bulk.succeeded).toHaveLength(0);
        await expect(importer.preview(tenantId, st.lists.customers!.slug, 'nombre\nX')).rejects.toThrow(/importar/);
    });

    it('columnas: las de la tienda sólo cambian de nombre; las propias son libres', async () => {
        const products = st.lists.products!.slug;
        await expect(fieldsService.remove(tenantId, products, String(F.products!.sku))).rejects.toThrow(/no se puede borrar/);
        await expect(fieldsService.update(tenantId, products, String(F.products!.sku), { type: 'long_text' } as never)).rejects.toThrow(/sólo se le puede cambiar el nombre/);
        await expect(fieldsService.update(tenantId, products, String(F.products!.sku), { slug: 'otro' } as never)).rejects.toThrow(/sólo se le puede cambiar el nombre/);
        const renamed = await fieldsService.update(tenantId, products, String(F.products!.sku), { label: 'Código' } as never);
        expect(renamed.label).toBe('Código');
        // Una columna propia (sólo en Imagina) se crea, se edita y se borra libre.
        const own = await fieldsService.create(tenantId, products, { label: 'Notas internas', type: 'text' } as never);
        const [taza] = (await rows(tenantId, st.lists.products!.id)).filter((r) => r[k('products', 'woo_id')] === '10');
        await recordsService.update(tenantId, admin(), products, Number(taza!.id), { data: { [`f${own.id}`]: 'revisar' } } as never);
        await fieldsService.remove(tenantId, products, String(own.id));
    });

    it('una automatización respeta las mismas reglas: saltea lo que se edita en WooCommerce y no crea registros de la tienda', async () => {
        const products = st.lists.products!;
        const own = await fieldsService.create(tenantId, products.slug, { label: 'Revisión', type: 'text' } as never);
        const [auto] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(automations)
                .values({
                    tenantId,
                    listId: products.id,
                    name: 'Marcar',
                    triggerType: 'record_updated',
                    actions: [
                        // «Editar desde la app» está apagado: el precio se saltea, la columna propia no.
                        { type: 'update_field', config: { values: { precio_normal: '1', [own.slug]: 'ok' } } },
                        { type: 'create_record', config: { target_list: st.lists.orders!.id, values: {} } },
                    ] as never,
                })
                .returning(),
        );
        const engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            null as never,
            connectors,
        );
        const taza = (await tree(tenantId, products.id)).roots.find((x) => x[k('products', 'woo_id')] === '10')!;
        const before = { ...taza };
        const ordersBefore = (await rows(tenantId, st.lists.orders!.id)).length;
        await engine.process({ tenantId, listId: products.id, recordId: Number(taza.id), trigger: 'record_updated', before, after: before });
        const after = (await tree(tenantId, products.id)).roots.find((x) => x.id === taza.id)!;
        expect(after[`f${own.id}`]).toBe('ok');
        expect(after[k('products', 'precio_normal')]).toBe(taza[k('products', 'precio_normal')]);
        expect((await rows(tenantId, st.lists.orders!.id)).length).toBe(ordersBefore);
        const [run] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto!.id)),
        );
        const log = JSON.stringify(run!.actionsLog);
        expect(log).toMatch(/precio_normal \(/);
        expect(log).toMatch(/se crean en WooCommerce/);
        await withTenant(pg.db, tenantId, (tx) => tx.delete(automations).where(eq(automations.id, auto!.id)));
        await fieldsService.remove(tenantId, products.slug, String(own.id));
    });

    // ── Tiempo real + edición en los dos sentidos ─────────────────────────────

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
        store.readOnly = false;
    });

    it('tiempo real: registra un aviso por tema; ping ok, token desconocido 404, firma mala 401', async () => {
        st = await svc.update(tenantId, adminId, 'admin', connId, { mode: 'realtime' });
        expect(st.realtime).toMatchObject({ active: true, webhooks: 10, error: null });
        const [row] = await pg.db.select().from(storeHooks).where(eq(storeHooks.syncId, syncId));
        expect(row!.secretEnc).not.toContain(hookOf().secret);
        const { token } = hookOf();
        await expect(realtime.receive(token, {}, 'webhook_id=5', { webhook_id: '5' })).resolves.toBeUndefined();
        await expect(realtime.receive('x'.repeat(32), { 'x-wc-webhook-topic': 'order.updated' }, '{}', {})).rejects.toThrow(/Not found/);
        await expect(deliver('order.updated', { ...store.orders[0]!, status: 'cancelled' }, { secret: 'otro' })).rejects.toThrow(/Firma/);
    });

    it('recibir: un pedido nuevo llega con sus líneas como subtareas; una talla recalcula su producto; un borrado va a la papelera', async () => {
        const nuevo = orderFor({ customerId: 3, email: 'caro@x.co', lines: [{ product: 20, variation: 21, qty: 2, price: 30000 }] });
        store.orders.push(nuevo);
        await deliver('order.created', nuevo);
        const orders = await tree(tenantId, st.lists.orders!.id);
        const rec = orders.roots.find((o) => o[k('orders', 'woo_id')] === String(nuevo.id))!;
        expect(orders.children.filter((l) => l.parentId === rec.id)).toHaveLength(1);

        const v = store.variations[20]![0]!;
        v.stock_quantity = 9;
        v.type = 'variation';
        touch(v);
        await deliver('product.updated', v);
        const products = await tree(tenantId, st.lists.products!.id);
        expect(products.children.find((x) => x[k('products', 'woo_id')] === '21')![k('products', 'stock')]).toBe(9);
        expect(products.roots.find((x) => x[k('products', 'woo_id')] === '20')![k('products', 'stock')]).toBe(9);

        await deliver('product.deleted', { id: 10 });
        const after = await tree(tenantId, st.lists.products!.id);
        expect(after.roots.find((x) => x[k('products', 'woo_id')] === '10')![k('products', 'estado')]).toBe('trash');
        await deliver('product.deleted', { id: 999 });
        expect((await tree(tenantId, st.lists.products!.id)).roots.length).toBe(after.roots.length);
    });

    it('red de seguridad: un aviso desactivado se reactiva y uno borrado se vuelve a crear', async () => {
        store.webhooks[0]!.status = 'disabled';
        const gone = store.webhooks.pop()!;
        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        expect(store.webhooks).toHaveLength(10);
        expect(store.webhooks.some((w) => w.topic === gone.topic)).toBe(true);
    });

    it('editar desde la app: apagado todo es de sólo lectura; prendido, sólo precios, stock y estados — y viajan', async () => {
        const products = st.lists.products!.slug;
        const tree0 = await tree(tenantId, st.lists.products!.id);
        const taza = tree0.roots.find((x) => x[k('products', 'woo_id')] === '10')!;
        const camiseta = tree0.roots.find((x) => x[k('products', 'woo_id')] === '20')!;
        const s21 = tree0.children.find((x) => x[k('products', 'woo_id')] === '21')!;
        // Apagado: ni el precio.
        await expect(
            recordsService.update(tenantId, admin(), products, Number(taza.id), { data: { [k('products', 'precio_normal')]: 21000 } } as never),
        ).rejects.toThrow(/Editar desde la app/);

        st = await svc.update(tenantId, adminId, 'admin', connId, { write_back: true });
        const [lst] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, st.lists.products!.id)));
        expect((lst!.settings as { store_sync: { write_back: boolean } }).store_sync.write_back).toBe(true);

        // Nombre y SKU no vienen habilitados: hay que elegirlos (v0.1.214).
        await expect(
            recordsService.update(tenantId, admin(), products, Number(taza.id), { data: { [k('products', 'nombre')]: 'Otra' } } as never),
        ).rejects.toThrow(/habilitala/);
        await expect(
            recordsService.update(tenantId, admin(), products, Number(taza.id), { data: { [k('products', 'tipo')]: 'variable' } } as never),
        ).rejects.toThrow(/Se edita en WooCommerce/);
        // Un producto con variaciones no tiene precio propio.
        await expect(
            recordsService.update(tenantId, admin(), products, Number(camiseta.id), { data: { [k('products', 'precio_normal')]: 1 } } as never),
        ).rejects.toThrow(/variaciones no tiene precio propio/);
        // Un valor que la tienda no aceptaría.
        await expect(
            recordsService.update(tenantId, admin(), products, Number(taza.id), { data: { [k('products', 'precio_rebajado')]: 999999 } } as never),
        ).rejects.toThrow(/menor que el normal/);

        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), products, Number(taza.id), { data: { [k('products', 'precio_normal')]: 35000 } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        expect(queue.pushes[0]).toMatchObject({ syncId, recordId: Number(taza.id), fieldIds: [F.products!.precio_normal] });
        let calls = store.calls.length;
        await realtime.processPush(queue.pushes[0]!);
        let put = store.calls.slice(calls).find((c) => c.method === 'PUT')!;
        expect(put.url).toContain('/wc/v3/products/10');
        expect(JSON.parse(put.body!)).toEqual({ regular_price: '35000' });

        // La talla: se reconoce por su vínculo y va a la ruta de variaciones.
        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), products, Number(s21.id), { data: { [k('products', 'stock')]: 7 } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        calls = store.calls.length;
        await realtime.processPush(queue.pushes[0]!);
        put = store.calls.slice(calls).find((c) => c.method === 'PUT')!;
        expect(put.url).toContain('/wc/v3/products/20/variations/21');
        expect(JSON.parse(put.body!)).toEqual({ manage_stock: true, stock_quantity: 7 });
        // …y el producto recalcula su resumen con lo que devolvió la tienda.
        const again = await tree(tenantId, st.lists.products!.id);
        expect(again.roots.find((x) => x.id === camiseta.id)![k('products', 'stock')]).toBe(7);

        // El aviso que la tienda manda después no rebota.
        dispatcher.events.length = 0;
        queue.pushes.length = 0;
        await deliver('product.updated', store.products.find((p) => p.id === 10)!);
        await new Promise((r) => setTimeout(r, 100));
        expect(queue.pushes).toHaveLength(0);
    });

    it('editar desde la app: el estado de un pedido sí; el de una línea y los clientes no; un rechazo de la tienda queda a la vista', async () => {
        const orders = await tree(tenantId, st.lists.orders!.id);
        const pedido = orders.roots[0]!;
        const linea = orders.children.find((l) => l.parentId === pedido.id)!;
        await expect(
            recordsService.update(tenantId, admin(), st.lists.orders!.slug, Number(linea.id), { data: { [k('orders', 'estado')]: 'cancelled' } } as never),
        ).rejects.toThrow(/líneas de un pedido/);
        await expect(
            recordsService.update(tenantId, admin(), st.lists.orders!.slug, Number(pedido.id), { data: { [k('orders', 'estado')]: 'checkout-draft' } } as never),
        ).rejects.toThrow(/lo pone la tienda/);
        const customers = await rows(tenantId, st.lists.customers!.id);
        await expect(
            recordsService.update(tenantId, admin(), st.lists.customers!.slug, Number(customers[0]!.id), { data: { [k('customers', 'telefono')]: '+573009998877' } } as never),
        ).rejects.toThrow(/habilitala/);

        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), st.lists.orders!.slug, Number(pedido.id), { data: { [k('orders', 'estado')]: 'on-hold' } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        store.readOnly = true;
        await realtime.processPush(queue.pushes[0]!);
        store.readOnly = false;
        st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.write_back_status.failed).toBe(1);
        expect(st.write_back_status.last_error).toMatch(/permiso de escritura/);
    });

    it('columnas elegidas por la empresa: nombre, SKU y etiquetas (una nueva se crea en la tienda); clientes con cuenta; un rechazo vuelve al valor de la tienda', async () => {
        const products = st.lists.products!.slug;
        const defaults = st.editable.products;
        expect(defaults).toContain('precio_normal');
        expect(defaults).not.toContain('nombre');
        // Un slug fuera del catálogo se descarta al guardar.
        st = await svc.update(tenantId, adminId, 'admin', connId, {
            editable: { products: [...defaults, 'nombre', 'sku', 'etiquetas', 'tipo'], customers: ['telefono'] },
        });
        expect(st.editable.products).toEqual([...defaults, 'nombre', 'sku', 'etiquetas']);
        expect(st.editable.customers).toEqual(['telefono']);
        expect(st.editable.orders).toEqual(['estado']);
        // Prender/apagar UNA columna se aplica sobre lo guardado (no sobre una caché vieja).
        st = await svc.update(tenantId, adminId, 'admin', connId, { editable_toggle: { role: 'products', slug: 'sku', on: false } });
        expect(st.editable.products).toEqual([...defaults, 'nombre', 'etiquetas']);
        st = await svc.update(tenantId, adminId, 'admin', connId, { editable_toggle: { role: 'products', slug: 'tipo', on: true } });
        expect(st.editable.products).not.toContain('tipo');
        st = await svc.update(tenantId, adminId, 'admin', connId, { editable_toggle: { role: 'products', slug: 'sku', on: true } });
        const [lst] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, st.lists.products!.id)));
        expect((lst!.settings as { store_sync: { editable: string[] } }).store_sync.editable).toContain('nombre');

        const t0 = await tree(tenantId, st.lists.products!.id);
        const taza = t0.roots.find((x) => x[k('products', 'woo_id')] === '10')!;
        const camiseta = t0.roots.find((x) => x[k('products', 'woo_id')] === '20')!;
        const s21 = t0.children.find((x) => x[k('products', 'woo_id')] === '21')!;
        // El nombre de una variación sale de su producto.
        await expect(
            recordsService.update(tenantId, admin(), products, Number(s21.id), { data: { [k('products', 'nombre')]: 'X' } } as never),
        ).rejects.toThrow(/variación/);
        // Las categorías no se habilitaron: su opción nueva tampoco se puede crear.
        await expect(fieldsService.appendOption(tenantId, products, String(F.products!.categorias), { value: 'Hogar' })).rejects.toThrow(/define WooCommerce/);

        // Etiqueta nueva: la opción nace con el slug que le va a dar WordPress.
        const tagField = await fieldsService.appendOption(tenantId, products, String(F.products!.etiquetas), { value: 'Oferta Verano' });
        expect((tagField.config as { options: Array<{ value: string; label: string }> }).options).toContainEqual({ value: 'oferta-verano', label: 'Oferta Verano' });

        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), products, Number(taza.id), {
            data: { [k('products', 'nombre')]: 'Taza grande', [k('products', 'etiquetas')]: ['regalo', 'oferta-verano'] },
        } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        let calls = store.calls.length;
        await realtime.processPush(queue.pushes[0]!);
        const put = store.calls.slice(calls).find((c) => c.method === 'PUT' && c.url.includes('/products/10'))!;
        const newTag = store.terms.tags.find((t) => t.slug === 'oferta-verano')!;
        expect(newTag).toMatchObject({ name: 'Oferta Verano' });
        expect(JSON.parse(put.body!)).toEqual({ name: 'Taza grande', tags: [{ id: 19 }, { id: newTag.id }] });
        const after = (await tree(tenantId, st.lists.products!.id)).roots.find((x) => x.id === taza.id)!;
        expect(after[k('products', 'nombre')]).toBe('Taza grande');
        expect(after[k('products', 'etiquetas')]).toEqual(['regalo', 'oferta-verano']);

        // Renombrar un producto con variaciones relee sus variaciones (su nombre lleva el del producto).
        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), products, Number(camiseta.id), { data: { [k('products', 'nombre')]: 'Camiseta nueva' } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        await realtime.processPush(queue.pushes[0]!);
        const renamed = (await tree(tenantId, st.lists.products!.id)).children.find((x) => x.id === s21.id)!;
        expect(String(renamed[k('products', 'nombre')])).toContain('Camiseta nueva');

        // Un SKU repetido: la tienda lo rechaza y la app vuelve al valor de la tienda.
        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), products, Number(taza.id), { data: { [k('products', 'sku')]: 'CAM-S' } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        await realtime.processPush(queue.pushes[0]!);
        st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.write_back_status.last_error).toMatch(/SKU no válido o duplicado.*quedó el valor que tiene la tienda/);
        const back = (await tree(tenantId, st.lists.products!.id)).roots.find((x) => x.id === taza.id)!;
        expect(back[k('products', 'sku')] ?? null).toBeNull();

        // Cliente con cuenta: su teléfono viaja a la cuenta de la tienda.
        const customers = await rows(tenantId, st.lists.customers!.id);
        const ana = customers.find((c) => c[k('customers', 'woo_id')] === '1')!;
        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), st.lists.customers!.slug, Number(ana.id), { data: { [k('customers', 'telefono')]: '+573009998877' } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        calls = store.calls.length;
        await realtime.processPush(queue.pushes[0]!);
        const putC = store.calls.slice(calls).find((c) => c.method === 'PUT')!;
        expect(putC.url).toContain('/wc/v3/customers/1');
        expect(JSON.parse(putC.body!)).toEqual({ billing: { phone: '+573009998877' } });
        expect((store.customers[0]!.billing as Row).phone).toBe('+573009998877');

        // Slug (v0.1.215): se habilita, viaja, y queda el que dejó WordPress.
        st = await svc.update(tenantId, adminId, 'admin', connId, { editable_toggle: { role: 'products', slug: 'slug_url', on: true } });
        const tz = (await tree(tenantId, st.lists.products!.id)).roots.find((x) => x.id === taza.id)!;
        expect(tz[k('products', 'slug_url')]).toBe('taza');
        await expect(
            recordsService.update(tenantId, admin(), products, Number(taza.id), { data: { [k('products', 'slug_url')]: 'cocina/taza' } } as never),
        ).rejects.toThrow(/«\/»/);
        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), products, Number(taza.id), { data: { [k('products', 'slug_url')]: 'Camiseta' } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        calls = store.calls.length;
        await realtime.processPush(queue.pushes[0]!);
        const putS = store.calls.slice(calls).find((c) => c.method === 'PUT')!;
        expect(JSON.parse(putS.body!)).toEqual({ slug: 'Camiseta' });
        const tz2 = (await tree(tenantId, st.lists.products!.id)).roots.find((x) => x.id === taza.id)!;
        // WordPress lo limpió y lo hizo único (ya existía «camiseta»).
        expect(tz2[k('products', 'slug_url')]).toBe('camiseta-2');
        expect(tz2[k('products', 'enlace')]).toBe('https://tienda.test/producto/camiseta-2/');
    });

    it('volver a intervalos borra los avisos de la tienda y el token deja de valer', async () => {
        const { token } = hookOf();
        st = await svc.update(tenantId, adminId, 'admin', connId, { mode: 'interval', write_back: false });
        expect(st.realtime.active).toBe(false);
        expect(store.webhooks).toHaveLength(0);
        await expect(realtime.receive(token, { 'x-wc-webhook-topic': 'order.updated' }, '{}', {})).rejects.toThrow(/Not found/);
    });

    it('migración: una tienda conectada con el pack viejo pasa a subtareas sin perder lo que es de la empresa', async () => {
        const settings = async () => {
            const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)));
            return row!.settings as Record<string, unknown> & { fields: Record<string, Record<string, number>>; lists: Record<string, number> };
        };
        // Armar a mano lo que tenía una tienda del pack 4: listas aparte para
        // variaciones y líneas, columnas de compras y dos listas de compras.
        const s0 = await settings();
        const oldVar = await listsSvc.create(tenantId, { name: 'Variaciones viejas' });
        const oldLines = await listsSvc.create(tenantId, { name: 'Líneas viejas' });
        const emptyPurchase = await listsSvc.create(tenantId, { name: 'Proveedores' });
        const usedPurchase = await listsSvc.create(tenantId, { name: 'Órdenes de compra' });
        const oc = await fieldsService.create(tenantId, String(usedPurchase.id), { label: 'Orden', type: 'text' } as never);
        await withTenant(pg.db, tenantId, (tx) => tx.insert(records).values({ tenantId, listId: usedPurchase.id, data: { [`f${oc.id}`]: 'OC-0001' }, createdBy: adminId }));
        const sumar = await fieldsService.create(tenantId, String(s0.lists.products), { label: 'Sumar al stock', slug: 'sumar_stock', type: 'number' } as never);
        const legacy = {
            ...s0,
            pack_version: 4,
            lists: { ...s0.lists, variations: oldVar.id, line_items: oldLines.id },
            fields: { ...s0.fields, products: { ...s0.fields.products, sumar_stock: sumar.id } },
            purchase_lists: { suppliers: emptyPurchase.id, orders: usedPurchase.id },
        };
        await withTenant(pg.db, tenantId, (tx) => tx.update(connectionSyncs).set({ settings: legacy }).where(eq(connectionSyncs.id, syncId)));
        const oldDash = s0.dashboard_id as number;

        queue.runs.length = 0;
        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        const s1 = await settings();
        expect(s1.pack_version).toBe(6);
        expect(s1.lists.variations).toBe(s1.lists.products);
        expect(s1.lists.line_items).toBe(s1.lists.orders);
        expect(s1.fields.products!.sumar_stock).toBeUndefined();
        expect(s1).not.toHaveProperty('purchase_lists');
        // Las listas viejas de la tienda se fueron; la de compras vacía también;
        // la que tenía datos quedó como lista común.
        const live = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: lists.id, settings: lists.settings }).from(lists));
        const ids = new Set(live.map((l) => l.id));
        expect(ids.has(oldVar.id)).toBe(false);
        expect(ids.has(oldLines.id)).toBe(false);
        expect(ids.has(emptyPurchase.id)).toBe(false);
        expect(ids.has(usedPurchase.id)).toBe(true);
        expect((live.find((l) => l.id === usedPurchase.id)!.settings as Record<string, unknown>).store_sync).toBeUndefined();
        expect((await fieldsService.listByListId(tenantId, s1.lists.products!)).some((f) => f.id === sumar.id)).toBe(false);
        // Tableros nuevos; el viejo ya no existe.
        expect(s1.dashboard_id).not.toBe(oldDash);
        const dash = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: dashboards.id }).from(dashboards).where(eq(dashboards.id, oldDash)));
        expect(dash).toHaveLength(0);
        // Se encola la vuelta que trae variaciones y líneas donde van.
        expect(queue.runs).toContainEqual({ tenantId, syncId, opts: { full: true, only: ['products', 'orders'] } });
        expect(await svc.runJob(tenantId, syncId, { full: true, only: ['products', 'orders'] })).toBe(true);
        expect((await tree(tenantId, s1.lists.products!)).children).toHaveLength(2);
        expect((await svc.status(tenantId, adminId, 'admin', connId)).last_error).toBeNull();
    });

    it('actualización liviana 5 → 6: suma la columna Slug sin rehacer nada y la llena (v0.1.215)', async () => {
        const read = async () => {
            const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)));
            return row!.settings as Record<string, unknown> & { fields: Record<string, Record<string, number>>; lists: Record<string, number>; dashboard_id: number };
        };
        const s0 = await read();
        const slugField = s0.fields.products!.slug_url!;
        // Una tienda que quedó en el pack 5: sin la columna.
        await fieldsService.remove(tenantId, String(s0.lists.products), String(slugField), { internal: true });
        const noSlug = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).filter(([k2]) => k2 !== 'slug_url'));
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(connectionSyncs)
                .set({
                    settings: {
                        ...s0,
                        pack_version: 5,
                        fields: { ...s0.fields, products: noSlug(s0.fields.products!), variations: noSlug(s0.fields.variations!) },
                    },
                })
                .where(eq(connectionSyncs.id, syncId)),
        );
        const before = await tree(tenantId, s0.lists.products!);
        queue.runs.length = 0;
        expect(await svc.runJob(tenantId, syncId, {})).toBe(true);
        const s1 = await read();
        expect(s1.pack_version).toBe(6);
        expect(s1.fields.products!.slug_url).toBeGreaterThan(0);
        expect(s1.fields.variations!.slug_url).toBe(s1.fields.products!.slug_url);
        // Nada se rehizo: mismo tablero, mismos registros (con sus variaciones).
        expect(s1.dashboard_id).toBe(s0.dashboard_id);
        const after = await tree(tenantId, s0.lists.products!);
        expect(after.roots.map((r) => r.id).sort()).toEqual(before.roots.map((r) => r.id).sort());
        expect(after.children.map((r) => r.id).sort()).toEqual(before.children.map((r) => r.id).sort());
        expect(queue.runs).toContainEqual({ tenantId, syncId, opts: { full: true, only: ['products'] } });
        // La marca de la lista conoce la columna nueva.
        const [lst] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, s0.lists.products!)));
        expect((lst!.settings as { store_sync: { fields: Record<string, number> } }).store_sync.fields.slug_url).toBe(s1.fields.products!.slug_url);
        // La vuelta de productos la llena.
        await svc.runJob(tenantId, syncId, { full: true, only: ['products'] });
        const filled = await tree(tenantId, s0.lists.products!);
        const camiseta = filled.roots.find((x) => x[`f${s1.fields.products!.woo_id}`] === '20')!;
        expect(camiseta[`f${s1.fields.products!.slug_url}`]).toBe('camiseta');
    });

    it('otra empresa no ve la sincronización ni sus vínculos (RLS)', async () => {
        const syncs = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(connectionSyncs));
        const links = await withTenant(pg.db, otherTenant, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(syncLinks));
        expect(syncs).toHaveLength(0);
        expect(links[0]!.n).toBe(0);
        await expect(svc.status(otherTenant, adminId, 'admin', connId)).rejects.toThrow();
    });

    it('el límite de registros del plan corta la importación con un motivo claro', async () => {
        await withTenant(pg.db, otherTenant, (tx) => tx.insert(memberships).values({ tenantId: otherTenant, userId: adminId, role: 'admin' }));
        await pg.db.update(tenants).set({ plan: 'mini' }).where(eq(tenants.id, otherTenant));
        seedStore(40);
        const c2 = await connect(otherTenant);
        await svc.setup(otherTenant, adminId, 'admin', c2, {
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
        const total = await withTenant(pg.db, otherTenant, (tx) =>
            tx.select({ n: sql<number>`count(*)::int` }).from(records).innerJoin(lists, eq(lists.id, records.listId)).where(isNull(records.deletedAt)),
        );
        expect(total[0]!.n).toBeLessThanOrEqual(30);
    });

    it('borrar la CONEXIÓN saca sus avisos de la tienda (no quedan llamando a una URL muerta)', async () => {
        const c3 = await connect(otherTenant);
        await svc.setup(otherTenant, adminId, 'admin', c3, {
            resources: { customers: true, products: true, orders: true },
            orders_since: null,
            mode: 'realtime',
            interval_minutes: 60,
        });
        const id3 = await syncIdOf(otherTenant, c3);
        const [hook] = await pg.db.select().from(storeHooks).where(eq(storeHooks.syncId, id3));
        const mine = () => store.webhooks.filter((w) => String(w.delivery_url).endsWith(`/${hook!.token}`));
        expect(mine()).toHaveLength(10);
        await connectors.remove(otherTenant, adminId, 'admin', c3, true);
        expect(mine()).toHaveLength(0);
    });

    it('dejar de sincronizar conserva las listas y sus datos (y ya se pueden editar libremente)', async () => {
        const productsList = st.lists.products!.id;
        await svc.remove(tenantId, adminId, 'admin', connId);
        expect((await svc.status(tenantId, adminId, 'admin', connId)).configured).toBe(false);
        expect((await tree(tenantId, productsList)).roots.length).toBe(2);
        const links = await withTenant(pg.db, tenantId, (tx) => tx.select().from(syncLinks).where(eq(syncLinks.syncId, syncId)));
        expect(links).toHaveLength(0);
        // Sin la marca: son listas comunes, sin bloqueos.
        const marked = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ id: lists.id }).from(lists).where(sql`${lists.settings} ? 'store_sync'`),
        );
        expect(marked).toHaveLength(0);
        const [taza] = (await tree(tenantId, productsList)).roots.filter((r) => r[k('products', 'woo_id')] === '10');
        await recordsService.update(tenantId, admin(), st.lists.products!.slug, Number(taza!.id), { data: { [k('products', 'nombre')]: 'Taza editada' } } as never);
        const created = await recordsService.create(tenantId, admin(), st.lists.products!.slug, { data: { [k('products', 'nombre')]: 'Producto propio' } } as never);
        expect(created.id).toBeGreaterThan(0);
        await fieldsService.remove(tenantId, st.lists.products!.slug, String(F.products!.sku));
    });
});
