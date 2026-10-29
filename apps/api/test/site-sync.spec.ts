import { bulkOperationSchema, type BulkOperationInput } from '@imagina-base/shared';
import { and, eq, isNull } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.333 (ADR-S83) — la sincronización con un sitio WordPress, con Postgres
 * y Redis reales. El sitio se simula en el borde de red (`safeWebhookFetch`)
 * con una API REST en memoria que se comporta como la de WordPress en lo que
 * usa el motor (verificado contra un WordPress 6.8 real con ACF):
 * contraseñas de aplicación por `Authorization: Basic`, `context=edit`,
 * `status=any` sin la papelera, `orderby=modified` + `modified_after` en hora
 * LOCAL del sitio, `X-WP-Total`, ACF y meta en sus propios objetos, términos
 * por id, `term_exists` con el id del que ya existe.
 */
type Row = Record<string, unknown>;
interface Call {
    method: string;
    url: string;
    body?: string;
}
const wp = vi.hoisted(() => ({
    password: 'good-pass-1234',
    clock: Date.UTC(2026, 9, 1, 12, 0, 0),
    nextId: 100,
    posts: {} as Record<string, Row[]>,
    terms: {} as Record<string, Row[]>,
    calls: [] as Call[],
    appPasswords: true,
    /**
     * Como un WordPress real (6.8): con la contraseña revocada NO dice
     * `incorrect_password` — responde como a un visitante anónimo.
     */
    anonymousOnBadAuth: false,
    /** Otras contraseñas de aplicación vigentes del usuario (la rotación de la conexión en un clic). */
    extraPasswords: {} as Record<string, string>,
    renamedTo: '',
    apSeq: 0,
    /** uuid → nombre, como el perfil del usuario en WordPress. */
    appPasswordNames: {} as Record<string, string>,
    /** El próximo POST a una entrada se rechaza (como un plugin que valida). */
    rejectNext: false,
}));

vi.mock('../src/common/safe-fetch', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/common/safe-fetch')>();
    const TYPES: Record<string, { rest: string; name: string; hier: boolean; taxes: string[]; supports: string[] }> = {
        post: { rest: 'posts', name: 'Entradas', hier: false, taxes: ['category', 'post_tag'], supports: ['title', 'editor', 'excerpt', 'thumbnail', 'author'] },
        page: { rest: 'pages', name: 'Páginas', hier: true, taxes: [], supports: ['title', 'editor', 'page-attributes', 'thumbnail', 'author'] },
        propiedad: { rest: 'propiedades', name: 'Propiedades', hier: false, taxes: ['zona'], supports: ['title', 'editor', 'excerpt', 'thumbnail', 'custom-fields'] },
        attachment: { rest: 'media', name: 'Medios', hier: false, taxes: [], supports: ['title'] },
    };
    const TAXES: Record<string, { rest: string; name: string; hier: boolean; field: string }> = {
        category: { rest: 'categories', name: 'Categorías', hier: true, field: 'categories' },
        post_tag: { rest: 'tags', name: 'Etiquetas', hier: false, field: 'tags' },
        zona: { rest: 'zonas', name: 'Zonas', hier: true, field: 'zonas' },
    };
    const local = () => new Date(wp.clock).toISOString().slice(0, 19);
    const res = (status: number, o: unknown, headers: Record<string, string> = {}) => ({ status, body: JSON.stringify(o), headers });
    return {
        ...real,
        safeWebhookFetch: async (url: string, opts: { method?: string; body?: string; headers?: Record<string, string> }) => {
            const method = opts.method ?? 'GET';
            wp.calls.push({ method, url, body: opts.body });
            const u = new URL(url);
            if (u.host !== 'blog.test') throw new Error('getaddrinfo ENOTFOUND');
            const path = u.pathname.replace(/^\/wp-json/, '').replace(/\/$/, '') || '/';
            const q = u.searchParams;
            if (path === '/' && method === 'GET') {
                return res(200, {
                    name: 'Blog de prueba',
                    home: 'https://blog.test',
                    namespaces: ['wp/v2'],
                    authentication: wp.appPasswords ? { 'application-passwords': { endpoints: { authorization: 'https://blog.test/wp-admin/authorize-application.php' } } } : [],
                });
            }
            const auth = opts.headers?.authorization ?? '';
            const basic = (p: string) => `Basic ${Buffer.from(`admin:${p}`).toString('base64')}`;
            const expected = basic(wp.password);
            const extra = Object.entries(wp.extraPasswords).find(([, p]) => basic(p) === auth);
            if (auth !== expected && !extra) {
                if (!wp.anonymousOnBadAuth) return res(401, { code: 'incorrect_password', message: 'La contraseña de aplicación no es correcta.' });
                if (q.get('status') === 'any') {
                    return res(400, {
                        code: 'rest_invalid_param',
                        message: 'Parámetro(s) no válido(s): status',
                        data: { status: 400, params: { status: 'El estado está prohibido.' }, details: { status: { code: 'rest_forbidden_status', message: 'El estado está prohibido.', data: { status: 401 } } } },
                    });
                }
                return res(401, { code: 'rest_not_logged_in', message: 'No estás conectado.', data: { status: 401 } });
            }
            // Contraseñas de aplicación del usuario conectado (la rotación al conectar en un clic).
            const apBase = '/wp/v2/users/me/application-passwords';
            const using = extra ? extra[0] : 'u-main';
            if (path === `${apBase}/introspect` && method === 'GET') return res(200, { uuid: using, name: wp.appPasswordNames[using] ?? '' });
            if (path === apBase && method === 'POST') {
                const body = JSON.parse(opts.body ?? '{}') as { name?: string };
                if (Object.values(wp.appPasswordNames).includes(body.name ?? '')) return res(409, { code: 'application_password_duplicate_name', message: 'Ese nombre ya existe.' });
                const uuid = `u-${++wp.apSeq}`;
                const pass = `rotada${uuid}PASS`;
                wp.extraPasswords[uuid] = pass;
                wp.appPasswordNames[uuid] = body.name ?? '';
                return res(201, { uuid, name: body.name, password: pass.replace(/(.{4})/g, '$1 ').trim() });
            }
            const apOne = path.startsWith(`${apBase}/`) ? path.slice(apBase.length + 1) : null;
            if (apOne && method === 'DELETE') {
                if (apOne === 'u-main') {
                    // Se borra la principal: la que quedó vigente pasa a serlo.
                    const [nextUuid, nextPass] = Object.entries(wp.extraPasswords)[0] ?? [];
                    if (!nextUuid) return res(400, { code: 'x', message: 'no' });
                    wp.password = nextPass!;
                    delete wp.extraPasswords[nextUuid];
                    wp.appPasswordNames['u-main'] = wp.appPasswordNames[nextUuid] ?? '';
                    delete wp.appPasswordNames[nextUuid];
                    wp.renamedTo = nextUuid;
                }
                return res(200, { deleted: true });
            }
            if (apOne && method === 'POST') {
                const body = JSON.parse(opts.body ?? '{}') as { name?: string };
                const key = apOne === wp.renamedTo ? 'u-main' : apOne;
                wp.appPasswordNames[key] = body.name ?? '';
                return res(200, { uuid: apOne, name: body.name });
            }
            if (path === '/wp/v2/users/me') {
                return res(200, { id: 1, username: 'admin', name: 'Ana Admin', roles: ['administrator'], capabilities: { edit_posts: true, edit_pages: true, manage_categories: true } });
            }
            if (path === '/wp/v2/types') {
                return res(200, Object.fromEntries(Object.entries(TYPES).map(([slug, t]) => [slug, { name: t.name, rest_base: t.rest, rest_namespace: 'wp/v2', hierarchical: t.hier, viewable: true, taxonomies: t.taxes, supports: Object.fromEntries(t.supports.map((s) => [s, true])) }])));
            }
            if (path === '/wp/v2/taxonomies') {
                return res(200, Object.fromEntries(Object.entries(TAXES).map(([slug, t]) => [slug, { name: t.name, rest_base: t.rest, rest_namespace: 'wp/v2', hierarchical: t.hier, visibility: { show_ui: true } }])));
            }
            if (path === '/wp/v2/users') return res(200, [{ id: 1, name: 'Ana Admin' }]);
            if (path === '/wp/v2/media') return res(200, [{ id: 30, source_url: 'https://blog.test/foto.jpg', media_details: { sizes: { thumbnail: { source_url: 'https://blog.test/foto-150x150.jpg' } } } }]);
            const type = Object.entries(TYPES).find(([, t]) => path.startsWith(`/wp/v2/${t.rest}`));
            const tax = Object.entries(TAXES).find(([, t]) => path.startsWith(`/wp/v2/${t.rest}`));
            if (tax) {
                const [slug, t] = tax;
                const list = wp.terms[slug] ?? (wp.terms[slug] = []);
                const one = /\/(\d+)$/.exec(path);
                if (method === 'POST' && !one) {
                    const body = JSON.parse(opts.body ?? '{}') as Row;
                    const dup = list.find((x) => String(x.name).toLowerCase() === String(body.name).toLowerCase());
                    if (dup) return res(400, { code: 'term_exists', message: 'Ya existe un término con ese nombre.', data: { status: 400, term_id: dup.id } });
                    const term = { id: wp.nextId++, name: body.name, slug: body.slug ?? String(body.name).toLowerCase(), description: '', parent: 0, count: 0, link: `https://blog.test/${t.rest}/${body.slug}/` };
                    list.push(term);
                    return res(201, term);
                }
                if (method === 'POST' && one) {
                    const term = list.find((x) => x.id === Number(one[1]));
                    if (!term) return res(404, { code: 'rest_term_invalid', message: 'El término no existe.' });
                    Object.assign(term, JSON.parse(opts.body ?? '{}') as Row);
                    return res(200, term);
                }
                let rows = [...list];
                if (q.get('slug')) rows = rows.filter((x) => x.slug === q.get('slug'));
                if (q.get('include')) rows = rows.filter((x) => q.get('include')!.split(',').map(Number).includes(Number(x.id)));
                return page(rows, q);
            }
            if (!type) return res(404, { code: 'rest_no_route', message: 'No se encontró ninguna ruta.' });
            const [typeSlug, t] = type;
            const list = wp.posts[typeSlug] ?? (wp.posts[typeSlug] = []);
            const one = /\/(\d+)$/.exec(path);
            if (one) {
                const post = list.find((x) => x.id === Number(one[1]));
                if (!post) return res(404, { code: 'rest_post_invalid_id', message: 'ID de entrada no válido.' });
                if (method === 'POST') {
                    if (wp.rejectNext) {
                        wp.rejectNext = false;
                        return res(400, { code: 'rest_invalid_param', message: 'Parámetro(s) no válido(s): title', data: { status: 400, params: { title: 'Un plugin del sitio no acepta ese título.' } } });
                    }
                    const body = JSON.parse(opts.body ?? '{}') as Row;
                    for (const [k, v] of Object.entries(body)) {
                        if (k === 'title' || k === 'excerpt') post[k] = { raw: v, rendered: v };
                        else if (k === 'acf' || k === 'meta') post[k] = { ...(post[k] as Row), ...(v as Row) };
                        else post[k] = v;
                    }
                    wp.clock += 60_000;
                    post.modified = local();
                    post.modified_gmt = local();
                }
                return res(200, post);
            }
            void t;
            let rows = [...list];
            const status = q.get('status') ?? 'publish';
            if (status === 'any') rows = rows.filter((x) => x.status !== 'trash');
            else rows = rows.filter((x) => x.status === status);
            if (q.get('include')) rows = list.filter((x) => q.get('include')!.split(',').map(Number).includes(Number(x.id)));
            const after = q.get('modified_after');
            if (after) rows = rows.filter((x) => String(x.modified) > after.slice(0, 19));
            if (q.get('orderby') === 'modified') rows.sort((a, b) => String(a.modified).localeCompare(String(b.modified)) || Number(a.id) - Number(b.id));
            return page(rows, q);
        },
    };

    function page(rows: Row[], q: URLSearchParams) {
        const per = Number(q.get('per_page') ?? 10);
        const p = Number(q.get('page') ?? 1);
        const pages = Math.max(1, Math.ceil(rows.length / per));
        if (p > pages) return { status: 400, body: JSON.stringify({ code: 'rest_post_invalid_page_number', message: 'Página fuera de rango.' }), headers: {} };
        return { status: 200, body: JSON.stringify(rows.slice((p - 1) * per, p * per)), headers: { 'x-wp-total': String(rows.length), 'x-wp-totalpages': String(pages) } };
    }
});

import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { connectionSyncs, connections, lists, memberships, plans, records, syncLinks, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ImportService } from '../src/import/import.service';
import { IncidentHub, type IncidentReport } from '../src/incidents/incident-hub';
import { ListGroupsService } from '../src/lists/list-groups.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { BulkEditService } from '../src/records/bulk-edit.service';
import { BulkHistoryService } from '../src/records/bulk-history.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { SiteSyncEngine } from '../src/site-sync/site-sync.engine';
import { SiteSyncQueue, type SiteSyncPushJob } from '../src/site-sync/site-sync.queue';
import { SiteSyncService } from '../src/site-sync/site-sync.service';
import { SiteRealtimeService } from '../src/site-sync/site-realtime.service';
import { SiteWriteBackService } from '../src/site-sync/site-writeback.service';
import { WordpressPluginService } from '../src/site-sync/wordpress-plugin.service';
import { WordpressConnectService, type WpConnectStateStore } from '../src/site-sync/wordpress-connect.service';
import { StoreSyncEngine } from '../src/sync/store-sync.engine';
import { StoreSyncQueue } from '../src/sync/store-sync.queue';
import { StoreRealtimeService } from '../src/sync/store-realtime.service';
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
class CapturingQueue extends SiteSyncQueue {
    runs: Array<{ tenantId: number; syncId: number; opts: { full?: boolean; only?: string[] } }> = [];
    pushes: SiteSyncPushJob[] = [];
    override enqueueRun(tenantId: number, syncId: number, opts: { full?: boolean; only?: string[] }): void {
        this.runs.push({ tenantId, syncId, opts });
    }
    override enqueuePush(job: SiteSyncPushJob): boolean {
        this.pushes.push(job);
        return true;
    }
}
function memoryStates(): WpConnectStateStore {
    const m = new Map<string, string>();
    return {
        set: (k, v) => {
            m.set(k, v);
            return Promise.resolve('OK');
        },
        getdel: (k) => {
            const v = m.get(k) ?? null;
            m.delete(k);
            return Promise.resolve(v);
        },
    };
}

// ── Sitio falso ────────────────────────────────────────────────────────────

const local = () => new Date(wp.clock).toISOString().slice(0, 19);
function tick(): string {
    wp.clock += 60_000;
    return local();
}
function post(type: string, id: number, title: string, extra: Row = {}): Row {
    const at = tick();
    return {
        id,
        type,
        status: 'publish',
        date: at,
        date_gmt: at,
        modified: at,
        modified_gmt: at,
        slug: title.toLowerCase().replace(/\s+/g, '-'),
        link: `https://blog.test/${type}/${id}/`,
        title: { raw: title, rendered: title },
        excerpt: { raw: '', rendered: '' },
        author: 1,
        featured_media: 0,
        parent: 0,
        menu_order: 0,
        template: '',
        acf: {},
        meta: {},
        ...extra,
    };
}
function seedSite(): void {
    wp.clock = Date.UTC(2026, 9, 1, 12, 0, 0);
    wp.nextId = 100;
    wp.password = 'good-pass-1234';
    wp.appPasswords = true;
    wp.rejectNext = false;
    wp.terms = {
        category: [
            { id: 1, name: 'Sin categoría', slug: 'sin-categoria', description: '', parent: 0, count: 1, link: 'https://blog.test/category/sin-categoria/' },
            { id: 2, name: 'Noticias', slug: 'noticias', description: 'Lo nuevo', parent: 0, count: 2, link: 'https://blog.test/category/noticias/' },
        ],
        post_tag: [{ id: 5, name: 'Hogar', slug: 'hogar', description: '', parent: 0, count: 1, link: 'https://blog.test/tag/hogar/' }],
        zona: [
            { id: 6, name: 'Norte', slug: 'norte', description: '', parent: 0, count: 2, link: '' },
            { id: 7, name: 'Sur', slug: 'sur', description: '', parent: 0, count: 1, link: '' },
        ],
    };
    wp.posts = {
        post: [
            post('post', 10, 'Hola mundo', { categories: [1], tags: [] }),
            post('post', 11, 'Lanzamiento', { categories: [2], tags: [5], excerpt: { raw: 'Llegó', rendered: '<p>Llegó</p>' } }),
            post('post', 12, 'Borrador de ideas', { status: 'draft', categories: [2], tags: [] }),
        ],
        page: [post('page', 20, 'Quiénes somos'), post('page', 21, 'Equipo', { parent: 20, menu_order: 2 })],
        propiedad: [
            post('propiedad', 30, 'Casa con jardín', { zonas: [6], featured_media: 30, acf: { precio: 450000000, ciudad: 'Medellín', habitaciones: 4 }, meta: { referencia: 'REF-1' } }),
            post('propiedad', 31, 'Apartamento', { zonas: [6], acf: { precio: 280000000, ciudad: 'Bogotá', habitaciones: 2 }, meta: { referencia: 'REF-2' } }),
            post('propiedad', 32, 'Finca', { status: 'trash', zonas: [7], acf: { precio: 900000000, ciudad: 'Rionegro', habitaciones: 6 }, meta: { referencia: 'REF-3' } }),
        ],
    };
    wp.calls = [];
}

// ── Test ───────────────────────────────────────────────────────────────────

describe('Sincronización con un sitio WordPress (v0.1.333, ADR-S83)', () => {
    let pg: TestPg;
    let rds: TestRedis;
    let redis: Redis;
    let tenantDb: TenantDb;
    let connectors: ConnectorsService;
    let svc: SiteSyncService;
    let storeSvc: StoreSyncService;
    let connect: WordpressConnectService;
    let writeBack: SiteWriteBackService;
    let fieldsService: FieldsService;
    let recordsService: RecordsService;
    let importer: ImportService;
    let bulk: BulkEditService;
    let history: BulkHistoryService;
    let dispatcher: CapturingDispatcher;
    let queue: CapturingQueue;
    const reports: IncidentReport[] = [];
    const resolved: string[] = [];
    let tenantId: number;
    let otherTenant: number;
    let adminId: number;
    let otherUser: number;

    beforeAll(async () => {
        pg = await startPostgres();
        rds = await startRedis();
        redis = new Redis(rds.url);
        tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.test' });
        const rt = new RealtimeService();
        const audit = new AuditService(tenantDb);
        const incidents = new IncidentHub();
        incidents.subscribe({
            report: (r) => {
                reports.push(r);
            },
            resolve: (_t, key) => {
                resolved.push(key);
            },
            resolvePrefix: (_t, prefix) => {
                resolved.push(`${prefix}*`);
            },
        });
        const listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps(), undefined, incidents);
        const automationsService = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), listsService, new AutomationScheduler(), new NoHooks(), connectors);
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
        importer = new ImportService(tenantDb, listsService, fieldsService, new RecordsRepository(), billing, rt);
        history = new BulkHistoryService(tenantDb, listsService, recordsService, rt, audit);
        bulk = new BulkEditService(recordsService, rt, history);
        const engine = new SiteSyncEngine(tenantDb, fieldsService, billing, rt, dispatcher, activity, redis, incidents);
        queue = new CapturingQueue();
        writeBack = new SiteWriteBackService(tenantDb, engine, queue);
        svc = new SiteSyncService(
            tenantDb,
            pg.db,
            connectors,
            blueprints,
            new ListGroupsService(tenantDb),
            fieldsService,
            audit,
            engine,
            queue,
            writeBack,
            new SiteRealtimeService(tenantDb, pg.db, env, engine, queue),
            new WordpressPluginService(env),
            rt,
        );
        writeBack.setCredsResolver((t, s) => svc.credsForSync(t, s));
        hub.subscribe((c) => writeBack.onRecordChange(c));
        connect = new WordpressConnectService(connectors, { get: () => Promise.resolve({ app_name: 'Imagina Base' }) } as never, memoryStates(), pg.db, env);
        // La tienda, para comprobar que una y otra no se pisan.
        const storeEngine = new StoreSyncEngine(tenantDb, fieldsService, billing, rt, dispatcher, activity, redis);
        const storeQueue = new StoreSyncQueue();
        storeSvc = new StoreSyncService(tenantDb, pg.db, connectors, blueprints, listsService, new ListGroupsService(tenantDb), fieldsService, audit, storeEngine, storeQueue, new StoreRealtimeService(tenantDb, pg.db, env, storeEngine, storeQueue));

        await pg.db.insert(plans).values({ slug: 'grande', name: 'Grande', maxRecords: null }).onConflictDoNothing();
        await pg.db.insert(plans).values({ slug: 'mini', name: 'Mini', maxRecords: 3 }).onConflictDoNothing();
        const [t] = await pg.db.insert(tenants).values({ slug: 'blog-co', name: 'Blog Co', plan: 'grande' }).returning();
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra-co', name: 'Otra Co', plan: 'grande' }).returning();
        tenantId = t!.id;
        otherTenant = t2!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@blog.co', name: 'Admin', passwordHash: 'x' }).returning();
        const [u2] = await pg.db.insert(users).values({ email: 'otra@blog.co', name: 'Otra', passwordHash: 'x' }).returning();
        adminId = u!.id;
        otherUser = u2!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values([{ tenantId, userId: adminId, role: 'admin' }, { tenantId, userId: otherUser, role: 'admin' }]));
        await withTenant(pg.db, otherTenant, (tx) => tx.insert(memberships).values({ tenantId: otherTenant, userId: adminId, role: 'admin' }));
        seedSite();
    }, 180_000);

    afterAll(async () => {
        redis?.disconnect();
        await rds?.stop();
        await pg?.stop();
    });

    const admin = () => ({ userId: adminId, role: 'admin' as const });
    const ops = (list: BulkOperationInput[]) => list.map((o) => bulkOperationSchema.parse(o));
    async function rows(tId: number, listId: number): Promise<Array<Record<string, unknown> & { id: number }>> {
        const r = await withTenant(pg.db, tId, (tx) =>
            tx.select({ id: records.id, data: records.data }).from(records).where(and(eq(records.listId, listId), isNull(records.deletedAt))),
        );
        return r.map((x) => ({ ...(x.data as Record<string, unknown>), id: x.id }));
    }
    const lastPost = (from: number) => wp.calls.slice(from).filter((c) => c.method === 'POST');

    let connId: number;
    let syncId: number;
    let F: Record<string, Record<string, number>>;
    let L: Record<string, { id: number; slug: string }>;
    const k = (resource: string, key: string) => `f${F[resource]![key]}`;

    it('conectar a mano: una contraseña equivocada no se guarda; la buena descubre cómo habla el sitio', async () => {
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'wordpress', {
                fields: { site_url: 'blog.test', user_login: 'admin', app_password: 'mala' },
                visibility: 'workspace',
            }),
        ).rejects.toThrow(/rechazó el usuario o la contraseña/);
        expect(await pg.db.select().from(connections)).toHaveLength(0);
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'wordpress', {
            fields: { site_url: 'https://blog.test/wp-admin/', user_login: 'admin', app_password: wp.password },
            visibility: 'workspace',
        });
        connId = connection.id;
        expect(connection.account_label).toBe('Blog de prueba');
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, connId)));
        expect((row!.config as { fields: Record<string, string> }).fields).toMatchObject({ site_url: 'https://blog.test', user_login: 'admin', api_style: 'pretty' });
        // La contraseña de aplicación queda cifrada.
        expect(JSON.stringify(row!.secrets)).not.toContain(wp.password);
    });

    it('conectar en un clic: la pantalla «Autorizar aplicación» de WordPress, con un state de un solo uso y de la misma persona', async () => {
        const started = await connect.start(tenantId, adminId, 'admin', { site_url: 'blog.test', visibility: 'workspace', connection_id: connId });
        const url = new URL(started.authorize_url);
        expect(`${url.origin}${url.pathname}`).toBe('https://blog.test/wp-admin/authorize-application.php');
        expect(url.searchParams.get('app_name')).toBe('Imagina Base · Blog Co');
        const back = new URL(url.searchParams.get('success_url')!);
        expect(back.pathname).toBe('/api/v1/connections/wordpress/callback');
        const state = back.searchParams.get('state')!;
        // Otra persona no canjea el state (y lo quema).
        expect((await connect.complete(otherUser, { state, user_login: 'admin', password: wp.password })).error).toMatch(/otra persona/);
        expect((await connect.complete(adminId, { state, user_login: 'admin', password: wp.password })).error).toMatch(/venció o ya se usó/);
        // Cancelado en WordPress.
        const s2 = new URL(new URL((await connect.start(tenantId, adminId, 'admin', { site_url: 'blog.test', visibility: 'workspace', connection_id: connId })).authorize_url).searchParams.get('success_url')!).searchParams.get('state')!;
        expect((await connect.complete(adminId, { state: s2, success: 'false' })).error).toMatch(/No se autorizó/);
        // Aprobado: WordPress devuelve usuario y contraseña nuevos; se prueban y se guardan.
        wp.password = 'nueva-pass-5678';
        const s3 = new URL(new URL((await connect.start(tenantId, adminId, 'admin', { site_url: 'blog.test', visibility: 'workspace', connection_id: connId })).authorize_url).searchParams.get('success_url')!).searchParams.get('state')!;
        wp.appPasswordNames = { 'u-main': 'Imagina Base · Blog Co' };
        const ok = await connect.complete(adminId, { state: s3, user_login: 'admin', password: 'nueva-pass-5678' });
        expect(ok).toMatchObject({ ok: true, connectionId: connId });
        // La contraseña que vino en la URL ya no vale: se cambió por otra con el mismo nombre.
        expect(wp.password).not.toBe('nueva-pass-5678');
        expect(wp.password).toMatch(/^rotada/);
        expect(Object.values(wp.appPasswordNames)).toEqual(['Imagina Base · Blog Co']);
        const who = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'wordpress', {
            fields: { site_url: 'blog.test', user_login: 'admin', app_password: 'nueva-pass-5678' },
            visibility: 'workspace',
            connection_id: connId,
        }).catch((e: Error) => e);
        expect(who).toBeInstanceOf(Error);
        // Sin contraseñas de aplicación, ni siquiera se manda a la persona.
        wp.appPasswords = false;
        await expect(connect.start(tenantId, adminId, 'admin', { site_url: 'blog.test', visibility: 'workspace' })).rejects.toThrow(/contraseñas de aplicación están desactivadas/);
        wp.appPasswords = true;
        // Un agente no conecta para todo el equipo.
        await expect(connect.start(tenantId, adminId, 'agent', { site_url: 'blog.test', visibility: 'workspace' })).rejects.toThrow(/admin/);
    });

    it('descubrir: tipos de contenido, la biblioteca de medios, taxonomías y los campos de ACF con un ejemplo', async () => {
        const d = await svc.discover(tenantId, adminId, 'admin', connId);
        expect(d.site_name).toBe('Blog de prueba');
        expect(d.user).toMatchObject({ login: 'admin', can_edit: true, can_manage_terms: true });
        expect(d.objects.map((o) => `${o.kind}:${o.object}`)).toEqual(['post_type:post', 'post_type:page', 'post_type:propiedad', 'media:attachment', 'taxonomy:category', 'taxonomy:post_tag', 'taxonomy:zona']);
        // Sin el complemento: ni SEO ni campos del complemento, y la página lo dice.
        expect(d.plugin).toMatchObject({ installed: false });
        expect(d.objects.flatMap((o) => o.columns).some((c) => /^(seo|cf|plugin):/.test(c.key))).toBe(false);
        expect(d.acf).toBe(true);
        const prop = d.objects.find((o) => o.object === 'propiedad')!;
        expect(prop.count).toBe(2);
        expect(prop.columns.find((c) => c.key === 'acf:precio')).toMatchObject({ type: 'number', sample: '450000000', can_edit: true });
        expect(prop.columns.find((c) => c.key === 'meta:referencia')).toMatchObject({ type: 'text', sample: 'REF-1' });
        expect(prop.columns.some((c) => c.key === 'content')).toBe(false);
    });

    it('alta: una carpeta con una lista por tipo, SÓLO las columnas elegidas, y la marca del sitio en cada lista', async () => {
        const st = await svc.setup(tenantId, adminId, 'admin', connId, {
            objects: [
                { kind: 'post_type', object: 'propiedad', columns: ['title', 'status', 'link', 'excerpt', 'featured_image', 'tax:zona', 'acf:precio', 'acf:ciudad', 'acf:habitaciones', 'meta:referencia'], editable: ['title', 'excerpt', 'tax:zona', 'acf:precio'] },
                { kind: 'post_type', object: 'post', columns: ['title', 'status', 'excerpt', 'tax:category', 'tax:post_tag'], editable: ['title', 'tax:category'] },
                { kind: 'post_type', object: 'page', columns: ['title', 'status', 'parent', 'menu_order'], editable: ['title'] },
                { kind: 'taxonomy', object: 'category', columns: ['name', 'slug', 'description', 'count'], editable: ['name', 'description'] },
            ],
            write_back: true,
            interval_minutes: 15,
            mode: 'interval',
        });
        expect(st.configured).toBe(true);
        expect(st.objects.map((o) => o.resource)).toEqual(['post:propiedad', 'post:post', 'post:page', 'term:category']);
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs).where(eq(connectionSyncs.connectionId, connId)));
        syncId = row!.id;
        expect(row!.provider).toBe('wordpress');
        F = (row!.settings as { fields: Record<string, Record<string, number>> }).fields;
        L = Object.fromEntries(st.objects.map((o) => [o.resource, { id: o.list!.id, slug: o.list!.slug }]));
        const inFolder = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: lists.id, name: lists.name }).from(lists).where(eq(lists.groupId, st.folder_id!)));
        expect(inFolder.map((l) => l.name).sort()).toEqual(['Categorías', 'Entradas', 'Propiedades', 'Páginas']);
        // Las columnas obligatorias se suman solas; nada más que lo elegido.
        expect(Object.keys(F['post:propiedad']!).sort()).toEqual(['acf:ciudad', 'acf:habitaciones', 'acf:precio', 'edit_link', 'excerpt', 'featured_image', 'link', 'meta:referencia', 'status', 'tax:zona', 'title', 'wp_id']);
        const fields = await fieldsService.listByListId(tenantId, L['post:propiedad']!.id);
        expect(fields.find((f) => f.id === F['post:propiedad']!.featured_image)!.config).toMatchObject({ display: 'image' });
        // Lo que se mira primero (título, estado, datos); lo técnico al final.
        const keyOf = new Map(Object.entries(F['post:propiedad']!).map(([k, id]) => [id, k]));
        const order = [...fields].sort((a, b) => a.position - b.position).map((f) => keyOf.get(f.id));
        expect(order.slice(0, 2)).toEqual(['title', 'status']);
        expect(order.slice(-3)).toEqual(['wp_id', 'edit_link', 'link']);
        const [list] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, L['post:propiedad']!.id)));
        expect((list!.settings as { site_sync: Record<string, unknown> }).site_sync).toMatchObject({
            connection_id: connId,
            resource: 'post:propiedad',
            write_back: true,
            editable: ['title', 'excerpt', 'tax:zona', 'acf:precio'],
        });
        expect(queue.runs).toEqual([{ tenantId, syncId, opts: { full: true } }]);
        await expect(svc.setup(tenantId, adminId, 'admin', connId, { objects: [{ kind: 'post_type', object: 'post', columns: ['title'], editable: [] }], write_back: true, interval_minutes: 15, mode: 'interval' })).rejects.toThrow(/ya se está sincronizando/);
    });

    it('primera carga: borradores y la papelera también, términos como opciones, ACF con su tipo — sin disparar automatizaciones', async () => {
        expect(await svc.runJob(tenantId, syncId, { full: true })).toBe(true);
        const st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.last_error).toBeNull();
        expect(st.initial_done).toBe(true);
        expect(st.objects.map((o) => [o.resource, o.count])).toEqual([
            ['post:propiedad', 3],
            ['post:post', 3],
            ['post:page', 2],
            ['term:category', 2],
        ]);
        expect(dispatcher.events).toHaveLength(0);
        const props = await rows(tenantId, L['post:propiedad']!.id);
        const casa = props.find((r) => r[k('post:propiedad', 'wp_id')] === 30)!;
        expect(casa).toMatchObject({
            [k('post:propiedad', 'title')]: 'Casa con jardín',
            [k('post:propiedad', 'tax:zona')]: ['norte'],
            [k('post:propiedad', 'acf:precio')]: 450000000,
            [k('post:propiedad', 'acf:ciudad')]: 'Medellín',
            [k('post:propiedad', 'meta:referencia')]: 'REF-1',
            [k('post:propiedad', 'featured_image')]: 'https://blog.test/foto-150x150.jpg',
            [k('post:propiedad', 'edit_link')]: 'https://blog.test/wp-admin/post.php?post=30&action=edit',
        });
        expect(props.find((r) => r[k('post:propiedad', 'wp_id')] === 32)![k('post:propiedad', 'status')]).toBe('trash');
        const posts = await rows(tenantId, L['post:post']!.id);
        expect(posts.find((r) => r[k('post:post', 'title')] === 'Borrador de ideas')![k('post:post', 'status')]).toBe('draft');
        const pages = await rows(tenantId, L['post:page']!.id);
        expect(pages.find((r) => r[k('post:page', 'title')] === 'Equipo')![k('post:page', 'parent')]).toBe('Quiénes somos');
        const zona = (await fieldsService.listByListId(tenantId, L['post:propiedad']!.id)).find((f) => f.id === F['post:propiedad']!['tax:zona'])!;
        expect((zona.config as { options: Array<{ value: string; label: string }> }).options.map((o) => [o.value, o.label])).toEqual([['norte', 'Norte'], ['sur', 'Sur']]);
        // Nunca se pidió el contenido completo.
        expect(wp.calls.every((c) => !/_fields=[^&]*content/.test(decodeURIComponent(c.url)))).toBe(true);
        // Re-correr no duplica.
        await svc.runJob(tenantId, syncId, { full: true });
        expect(await rows(tenantId, L['post:propiedad']!.id)).toHaveLength(3);
    });

    it('incremental: trae lo modificado (por fecha de modificación) y lo nuevo, y ahí sí dispara automatizaciones', async () => {
        const p = wp.posts.propiedad!.find((x) => x.id === 31)!;
        p.title = { raw: 'Apartamento renovado', rendered: '' };
        (p.acf as Row).ciudad = 'Bogotá D.C.';
        p.modified = tick();
        wp.posts.propiedad!.push(post('propiedad', 33, 'Lote', { zonas: [7], acf: { precio: 50000000, ciudad: 'Cali', habitaciones: 0 }, meta: { referencia: 'REF-4' } }));
        wp.calls = [];
        await svc.runJob(tenantId, syncId, {});
        // Pidió desde la última fecha vista (un segundo antes: el filtro es exclusivo).
        expect(wp.calls.some((c) => c.url.includes('/propiedades') && c.url.includes('modified_after='))).toBe(true);
        const props = await rows(tenantId, L['post:propiedad']!.id);
        expect(props).toHaveLength(4);
        expect(props.find((r) => r[k('post:propiedad', 'wp_id')] === 31)).toMatchObject({ [k('post:propiedad', 'title')]: 'Apartamento renovado', [k('post:propiedad', 'acf:ciudad')]: 'Bogotá D.C.' });
        const kinds = dispatcher.events.map((e) => e.trigger);
        expect(kinds).toEqual(expect.arrayContaining(['record_created', 'record_updated']));
    });

    it('lo que se borra del todo en WordPress queda en «Papelera» en la app (barrido completo), nunca se borra', async () => {
        wp.posts.propiedad = wp.posts.propiedad!.filter((x) => x.id !== 33);
        await svc.runJob(tenantId, syncId, { full: true });
        const props = await rows(tenantId, L['post:propiedad']!.id);
        expect(props).toHaveLength(4);
        expect(props.find((r) => r[k('post:propiedad', 'wp_id')] === 33)![k('post:propiedad', 'status')]).toBe('trash');
    });

    it('editar desde la app: SÓLO lo que cambió viaja; un término nuevo se crea en WordPress; lo bloqueado se rechaza con el motivo', async () => {
        const props = await rows(tenantId, L['post:propiedad']!.id);
        const casa = props.find((r) => r[k('post:propiedad', 'wp_id')] === 30)!;
        const slug = L['post:propiedad']!.slug;
        await expect(recordsService.update(tenantId, admin(), slug, casa.id, { data: { [k('post:propiedad', 'acf:habitaciones')]: 5 } } as never)).rejects.toThrow(/habilítala/);
        await expect(recordsService.update(tenantId, admin(), slug, casa.id, { data: { [k('post:propiedad', 'link')]: 'https://x.test' } } as never)).rejects.toThrow(/Lo pone WordPress/);
        await expect(recordsService.update(tenantId, admin(), slug, casa.id, { data: { [k('post:propiedad', 'title')]: '  ' } } as never)).rejects.toThrow(/título no puede quedar vacío/);
        const finca = props.find((r) => r[k('post:propiedad', 'wp_id')] === 32)!;
        await expect(recordsService.update(tenantId, admin(), slug, finca.id, { data: { [k('post:propiedad', 'title')]: 'X' } } as never)).rejects.toThrow(/papelera de WordPress/);
        await expect(recordsService.create(tenantId, admin(), slug, { data: { [k('post:propiedad', 'title')]: 'Nueva' } } as never)).rejects.toThrow(/se crea en WordPress/);
        await expect(recordsService.remove(tenantId, admin(), slug, casa.id)).rejects.toThrow(/se borra en WordPress/);
        await expect(importer.preview(tenantId, slug, 'Título\nX')).rejects.toThrow(/importar/);

        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), slug, casa.id, { data: { [k('post:propiedad', 'title')]: 'Casa con jardín grande', [k('post:propiedad', 'acf:precio')]: 470000000 } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        let from = wp.calls.length;
        await writeBack.processPush(queue.pushes[0]!);
        let sent = lastPost(from);
        expect(sent).toHaveLength(1);
        expect(sent[0]!.url).toContain('/wp-json/wp/v2/propiedades/30');
        expect(JSON.parse(sent[0]!.body!)).toEqual({ title: 'Casa con jardín grande', acf: { precio: 470000000 } });
        expect((wp.posts.propiedad!.find((x) => x.id === 30)!.acf as Row).precio).toBe(470000000);

        // Un término que no existe: la opción nace con el slug que le dará WordPress y se crea allá.
        await fieldsService.appendOption(tenantId, slug, String(F['post:propiedad']!['tax:zona']), { value: 'Oeste Lejano' });
        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), slug, casa.id, { data: { [k('post:propiedad', 'tax:zona')]: ['norte', 'oeste-lejano'] } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        from = wp.calls.length;
        await writeBack.processPush(queue.pushes[0]!);
        sent = lastPost(from);
        expect(sent.map((c) => new URL(c.url).pathname)).toEqual(['/wp-json/wp/v2/zonas', '/wp-json/wp/v2/propiedades/30']);
        const oeste = wp.terms.zona!.find((t) => t.slug === 'oeste-lejano')!;
        expect(oeste.name).toBe('Oeste Lejano');
        expect(JSON.parse(sent[1]!.body!)).toEqual({ zonas: [6, oeste.id] });
        // Una opción de una columna NO habilitada no se crea.
        await expect(fieldsService.appendOption(tenantId, L['post:post']!.slug, String(F['post:post']!['tax:post_tag']), { value: 'Nueva' })).rejects.toThrow(/opciones las define WordPress/);
        // El sitio devolvió la entrada guardada: la sincronización no la rebota.
        queue.pushes.length = 0;
        await svc.runJob(tenantId, syncId, {});
        await new Promise((r) => setTimeout(r, 100));
        expect(queue.pushes).toHaveLength(0);
    });

    it('un rechazo de WordPress: la app vuelve a lo que tiene el sitio y el motivo queda a la vista', async () => {
        const slug = L['post:propiedad']!.slug;
        const casa = (await rows(tenantId, L['post:propiedad']!.id)).find((r) => r[k('post:propiedad', 'wp_id')] === 30)!;
        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), slug, casa.id, { data: { [k('post:propiedad', 'title')]: 'Título prohibido' } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        wp.rejectNext = true;
        await writeBack.processPush(queue.pushes[0]!);
        const after = (await rows(tenantId, L['post:propiedad']!.id)).find((r) => r.id === casa.id)!;
        expect(after[k('post:propiedad', 'title')]).toBe('Casa con jardín grande');
        const st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.write_back_status.failed).toBe(1);
        expect(st.write_back_status.last_error).toContain('Un plugin del sitio no acepta ese título');
        expect(st.write_back_status.last_error).toContain('En la app quedó lo que tiene el sitio');
        expect(reports.some((r) => r.key === `site_sync:${connId}:push` && r.source === 'site_sync')).toBe(true);
    });

    it('edición masiva y deshacer: cada cambio viaja al sitio y deshacer lo devuelve allá', async () => {
        const slug = L['post:propiedad']!.slug;
        const targets = (await rows(tenantId, L['post:propiedad']!.id)).filter((r) => [30, 31].includes(Number(r[k('post:propiedad', 'wp_id')])));
        queue.pushes.length = 0;
        const res = await bulk.apply(tenantId, admin(), slug, targets.map((r) => r.id), ops([{ op: 'append', field_id: F['post:propiedad']!.title!, text: ' (oferta)' }]));
        expect(res.succeeded).toHaveLength(2);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(2));
        for (const job of queue.pushes.splice(0)) await writeBack.processPush(job);
        expect(wp.posts.propiedad!.filter((x) => [30, 31].includes(Number(x.id))).map((x) => (x.title as Row).raw).sort()).toEqual(['Apartamento renovado (oferta)', 'Casa con jardín grande (oferta)']);

        const preview = await history.revertPreview(tenantId, admin(), slug, res.edit_id!);
        expect(preview.total).toBe(2);
        await history.revertApply(tenantId, admin(), slug, res.edit_id!, preview.item_ids, false);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(2));
        for (const job of queue.pushes.splice(0)) await writeBack.processPush(job);
        expect(wp.posts.propiedad!.filter((x) => [30, 31].includes(Number(x.id))).map((x) => (x.title as Row).raw).sort()).toEqual(['Apartamento renovado', 'Casa con jardín grande']);
    });

    it('columnas: las del sitio sólo cambian de nombre; las propias son libres y nunca viajan', async () => {
        const slug = L['post:propiedad']!.slug;
        await expect(fieldsService.update(tenantId, slug, String(F['post:propiedad']!['acf:ciudad']), { type: 'long_text' } as never)).rejects.toThrow(/sólo se le puede cambiar el nombre/);
        await expect(fieldsService.remove(tenantId, slug, String(F['post:propiedad']!['acf:ciudad']))).rejects.toThrow(/no se puede borrar mientras se sincronice/);
        const renamed = await fieldsService.update(tenantId, slug, String(F['post:propiedad']!['acf:ciudad']), { label: 'Municipio' } as never);
        expect(renamed.label).toBe('Municipio');
        const own = await fieldsService.create(tenantId, slug, { label: 'Asesor', type: 'text' } as never);
        const casa = (await rows(tenantId, L['post:propiedad']!.id)).find((r) => r[k('post:propiedad', 'wp_id')] === 30)!;
        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), slug, casa.id, { data: { [`f${own.id}`]: 'Carla' } } as never);
        await new Promise((r) => setTimeout(r, 100));
        expect(queue.pushes).toHaveLength(0);
    });

    it('apagar una columna editable la bloquea al instante (la elección se aplica sobre lo guardado)', async () => {
        await svc.update(tenantId, adminId, 'admin', connId, { editable_toggle: { resource: 'post:propiedad', key: 'acf:precio', on: false } });
        const slug = L['post:propiedad']!.slug;
        const casa = (await rows(tenantId, L['post:propiedad']!.id)).find((r) => r[k('post:propiedad', 'wp_id')] === 30)!;
        await expect(recordsService.update(tenantId, admin(), slug, casa.id, { data: { [k('post:propiedad', 'acf:precio')]: 1 } } as never)).rejects.toThrow(/habilítala/);
        await expect(svc.update(tenantId, adminId, 'admin', connId, { editable_toggle: { resource: 'post:propiedad', key: 'link', on: true } })).rejects.toThrow();
    });

    it('la contraseña revocada en WordPress abre un problema y marca la conexión; al volver, se cierra', async () => {
        reports.length = 0;
        wp.password = 'revocada-0000';
        await svc.runJob(tenantId, syncId, {});
        const st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.last_error).toMatch(/rechazó el usuario o la contraseña/);
        const report = reports.find((r) => r.key === `site_sync:${connId}:run`)!;
        expect(report.title).toMatch(/rechazó la conexión/);
        const [conn] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, connId)));
        expect(conn!.lastCheckOk).toBe(false);
        // Reconectar (la contraseña nueva que devuelve «Autorizar aplicación»).
        wp.password = 'otra-buena-9999';
        await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'wordpress', {
            fields: { site_url: 'blog.test', user_login: 'admin', app_password: wp.password },
            visibility: 'workspace',
            connection_id: connId,
        });
        resolved.length = 0;
        await svc.runJob(tenantId, syncId, {});
        expect(resolved).toContain(`site_sync:${connId}:run`);
        const [fixed] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, connId)));
        expect(fixed!.lastCheckOk).toBe(true);

        // Un WordPress real no dice «contraseña incorrecta»: responde como a un
        // anónimo (un 400 «el estado está prohibido» al listar con status=any).
        // Igual se reconoce como contraseña revocada, no como un cambio rechazado.
        const good = wp.password;
        wp.anonymousOnBadAuth = true;
        wp.password = 'revocada-otra-vez';
        reports.length = 0;
        await svc.runJob(tenantId, syncId, {});
        const st2 = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st2.last_error).toMatch(/ya no acepta la contraseña de aplicación/);
        expect(reports.find((r) => r.key === `site_sync:${connId}:run`)!.title).toMatch(/rechazó la conexión/);
        const [again] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, connId)));
        expect(again!.lastCheckOk).toBe(false);
        wp.anonymousOnBadAuth = false;
        wp.password = good;
        await svc.runJob(tenantId, syncId, {});
    });

    it('la tienda y el sitio no se pisan: el tick de la tienda no toma la sincronización del sitio', async () => {
        await pg.db.update(connectionSyncs).set({ nextRunAt: new Date(Date.now() - 60_000) }).where(eq(connectionSyncs.id, syncId));
        expect(await storeSvc.tick()).toBe(0);
        expect(await storeSvc.runJob(tenantId, syncId, {})).toBe(true);
        queue.runs.length = 0;
        expect(await svc.tick()).toBe(1);
        expect(queue.runs).toEqual([{ tenantId, syncId, opts: {} }]);
    });

    it('otra empresa no ve la sincronización ni sus vínculos (RLS)', async () => {
        const rowsOther = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(connectionSyncs));
        const linksOther = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(syncLinks));
        expect(rowsOther).toHaveLength(0);
        expect(linksOther).toHaveLength(0);
        await expect(svc.status(otherTenant, adminId, 'admin', connId)).rejects.toThrow();
    });

    it('el límite de registros del plan corta la carga con un motivo claro', async () => {
        await pg.db.update(tenants).set({ plan: 'mini' }).where(eq(tenants.id, tenantId));
        wp.posts.post!.push(post('post', 13, 'Otra entrada', { categories: [2], tags: [] }));
        await svc.runJob(tenantId, syncId, {});
        const st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.last_error).toMatch(/plan/i);
        await pg.db.update(tenants).set({ plan: 'grande' }).where(eq(tenants.id, tenantId));
    });

    it('dejar de sincronizar conserva las listas y sus datos, y ya se editan libremente', async () => {
        await svc.remove(tenantId, adminId, 'admin', connId);
        const props = await rows(tenantId, L['post:propiedad']!.id);
        expect(props).toHaveLength(4);
        const [list] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, L['post:propiedad']!.id)));
        expect((list!.settings as Record<string, unknown>).site_sync).toBeUndefined();
        const created = await recordsService.create(tenantId, admin(), L['post:propiedad']!.slug, { data: { [k('post:propiedad', 'title')]: 'Ahora sí' } } as never);
        expect(created.id).toBeGreaterThan(0);
    });

    it('borrar la CONEXIÓN también deja las listas libres (y cierra sus problemas)', async () => {
        // Se vuelve a sincronizar sólo las categorías y se borra la conexión.
        await svc.setup(tenantId, adminId, 'admin', connId, { objects: [{ kind: 'taxonomy', object: 'post_tag', columns: ['name'], editable: ['name'] }], write_back: true, interval_minutes: 60, mode: 'interval' });
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs).where(eq(connectionSyncs.connectionId, connId)));
        const listId = (row!.settings as { lists: Record<string, number> }).lists['term:post_tag']!;
        resolved.length = 0;
        wp.calls.length = 0;
        await connectors.remove(tenantId, adminId, 'admin', connId, false);
        // Antes de borrarse, la app borra SU contraseña de aplicación en WordPress.
        expect(wp.calls.some((c) => c.method === 'GET' && c.url.includes('/application-passwords/introspect'))).toBe(true);
        expect(wp.calls.some((c) => c.method === 'DELETE' && /\/application-passwords\/u-main$/.test(new URL(c.url).pathname))).toBe(true);
        const [list] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, listId)));
        expect((list!.settings as Record<string, unknown>).site_sync).toBeUndefined();
        expect(resolved).toContain(`site_sync:${connId}:*`);
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs))).toHaveLength(0);
    });
});
