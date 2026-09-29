import { and, eq, isNull, sql } from 'drizzle-orm';
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
}));
vi.mock('../src/common/safe-fetch', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/common/safe-fetch')>();
    return {
        ...real,
        safeWebhookFetch: async (url: string, opts: { method?: string }) => {
            store.calls.push({ url, method: opts.method });
            const u = new URL(url);
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
import { connectionSyncs, lists, plans, records, relations, syncLinks, tenants, users, memberships } from '../src/db/schema';
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
import { StoreSyncQueue } from '../src/sync/store-sync.queue';
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
    override enqueueRun(tenantId: number, syncId: number, opts: { full?: boolean; only?: string[] }): void {
        this.runs.push({ tenantId, syncId, opts });
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
            { id: 21, parent_id: 20, price: '30000', manage_stock: true, stock_quantity: 5, stock_status: 'instock', attributes: [{ name: 'Talla', option: 'S' }], date_modified_gmt: tick(), meta_data: [] },
            { id: 22, parent_id: 20, price: '32000', manage_stock: true, stock_quantity: 3, stock_status: 'instock', attributes: [{ name: 'Talla', option: 'M' }], date_modified_gmt: tick(), meta_data: [] },
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
        recordsService = new RecordsService(tenantDb, new RecordsRepository(), listsService, fieldsService, rt, activity, dispatcher, new RelationsRepository());
        const engine = new StoreSyncEngine(tenantDb, fieldsService, billing, rt, dispatcher, activity, redis);
        queue = new CapturingQueue();
        svc = new StoreSyncService(tenantDb, pg.db, connectors, blueprints, listsService, new ListGroupsService(tenantDb), fieldsService, audit, engine, queue);

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
        expect(st.folder_id).not.toBeNull();
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
