import { unzipText } from '@imagina-base/shared';
import { and, eq, isNull } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.334 (ADR-S84) — el complemento «Imagina Base Connector» visto desde la
 * app, con Postgres y Redis reales. El sitio se simula en el borde de red
 * (`safeWebhookFetch`): la API de WordPress en lo que usa el motor y las rutas
 * del complemento (`/imagina-base/v1`) con la forma que devuelve el PHP real
 * (verificado contra un WordPress 6.8 con Rank Math, Yoast, SEOPress, AIOSEO,
 * ACF y Meta Box).
 */
type Row = Record<string, unknown>;
interface Call {
    method: string;
    url: string;
    body?: string;
    headers?: Record<string, string>;
}
const wp = vi.hoisted(() => ({
    password: 'good-pass-1234',
    clock: Date.UTC(2026, 9, 1, 12, 0, 0),
    posts: {} as Record<string, Row[]>,
    /** id → valores que da el complemento (`seo:title`, `cf:acf.asesor`…), por objeto. */
    values: {} as Record<string, Record<number, Row>>,
    plugin: { installed: true, pingOk: true, seo: true },
    hook: null as null | { url: string; secret: string; objects: unknown },
    calls: [] as Call[],
}));

vi.mock('../src/common/safe-fetch', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/common/safe-fetch')>();
    const { createHash } = await import('node:crypto');
    const TYPES: Record<string, { rest: string; name: string; supports: string[] }> = {
        post: { rest: 'posts', name: 'Entradas', supports: ['title', 'editor', 'excerpt', 'author'] },
        attachment: { rest: 'media', name: 'Medios', supports: ['title'] },
    };
    const local = () => new Date(wp.clock).toISOString().slice(0, 19);
    const res = (status: number, o: unknown, headers: Record<string, string> = {}) => ({ status, body: JSON.stringify(o), headers });
    const NS = '/imagina-base/v1';
    const READ_ONLY = new Set(['seo:google_title', 'seo:google_description', 'seo:score', 'plugin:words', 'plugin:used_in', 'plugin:used_count']);
    const pluginSchema = () => ({
        version: '1.0.0',
        seo: wp.plugin.seo ? { plugin: 'rank_math', name: 'Rank Math', version: '1.0.280', terms: true, others: [], problem: null } : null,
        objects: [
            {
                kind: 'post_type',
                object: 'post',
                columns: [
                    ...(wp.plugin.seo
                        ? [
                              { key: 'seo:title', label: 'Título SEO', type: 'text', provider: 'seo', editable: true, options: null, image: false, hint: null, private: false, group: 'seo' },
                              { key: 'seo:description', label: 'Descripción SEO', type: 'long_text', provider: 'seo', editable: true, options: null, image: false, hint: null, private: false, group: 'seo' },
                              { key: 'seo:focus_keyword', label: 'Palabra clave', type: 'text', provider: 'seo', editable: true, options: null, image: false, hint: null, private: false, group: 'seo' },
                              { key: 'seo:google_title', label: 'Título en Google', type: 'text', provider: 'seo', editable: false, options: null, image: false, hint: null, private: false, group: 'seo' },
                              { key: 'seo:google_description', label: 'Descripción en Google', type: 'long_text', provider: 'seo', editable: false, options: null, image: false, hint: null, private: false, group: 'seo' },
                          ]
                        : []),
                    { key: 'plugin:words', label: 'Palabras', type: 'number', provider: 'plugin', editable: false, options: null, image: false, hint: null, private: false, group: null },
                    { key: 'cf:acf.precio', label: 'Precio', type: 'number', provider: 'acf', editable: true, options: null, image: false, hint: null, private: false, group: 'acf' },
                    { key: 'cf:acf.asesor', label: 'Asesor', type: 'text', provider: 'acf', editable: true, options: null, image: false, hint: null, private: false, group: 'acf' },
                    {
                        key: 'cf:acf.estado_interno',
                        label: 'Estado interno',
                        type: 'select',
                        provider: 'acf',
                        editable: true,
                        options: [
                            { value: 'disponible', label: 'Disponible' },
                            { value: 'vendida', label: 'Vendida' },
                        ],
                        image: false,
                        hint: null,
                        private: false,
                        group: 'acf',
                    },
                    { key: 'cf:mb.mb_estrato', label: 'Estrato', type: 'number', provider: 'metabox', editable: true, options: null, image: false, hint: null, private: false, group: 'metabox' },
                ],
            },
            {
                kind: 'media',
                object: 'attachment',
                columns: [
                    { key: 'plugin:used_in', label: 'Dónde se usa', type: 'long_text', provider: 'plugin', editable: false, options: null, image: false, hint: null, private: false, group: null },
                    { key: 'plugin:used_count', label: 'Veces usada', type: 'number', provider: 'plugin', editable: false, options: null, image: false, hint: null, private: false, group: null },
                ],
            },
        ],
    });
    const kindKey = (kind: string, object: string) => `${kind}:${object}`;
    const pluginRoute = (path: string, method: string, body: Row): ReturnType<typeof res> => {
        if (!wp.plugin.installed) return res(404, { code: 'rest_no_route', message: 'No se encontró ninguna ruta.' });
        if (path === `${NS}/info`) {
            return res(200, {
                plugin: 'imagina-base-connector',
                version: '1.0.0',
                seo: pluginSchema().seo,
                providers: { acf: true, metabox: true, jetengine: false },
                can_manage: true,
                updates: true,
                hooks: wp.hook ? { registered: true, url: wp.hook.url, objects: wp.hook.objects } : { registered: false },
            });
        }
        if (path === `${NS}/schema`) return res(200, pluginSchema());
        if (path === `${NS}/items/read`) {
            const store = wp.values[kindKey(String(body.kind), String(body.object))] ?? {};
            const fields = (body.fields as string[]) ?? [];
            const items: Record<string, Row> = {};
            for (const id of (body.ids as number[]) ?? []) {
                const v = store[id];
                if (!v) continue;
                const post = (wp.posts[String(body.object)] ?? []).find((p) => p.id === id);
                const title = (post?.title as { raw?: string } | undefined)?.raw ?? '';
                const all: Row = { ...v, 'seo:google_title': `${(v['seo:title'] as string) || title} - Blog de prueba` };
                items[String(id)] = Object.fromEntries(fields.filter((f) => f in all || f.startsWith('seo:') || f.startsWith('cf:')).map((f) => [f, all[f] ?? null]));
            }
            return res(200, { items, skipped: [] });
        }
        if (path === `${NS}/items/write`) {
            const store = (wp.values[kindKey(String(body.kind), String(body.object))] ??= {});
            const out = [];
            for (const it of (body.items as Array<{ id: number; values: Row }>) ?? []) {
                const errors: Record<string, string> = {};
                for (const [k, v] of Object.entries(it.values)) {
                    if (READ_ONLY.has(k)) errors[k] = 'Lo calcula el sitio: no se puede cambiar.';
                    else if (k === 'cf:acf.estado_interno' && v !== null && !['disponible', 'vendida'].includes(String(v))) errors[k] = 'No es una de las opciones.';
                    else (store[it.id] ??= {})[k] = v;
                }
                out.push({ id: it.id, ok: Object.keys(errors).length === 0, errors });
            }
            return res(200, { items: out });
        }
        if (path === `${NS}/hooks`) {
            if (method === 'DELETE') {
                wp.hook = null;
                return res(200, { registered: false });
            }
            if (method === 'POST') {
                wp.hook = { url: String(body.url), secret: String(body.secret), objects: body.objects };
                return res(200, { registered: true, ping: wp.plugin.pingOk ? { ok: true, status: 200, error: null } : { ok: false, status: 0, error: 'cURL error 7: no se pudo conectar' } });
            }
            if (!wp.hook) return res(200, { registered: false, pending: 0, delivered: 0, fails: 0 });
            return res(200, {
                registered: true,
                url: wp.hook.url,
                objects: wp.hook.objects,
                pending: 0,
                delivered: 0,
                fails: 0,
                secret_fingerprint: createHash('sha256').update(wp.hook.secret, 'utf8').digest('hex').slice(0, 16),
            });
        }
        return res(404, { code: 'rest_no_route', message: 'No se encontró ninguna ruta.' });
    };
    return {
        ...real,
        safeWebhookFetch: async (url: string, opts: { method?: string; body?: string; headers?: Record<string, string> }) => {
            const method = opts.method ?? 'GET';
            wp.calls.push({ method, url, body: opts.body, headers: opts.headers });
            const u = new URL(url);
            if (u.host !== 'blog.test') throw new Error('getaddrinfo ENOTFOUND');
            const path = u.pathname.replace(/^\/wp-json/, '').replace(/\/$/, '') || '/';
            const q = u.searchParams;
            if (path === '/' && method === 'GET') {
                return res(200, { name: 'Blog de prueba', home: 'https://blog.test', namespaces: ['wp/v2', 'imagina-base/v1'], authentication: { 'application-passwords': { endpoints: { authorization: 'https://blog.test/wp-admin/authorize-application.php' } } } });
            }
            if (opts.headers?.authorization !== `Basic ${Buffer.from(`admin:${wp.password}`).toString('base64')}`) return res(401, { code: 'incorrect_password', message: 'La contraseña de aplicación no es correcta.' });
            if (path.startsWith('/imagina-base/v1')) return pluginRoute(path, method, (opts.body ? JSON.parse(opts.body) : {}) as Row);
            if (path === '/wp/v2/users/me') return res(200, { id: 1, username: 'admin', name: 'Ana Admin', roles: ['administrator'], capabilities: { edit_posts: true, edit_pages: true, manage_categories: true, upload_files: true } });
            if (path === '/wp/v2/types') {
                return res(200, Object.fromEntries(Object.entries(TYPES).map(([slug, t]) => [slug, { name: t.name, rest_base: t.rest, rest_namespace: 'wp/v2', hierarchical: false, viewable: true, taxonomies: [], supports: Object.fromEntries(t.supports.map((s) => [s, true])) }])));
            }
            if (path === '/wp/v2/taxonomies') return res(200, {});
            if (path === '/wp/v2/users') return res(200, [{ id: 1, name: 'Ana Admin' }]);
            const type = Object.entries(TYPES).find(([, t]) => path.startsWith(`/wp/v2/${t.rest}`));
            if (!type) return res(404, { code: 'rest_no_route', message: 'No se encontró ninguna ruta.' });
            const [typeSlug] = type;
            const list = wp.posts[typeSlug] ?? (wp.posts[typeSlug] = []);
            const one = /\/(\d+)$/.exec(path);
            if (one) {
                const p = list.find((x) => x.id === Number(one[1]));
                if (!p) return res(404, { code: 'rest_post_invalid_id', message: 'ID no válido.' });
                if (method === 'POST') {
                    for (const [k, v] of Object.entries(JSON.parse(opts.body ?? '{}') as Row)) {
                        if (k === 'title' || k === 'excerpt' || k === 'caption') p[k] = { raw: v, rendered: v };
                        else p[k] = v;
                    }
                    wp.clock += 60_000;
                    p.modified = local();
                    p.modified_gmt = local();
                }
                return res(200, p);
            }
            let rows = [...list];
            const status = q.get('status') ?? (typeSlug === 'attachment' ? 'inherit' : 'publish');
            const allowed = status === 'any' ? null : status.split(',');
            rows = rows.filter((x) => (allowed ? allowed.includes(String(x.status)) : x.status !== 'trash'));
            if (q.get('include')) rows = rows.filter((x) => q.get('include')!.split(',').map(Number).includes(Number(x.id)));
            const after = q.get('modified_after');
            if (after) rows = rows.filter((x) => String(x.modified) > after.slice(0, 19));
            if (q.get('orderby') === 'modified') rows.sort((a, b) => String(a.modified).localeCompare(String(b.modified)) || Number(a.id) - Number(b.id));
            const per = Number(q.get('per_page') ?? 10);
            const pageN = Number(q.get('page') ?? 1);
            const pages = Math.max(1, Math.ceil(rows.length / per));
            if (pageN > pages) return res(400, { code: 'rest_post_invalid_page_number', message: 'Página fuera de rango.' });
            return res(200, rows.slice((pageN - 1) * per, pageN * per), { 'x-wp-total': String(rows.length), 'x-wp-totalpages': String(pages) });
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
import { connectionSyncs, memberships, plans, records, storeHooks, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { IncidentHub } from '../src/incidents/incident-hub';
import { ListGroupsService } from '../src/lists/list-groups.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { SiteKitsService } from '../src/site-sync/site-kits.service';
import { SiteRealtimeService, type SiteSyncHookJob } from '../src/site-sync/site-realtime.service';
import { nextRunMinutes, SiteSyncEngine } from '../src/site-sync/site-sync.engine';
import { SiteSyncQueue, type SiteSyncPushJob } from '../src/site-sync/site-sync.queue';
import { SiteSyncService } from '../src/site-sync/site-sync.service';
import { SiteWriteBackService } from '../src/site-sync/site-writeback.service';
import { parsePluginVersion, updateSourcePhp, versionNewer, WordpressPluginService } from '../src/site-sync/wordpress-plugin.service';
import { parseSiteHookBody, secretFingerprint, siteHookSignature, verifySiteSignature } from '../src/site-sync/wordpress/ibc-hooks';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { BlueprintService } from '../src/templates/blueprint.service';
import { pickBundleAssets } from '../src/update/check-updates.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';

// ── Piezas puras ───────────────────────────────────────────────────────────

describe('complemento de WordPress: piezas puras (v0.1.334)', () => {
    it('firma de los avisos: buena, mala, vencida y sin datos', () => {
        const body = '{"type":"events","events":[]}';
        const now = Date.UTC(2026, 9, 1, 12, 0, 0);
        const ts = String(Math.floor(now / 1000));
        const sig = siteHookSignature('secreto', ts, body);
        expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
        expect(verifySiteSignature('secreto', ts, body, sig, now)).toBe('ok');
        expect(verifySiteSignature('otro', ts, body, sig, now)).toBe('bad');
        expect(verifySiteSignature('secreto', ts, `${body} `, sig, now)).toBe('bad');
        expect(verifySiteSignature('secreto', ts, body, sig, now + 301_000)).toBe('stale');
        expect(verifySiteSignature('secreto', undefined, body, sig, now)).toBe('bad');
        expect(verifySiteSignature('', ts, body, sig, now)).toBe('bad');
        expect(secretFingerprint('secreto')).toHaveLength(16);
    });

    it('el cuerpo de un aviso: sólo eventos que se entienden, con tope', () => {
        expect(parseSiteHookBody({ type: 'ping' })).toEqual({ type: 'ping' });
        expect(parseSiteHookBody({ type: 'x' })).toBeNull();
        expect(parseSiteHookBody([1])).toBeNull();
        const parsed = parseSiteHookBody({
            type: 'events',
            events: [
                { kind: 'post', object: 'post', id: 5, action: 'saved' },
                { kind: 'media', object: 'attachment', id: 7, action: 'trashed' },
                { kind: 'raro', object: 'post', id: 1, action: 'saved' },
                { kind: 'post', object: '../x', id: 1, action: 'saved' },
                { kind: 'post', object: 'post', id: -1, action: 'saved' },
            ],
        });
        expect(parsed).toEqual({ type: 'events', events: [{ kind: 'post', object: 'post', id: 5, action: 'saved' }, { kind: 'media', object: 'attachment', id: 7, action: 'trashed' }] });
        const many = parseSiteHookBody({ type: 'events', events: Array.from({ length: 900 }, (_, i) => ({ kind: 'post', object: 'post', id: i + 1, action: 'saved' })) });
        expect(many && many.type === 'events' && many.events.length).toBe(500);
    });

    it('versión del complemento, de dónde actualizarse y qué asset del release es el bundle', () => {
        expect(parsePluginVersion(' * Plugin Name: X\n * Version: 1.2.3\n')).toBe('1.2.3');
        expect(parsePluginVersion('nada')).toBeNull();
        expect(versionNewer('1.10.0', '1.9.9')).toBe(true);
        expect(versionNewer('1.0.0', '1.0.0')).toBe(false);
        expect(versionNewer(null, '1.0.0')).toBe(false);
        const php = updateSourcePhp("https://app.test/o'reilly\\", 'Mi app');
        expect(php).toContain("'url' => 'https://app.test/o\\'reilly\\\\'");
        expect(php.startsWith('<?php')).toBe(true);
        const assets = [{ name: 'imagina-base-connector-1.0.0.zip' }, { name: 'imagina-base-0.1.334.zip' }, { name: 'imagina-base-0.1.334.zip.sha256' }, { name: 'install.sh' }];
        expect(pickBundleAssets(assets, '0.1.334')).toEqual({ zip: { name: 'imagina-base-0.1.334.zip' }, sha: { name: 'imagina-base-0.1.334.zip.sha256' } });
        // Un release viejo con otro nombre: el primer .zip que no es el complemento.
        expect(pickBundleAssets([{ name: 'imagina-base-connector-1.0.0.zip' }, { name: 'bundle.zip' }], '9.9.9').zip).toEqual({ name: 'bundle.zip' });
        expect(nextRunMinutes({ mode: 'realtime', interval_minutes: 15 } as never, true)).toBe(60);
        expect(nextRunMinutes({ mode: 'realtime', interval_minutes: 15 } as never, false)).toBe(15);
        expect(nextRunMinutes({ mode: 'interval', interval_minutes: 30 } as never, true)).toBe(30);
    });

    it('el zip que reparte la app: el complemento entero y de dónde actualizarse', () => {
        const svc = new WordpressPluginService(loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.test/' }));
        expect(svc.version()).toMatch(/^\d+\.\d+\.\d+$/);
        const zip = svc.zip()!;
        expect(zip.filename).toBe('imagina-base-connector.zip');
        const files = unzipText(new Uint8Array(zip.bytes));
        expect(Object.keys(files)).toEqual(expect.arrayContaining(['imagina-base-connector/imagina-base-connector.php', 'imagina-base-connector/uninstall.php', 'imagina-base-connector/includes/class-ibc-rest.php']));
        expect(files['imagina-base-connector/includes/update-source.php']).toContain("'url' => 'https://app.test'");
        // El que se reparte es el mismo código del repo (versión incluida).
        expect(parsePluginVersion(files['imagina-base-connector/imagina-base-connector.php']!)).toBe(svc.version());
        const info = svc.info()!;
        expect(info).toMatchObject({ slug: 'imagina-base-connector', download_url: 'https://app.test/api/v1/public/wordpress-plugin/download', requires_php: '7.4' });
        // Las listas del readme salen como listas (WordPress las muestra en «Ver detalles»).
        expect(info.sections.description).toMatch(/<ul>\n<li>/);
        expect(info.sections.description).not.toMatch(/<script/i);
    });
});

// ── Con el sitio simulado ──────────────────────────────────────────────────

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
    runs: Array<{ tenantId: number; syncId: number }> = [];
    pushes: SiteSyncPushJob[] = [];
    hooks: SiteSyncHookJob[] = [];
    override enqueueRun(tenantId: number, syncId: number): void {
        this.runs.push({ tenantId, syncId });
    }
    override enqueuePush(job: SiteSyncPushJob): boolean {
        this.pushes.push(job);
        return true;
    }
    override enqueueHook(job: SiteSyncHookJob): boolean {
        this.hooks.push(job);
        return true;
    }
}

const local = () => new Date(wp.clock).toISOString().slice(0, 19);
function tick(): string {
    wp.clock += 60_000;
    return local();
}
function post(id: number, title: string, extra: Row = {}): Row {
    const at = tick();
    return {
        id,
        type: 'post',
        status: 'publish',
        date: at,
        date_gmt: at,
        modified: at,
        modified_gmt: at,
        slug: title.toLowerCase().replace(/\s+/g, '-'),
        link: `https://blog.test/${id}/`,
        title: { raw: title, rendered: title },
        excerpt: { raw: '', rendered: '' },
        author: 1,
        acf: { precio: 100 },
        meta: {},
        ...extra,
    };
}
function mediaItem(id: number, title: string, alt: string): Row {
    const at = tick();
    return {
        id,
        type: 'attachment',
        status: 'inherit',
        date: at,
        date_gmt: at,
        modified: at,
        modified_gmt: at,
        slug: title.toLowerCase().replace(/\s+/g, '-'),
        link: `https://blog.test/?attachment_id=${id}`,
        title: { raw: title, rendered: title },
        caption: { raw: '', rendered: '' },
        description: { raw: '', rendered: '' },
        alt_text: alt,
        mime_type: 'image/png',
        source_url: `https://blog.test/wp-content/uploads/${id}.png`,
        media_details: { width: 800, height: 600, filesize: 512_000, sizes: { thumbnail: { source_url: `https://blog.test/wp-content/uploads/${id}-150x150.png` } } },
        author: 1,
        post: 0,
    };
}
function seedSite(): void {
    wp.clock = Date.UTC(2026, 9, 1, 12, 0, 0);
    wp.posts = {
        post: [post(10, 'Hola mundo'), post(11, 'Lanzamiento')],
        attachment: [mediaItem(40, 'Fachada', 'Fachada blanca'), mediaItem(41, 'Sala', '')],
    };
    wp.values = {
        'post_type:post': {
            10: { 'seo:title': 'Hola mundo | Blog', 'seo:description': '', 'cf:acf.precio': 100, 'cf:acf.asesor': 'Laura', 'cf:acf.estado_interno': 'disponible', 'cf:mb.mb_estrato': 3, 'plugin:words': 420 },
            11: { 'seo:title': '', 'seo:description': 'Llegó la versión nueva.', 'cf:acf.precio': 200, 'cf:acf.asesor': 'Pedro', 'cf:acf.estado_interno': 'vendida', 'cf:mb.mb_estrato': 4, 'plugin:words': 80 },
        },
        'media:attachment': {
            40: { 'plugin:used_in': 'Hola mundo', 'plugin:used_count': 1 },
            41: { 'plugin:used_in': null, 'plugin:used_count': 0 },
        },
    };
    wp.plugin = { installed: true, pingOk: true, seo: true };
    wp.hook = null;
    wp.calls = [];
}

describe('Complemento de WordPress en la app (v0.1.334, ADR-S84)', () => {
    let pg: TestPg;
    let rds: TestRedis;
    let redis: Redis;
    let tenantDb: TenantDb;
    let connectors: ConnectorsService;
    let svc: SiteSyncService;
    let realtime: SiteRealtimeService;
    let writeBack: SiteWriteBackService;
    let kits: SiteKitsService;
    let recordsService: RecordsService;
    let fieldsService: FieldsService;
    let views: ViewsService;
    let queue: CapturingQueue;
    let engine: SiteSyncEngine;
    let tenantId: number;
    let adminId: number;
    let connId: number;
    let syncId: number;
    let F: Record<string, Record<string, number>>;
    let L: Record<string, { id: number; slug: string }>;
    const k = (resource: string, key: string) => `f${F[resource]![key]}`;
    const admin = () => ({ userId: adminId, role: 'admin' as const });

    beforeAll(async () => {
        pg = await startPostgres();
        rds = await startRedis();
        redis = new Redis(rds.url);
        tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.test' });
        const rt = new RealtimeService();
        const audit = new AuditService(tenantDb);
        const incidents = new IncidentHub();
        const listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), audit, memoryIntegrationApps(), undefined, incidents);
        const automationsService = new AutomationsService(pg.db, tenantDb, new AutomationsRepository(), listsService, new AutomationScheduler(), new NoHooks(), connectors);
        const plansService = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plansService, new EmailQuotaService(pg.db, plansService), new TenantSmtpService(pg.db, env));
        views = new ViewsService(tenantDb, new ViewsRepository(), listsService, rt);
        const blueprints = new BlueprintService(
            tenantDb,
            listsService,
            fieldsService,
            views,
            automationsService,
            new RecordsRepository(),
            new RelationsRepository(),
            billing,
            rt,
            new DashboardsService(tenantDb, null as never, null as never, null as never),
        );
        const dispatcher = new CapturingDispatcher();
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        const hub = new RecordChangeHub();
        recordsService = new RecordsService(tenantDb, new RecordsRepository(), listsService, fieldsService, rt, activity, dispatcher, new RelationsRepository(), undefined, hub);
        engine = new SiteSyncEngine(tenantDb, fieldsService, billing, rt, dispatcher, activity, redis, incidents);
        queue = new CapturingQueue();
        writeBack = new SiteWriteBackService(tenantDb, engine, queue);
        realtime = new SiteRealtimeService(tenantDb, pg.db, env, engine, queue);
        svc = new SiteSyncService(tenantDb, pg.db, connectors, blueprints, new ListGroupsService(tenantDb), fieldsService, audit, engine, queue, writeBack, realtime, new WordpressPluginService(env), rt);
        writeBack.setCredsResolver((t, s) => svc.credsForSync(t, s));
        realtime.setCredsResolver((t, s) => svc.credsForSync(t, s));
        hub.subscribe((c) => writeBack.onRecordChange(c));
        kits = new SiteKitsService(svc, fieldsService, views, listsService);

        await pg.db.insert(plans).values({ slug: 'grande', name: 'Grande', maxRecords: null }).onConflictDoNothing();
        const [t] = await pg.db.insert(tenants).values({ slug: 'blog-co', name: 'Blog Co', plan: 'grande' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@blog.co', name: 'Admin', passwordHash: 'x' }).returning();
        adminId = u!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: adminId, role: 'admin' }));
        seedSite();
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'wordpress', {
            fields: { site_url: 'https://blog.test', user_login: 'admin', app_password: wp.password },
            visibility: 'workspace',
        });
        connId = connection.id;
    }, 180_000);

    afterAll(async () => {
        redis?.disconnect();
        await rds?.stop();
        await pg?.stop();
    });

    async function rows(listId: number): Promise<Array<Row & { id: number }>> {
        const r = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: records.id, data: records.data }).from(records).where(and(eq(records.listId, listId), isNull(records.deletedAt))));
        return r.map((x) => ({ ...(x.data as Row), id: x.id }));
    }
    const signedPost = async (token: string, payload: unknown, secret: string, ts = String(Math.floor(Date.now() / 1000))) => {
        const raw = JSON.stringify(payload);
        return realtime.receive(token, { 'x-imagina-timestamp': ts, 'x-imagina-signature': siteHookSignature(secret, ts, raw) }, raw, payload);
    };

    it('descubrir con el complemento: SEO, campos con tipo (también los que no están en la API), medios y sin duplicar ACF', async () => {
        const d = await svc.discover(tenantId, adminId, 'admin', connId);
        expect(d.plugin).toMatchObject({ installed: true, version: '1.0.0', seo: { name: 'Rank Math' }, providers: { acf: true, metabox: true, jetengine: false }, can_manage: true });
        const p = d.objects.find((o) => o.object === 'post')!;
        const keys = p.columns.map((c) => c.key);
        expect(keys).toEqual(expect.arrayContaining(['seo:title', 'seo:description', 'seo:google_title', 'plugin:words', 'cf:acf.asesor', 'cf:acf.estado_interno', 'cf:mb.mb_estrato']));
        // ACF llega por la API Y por el complemento: queda una sola columna, la del complemento (tiene el tipo).
        expect(keys).toContain('cf:acf.precio');
        expect(keys).not.toContain('acf:precio');
        expect(p.columns.find((c) => c.key === 'seo:title')).toMatchObject({ source: 'seo', can_edit: true, default_on: true });
        expect(p.columns.find((c) => c.key === 'seo:google_title')).toMatchObject({ source: 'seo', can_edit: false });
        expect(p.columns.find((c) => c.key === 'cf:acf.estado_interno')).toMatchObject({ source: 'plugin', provider: 'acf', type: 'select', options: [{ value: 'disponible', label: 'Disponible' }, { value: 'vendida', label: 'Vendida' }] });
        const m = d.objects.find((o) => o.kind === 'media')!;
        expect(m).toMatchObject({ object: 'attachment', count: 2 });
        expect(m.columns.map((c) => c.key)).toEqual(expect.arrayContaining(['thumbnail', 'alt_text', 'caption', 'filesize', 'plugin:used_in']));
        expect(m.columns.find((c) => c.key === 'thumbnail')).toMatchObject({ image: true });
    });

    it('alta en tiempo real: registra el aviso con su secreto y trae los valores del complemento', async () => {
        const st = await svc.setup(tenantId, adminId, 'admin', connId, {
            objects: [
                { kind: 'post_type', object: 'post', columns: ['title', 'status', 'seo:title', 'seo:description', 'seo:google_title', 'plugin:words', 'cf:acf.precio', 'cf:acf.asesor', 'cf:acf.estado_interno', 'cf:mb.mb_estrato'], editable: ['title', 'seo:title', 'seo:description', 'cf:acf.asesor', 'cf:acf.estado_interno'] },
                { kind: 'media', object: 'attachment', columns: ['title', 'thumbnail', 'alt_text', 'caption', 'filesize', 'plugin:used_in'], editable: ['alt_text', 'caption'] },
            ],
            write_back: true,
            interval_minutes: 15,
            mode: 'realtime',
        });
        expect(st.mode).toBe('realtime');
        expect(st.effective_mode).toBe('realtime');
        expect(st.realtime.registered).toBe(true);
        expect(wp.hook?.url).toMatch(/^https:\/\/app\.test\/api\/v1\/public\/site-hooks\/[A-Za-z0-9_-]{24,}$/);
        expect(wp.hook?.objects).toEqual({ post_types: ['post'], taxonomies: [], media: true });
        // El secreto queda CIFRADO en la tabla (nunca en claro).
        const [h] = await pg.db.select().from(storeHooks);
        expect(h!.secretEnc).not.toContain(wp.hook!.secret);
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connectionSyncs).where(eq(connectionSyncs.connectionId, connId)));
        syncId = row!.id;
        F = (row!.settings as { fields: Record<string, Record<string, number>> }).fields;
        L = Object.fromEntries(st.objects.map((o) => [o.resource, { id: o.list!.id, slug: o.list!.slug }]));
        // La próxima vuelta (red de seguridad) es dentro de una hora, no en 15 minutos.
        expect(new Date(row!.nextRunAt!).getTime() - Date.now()).toBeGreaterThan(50 * 60_000);

        expect(await svc.runJob(tenantId, syncId, { full: true })).toBe(true);
        const status = await svc.status(tenantId, adminId, 'admin', connId);
        expect(status.last_error).toBeNull();
        expect(status.plugin).toMatchObject({ installed: true, version: '1.0.0', seo_name: 'Rank Math' });
        const posts = await rows(L['post:post']!.id);
        const hola = posts.find((r) => r[k('post:post', 'title')] === 'Hola mundo')!;
        expect(hola).toMatchObject({
            [k('post:post', 'seo:title')]: 'Hola mundo | Blog',
            [k('post:post', 'seo:google_title')]: 'Hola mundo | Blog - Blog de prueba',
            [k('post:post', 'plugin:words')]: 420,
            [k('post:post', 'cf:acf.asesor')]: 'Laura',
            [k('post:post', 'cf:acf.estado_interno')]: 'disponible',
            [k('post:post', 'cf:mb.mb_estrato')]: 3,
        });
        const estado = (await fieldsService.listByListId(tenantId, L['post:post']!.id)).find((f) => f.id === F['post:post']!['cf:acf.estado_interno'])!;
        expect(estado.type).toBe('select');
        expect((estado.config as { options: Array<{ label: string }> }).options.map((o) => o.label)).toEqual(expect.arrayContaining(['Disponible', 'Vendida']));
        const media = await rows(L['media:attachment']!.id);
        expect(media.find((r) => r[k('media:attachment', 'title')] === 'Fachada')).toMatchObject({
            [k('media:attachment', 'alt_text')]: 'Fachada blanca',
            [k('media:attachment', 'thumbnail')]: 'https://blog.test/wp-content/uploads/40-150x150.png',
            [k('media:attachment', 'filesize')]: 500,
            [k('media:attachment', 'plugin:used_in')]: 'Hola mundo',
        });
        // Se piden sólo las columnas elegidas, en lote, y nunca el contenido.
        const reads = wp.calls.filter((c) => c.url.includes('/imagina-base/v1/items/read'));
        expect(reads.length).toBeGreaterThan(0);
        expect(JSON.parse(reads[0]!.body!).fields).not.toContain('content');
        expect(wp.calls.every((c) => !/_fields=[^&]*content/.test(decodeURIComponent(c.url)))).toBe(true);
    });

    it('editar desde la app: SEO y campos del complemento viajan por el complemento; lo de WordPress por la API', async () => {
        const posts = await rows(L['post:post']!.id);
        const hola = posts.find((r) => r[k('post:post', 'title')] === 'Hola mundo')!;
        const slug = L['post:post']!.slug;
        // Lo que calcula el plugin de SEO no se edita.
        await expect(recordsService.update(tenantId, admin(), slug, hola.id, { data: { [k('post:post', 'seo:google_title')]: 'x' } } as never)).rejects.toThrow(/plugin de SEO|lo calcula/i);
        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), slug, hola.id, { data: { [k('post:post', 'seo:title')]: 'Hola, ¿qué tal? \\ guía', [k('post:post', 'cf:acf.asesor')]: 'Ana', [k('post:post', 'title')]: 'Hola mundo nuevo' } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        const from = wp.calls.length;
        await writeBack.processPush(queue.pushes[0]!);
        const sent = wp.calls.slice(from).filter((c) => c.method === 'POST');
        const write = sent.find((c) => c.url.includes('/imagina-base/v1/items/write'))!;
        expect(JSON.parse(write.body!)).toEqual({ kind: 'post_type', object: 'post', items: [{ id: 10, values: { 'seo:title': 'Hola, ¿qué tal? \\ guía', 'cf:acf.asesor': 'Ana' } }] });
        expect(write.headers?.['x-imagina-source']).toBe('app');
        const rest = sent.find((c) => c.url.includes('/wp/v2/posts/10'))!;
        expect(JSON.parse(rest.body!)).toEqual({ title: 'Hola mundo nuevo' });
        expect(wp.values['post_type:post']![10]).toMatchObject({ 'seo:title': 'Hola, ¿qué tal? \\ guía', 'cf:acf.asesor': 'Ana' });
        // Lo que ve Google vuelve RELEÍDO del complemento.
        const after = (await rows(L['post:post']!.id)).find((r) => r.id === hola.id)!;
        expect(after[k('post:post', 'seo:google_title')]).toBe('Hola, ¿qué tal? \\ guía - Blog de prueba');

        // Un rechazo del complemento (opción inexistente) se dice y la app vuelve a lo del sitio.
        queue.pushes.length = 0;
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(records)
                .set({ data: { ...(after as Row), id: undefined, [k('post:post', 'cf:acf.estado_interno')]: 'reservada' } })
                .where(eq(records.id, hola.id)),
        );
        await expect(svc.credsForSync(tenantId, syncId).then((c) => engine.push(tenantId, syncId, c!, hola.id, [F['post:post']!['cf:acf.estado_interno']!]))).rejects.toThrow(/Estado interno: No es una de las opciones/);
        const back = (await rows(L['post:post']!.id)).find((r) => r.id === hola.id)!;
        expect(back[k('post:post', 'cf:acf.estado_interno')]).toBe('disponible');

        // El texto alternativo de un medio viaja por la API de WordPress.
        const sala = (await rows(L['media:attachment']!.id)).find((r) => r[k('media:attachment', 'title')] === 'Sala')!;
        queue.pushes.length = 0;
        await recordsService.update(tenantId, admin(), L['media:attachment']!.slug, sala.id, { data: { [k('media:attachment', 'alt_text')]: 'Sala con sofá gris' } } as never);
        await vi.waitFor(() => expect(queue.pushes).toHaveLength(1));
        const f2 = wp.calls.length;
        await writeBack.processPush(queue.pushes[0]!);
        const m = wp.calls.slice(f2).find((c) => c.method === 'POST' && c.url.includes('/wp/v2/media/41'))!;
        expect(JSON.parse(m.body!)).toEqual({ alt_text: 'Sala con sofá gris' });
        expect(wp.posts.attachment!.find((x) => x.id === 41)!.alt_text).toBe('Sala con sofá gris');
    });

    it('avisos: firmados se aplican solos; firma falsa, vencida o token desconocido no tocan nada', async () => {
        const token = /site-hooks\/([^/]+)$/.exec(wp.hook!.url)![1]!;
        const secret = wp.hook!.secret;
        // Un cambio en WordPress (título + SEO) y un medio nuevo.
        const p = wp.posts.post!.find((x) => x.id === 11)!;
        p.title = { raw: 'Lanzamiento 2.0', rendered: '' };
        p.modified = tick();
        p.modified_gmt = p.modified;
        wp.values['post_type:post']![11]!['seo:title'] = 'Lanzamiento | SEO';
        wp.posts.attachment!.push(mediaItem(42, 'Plano', ''));
        wp.values['media:attachment']![42] = { 'plugin:used_in': null, 'plugin:used_count': 0 };

        await expect(signedPost(token, { type: 'events', events: [] }, 'otro-secreto')).rejects.toMatchObject({ status: 401 });
        await expect(signedPost(token, { type: 'events', events: [] }, secret, String(Math.floor(Date.now() / 1000) - 900))).rejects.toMatchObject({ response: { code: 'stale_signature' } });
        await expect(signedPost('token-que-no-existe-12345', { type: 'events', events: [] }, secret)).rejects.toMatchObject({ status: 404 });
        expect(queue.hooks).toHaveLength(0);
        // El ping (al registrar) se acepta y no encola nada.
        await signedPost(token, { type: 'ping' }, secret);
        expect(queue.hooks).toHaveLength(0);

        await signedPost(token, { type: 'events', site: 'x', events: [{ kind: 'post', object: 'post', id: 11, action: 'saved' }, { kind: 'media', object: 'attachment', id: 42, action: 'saved' }] }, secret);
        expect(queue.hooks).toHaveLength(1);
        await realtime.processHook(queue.hooks[0]!, null);
        const posts = await rows(L['post:post']!.id);
        expect(posts.find((r) => r[k('post:post', 'wp_id')] === 11)).toMatchObject({ [k('post:post', 'title')]: 'Lanzamiento 2.0', [k('post:post', 'seo:title')]: 'Lanzamiento | SEO' });
        const media = await rows(L['media:attachment']!.id);
        expect(media.some((r) => r[k('media:attachment', 'title')] === 'Plano')).toBe(true);
        const st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.realtime.received).toBe(2);
        expect(st.realtime.last_at).not.toBeNull();

        // Borrado en WordPress → «Papelera» en la app (nunca se borra nada).
        queue.hooks.length = 0;
        wp.posts.attachment = wp.posts.attachment!.filter((x) => x.id !== 42);
        await signedPost(token, { type: 'events', events: [{ kind: 'media', object: 'attachment', id: 42, action: 'deleted' }] }, secret);
        await realtime.processHook(queue.hooks[0]!, null);
        const plano = (await rows(L['media:attachment']!.id)).find((r) => r[k('media:attachment', 'title')] === 'Plano')!;
        expect(plano[k('media:attachment', 'status')]).toBe('trash');
    });

    it('red de seguridad: si el sitio perdió el aviso (o tiene otro secreto), la vuelta lo vuelve a registrar', async () => {
        wp.hook = null;
        await svc.runJob(tenantId, syncId, {});
        expect(wp.hook).not.toBeNull();
        wp.hook!.secret = 'otro';
        await svc.runJob(tenantId, syncId, {});
        const [h] = await pg.db.select().from(storeHooks);
        expect(secretFingerprint(wp.hook!.secret)).not.toBe(secretFingerprint('otro'));
        expect(h).toBeTruthy();
    });

    it('kits: auditoría SEO y texto alternativo arman fórmulas, vistas y campos con IA (y no se duplican)', async () => {
        const seo = await kits.apply(tenantId, adminId, 'admin', connId, { resource: 'post:post', kit: 'seo_audit' });
        expect(seo.views.map((v) => v.name)).toEqual(expect.arrayContaining(['Sin descripción', 'Título de más de 60 caracteres']));
        expect(seo.added_columns).toEqual(expect.arrayContaining(['seo:focus_keyword', 'seo:google_description']));
        expect(seo.ai_field).toMatchObject({ label: 'Meta descripción sugerida' });
        const fields = await fieldsService.listByListId(tenantId, L['post:post']!.id);
        const len = fields.find((f) => f.slug === 'largo_titulo_google')!;
        expect(len).toMatchObject({ type: 'formula' });
        expect((len.config as { formula: string }).formula).toBe(`LARGO({#${F['post:post']!['seo:google_title']}})`);
        const ai = fields.find((f) => f.slug === 'meta_descripcion_sugerida')!;
        expect(ai.config).toMatchObject({ task: 'custom', auto: false, quality: 'fast' });
        const vs = await views.list(tenantId, String(L['post:post']!.id));
        const sinDesc = vs.find((v) => v.name === 'Sin descripción')!;
        expect(JSON.stringify(sinDesc.config)).toContain(`"field_id":${F['post:post']!['seo:description']}`);
        // De nuevo: nada nuevo.
        const again = await kits.apply(tenantId, adminId, 'admin', connId, { resource: 'post:post', kit: 'seo_audit' });
        expect(again.views).toHaveLength(0);
        expect(again.fields).toHaveLength(0);
        expect(again.ai_field?.id).toBe(ai.id);

        const alt = await kits.apply(tenantId, adminId, 'admin', connId, { resource: 'media:attachment', kit: 'alt_text' });
        expect(alt.views.map((v) => v.name)).toEqual(['Sin texto alternativo', 'Imágenes de más de 300 KB']);
        const altField = (await fieldsService.listByListId(tenantId, L['media:attachment']!.id)).find((f) => f.slug === 'texto_alternativo_sugerido')!;
        expect((altField.config as { inputs: number[] }).inputs).toContain(F['media:attachment']!.thumbnail);
        await expect(kits.apply(tenantId, adminId, 'admin', connId, { resource: 'post:post', kit: 'alt_text' })).rejects.toThrow(/biblioteca de medios/);
    });

    it('sin el complemento: las columnas quedan con lo último, bloqueadas con el motivo, y vuelve a intervalos; al volver, todo sigue', async () => {
        wp.plugin.installed = false;
        await svc.runJob(tenantId, syncId, {});
        let st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.last_error).toBeNull();
        expect(st.effective_mode).toBe('interval');
        expect(st.plugin).toMatchObject({ installed: false });
        expect(st.plugin?.missing_since).not.toBeNull();
        const cols = st.objects.find((o) => o.resource === 'post:post')!.columns;
        expect(cols.filter((c) => c.needs_plugin).map((c) => c.key)).toEqual(expect.arrayContaining(['seo:title', 'cf:acf.asesor', 'plugin:words']));
        expect(cols.find((c) => c.key === 'title')!.needs_plugin).toBe(false);
        const hola = (await rows(L['post:post']!.id)).find((r) => r[k('post:post', 'wp_id')] === 10)!;
        expect(hola[k('post:post', 'seo:title')]).toBe('Hola, ¿qué tal? \\ guía');
        await expect(recordsService.update(tenantId, admin(), L['post:post']!.slug, hola.id, { data: { [k('post:post', 'seo:title')]: 'x' } } as never)).rejects.toThrow(/complemento/);
        // Lo de WordPress sigue editable.
        await recordsService.update(tenantId, admin(), L['post:post']!.slug, hola.id, { data: { [k('post:post', 'title')]: 'Sigue editable' } } as never);
        // Cambiar a «Al instante» sin el complemento se rechaza con el motivo.
        await svc.update(tenantId, adminId, 'admin', connId, { mode: 'interval' });
        await expect(svc.update(tenantId, adminId, 'admin', connId, { mode: 'realtime' })).rejects.toThrow(/complemento/);

        // Vuelve el complemento: las columnas se desbloquean y se puede volver al instante.
        wp.plugin.installed = true;
        await svc.runJob(tenantId, syncId, {});
        st = await svc.update(tenantId, adminId, 'admin', connId, { mode: 'realtime' });
        expect(st.effective_mode).toBe('realtime');
        expect(st.objects.find((o) => o.resource === 'post:post')!.columns.some((c) => c.needs_plugin)).toBe(false);
        expect(st.plugin?.missing_since ?? null).toBeNull();
    });

    it('«Al instante» cuando WordPress no llega a la app: el alta igual sale, en intervalos y con el motivo', async () => {
        await svc.update(tenantId, adminId, 'admin', connId, { mode: 'interval' });
        expect(wp.hook).toBeNull();
        wp.plugin.pingOk = false;
        await expect(svc.update(tenantId, adminId, 'admin', connId, { mode: 'realtime' })).rejects.toThrow(/no pudo llegar a la app/);
        expect(wp.hook).toBeNull();
        const st = await svc.status(tenantId, adminId, 'admin', connId);
        expect(st.mode).toBe('interval');
        wp.plugin.pingOk = true;
    });

    it('dejar de sincronizar apaga el aviso en el sitio y el token deja de valer', async () => {
        await svc.update(tenantId, adminId, 'admin', connId, { mode: 'realtime' });
        const token = /site-hooks\/([^/]+)$/.exec(wp.hook!.url)![1]!;
        const secret = wp.hook!.secret;
        await svc.remove(tenantId, adminId, 'admin', connId);
        expect(wp.hook).toBeNull();
        await expect(signedPost(token, { type: 'events', events: [] }, secret)).rejects.toMatchObject({ status: 404 });
        expect(await pg.db.select().from(storeHooks)).toHaveLength(0);
    });
});
