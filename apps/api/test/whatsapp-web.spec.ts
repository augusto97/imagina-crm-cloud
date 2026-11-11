import { and, eq } from 'drizzle-orm';
import { PublicCache } from '../src/public-cache/public-cache';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WA_WEB_EXTRA_ABILITIES, WA_WEB_HOOK_EVENTS, readWhatsappListFields, whatsappStatusFromWeb } from '@imagina-base/shared';

/**
 * v0.1.389 — La versión nueva de Imagina WAS (API v1 de Zender) de punta a
 * punta con Postgres real. El servidor de WhatsApp se simula en el borde de
 * red (`safeWebhookFetch`) con las respuestas de su documentación (y las que
 * se confirmaron contra el servidor real): conectar (clave, permisos y la lista
 * de números), el aviso que se registra solo con su secreto cifrado, la firma
 * `t=…,v1=…`, el envío con su cuerpo EXACTO, los estados, el mensaje entrante,
 * los avisos de OTRO número del mismo espacio, el problema de la conexión y
 * el aviso que se borra con la conexión.
 */
interface FakeCall {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}
const net = vi.hoisted(() => ({
    calls: [] as FakeCall[],
    handler: (_call: FakeCall): { status: number; body: string } => ({ status: 404, body: '' }),
}));
vi.mock('../src/common/safe-fetch', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/common/safe-fetch')>();
    return {
        ...real,
        safeWebhookFetch: async (url: string, opts: { method?: string; headers?: Record<string, string>; body?: string }) => {
            const call = { url, method: opts.method, headers: opts.headers, body: opts.body };
            net.calls.push(call);
            const res = net.handler(call);
            return { status: res.status, body: res.body, contentType: 'application/json' };
        },
    };
});

import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { loadEnv } from '../src/config/env';
import { buildIntegrationRequest, checkIntegrationResponse } from '../src/connectors/integration-calls';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { activity, automationRuns, automations, connections, fields, lists, records, tenants, users, whatsappContacts, whatsappHooks } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { IncidentHub, type IncidentReport } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { whatsappSchema } from '../src/ai/tools/whatsapp-ai';
import { emptyMaps, remapWhatsappConnectionConfig } from '../src/platform/tenant-transfer.remap';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import {
    parseWaWebError,
    parseWaWebHook,
    signWaWebBody,
    verifyWaWebSignature,
    waWebCreds,
    waWebErrorText,
    waWebSendRequest,
} from '../src/whatsapp/whatsapp-web';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { describeWhatsPlan, pickConversation, planWhatsAction } from '../src/whatsapp/whats-actions';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const WAS = 'https://whats.imagina.cloud/api/v1';
const API_KEY = '2|clave-de-api-de-prueba-abcdefghijklmnop';
const HOOK_SECRET = 'secreto-del-aviso-de-imagina-was-0123';
const ALL = ['account.view', 'wa.accounts.view', 'wa.send', 'wa.read', 'webhooks.manage'];

class NullMail implements MailTransport {
    readonly name = 'null';
    send(_m: MailMessage): Promise<void> {
        return Promise.resolve();
    }
}

class CapturingDispatcher extends AutomationDispatcher {
    events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

/** Un mensaje como lo manda Imagina WAS en sus avisos (la forma `Message` de su API). */
function waMessage(over: Record<string, unknown>): Record<string, unknown> {
    return {
        reference: null,
        id: 42,
        to: '+573001112233',
        from: '+573178339119',
        direction: 'out',
        sender: '+573178339119',
        body: 'Hola',
        type: 'text',
        kind: 'text',
        channel: 'wa',
        connection: { type: 'wa', id: 1 },
        status: 'sent',
        failure_reason: null,
        error: null,
        error_message: null,
        error_reason: null,
        attachments: [],
        sent_at: null,
        delivered_at: null,
        read_at: null,
        created_at: new Date().toISOString(),
        ...over,
    };
}

function delivery(event: string, payload: Record<string, unknown>): string {
    return JSON.stringify({ id: `d-${event}-${String(payload.id)}`, event, payload, sent_at: new Date().toISOString() });
}

describe('WhatsApp — WAS v1 (v0.1.389)', () => {
    let pg: TestPg;
    let connectors: ConnectorsService;
    let svc: WhatsappService;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let engine: AutomationEngine;
    let dispatcher: CapturingDispatcher;
    let incidents: IncidentReport[];
    let tenantId: number;
    let adminId: number;
    let sent: Array<Record<string, unknown>>;
    let abilities: string[];
    let keyOk: string;
    let hooksCreated: number;
    let hooksDeleted: number[];
    let hooksPatched: number;
    let hookEvents: string[];
    let account1: Record<string, unknown>;
    let sendError: { status: number; body: string } | null;
    // v0.1.401 — lo que el Whats simulado guarda del resto de la API.
    let waContacts: Array<{ id: number; phone: string; name: string | null; email: string | null }>;
    let waTags: Array<{ id: number; name: string }>;
    let waGroups: Array<{ id: number; name: string }>;
    let waFlows: Array<{ id: number; name: string; status: string }>;
    let waConvs: Array<{ id: number; contact_id: number; channel: string; status: string; last_message_at: string }>;
    let dripRefuse: boolean;
    let ops: Array<{ method: string; path: string; body: unknown }>;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.imagina.test' });
        const store = memoryOAuthStore();
        const audit = new AuditService(tenantDb);
        const hub = new IncidentHub();
        incidents = [];
        hub.subscribe({ report: (r) => void incidents.push(r), resolve: () => undefined, resolvePrefix: () => undefined });
        connectors = new ConnectorsService(tenantDb, pg.db, env, store, audit, new IntegrationAppsService(store, env), undefined, hub);
        const rt = new RealtimeService();
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        dispatcher = new CapturingDispatcher();
        const activitySvc = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        const recordsSvc = new RecordsService(tenantDb, new RecordsRepository(), listsService, fieldsService, rt, activitySvc, dispatcher, new RelationsRepository());
        svc = new WhatsappService(
            tenantDb,
            pg.db,
            env,
            store as never,
            connectors,
            listsService,
            fieldsService,
            new RecordsRepository(),
            activitySvc,
            rt,
            dispatcher,
            audit,
            recordsSvc,
            hub,
            undefined,
            // v0.1.391 — con la caché en memoria, como en producción (cambiar la lista se ve al instante).
            new PublicCache({ maxEntries: 100, concurrency: 4, maxQueue: 50, queueTimeoutMs: 2_000 }) as never,
        );
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), new NullMail()),
            connectors,
        );
        engine.setWhatsapp(svc);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-was', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme-was.test', passwordHash: 'x', name: 'Ada' }).returning();
        adminId = u!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        net.calls.length = 0;
        sent = [];
        incidents.length = 0;
        dispatcher.events.length = 0;
        abilities = [...ALL];
        keyOk = API_KEY;
        hooksCreated = 0;
        hooksPatched = 0;
        hookEvents = [];
        hooksDeleted = [];
        sendError = null;
        waContacts = [];
        waTags = [{ id: 1, name: 'Cliente' }];
        waGroups = [{ id: 7, name: 'Clientes 2026' }];
        waFlows = [
            { id: 31, name: 'Bienvenida', status: 'active' },
            { id: 32, name: 'Encuesta', status: 'draft' },
        ];
        waConvs = [];
        dripRefuse = false;
        ops = [];
        account1 = { id: 1, phone: '+573178339119', display_name: 'Augusto', label: null, status: 'connected', is_enabled: true, status_reason: null, banned_until: null };
        fakeWas();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(whatsappContacts).where(eq(whatsappContacts.tenantId, tenantId));
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(activity).where(eq(activity.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        await pg.db.delete(whatsappHooks).where(eq(whatsappHooks.tenantId, tenantId));
        await withTenant(pg.db, tenantId, (tx) => tx.delete(connections).where(eq(connections.tenantId, tenantId)));
    });

    // ── Imagina WAS simulado ────────────────────────────────────────────

    function fakeWas(): void {
        let n = 100;
        const json = (status: number, body: unknown) => ({ status, body: JSON.stringify(body) });
        net.handler = (call) => {
            if (!call.url.startsWith(WAS)) return { status: 404, body: '' };
            if (call.headers?.authorization !== `Bearer ${keyOk}`) return json(401, { error: { code: 'unauthenticated', message: 'Unauthenticated.' } });
            const path = call.url.slice(WAS.length).split('?')[0]!;
            const need = (ability: string) => (abilities.includes(ability) ? null : json(403, { error: { code: 'missing_ability', message: 'The token does not allow this action.', details: { ability } } }));
            if (path === '/me') {
                return json(200, {
                    data: {
                        profile: { id: 2, name: 'Augusto' },
                        workspace: { name: 'Augusto', host: 'whats.imagina.cloud' },
                        plan: { name: 'Pro', features: { api: true, wa: true } },
                        credits: { balance: 0 },
                        token: { name: 'Imagina Base', abilities, expires_at: null },
                    },
                });
            }
            if (path === '/whatsapp/accounts') {
                return (
                    need('wa.accounts.view') ??
                    json(200, {
                        data: [account1, { id: 2, phone: '+573000000001', display_name: 'Soporte', status: 'disconnected', is_enabled: true }],
                        links: {},
                        meta: { next_cursor: null },
                    })
                );
            }
            if (path === '/whatsapp/accounts/1') return need('wa.accounts.view') ?? json(200, { data: account1 });
            if (path === '/webhooks' && call.method === 'POST') {
                const denied = need('webhooks.manage');
                if (denied) return denied;
                hooksCreated++;
                const body = JSON.parse(call.body ?? '{}') as Record<string, unknown>;
                hookEvents = (body.events as string[]) ?? [];
                // 201 con `WebhookCreated` SIN envoltorio `data` (así lo documenta la API).
                return json(201, { id: 55, secret: HOOK_SECRET, events: body.events, url: body.url });
            }
            if (path === '/webhooks/55' && call.method === 'GET') return json(200, { data: { id: 55, is_active: true, events: hookEvents } });
            if (path === '/webhooks/55' && call.method === 'PATCH') {
                hooksPatched++;
                hookEvents = (JSON.parse(call.body ?? '{}') as { events: string[] }).events;
                return json(200, { data: { id: 55, is_active: true, events: hookEvents } });
            }
            if (path.startsWith('/webhooks/') && call.method === 'DELETE') {
                hooksDeleted.push(Number(path.split('/').pop()));
                return { status: 204, body: '' };
            }
            if (path === '/messages/whatsapp' && call.method === 'POST') {
                const denied = need('wa.send');
                if (denied) return denied;
                if (sendError) return sendError;
                const body = JSON.parse(call.body ?? '{}') as Record<string, unknown>;
                sent.push(body);
                n++;
                return json(202, { data: { ...waMessage({ id: n, to: body.to, body: body.body ?? null, status: 'queued' }), contact_id: 500 } });
            }
            // ── v0.1.401: contactos, etiquetas, grupos, flujos, goteos y la bandeja ──
            const body = call.body ? (JSON.parse(call.body) as Record<string, unknown>) : {};
            if (call.method !== 'GET') ops.push({ method: call.method ?? 'GET', path, body });
            const page = (rows: unknown[], size = 2) => {
                // Páginas chicas a propósito: el servidor tiene que seguir el cursor.
                const cursor = Number(new URL(call.url).searchParams.get('cursor') ?? '0');
                const next = cursor + size < rows.length ? String(cursor + size) : null;
                return json(200, { data: rows.slice(cursor, cursor + size), links: {}, meta: { next_cursor: next } });
            };
            if (path === '/contacts/lookup') {
                const denied = need('contacts.view');
                if (denied) return denied;
                const phone = new URL(call.url).searchParams.get('phone');
                const c = waContacts.find((x) => x.phone === phone);
                return c ? json(200, { data: c }) : json(404, { error: { code: 'not_found', message: 'Contact not found.' } });
            }
            if (path === '/contacts' && call.method === 'PUT') {
                const denied = need('contacts.manage');
                if (denied) return denied;
                let c = waContacts.find((x) => x.phone === body.phone);
                if (!c) {
                    c = { id: 600 + waContacts.length, phone: String(body.phone), name: null, email: null };
                    waContacts.push(c);
                }
                if (typeof body.name === 'string') c.name = body.name;
                if (typeof body.email === 'string') c.email = body.email;
                return json(200, { data: c });
            }
            if (path === '/contacts/fields') return page([{ key: 'ciudad', label: 'Ciudad', type: 'text' }, { key: 'plan', label: 'Plan', type: 'select' }]);
            const m = /^\/contacts\/(\d+)\/(tags|notes|consent)$/.exec(path);
            if (m) {
                if (!waContacts.some((x) => x.id === Number(m[1]))) return json(404, { error: { code: 'contact_not_found', message: 'Contact not found.' } });
                if (m[2] === 'tags') return need('tags.manage') ?? json(200, { data: { attached: (body.tag_ids as number[]).length } });
                return json(201, { data: { id: 1 } });
            }
            if (path === '/tags' && call.method === 'GET') return need('tags.view') ?? page(waTags);
            if (path === '/tags' && call.method === 'POST') {
                const t = { id: 10 + waTags.length, name: String(body.name) };
                waTags.push(t);
                return json(201, { data: t });
            }
            if (path === '/groups' && call.method === 'GET') return page(waGroups);
            if (path === '/groups' && call.method === 'POST') {
                const g = { id: 20 + waGroups.length, name: String(body.name) };
                waGroups.push(g);
                return json(201, { data: g });
            }
            if (/^\/groups\/\d+\/contacts$/.test(path)) return json(200, { data: { added: 1 } });
            if (path === '/unsubscribed') return json(201, { data: { phone: body.phone } });
            if (path === '/flows') return page(waFlows);
            const flow = /^\/flows\/(\d+)\/trigger$/.exec(path);
            if (flow) {
                const f = waFlows.find((x) => x.id === Number(flow[1]));
                if (!f || f.status !== 'active') return json(422, { error: { code: 'flow_not_active', message: 'The flow is not active.' } });
                return json(202, { data: { id: 777, status: 'running' } });
            }
            if (/^\/flow-runs\/\d+\/resume$/.test(path)) return json(202, { data: { id: Number(path.split('/')[2]), status: 'running' } });
            if (path === '/drips') return page([{ id: 41, name: 'Onboarding', status: 'active' }]);
            if (/^\/drips\/\d+\/enroll$/.test(path)) return json(200, { data: dripRefuse ? { enrolled: 0, refused: 1 } : { enrolled: 1, refused: 0 } });
            if (path === '/conversations') return json(200, { data: waConvs, links: {}, meta: { next_cursor: null } });
            if (/^\/conversations\/\d+\/reply$/.test(path)) return need('messenger.send') ?? json(201, { data: { id: 9001 } });
            if (/^\/conversations\/\d+\/(resolve|reopen)$/.test(path)) return json(200, { data: { id: Number(path.split('/')[2]) } });
            return json(404, { error: { code: 'not_found', message: 'Not found.' } });
        };
    }

    const admin = (): { userId: number; role: 'admin' } => ({ userId: adminId, role: 'admin' });

    async function connect(fields: Record<string, string> = {}): Promise<number> {
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'whatsapp_web', {
            fields: { api_key: API_KEY, account: '1', ...fields },
            visibility: 'workspace',
        });
        // El aviso se registra en segundo plano al conectar.
        await vi.waitFor(async () => {
            const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, connection.id)));
            expect((row!.config as Record<string, unknown>).whatsapp_web).toBeTruthy();
        });
        return connection.id;
    }

    async function seedContacts(connId: number): Promise<{ listId: number; fieldsBy: Record<string, number> }> {
        const list = await listsService.create(tenantId, { name: 'Clientes', slug: 'clientes' });
        await fieldsService.create(tenantId, 'clientes', { label: 'Nombre', type: 'text' });
        await fieldsService.create(tenantId, 'clientes', { label: 'Teléfono', type: 'phone', config: { default_country: 'CO' } });
        await svc.setupListColumns(tenantId, admin(), 'clientes');
        await svc.updateConfig(tenantId, admin(), connId, { inbound_list_id: list.id, create_contacts: true });
        const all = await fieldsService.listByListId(tenantId, list.id);
        const fieldsBy: Record<string, number> = {};
        for (const f of all) fieldsBy[f.slug] = f.id;
        return { listId: list.id, fieldsBy };
    }

    async function listRecords(listId: number): Promise<Array<{ id: number; data: Record<string, unknown> }>> {
        const rows = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(and(eq(records.tenantId, tenantId), eq(records.listId, listId))));
        return rows.map((r) => ({ id: r.id, data: r.data as Record<string, unknown> })).sort((a, b) => a.id - b.id);
    }

    async function post(connId: number, event: string, payload: Record<string, unknown>, secret = HOOK_SECRET): Promise<void> {
        const h = await svc.ensureHook(tenantId, connId);
        const body = delivery(event, payload);
        await svc.receive(h.token, body, { web: signWaWebBody(secret, body), event });
    }

    // ── Piezas puras ────────────────────────────────────────────────────

    it('piezas puras: el envío, los errores en palabras, la firma y los avisos', () => {
        const c = waWebCreds({ secret: API_KEY, accessToken: '', fields: { account: '1', server: 'https://whats.imagina.cloud/' } });
        const req = waWebSendRequest(c, { kind: 'text', to: '573001112233', text: 'Hola' });
        expect(req.url).toBe(`${WAS}/messages/whatsapp`);
        expect(req.headers).toMatchObject({ authorization: `Bearer ${API_KEY}`, accept: 'application/json', 'content-type': 'application/json' });
        expect(JSON.parse(req.body!)).toEqual({ to: '+573001112233', type: 'text', wa_account_id: 1, body: 'Hola' });
        const media = waWebSendRequest(c, { kind: 'media', to: '+573001112233', url: 'https://files.test/f.pdf', caption: '' });
        expect(JSON.parse(media.body!)).toEqual({ to: '+573001112233', type: 'media', wa_account_id: 1, media_url: 'https://files.test/f.pdf' });

        // El mismo armado por el camino genérico (Probar ahora) y su lectura.
        const generic = buildIntegrationRequest('whatsapp_web', 'send_text', { values: { recipient: '300 111 2233', message: 'Hola' }, lines: {} }, {
            secret: API_KEY,
            accessToken: '',
            fields: { account: '1', account_phone: '+573178339119' },
        });
        expect(JSON.parse(generic.body!).to).toBe('+573001112233');
        expect(() => buildIntegrationRequest('whatsapp_web', 'send_media', { values: { recipient: '+573001112233', url: 'http://x' }, lines: {} }, { secret: API_KEY, accessToken: '', fields: { account: '1' } })).toThrow(/https/);
        expect(checkIntegrationResponse('whatsapp_web', 202, '{"data":{"id":1}}')).toBeNull();

        const text = (status: number, error: Record<string, unknown>) => waWebErrorText(parseWaWebError(status, JSON.stringify({ error }))!);
        expect(text(403, { code: 'missing_ability', details: { ability: 'wa.send' } })).toMatch(/permiso «wa\.send \(enviar mensajes\)»/);
        expect(text(429, { code: 'rate_limited', details: { reason: 'wa_warmup_cap_reached' } })).toMatch(/calentamiento/);
        expect(text(429, { code: 'rate_limited', details: { scope: 'sending_limit', retry_after: 40 } })).toMatch(/40 segundos/);
        expect(text(422, { code: 'validation_failed', details: { fields: { to: ['Enter a valid phone number.'] } } })).toMatch(/número de destino no es válido/);
        expect(text(422, { code: 'not_on_whatsapp' })).toBe('Ese número no tiene WhatsApp.');
        expect(text(500, {})).toMatch(/tuvo un problema/);

        const body = delivery('wa.message.read', waMessage({ status: 'read' }));
        const now = Math.floor(Date.now() / 1000);
        const sig = signWaWebBody(HOOK_SECRET, body, now);
        expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
        expect(verifyWaWebSignature(HOOK_SECRET, body, sig, String(now), now)).toBe(true);
        expect(verifyWaWebSignature('otro', body, sig, String(now), now)).toBe(false);
        expect(verifyWaWebSignature(HOOK_SECRET, `${body} `, sig, String(now), now)).toBe(false);
        // El timestamp de la cabecera tiene que ser el de la firma, y la firma no puede ser vieja.
        expect(verifyWaWebSignature(HOOK_SECRET, body, sig, String(now + 1), now)).toBe(false);
        expect(verifyWaWebSignature(HOOK_SECRET, body, sig, String(now), now + 20 * 60)).toBe(false);
        expect(verifyWaWebSignature(HOOK_SECRET, body, undefined, undefined, now)).toBe(false);

        const inbound = parseWaWebHook(JSON.parse(delivery('wa.message.received', waMessage({ id: 9, direction: 'in', from: '+573001112233', body: 'Hola', status: 'received' }))));
        expect(inbound).toMatchObject({ event: 'wa.message.received', accountId: 1, message: { waId: '573001112233', text: 'Hola', id: 'web-9', phoneNumberId: '1' } });
        const image = parseWaWebHook(
            JSON.parse(delivery('wa.message.received', waMessage({ direction: 'in', type: 'image', kind: 'media', body: null, attachments: [{ url: null, mime: 'image/jpeg', name: 'a.jpg' }] }))),
        );
        expect(image.message?.text).toBe('[Imagen]');
        const group = parseWaWebHook(JSON.parse(delivery('wa.message.received', waMessage({ direction: 'in', from: '12036302@g.us' }))));
        expect(group.message).toBeNull();
        const failed = parseWaWebHook(JSON.parse(delivery('wa.message.failed', waMessage({ status: 'failed', failure_reason: 'no_whatsapp', error_reason: null }))));
        expect(failed.status).toMatchObject({ id: '42', status: 'failed', failureReason: 'no_whatsapp' });
        expect(failed.status?.errors[0]?.message).toBe('Ese número no tiene WhatsApp.');
        expect(parseWaWebHook({ event: 'webhook.test', payload: {} }).status).toBeNull();
        expect(whatsappStatusFromWeb('queued')).toBeNull();
        expect(whatsappStatusFromWeb('canceled')).toBe('fallido');

        // Migración de empresa: el aviso del origen no viaja; la lista de entrada se re-mapea.
        const maps = emptyMaps();
        maps.list.set(10, 99);
        expect(
            remapWhatsappConnectionConfig('whatsapp_web', { fields: { account: '1' }, whatsapp: { inbound_list_id: 10 }, whatsapp_web: { hook_id: 55, hook_url: 'x', error: null } }, maps),
        ).toEqual({ fields: { account: '1' }, whatsapp: { inbound_list_id: 99 } });
    });

    // ── Conectar ────────────────────────────────────────────────────────

    it('conectar: la clave se verifica, se lista los números y el aviso se registra solo con su secreto cifrado', async () => {
        // Clave mala o sin permiso de enviar: no se guarda.
        keyOk = 'otra';
        await expect(connectors.verifyIntegration(tenantId, adminId, 'admin', 'whatsapp_web', { fields: { api_key: API_KEY } })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/clave de API ya no sirve/) });
        keyOk = API_KEY;
        abilities = ['account.view', 'wa.accounts.view'];
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'whatsapp_web', { fields: { api_key: API_KEY, account: '1' }, visibility: 'workspace' }),
        ).rejects.toThrow(/permiso para enviar/);
        expect(await connectors.list(tenantId, adminId, 'admin')).toHaveLength(0);

        // «Buscar mis cuentas»: los números con su estado.
        abilities = [...ALL];
        const lookup = await connectors.verifyIntegration(tenantId, adminId, 'admin', 'whatsapp_web', { fields: { api_key: API_KEY } });
        expect(lookup.ok).toBe(true);
        expect(lookup.options.account).toEqual([
            { value: '1', label: '+573178339119 · Augusto · Conectado' },
            { value: '2', label: '+573000000001 · Soporte · Desconectado' },
        ]);
        // Elegir un número desconectado avisa (sin bloquear).
        const off = await connectors.verifyIntegration(tenantId, adminId, 'admin', 'whatsapp_web', { fields: { api_key: API_KEY, account: '2' } });
        expect(off.warning).toMatch(/Desconectado/);
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'whatsapp_web', { fields: { api_key: API_KEY, account: '7' }, visibility: 'workspace' }),
        ).rejects.toThrow(/no está en tu cuenta/);

        const id = await connect();
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, id)));
        const config = row!.config as Record<string, unknown>;
        expect(config.account_label).toBe('+573178339119 · Augusto');
        expect(config.whatsapp_web).toMatchObject({ hook_id: 55, error: null });
        expect(String((config.whatsapp_web as Record<string, unknown>).hook_url)).toMatch(/^https:\/\/app\.imagina\.test\/api\/v1\/public\/whatsapp\//);
        // La clave y el secreto del aviso, cifrados: nunca en claro en la fila.
        expect(JSON.stringify(row!.secrets)).not.toContain(API_KEY);
        expect(JSON.stringify(row!.secrets)).not.toContain(HOOK_SECRET);
        expect(hooksCreated).toBe(1);
        const create = net.calls.find((c) => c.url === `${WAS}/webhooks` && c.method === 'POST')!;
        // v0.1.391 — Sin lista de entrada ni columna de estado: sólo las fallas (nada más se usa).
        expect(JSON.parse(create.body!)).toMatchObject({ events: ['wa.message.failed', 'wa.message.canceled'], is_active: true });
        expect(WA_WEB_HOOK_EVENTS).toContain('wa.message.received');

        // Abrir la pantalla no lo vuelve a crear (sigue activo); el número se ve como está AHORA.
        const detail = await svc.connectionDetail(tenantId, admin(), id);
        expect(hooksCreated).toBe(1);
        expect(detail.provider).toBe('whatsapp_web');
        expect(detail.web).toMatchObject({ account: { id: 1, status: 'connected', status_label: 'Conectado' }, missing_abilities: [], hook: { registered: true, error: null } });
        expect(detail.templates).toEqual([]);

        // Borrar la conexión saca el aviso de Imagina WAS.
        await connectors.remove(tenantId, adminId, 'admin', id, false);
        expect(hooksDeleted).toEqual([55]);
    });

    it('sin permiso de avisos: se conecta igual, avisa qué falta y la pantalla lo dice', async () => {
        abilities = ['account.view', 'wa.accounts.view', 'wa.send'];
        const res = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'whatsapp_web', {
            fields: { api_key: API_KEY, account: '1' },
            visibility: 'workspace',
        });
        expect(res.warning).toMatch(/webhooks\.manage/);
        const detail = await vi.waitFor(async () => {
            const d = await svc.connectionDetail(tenantId, admin(), res.connection.id);
            expect(d.web?.hook.error).toMatch(/webhooks\.manage/);
            return d;
        });
        expect(detail.web?.missing_abilities).toEqual(['wa.read', 'webhooks.manage']);
        expect(hooksCreated).toBe(0);
    });

    // ── Avisos ──────────────────────────────────────────────────────────

    it('avisos: firma mala 401; un mensaje entrante crea el contacto y corre el disparador; el de OTRO número se ignora', async () => {
        const id = await connect();
        const { listId, fieldsBy } = await seedContacts(id);
        const h = await svc.ensureHook(tenantId, id);
        const body = delivery('wa.message.received', waMessage({ id: 7, direction: 'in', from: '+573001112233', body: 'Hola', status: 'received' }));
        await expect(svc.receive(h.token, body, { web: signWaWebBody('secreto-falso', body) })).rejects.toMatchObject({ status: 401 });
        await expect(svc.receive(h.token, body, { meta: 'sha256=00' })).rejects.toMatchObject({ status: 401 });
        expect(await listRecords(listId)).toHaveLength(0);

        await post(id, 'wa.message.received', waMessage({ id: 7, direction: 'in', from: '+573001112233', body: '¿Tienen turno mañana?', status: 'received' }));
        let rows = await listRecords(listId);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.data[`f${fieldsBy.telefono}`]).toBe('+573001112233');
        expect(rows[0]!.data[`f${fieldsBy.whatsapp_ultimo_mensaje}`]).toBe('¿Tienen turno mañana?');
        expect(rows[0]!.data[`f${fieldsBy.whatsapp_direccion}`]).toBe('entrante');
        const ev = dispatcher.events.find((e) => e.trigger === 'whatsapp_message_received');
        expect(ev?.whatsapp).toMatchObject({ texto: '¿Tienen turno mañana?', de: '+573001112233', conexion_id: id });

        // El repetido (Imagina WAS reintenta) no se procesa dos veces.
        dispatcher.events.length = 0;
        await post(id, 'wa.message.received', waMessage({ id: 7, direction: 'in', from: '+573001112233', body: '¿Tienen turno mañana?', status: 'received' }));
        expect(dispatcher.events).toHaveLength(0);

        // Un mensaje que llegó a OTRO número del mismo espacio de trabajo no es de esta conexión.
        await post(id, 'wa.message.received', waMessage({ id: 8, direction: 'in', from: '+573009998877', body: 'Hola', status: 'received', connection: { type: 'wa', id: 2 } }));
        rows = await listRecords(listId);
        expect(rows).toHaveLength(1);
    });

    // ── Enviar ──────────────────────────────────────────────────────────

    it('v0.1.391 — WAS manda sólo los avisos que algo usa; lo que llega de más se descarta sin tocar nada', async () => {
        const id = await connect();
        expect(hookEvents.sort()).toEqual(['wa.message.canceled', 'wa.message.failed']);
        // Lista de entrada con la columna de estado: se suman los estados y los mensajes que te escriben.
        const { listId, fieldsBy } = await seedContacts(id);
        expect(hooksCreated).toBe(1);
        expect(hooksPatched).toBeGreaterThan(0);
        expect(hookEvents.sort()).toEqual(['wa.message.canceled', 'wa.message.delivered', 'wa.message.failed', 'wa.message.read', 'wa.message.received', 'wa.message.sent']);
        const detail = await svc.connectionDetail(tenantId, admin(), id);
        expect(detail.listening).toMatchObject({ inbound: true, statuses: true, status_lists: ['Clientes'] });
        expect(detail.listening.events?.sort()).toEqual([...hookEvents].sort());

        // Sin lista de entrada: WAS deja de mandar los mensajes que te escriben…
        await svc.updateConfig(tenantId, admin(), id, { inbound_list_id: null, create_contacts: true });
        expect(hookEvents).not.toContain('wa.message.received');
        // …y si alguno llega igual (el rato hasta que WAS se entera), no crea ni encola nada.
        await post(id, 'wa.message.received', waMessage({ id: 801, direction: 'in', from: '+573001119999', body: 'hola', status: 'received' }));
        expect(await listRecords(listId)).toHaveLength(0);
        const contacts = await withTenant(pg.db, tenantId, (tx) => tx.select().from(whatsappContacts).where(eq(whatsappContacts.tenantId, tenantId)));
        expect(contacts).toHaveLength(0);

        // Sin columna de estado: sólo las fallas. Un «entregado» que llega se descarta; una falla, no.
        const noStatus = { ...readWhatsappListFields({}), phone: fieldsBy.telefono!, message: fieldsBy.whatsapp_ultimo_mensaje! };
        await svc.updateListColumns(tenantId, admin(), String(listId), noStatus);
        expect(hookEvents.sort()).toEqual(['wa.message.canceled', 'wa.message.failed']);
        expect((await svc.connectionDetail(tenantId, admin(), id)).listening).toMatchObject({ inbound: false, statuses: false, status_lists: [] });

        // La revisión de cada hora no llama a WAS si ya está como debe.
        const before = net.calls.length;
        expect(await svc.reconcileWebHooks()).toBe(0);
        expect(net.calls.length).toBe(before);
        // Un aviso registrado por una versión anterior (todos los eventos, sin la lista guardada) se ajusta.
        await withTenant(pg.db, tenantId, async (tx) => {
            const [row] = await tx.select({ config: connections.config }).from(connections).where(eq(connections.id, id));
            const cfg = row!.config as Record<string, unknown>;
            const web = { ...(cfg.whatsapp_web as Record<string, unknown>) };
            delete web.events;
            await tx.update(connections).set({ config: { ...cfg, whatsapp_web: web } }).where(eq(connections.id, id));
        });
        hookEvents = [...WA_WEB_HOOK_EVENTS];
        const patches = hooksPatched;
        expect(await svc.reconcileWebHooks()).toBe(1);
        expect(hooksPatched).toBe(patches + 1);
        expect(hookEvents.sort()).toEqual(['wa.message.canceled', 'wa.message.failed']);
        expect(hooksCreated).toBe(1);
    });

    it('v0.1.391 — tres mensajes seguidos de un número nuevo: UN registro y una línea de actividad («escribió 3 mensajes»)', async () => {
        const id = await connect();
        const { listId } = await seedContacts(id);
        await Promise.all(
            [901, 902, 903].map((n) => post(id, 'wa.message.received', waMessage({ id: n, direction: 'in', from: '+573005550909', body: `mensaje ${n}`, status: 'received' }))),
        );
        const rows = await listRecords(listId);
        expect(rows).toHaveLength(1);
        const act = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(and(eq(activity.recordId, rows[0]!.id), eq(activity.action, 'whatsapp'))));
        expect(act).toHaveLength(1);
        expect(act[0]!.diff).toMatchObject({ whatsapp: { event: 'received', count: 3 } });
        // El texto nunca queda en la actividad.
        expect(JSON.stringify(act[0]!.diff)).not.toContain('mensaje 90');
    });

    it('envía texto y archivo desde la ficha (el cuerpo EXACTO) y los estados llegan por los avisos', async () => {
        const id = await connect();
        const { listId, fieldsBy } = await seedContacts(id);
        const [rec] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({ tenantId, listId, data: { [`f${fieldsBy.nombre}`]: 'Ana', [`f${fieldsBy.telefono}`]: '+573001112233' }, createdBy: adminId }).returning(),
        );
        // Sin ventana de 24 h: el texto sale aunque el contacto nunca escribió.
        const info = await svc.recordInfo(tenantId, admin(), 'clientes', rec!.id);
        expect(info.connections[0]).toMatchObject({ provider: 'whatsapp_web', window_open: true, templates: [] });

        const res = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec!.id, { connection_id: id, kind: 'text', text: 'Hola {{nombre}}, tu turno es mañana', variables: {} });
        expect(res).toMatchObject({ ok: true, message_id: '101', to: '+573001112233', status: 'enviado' });
        expect(sent[0]).toEqual({ to: '+573001112233', type: 'text', wa_account_id: 1, body: 'Hola Ana, tu turno es mañana' });
        let [data] = (await listRecords(listId)).map((r) => r.data);
        expect(data![`f${fieldsBy.whatsapp_ultimo_mensaje}`]).toBe('Hola Ana, tu turno es mañana');
        expect(data![`f${fieldsBy.whatsapp_estado}`]).toBe('enviado');

        // Leído antes que entregado (llegan desordenados): queda «leído».
        await post(id, 'wa.message.read', waMessage({ id: 101, status: 'read', read_at: new Date().toISOString() }));
        await post(id, 'wa.message.delivered', waMessage({ id: 101, status: 'delivered' }));
        [data] = (await listRecords(listId)).map((r) => r.data);
        expect(data![`f${fieldsBy.whatsapp_estado}`]).toBe('leido');

        // Un archivo; si después falla porque el número no tiene WhatsApp, queda el motivo en palabras.
        const file = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec!.id, {
            connection_id: id,
            kind: 'media',
            media_url: 'https://files.acme.test/turno.pdf',
            text: 'Tu comprobante',
            variables: {},
        });
        expect(file.ok).toBe(true);
        expect(sent[1]).toEqual({ to: '+573001112233', type: 'media', wa_account_id: 1, media_url: 'https://files.acme.test/turno.pdf', body: 'Tu comprobante' });
        await post(id, 'wa.message.failed', waMessage({ id: 102, status: 'failed', failure_reason: 'no_whatsapp' }));
        [data] = (await listRecords(listId)).map((r) => r.data);
        expect(data![`f${fieldsBy.whatsapp_estado}`]).toBe('fallido');
        expect(data![`f${fieldsBy.whatsapp_detalle}`]).toBe('Ese número no tiene WhatsApp.');
        expect(incidents).toHaveLength(0);

        // Plantillas no: Imagina WAS no las usa.
        const tpl = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec!.id, { connection_id: id, kind: 'template', template: 'x', variables: {} });
        expect(tpl.error).toMatch(/no usa plantillas/);
        // La actividad anota el envío SIN el texto.
        const act = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(and(eq(activity.recordId, rec!.id), eq(activity.action, 'whatsapp'))));
        expect(JSON.stringify(act.map((a) => a.diff))).not.toContain('turno es mañana');
    });

    it('automatización: «Enviar archivo» corre de verdad; un número desconectado falla con el motivo y abre un problema', async () => {
        const id = await connect();
        const { listId, fieldsBy } = await seedContacts(id);
        const [rec] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({ tenantId, listId, data: { [`f${fieldsBy.nombre}`]: 'Ana', [`f${fieldsBy.telefono}`]: '3001112233' }, createdBy: adminId }).returning(),
        );
        const [auto] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(automations)
                .values({
                    tenantId,
                    listId,
                    name: 'Mandar comprobante',
                    triggerType: 'record_created',
                    triggerConfig: {},
                    actions: [
                        {
                            type: 'connector_action',
                            config: { connection_id: id, action_key: 'send_media', values: { recipient: '{{telefono}}', url: 'https://files.acme.test/{{nombre}}.pdf', caption: 'Hola {{nombre}}' } },
                        },
                    ],
                    isActive: true,
                })
                .returning(),
        );
        const data = (await listRecords(listId))[0]!.data;
        await engine.process({ tenantId, listId, recordId: rec!.id, trigger: 'record_created', after: data });
        const [run] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto!.id)));
        const log = run!.actionsLog as Array<{ status: string; message: string }>;
        expect(log[0]!.status).toBe('success');
        // Un número local se completa con el indicativo del número de la empresa.
        expect(sent[0]).toEqual({ to: '+573001112233', type: 'media', wa_account_id: 1, media_url: 'https://files.acme.test/Ana.pdf', body: 'Hola Ana' });
        expect((await listRecords(listId))[0]!.data[`f${fieldsBy.whatsapp_estado}`]).toBe('enviado');

        // El número se desconectó: falla con el motivo y se abre UN problema de la conexión.
        sendError = { status: 422, body: JSON.stringify({ error: { code: 'account_disconnected', message: 'The account is disconnected.' } }) };
        await engine.process({ tenantId, listId, recordId: rec!.id, trigger: 'record_created', after: data });
        const runs = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto!.id)));
        const last = runs.sort((a, b) => b.id - a.id)[0]!.actionsLog as Array<{ status: string; message: string }>;
        expect(last[0]!.status).toBe('failed');
        expect(last[0]!.message).toMatch(/desconectado: vuelve a vincularlo/);
        expect(incidents).toHaveLength(1);
        expect(incidents[0]).toMatchObject({ key: `connection:${id}`, source: 'connection' });
    });

    // ── v0.1.401: el conector completo ───────────────────────────────

    /** Una automatización «al crear» con esas acciones, corrida sobre el registro. */
    async function runActions(listId: number, recordId: number, actions: Array<{ action_key: string; values: Record<string, string> }>, connId: number) {
        const [auto] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(automations)
                .values({
                    tenantId,
                    listId,
                    name: 'Whats completo',
                    triggerType: 'record_created',
                    triggerConfig: {},
                    actions: actions.map((a) => ({ type: 'connector_action', config: { connection_id: connId, action_key: a.action_key, values: a.values } })),
                    isActive: true,
                })
                .returning(),
        );
        const data = (await listRecords(listId)).find((r) => r.id === recordId)!.data;
        await engine.process({ tenantId, listId, recordId, trigger: 'record_created', after: data });
        const runs = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto!.id)));
        await withTenant(pg.db, tenantId, (tx) => tx.update(automations).set({ isActive: false }).where(eq(automations.id, auto!.id)));
        return runs.sort((a, b) => b.id - a.id)[0]!.actionsLog as Array<{ status: string; message: string }>;
    }

    async function seedClient(): Promise<{ id: number; listId: number; recId: number; fieldsBy: Record<string, number> }> {
        const id = await connect();
        const { listId, fieldsBy } = await seedContacts(id);
        await fieldsService.create(tenantId, 'clientes', { label: 'Ciudad', type: 'text' });
        const ciudad = (await fieldsService.listByListId(tenantId, listId)).find((f) => f.slug === 'ciudad')!.id;
        const [rec] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(records)
                .values({ tenantId, listId, data: { [`f${fieldsBy.nombre}`]: 'Ana Gómez', [`f${fieldsBy.telefono}`]: '3001112233', [`f${ciudad}`]: 'Bogotá' }, createdBy: adminId })
                .returning(),
        );
        return { id, listId, recId: rec!.id, fieldsBy };
    }

    it('v0.1.401 — piezas puras: el plan valida los datos y dice lo que hará', () => {
        const deps = {
            phoneOf: (raw: string) => (/^\+?\d{10,15}$/.test(raw) ? { ok: true as const, digits: raw.replace(/\D/g, '') } : { ok: false as const, error: 'no es un teléfono' }),
            names: (raw: string) => raw.split(',').map((x) => x.trim()).filter(Boolean),
            keyValues: (raw: string) => (raw ? (JSON.parse(raw) as Record<string, string>) : {}),
            flag: (raw: string, fb: boolean) => (raw === '' ? fb : raw === 'true'),
            title: 'Ana',
            nowIso: '2026-11-11T12:00:00.000Z',
        };
        expect(planWhatsAction('add_tags', { recipient: '', tags: 'VIP' }, deps)).toEqual({ ok: false, error: 'Falta el teléfono del contacto.' });
        expect(planWhatsAction('add_tags', { recipient: 'hola', tags: 'VIP' }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/no sirve/) });
        expect(planWhatsAction('add_tags', { recipient: '+573001112233', tags: ' ' }, deps)).toEqual({ ok: false, error: 'Elige al menos una etiqueta.' });
        expect(planWhatsAction('upsert_contact', { recipient: '+573001112233', email: 'no-es-correo' }, deps)).toMatchObject({ ok: false });
        expect(planWhatsAction('resume_flow', { run_id: 'abc', resume_token: 't' }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/no es el número/) });
        const tags = planWhatsAction('add_tags', { recipient: '+573001112233', tags: 'VIP, Bogotá' }, deps);
        expect(tags).toMatchObject({ ok: true, plan: { action: 'add_tags', phone: '573001112233', tags: ['VIP', 'Bogotá'], createMissing: true, createName: 'Ana' } });
        expect(tags.ok && describeWhatsPlan(tags.plan)).toMatch(/VIP/);
        const conv = planWhatsAction('conversation_status', { recipient: '+573001112233', operation: 'reopen', conversation: '#55' }, deps);
        expect(conv).toMatchObject({ ok: true, plan: { operation: 'reopen', conversationId: 55 } });
        // La conversación de ESE contacto, abierta antes que resuelta.
        expect(
            pickConversation(
                [
                    { id: 1, contactId: 9, channel: 'wa', status: 'open', lastMessageAt: '2026-11-10' },
                    { id: 2, contactId: 5, channel: 'wa', status: 'resolved', lastMessageAt: '2026-11-11' },
                    { id: 3, contactId: 5, channel: 'wa', status: 'open', lastMessageAt: '2026-11-01' },
                    { id: 4, contactId: 5, channel: 'email', status: 'open', lastMessageAt: '2026-11-11' },
                ],
                5,
            )?.id,
        ).toBe(3);
    });

    it('v0.1.401 — contacto por teléfono: se crea si falta y se recuerda; etiquetas por nombre (crea las que faltan), grupo, nota, flujo y {{whats.*}}', async () => {
        abilities = [...ALL, ...WA_WEB_EXTRA_ABILITIES];
        const { id, listId, recId } = await seedClient();
        const log = await runActions(
            listId,
            recId,
            [
                { action_key: 'add_tags', values: { recipient: '{{telefono}}', tags: 'cliente, VIP, {{ciudad}}' } },
                { action_key: 'add_to_group', values: { recipient: '{{telefono}}', group: 'Clientes 2026' } },
                { action_key: 'add_note', values: { recipient: '{{telefono}}', note: 'Contacto {{whats.contacto_id}} de {{ciudad}}' } },
                { action_key: 'trigger_flow', values: { recipient: '{{telefono}}', flow: '31', flow_label: 'Bienvenida', variables: '{"cliente":"{{nombre}}"}' } },
                { action_key: 'add_note', values: { recipient: '{{telefono}}', note: 'Flujo {{whats.ejecucion_id}}' } },
            ],
            id,
        );
        expect(log.map((l) => l.status)).toEqual(['success', 'success', 'success', 'success', 'success']);
        // Se buscó UNA vez y se creó con el título del registro (el teléfono con el indicativo de la empresa).
        expect(net.calls.filter((c) => c.url.includes('/contacts/lookup'))).toHaveLength(1);
        expect(waContacts).toEqual([{ id: 600, phone: '+573001112233', name: 'Ana Gómez', email: null }]);
        // «cliente» ya existía (sin importar mayúsculas); VIP y Bogotá se crearon; la lista se leyó siguiendo el cursor.
        expect(ops.filter((o) => o.path === '/tags').map((o) => (o.body as { name: string }).name)).toEqual(['VIP', 'Bogotá']);
        expect(ops.find((o) => o.path === '/contacts/600/tags')).toEqual({ method: 'POST', path: '/contacts/600/tags', body: { tag_ids: [1, 11, 12] } });
        expect(ops.find((o) => o.path === '/groups/7/contacts')!.body).toEqual({ contact_ids: [600] });
        expect(ops.find((o) => o.path === '/flows/31/trigger')!.body).toEqual({ contact_id: 600, variables: { cliente: 'Ana Gómez' } });
        // Lo que deja cada acción sirve en la siguiente.
        const notes = ops.filter((o) => o.path === '/contacts/600/notes').map((o) => (o.body as { body: string }).body);
        expect(notes).toEqual(['Contacto 600 de Bogotá', 'Flujo 777']);
        expect(log[3]!.message).toMatch(/Se activó el flujo «Bienvenida»/);
        // La clave nunca queda en el registro de la corrida.
        expect(JSON.stringify(log)).not.toContain(API_KEY);

        // Una segunda corrida usa el contacto recordado: no lo vuelve a buscar.
        const before = net.calls.filter((c) => c.url.includes('/contacts/lookup')).length;
        await runActions(listId, recId, [{ action_key: 'add_note', values: { recipient: '{{telefono}}', note: 'otra' } }], id);
        expect(net.calls.filter((c) => c.url.includes('/contacts/lookup'))).toHaveLength(before);
        // Si lo borraron en Whats, se olvida y se busca (y crea) de nuevo, sin fallar.
        waContacts = [];
        const again = await runActions(listId, recId, [{ action_key: 'add_note', values: { recipient: '{{telefono}}', note: 'de nuevo' } }], id);
        expect(again[0]!.status).toBe('success');
        expect(waContacts).toHaveLength(1);
    });

    it('v0.1.401 — lo que no se puede: flujo inactivo falla; goteo rechazado y bandeja sin conversación se saltan; sin permiso abre un problema', async () => {
        abilities = [...ALL, ...WA_WEB_EXTRA_ABILITIES];
        const { id, listId, recId } = await seedClient();
        const log = await runActions(
            listId,
            recId,
            [
                { action_key: 'trigger_flow', values: { recipient: '{{telefono}}', flow: '32', flow_label: 'Encuesta' } },
                { action_key: 'reply_conversation', values: { recipient: '{{telefono}}', message: 'Hola' } },
            ],
            id,
        );
        expect(log[0]).toMatchObject({ status: 'failed', message: expect.stringMatching(/no está publicado y activo/) });
        // El contacto no tenía conversación: se salta sin crear nada.
        expect(log[1]!.status).toBe('skipped');
        expect(incidents).toHaveLength(0);

        // Con una conversación abierta de ese contacto: responde y la resuelve.
        waContacts = [{ id: 600, phone: '+573001112233', name: 'Ana', email: null }];
        waConvs = [
            { id: 70, contact_id: 999, channel: 'wa', status: 'open', last_message_at: '2026-11-11T10:00:00Z' },
            { id: 71, contact_id: 600, channel: 'wa', status: 'open', last_message_at: '2026-11-10T10:00:00Z' },
        ];
        dripRefuse = true;
        const log2 = await runActions(
            listId,
            recId,
            [
                { action_key: 'reply_conversation', values: { recipient: '{{telefono}}', message: 'Hola {{nombre}}' } },
                { action_key: 'conversation_status', values: { recipient: '{{telefono}}', operation: 'resolve' } },
                { action_key: 'enroll_drip', values: { recipient: '{{telefono}}', drip: '41', drip_label: 'Onboarding' } },
            ],
            id,
        );
        expect(log2.map((l) => l.status)).toEqual(['success', 'success', 'skipped']);
        expect(ops.find((o) => o.path === '/conversations/71/reply')!.body).toEqual({ body: 'Hola Ana Gómez' });
        expect(ops.some((o) => o.path === '/conversations/71/resolve')).toBe(true);
        expect(log2[2]!.message).toMatch(/no inscribió/);

        // Sin el permiso de etiquetas: falla con el motivo y abre UN problema de la conexión.
        abilities = [...ALL, 'contacts.view', 'contacts.manage'];
        const log3 = await runActions(listId, recId, [{ action_key: 'add_tags', values: { recipient: '{{telefono}}', tags: 'VIP' } }], id);
        expect(log3[0]!.status).toBe('failed');
        expect(incidents).toHaveLength(1);
        expect(incidents[0]).toMatchObject({ key: `connection:${id}`, source: 'connection' });
    });

    it('v0.1.401 — ubicación y tarjeta de contacto: el cuerpo EXACTO, y el contacto del envío queda recordado', async () => {
        abilities = [...ALL, ...WA_WEB_EXTRA_ABILITIES];
        const { id, listId, recId } = await seedClient();
        // Whats crea el contacto al recibir el envío y devuelve su id (500).
        waContacts = [{ id: 500, phone: '+573001112233', name: 'Ana', email: null }];
        const log = await runActions(
            listId,
            recId,
            [
                { action_key: 'send_location', values: { recipient: '{{telefono}}', latitude: '4.6097', longitude: '-74.0817', place_name: 'Oficina', address: 'Cra 7 # 1-2' } },
                { action_key: 'send_contact', values: { recipient: '{{telefono}}', contact_name: 'Asesora Laura', contact_phones: '+573004445566\n+573007778899' } },
                { action_key: 'add_note', values: { recipient: '{{telefono}}', note: 'Mensaje {{whats.mensaje_id}}' } },
            ],
            id,
        );
        expect(log.map((l) => l.status)).toEqual(['success', 'success', 'success']);
        expect(sent[0]).toEqual({ to: '+573001112233', type: 'location', wa_account_id: 1, location: { latitude: 4.6097, longitude: -74.0817, name: 'Oficina', address: 'Cra 7 # 1-2' } });
        expect(sent[1]).toEqual({ to: '+573001112233', type: 'contact', wa_account_id: 1, contact: { name: 'Asesora Laura', phones: ['+573004445566', '+573007778899'] } });
        // El envío devolvió el contacto (500): la nota no lo busca, y {{whats.mensaje_id}} es el del último envío.
        expect(net.calls.some((c) => c.url.includes('/contacts/lookup'))).toBe(false);
        expect(ops.find((o) => o.path === '/contacts/500/notes')!.body).toEqual({ body: 'Mensaje 102' });
        // Una latitud que no es un número se dice antes de mandar nada.
        const bad = await runActions(listId, recId, [{ action_key: 'send_location', values: { recipient: '{{telefono}}', latitude: 'norte', longitude: '-74' } }], id);
        expect(bad[0]!.status).toBe('failed');
        expect(sent).toHaveLength(2);
    });

    it('v0.1.401 — el editor: listas de la cuenta siguiendo el cursor, permisos que faltan por acción y «Probar ahora» sin tocar Whats', async () => {
        abilities = [...ALL, 'contacts.view', 'contacts.manage', 'tags.view', 'tags.manage', 'flows.view'];
        const { id } = await seedClient();
        waTags = [1, 2, 3, 4, 5].map((n) => ({ id: n, name: `Etiqueta ${n}` }));
        const tags = await svc.whatsOptions(tenantId, admin(), id, 'tags');
        expect(tags).toEqual({ items: waTags.map((t) => ({ value: t.name, label: t.name, hint: null })), truncated: false, error: null });
        // Se recuerda: pedirla otra vez no llama a Whats.
        const calls = net.calls.length;
        await svc.whatsOptions(tenantId, admin(), id, 'tags');
        expect(net.calls.length).toBe(calls);
        const flows = await svc.whatsOptions(tenantId, admin(), id, 'flows');
        expect(flows.items).toEqual([
            { value: '31', label: 'Bienvenida', hint: 'Activo' },
            { value: '32', label: 'Encuesta', hint: 'Borrador' },
        ]);
        const fieldsOpt = await svc.whatsOptions(tenantId, admin(), id, 'contact_fields');
        expect(fieldsOpt.items.map((i) => i.value)).toEqual(['ciudad', 'plan']);

        const ab = await svc.whatsAbilities(tenantId, admin(), id);
        expect(ab.missing.add_tags).toBeUndefined();
        expect(ab.missing.add_to_group).toEqual(['groups.view', 'groups.manage']);
        expect(ab.missing.reply_conversation).toEqual(['messenger.view', 'messenger.send']);

        // «Ver qué haría»: con un registro real y sin un solo pedido a Whats.
        const before = net.calls.length;
        const preview = await svc.whatsActionTest(tenantId, admin(), 'clientes', {
            connection_id: id,
            action_key: 'add_tags',
            values: { recipient: '{{telefono}}', tags: 'VIP, {{ciudad}}' },
            execute: false,
        });
        expect(preview).toMatchObject({ ok: true, executed: false, error: null, steps: [] });
        expect(preview.summary).toMatch(/VIP.*Bogotá/);
        expect(net.calls.length).toBe(before);
        const missing = await svc.whatsActionTest(tenantId, admin(), 'clientes', { connection_id: id, action_key: 'add_tags', values: { recipient: '{{telefono}}', tags: '' }, execute: false });
        expect(missing).toMatchObject({ ok: false, error: 'Elige al menos una etiqueta.' });
        // «Hacerlo de verdad»: los pedidos, sin la clave.
        const real = await svc.whatsActionTest(tenantId, admin(), 'clientes', { connection_id: id, action_key: 'add_tags', values: { recipient: '{{telefono}}', tags: 'VIP' }, execute: true });
        expect(real).toMatchObject({ ok: true, executed: true, outputs: { contacto_id: '600' } });
        expect(real.steps.map((st) => st.label)).toEqual(['Buscar el contacto', 'Crear el contacto', 'Crear la etiqueta «VIP»', 'Poner las etiquetas']);
        expect(JSON.stringify(real.steps)).not.toContain(API_KEY);
    });

    it('el asistente y el MCP ven la conexión con sus acciones (sin plantillas)', async () => {
        const id = await connect();
        const conns = await connectors.list(tenantId, adminId, 'admin');
        const schema = await whatsappSchema(new TenantDb(pg.db), tenantId, conns, {}, []);
        const conn = (schema?.connections as Array<Record<string, unknown>>)[0]!;
        expect(conn).toMatchObject({ connection_id: id, kind: 'whats', phone: '+573178339119 · Augusto' });
        // v0.1.401 — todas las del catálogo, con lo opcional marcado y lo que dejan para los pasos siguientes.
        const actions = conn.actions as string[];
        expect(actions).toHaveLength(17);
        expect(actions).toContain('send_text {recipient, message} → {{whats.mensaje_id}} {{whats.contacto_id}}');
        expect(actions).toContain('add_tags {recipient, tags, create_missing?, name?} → {{whats.contacto_id}}');
        expect(actions.some((a) => a.startsWith('resume_flow {run_id, resume_token, variables?}'))).toBe(true);
        expect(String(schema?.rules)).toMatch(/kind "whats"/);
        expect(String(schema?.rules)).toMatch(/Nunca se envía a grupos/);
    });
});
