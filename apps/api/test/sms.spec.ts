import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextCommercialSendTime, smsSegments } from '@imagina-base/shared';

/**
 * SMS (ADR-S82) de punta a punta con Postgres real. Los cinco proveedores
 * (Twilio, BulkGate, Infobip, LabsMobile, Onurix) se simulan en el borde de
 * red (`safeWebhookFetch`) con las respuestas de SU documentación, así el test
 * ejercita todo lo nuestro: verificar la credencial antes de guardarla, la
 * petición EXACTA de cada uno, las columnas del registro, la actividad sin el
 * texto, los avisos de entrega (firma de Twilio, estado que sólo avanza, un
 * aviso de otra conexión que no mueve nada), el envío a una selección al ritmo
 * de la conexión, el horario de la Ley 2300, la consulta de estado de Onurix,
 * los problemas de la conexión y la RLS.
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
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { smsSchema } from '../src/ai/tools/sms-ai';
import { activity, automationRuns, automations, connections, fields, lists, records, smsHooks, smsMessages, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { IncidentHub, type IncidentReport } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { SMS_PROVIDERS, bulkgateSender, infobipBase, onurixStateToStatus, twilioSignature } from '../src/sms/sms-providers';
import { SmsService, columnValue } from '../src/sms/sms.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const TW_SID = `AC${'a1'.repeat(16)}`;
const TW_TOKEN = 'twilio-auth-token-bueno';
const BG_APP = '12345';
const BG_TOKEN = 'bulkgate-token-bueno';
const IB_BASE = 'https://xyz12.api.infobip.com';
const IB_KEY = 'infobip-api-key-buena';
const LM_USER = 'ventas@acme.test';
const LM_TOKEN = 'labs-token-bueno';
const OX_CLIENT = '4321';
const OX_KEY = 'onurix-key-buena';
const BASES = { twilio: 'https://api.twilio.com', bulkgate: 'https://portal.bulkgate.com', labsmobile: 'https://api.labsmobile.com', onurix: 'https://www.onurix.com' };

class NullMail implements MailTransport {
    readonly name = 'null';
    send(_m: MailMessage): Promise<void> {
        return Promise.resolve();
    }
}

function basic(h: string | undefined): { user: string; pass: string } | null {
    if (!h?.startsWith('Basic ')) return null;
    const [user, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
    return { user: user ?? '', pass: rest.join(':') };
}

describe('SMS — Twilio, BulkGate, Infobip, LabsMobile y Onurix (ADR-S82)', () => {
    let pg: TestPg;
    let connectors: ConnectorsService;
    let svc: SmsService;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let engine: AutomationEngine;
    let incidents: IncidentReport[];
    let resolved: string[];
    let tenantId: number;
    let otherTenantId: number;
    let adminId: number;
    let agentId: number;
    /** Lo que mandó cada proveedor (el cuerpo de la petición, ya leído). */
    let sent: Array<{ provider: string; to: string; text: string; raw: string }>;
    /** Respuesta forzada del próximo envío (saldo agotado, credencial revocada). */
    let override: { status: number; body: string } | null;
    let onurixState: string;
    let n = 0;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.imagina.test' });
        const store = memoryOAuthStore();
        const audit = new AuditService(tenantDb);
        const hub = new IncidentHub();
        incidents = [];
        resolved = [];
        hub.subscribe({ report: (r) => void incidents.push(r), resolve: (_t, key) => void resolved.push(key), resolvePrefix: () => undefined });
        connectors = new ConnectorsService(tenantDb, pg.db, env, store, audit, new IntegrationAppsService(store, env), undefined, hub);
        const rt = new RealtimeService();
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const activitySvc = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        svc = new SmsService(tenantDb, pg.db, env, connectors, listsService, fieldsService, new RecordsRepository(), activitySvc, rt, audit, hub);
        // Sin cola en el test: el masivo se drena a mano.
        svc.setKicker(() => undefined);
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), new NullMail()),
            connectors,
        );
        engine.setSms(svc);

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-sms', name: 'ACME', settings: { format: { timezone: 'America/Bogota' } } }).returning();
        tenantId = t!.id;
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra-sms', name: 'Otra' }).returning();
        otherTenantId = t2!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme-sms.test', passwordHash: 'x', name: 'Ada' }).returning();
        adminId = u!.id;
        const [a] = await pg.db.insert(users).values({ email: 'agent@acme-sms.test', passwordHash: 'x', name: 'Agus' }).returning();
        agentId = a!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    beforeEach(async () => {
        net.calls.length = 0;
        sent = [];
        override = null;
        onurixState = 'Enviado';
        incidents.length = 0;
        resolved.length = 0;
        fakeProviders();
        for (const tid of [tenantId, otherTenantId]) {
            await withTenant(pg.db, tid, async (tx) => {
                await tx.delete(smsMessages).where(eq(smsMessages.tenantId, tid));
                await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tid));
                await tx.delete(automations).where(eq(automations.tenantId, tid));
                await tx.delete(activity).where(eq(activity.tenantId, tid));
                await tx.delete(records).where(eq(records.tenantId, tid));
                await tx.delete(fields).where(eq(fields.tenantId, tid));
                await tx.delete(lists).where(eq(lists.tenantId, tid));
            });
            await pg.db.delete(smsHooks).where(eq(smsHooks.tenantId, tid));
            await withTenant(pg.db, tid, (tx) => tx.delete(connections).where(eq(connections.tenantId, tid)));
        }
    });

    // ── Los proveedores simulados (con las respuestas de su documentación) ──

    function fakeProviders(): void {
        net.handler = (call) => {
            const url = new URL(call.url);
            const auth = call.headers?.authorization;
            const form = (): Record<string, string> => Object.fromEntries(new URLSearchParams(call.body ?? ''));
            const json = (): Record<string, unknown> => JSON.parse(call.body ?? '{}') as Record<string, unknown>;
            // Twilio
            if (url.origin === BASES.twilio) {
                const b = basic(auth);
                if (!b || b.user !== TW_SID || b.pass !== TW_TOKEN) {
                    return { status: 401, body: JSON.stringify({ code: 20003, message: 'Authenticate', more_info: 'https://www.twilio.com/docs/errors/20003', status: 401 }) };
                }
                if (url.pathname === `/2010-04-01/Accounts/${TW_SID}.json`) {
                    return { status: 200, body: JSON.stringify({ sid: TW_SID, friendly_name: 'Acme Twilio', status: 'active', type: 'Full' }) };
                }
                if (url.pathname === `/2010-04-01/Accounts/${TW_SID}/Messages.json` && call.method === 'POST') {
                    if (override) return override;
                    const f = form();
                    if (f.To?.endsWith('0000')) {
                        return { status: 400, body: JSON.stringify({ code: 21211, message: "The 'To' number is not a valid phone number.", status: 400 }) };
                    }
                    sent.push({ provider: 'twilio', to: f.To ?? '', text: f.Body ?? '', raw: call.body ?? '' });
                    return { status: 201, body: JSON.stringify({ sid: `SM${String(++n).padStart(32, '0')}`, status: 'queued', num_segments: String(smsSegments(f.Body ?? '').segments), error_code: null }) };
                }
            }
            // BulkGate
            if (url.origin === BASES.bulkgate) {
                const b = json();
                if (b.application_id !== BG_APP || b.application_token !== BG_TOKEN) {
                    return { status: 401, body: JSON.stringify({ type: 'unknown_identity', code: 401, error: 'Unknown identity / unauthorized / empty application_id', detail: null }) };
                }
                if (url.pathname === '/api/1.0/simple/info') {
                    return { status: 200, body: JSON.stringify({ data: { wallet: 'bg1805151838000001', credit: 215.8138, currency: 'credits', free_messages: 51 } }) };
                }
                if (url.pathname === '/api/1.0/simple/transactional') {
                    if (override) return override;
                    sent.push({ provider: 'bulkgate', to: String(b.number), text: String(b.text), raw: call.body ?? '' });
                    return { status: 200, body: JSON.stringify({ data: { status: 'accepted', sms_id: `idx${++n}`, price: 1, credit: 52.381, number: b.number } }) };
                }
            }
            // Infobip
            if (url.origin === IB_BASE) {
                if (auth !== `App ${IB_KEY}`) {
                    return { status: 401, body: JSON.stringify({ requestError: { serviceException: { messageId: 'UNAUTHORIZED', text: 'Invalid login details' } } }) };
                }
                if (url.pathname === '/account/1/balance') return { status: 200, body: JSON.stringify({ balance: 47.79, currency: 'EUR' }) };
                if (url.pathname === '/sms/3/messages') {
                    if (override) return override;
                    const m = (json().messages as Array<Record<string, unknown>>)[0]!;
                    const dest = (m.destinations as Array<Record<string, string>>)[0]!;
                    const text = String((m.content as Record<string, unknown>).text);
                    sent.push({ provider: 'infobip', to: dest.to!, text, raw: call.body ?? '' });
                    return {
                        status: 200,
                        body: JSON.stringify({
                            bulkId: 'bulk-1',
                            messages: [{ messageId: dest.messageId, status: { groupId: 1, groupName: 'PENDING', id: 26, name: 'PENDING_ACCEPTED', description: 'Message sent to next instance' }, destination: dest.to, details: { messageCount: 1 } }],
                        }),
                    };
                }
            }
            // LabsMobile
            if (url.origin === BASES.labsmobile) {
                const b = basic(auth);
                if (!b || b.user !== LM_USER || b.pass !== LM_TOKEN) return { status: 401, body: JSON.stringify({ code: 401, message: 'Unauthorized' }) };
                if (url.pathname === '/json/balance') return { status: 200, body: JSON.stringify({ code: 0, credits: '120.5' }) };
                if (url.pathname === '/json/send') {
                    if (override) return override;
                    const body = json();
                    sent.push({ provider: 'labsmobile', to: String((body.recipient as Array<Record<string, string>>)[0]!.msisdn), text: String(body.message), raw: call.body ?? '' });
                    return { status: 200, body: JSON.stringify({ code: '0', message: 'Message has been successfully sent.', subid: body.subid }) };
                }
            }
            // Onurix
            if (url.origin === BASES.onurix) {
                const params = call.method === 'GET' ? Object.fromEntries(url.searchParams) : form();
                if (params.client !== OX_CLIENT || params.key !== OX_KEY) return { status: 200, body: JSON.stringify({ error: 1001, msg: 'El cliente no existe' }) };
                if (url.pathname === '/api/v1/balance') return { status: 200, body: JSON.stringify({ balance: 250 }) };
                if (url.pathname === '/api/v1/sms/send') {
                    if (override) return override;
                    sent.push({ provider: 'onurix', to: params.phone ?? '', text: params.sms ?? '', raw: call.body ?? '' });
                    return { status: 200, body: JSON.stringify({ status: 1, id: String(9000 + ++n), data: [{ id: 'm1', state: 'Enviado', credits: 1, sms: params.sms, phone: params.phone }] }) };
                }
                if (url.pathname === '/api/v1/messages-state') return { status: 200, body: JSON.stringify({ data: [{ id: params.id, state: onurixState }] }) };
            }
            return { status: 404, body: '' };
        };
    }

    const admin = (): { userId: number; role: 'admin' } => ({ userId: adminId, role: 'admin' });

    async function connect(key: string, fieldsIn: Record<string, string>): Promise<number> {
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', key as never, { fields: fieldsIn, visibility: 'workspace' });
        return connection.id;
    }
    const connectTwilio = (): Promise<number> => connect('sms_twilio', { account_sid: TW_SID, auth_token: TW_TOKEN, from: '+15005550006' });

    /** Lista «Clientes» con nombre, teléfono y las columnas de SMS preparadas. */
    async function seedClients(): Promise<{ listId: number; fieldsBy: Record<string, number> }> {
        const list = await listsService.create(tenantId, { name: 'Clientes', slug: 'clientes' });
        await fieldsService.create(tenantId, 'clientes', { label: 'Nombre', type: 'text' });
        await fieldsService.create(tenantId, 'clientes', { label: 'Teléfono', type: 'phone', config: { default_country: 'CO' } });
        const cols = await svc.setupListColumns(tenantId, admin(), 'clientes');
        const all = await fieldsService.listByListId(tenantId, list.id);
        const fieldsBy: Record<string, number> = {};
        for (const f of all) fieldsBy[f.slug] = f.id;
        expect(cols.fields.phone).toBe(fieldsBy.telefono);
        expect(cols.fields.last_at).toBeTruthy();
        expect(cols.fields.last_status).toBeTruthy();
        return { listId: list.id, fieldsBy };
    }

    async function addClient(listId: number, fieldsBy: Record<string, number>, name: string, phone: string | null): Promise<number> {
        const data: Record<string, unknown> = { [`f${fieldsBy.nombre}`]: name };
        if (phone) data[`f${fieldsBy.telefono}`] = phone;
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.insert(records).values({ tenantId, listId, data, createdBy: adminId }).returning());
        return rec!.id;
    }

    async function recordData(recordId: number): Promise<Record<string, unknown>> {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.id, recordId)));
        return row!.data as Record<string, unknown>;
    }

    async function messages(): Promise<Array<typeof smsMessages.$inferSelect>> {
        return withTenant(pg.db, tenantId, (tx) => tx.select().from(smsMessages).where(eq(smsMessages.tenantId, tenantId)).orderBy(smsMessages.id));
    }

    // ── Piezas puras ────────────────────────────────────────────────────

    it('piezas puras: la firma de Twilio (vector oficial), cada petición y cada aviso con la forma de su documentación', () => {
        // El vector de la documentación de Twilio (twilio-python / twilio-node).
        expect(
            twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', {
                CallSid: 'CA1234567890ABCDE',
                Digits: '1234',
                From: '+14158675309',
                To: '+18005551212',
                Caller: '+14158675309',
            }),
        ).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');

        const input = { to: '+573001112233', text: 'Hola Ana', sender: '', unicode: false, segments: 1, callbackUrl: 'https://app.test/api/v1/public/sms/tok', reference: 'sabc123' };
        const tw = SMS_PROVIDERS.sms_twilio.buildSend(input, { secret: TW_TOKEN, fields: { account_sid: TW_SID, from: 'MG' + 'b'.repeat(32) } }, BASES);
        expect(tw.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`);
        expect(Object.fromEntries(new URLSearchParams(tw.body!))).toEqual({ To: '+573001112233', Body: 'Hola Ana', MessagingServiceSid: 'MG' + 'b'.repeat(32), StatusCallback: input.callbackUrl });
        expect(SMS_PROVIDERS.sms_twilio.parseSend(400, JSON.stringify({ code: 21211, message: 'x' }))).toMatchObject({ ok: false, systemic: false, code: '21211' });
        expect(SMS_PROVIDERS.sms_twilio.parseSend(401, '{}')).toMatchObject({ ok: false, systemic: true });

        const bg = SMS_PROVIDERS.sms_bulkgate.buildSend({ ...input, unicode: true }, { secret: BG_TOKEN, fields: { application_id: BG_APP, sender: 'Acme' } }, BASES);
        expect(JSON.parse(bg.body!)).toMatchObject({ application_id: BG_APP, number: '573001112233', unicode: true, sender_id: 'gText', sender_id_value: 'Acme', tag: 'sabc123' });
        expect(bulkgateSender('')).toEqual({ sender_id: 'gSystem' });
        expect(bulkgateSender('+573001112233')).toEqual({ sender_id: 'gOwn', sender_id_value: '573001112233' });
        // Un aviso de BulkGate de una parte de un mensaje largo se ata al envío.
        expect(
            SMS_PROVIDERS.sms_bulkgate.parseDeliveryReport({ method: 'GET', query: { status: '1', smsID: 'idx9_2', price: '1' }, body: null, headers: {}, url: '' }),
        ).toEqual([{ providerIds: ['idx9_2', 'idx9'], reference: null, status: 'entregado', error: null }]);
        expect(SMS_PROVIDERS.sms_bulkgate.parseSend(200, JSON.stringify({ type: 'insufficient_credit', code: 400, error: 'Insufficient credit' }))).toMatchObject({
            ok: false,
            systemic: true,
        });

        expect(infobipBase('xyz12.api.infobip.com/')).toBe('https://xyz12.api.infobip.com');
        const ib = SMS_PROVIDERS.sms_infobip.buildSend(input, { secret: IB_KEY, fields: { base_url: IB_BASE, sender: 'Acme' } }, BASES);
        expect(ib.url).toBe(`${IB_BASE}/sms/3/messages`);
        expect(ib.headers.authorization).toBe(`App ${IB_KEY}`);
        expect(JSON.parse(ib.body!)).toEqual({
            messages: [
                {
                    destinations: [{ to: '573001112233', messageId: 'sabc123' }],
                    content: { text: 'Hola Ana' },
                    sender: 'Acme',
                    webhooks: { delivery: { url: input.callbackUrl }, contentType: 'application/json', callbackData: 'sabc123' },
                },
            ],
        });
        expect(
            SMS_PROVIDERS.sms_infobip.parseDeliveryReport({
                method: 'POST',
                query: {},
                headers: {},
                url: '',
                body: { results: [{ messageId: 'sabc123', status: { groupId: 3, groupName: 'DELIVERED', id: 5, name: 'DELIVERED_TO_HANDSET' }, callbackData: 'sabc123' }] },
            }),
        ).toEqual([{ providerIds: ['sabc123'], reference: 'sabc123', status: 'entregado', error: null }]);
        expect(
            SMS_PROVIDERS.sms_infobip.parseSend(200, JSON.stringify({ messages: [{ messageId: 'x', status: { groupName: 'REJECTED', name: 'REJECTED_NOT_ENOUGH_CREDITS' } }] })),
        ).toMatchObject({ ok: false, systemic: true, code: 'REJECTED_NOT_ENOUGH_CREDITS' });

        const lm = SMS_PROVIDERS.sms_labsmobile.buildSend({ ...input, unicode: true, segments: 2 }, { secret: LM_TOKEN, fields: { username: LM_USER } }, BASES);
        expect(JSON.parse(lm.body!)).toEqual({ message: 'Hola Ana', recipient: [{ msisdn: '573001112233' }], subid: 'sabc123', ackurl: input.callbackUrl, ucs2: '1', long: '1' });
        expect(
            SMS_PROVIDERS.sms_labsmobile.parseDeliveryReport({ method: 'GET', query: { acklevel: 'handset', status: 'ok', subid: 'sabc123', msisdn: '57300' }, body: null, headers: {}, url: '' }),
        ).toEqual([{ providerIds: ['sabc123'], reference: 'sabc123', status: 'entregado', error: null }]);

        const ox = SMS_PROVIDERS.sms_onurix.buildSend(input, { secret: OX_KEY, fields: { client_id: OX_CLIENT } }, BASES);
        expect(ox.url).toBe('https://www.onurix.com/api/v1/sms/send');
        expect(Object.fromEntries(new URLSearchParams(ox.body!))).toEqual({ client: OX_CLIENT, key: OX_KEY, phone: '573001112233', sms: 'Hola Ana' });
        expect(SMS_PROVIDERS.sms_onurix.parseSend(200, JSON.stringify({ error: 1004, msg: 'IP no autorizada' }))).toMatchObject({ ok: false, systemic: true, code: '1004' });
        expect(onurixStateToStatus('Entregado')).toBe('entregado');
        expect(onurixStateToStatus('No entregado')).toBe('fallido');
        expect(onurixStateToStatus('Enviado')).toBe('enviado');

        // La columna de estado en un select guarda el value; «enviando» se muestra «en cola».
        expect(columnValue('last_status', 'enviando', { type: 'select', config: {} })).toBe('en_cola');
        expect(columnValue('last_status', 'entregado', { type: 'text', config: {} })).toBe('Entregado');
        expect(columnValue('last_at', new Date('2026-10-29T15:00:00Z'), { type: 'date', config: {} })).toBe('2026-10-29');
    });

    // ── Conectar ────────────────────────────────────────────────────────

    it('conectar: cada proveedor verifica la credencial ANTES de guardarla; la mala no se guarda y dice por qué', async () => {
        const cases: Array<{ key: string; bad: Record<string, string>; good: Record<string, string>; label: RegExp; error: RegExp }> = [
            {
                key: 'sms_twilio',
                bad: { account_sid: TW_SID, auth_token: 'otro', from: '+15005550006' },
                good: { account_sid: TW_SID, auth_token: TW_TOKEN, from: '+15005550006' },
                label: /Acme Twilio/,
                error: /no reconoce|Account SID|token/i,
            },
            { key: 'sms_bulkgate', bad: { application_id: BG_APP, application_token: 'x' }, good: { application_id: BG_APP, application_token: BG_TOKEN }, label: /Crédito/, error: /BulkGate no reconoce/ },
            { key: 'sms_infobip', bad: { base_url: IB_BASE, api_key: 'x' }, good: { base_url: 'xyz12.api.infobip.com', api_key: IB_KEY }, label: /Saldo/, error: /Infobip no reconoce/ },
            { key: 'sms_labsmobile', bad: { username: LM_USER, api_token: 'x' }, good: { username: LM_USER, api_token: LM_TOKEN }, label: /Créditos/, error: /LabsMobile no reconoce/ },
            { key: 'sms_onurix', bad: { client_id: OX_CLIENT, key: 'x' }, good: { client_id: OX_CLIENT, key: OX_KEY }, label: /Saldo/, error: /Onurix no reconoce/ },
        ];
        for (const c of cases) {
            await expect(connect(c.key, c.bad), c.key).rejects.toThrow(c.error);
            const id = await connect(c.key, c.good);
            const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, id)));
            // La credencial queda CIFRADA (nunca en claro en la fila).
            expect(JSON.stringify(row!.secrets), c.key).not.toContain(c.good.auth_token ?? c.good.application_token ?? c.good.api_key ?? c.good.api_token ?? c.good.key);
            const listed = (await connectors.list(tenantId, adminId, 'admin')).find((x) => x.id === id)!;
            expect(listed.account_label ?? '', c.key).toMatch(c.label);
        }
        // Infobip guarda la URL base normalizada (con https).
        const ib = (await svc.usableConnections(tenantId, admin())).find((c) => c.provider === 'sms_infobip');
        expect(ib).toBeTruthy();
        const [ibRow] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, ib!.id)));
        expect(((ibRow!.config as Record<string, unknown>).fields as Record<string, string>).base_url).toBe(IB_BASE);
        // Una URL de Infobip sin https se rechaza (sólo el desarrollo deja salir a http).
        await expect(connect('sms_infobip', { base_url: 'http://xyz12.api.infobip.com', api_key: IB_KEY })).rejects.toThrow(/https/);
    });

    // ── Envío desde el registro + avisos de entrega ────────────────────

    it('desde el registro: la petición, las columnas y la actividad SIN el texto; el aviso firmado lo pasa a «entregado» y nunca retrocede', async () => {
        const id = await connectTwilio();
        const { listId, fieldsBy } = await seedClients();
        const rec = await addClient(listId, fieldsBy, 'Ana', '300 111 2233');
        const res = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec, {
            connection_id: id,
            message: 'Hola {{nombre}}, tu pedido está listo. ¿Cuándo pasas?',
            strip_accents: true,
            respect_hours: false,
        });
        expect(res).toMatchObject({ ok: true, status: 'enviado', to: '+573001112233', segments: 1, encoding: 'gsm7' });
        // «Quitar tildes» llega al proveedor: la misma función que el contador.
        expect(sent).toHaveLength(1);
        expect(sent[0]!.text).toBe('Hola Ana, tu pedido esta listo. ¿Cuando pasas?');
        const form = Object.fromEntries(new URLSearchParams(sent[0]!.raw));
        expect(form.StatusCallback).toMatch(/^https:\/\/app\.imagina\.test\/api\/v1\/public\/sms\/[A-Za-z0-9_-]{32}$/);
        // Nada de la credencial en lo que ve la persona.
        expect(JSON.stringify(res)).not.toContain(TW_TOKEN);

        const data = await recordData(rec);
        expect(data[`f${fieldsBy.sms_estado}`]).toBe('enviado');
        expect(typeof data[`f${fieldsBy.sms_ultimo}`]).toBe('string');
        const [log] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(and(eq(activity.recordId, rec), eq(activity.action, 'sms'))));
        expect(log!.diff).toEqual({ sms: { event: 'sent', phone: '+57 300…', segments: 1, connection: 'Twilio (SMS) · Acme Twilio', provider: 'sms_twilio' } });
        expect(JSON.stringify(log!.diff)).not.toContain('pedido');
        const [msg] = await messages();
        expect(msg!.body).toBeNull();
        expect(msg!.userId).toBe(adminId);

        // El aviso de Twilio: firma mala → 401; firma buena → entregado.
        const token = form.StatusCallback!.split('/').pop()!;
        const params = { MessageSid: msg!.providerMessageId!, MessageStatus: 'delivered', AccountSid: TW_SID };
        await expect(svc.receive(token, { method: 'POST', query: {}, body: params, headers: { 'x-twilio-signature': 'firma-falsa' } })).rejects.toMatchObject({ status: 401 });
        const sig = twilioSignature(TW_TOKEN, form.StatusCallback!, params);
        expect(await svc.receive(token, { method: 'POST', query: {}, body: params, headers: { 'x-twilio-signature': sig } })).toEqual({ ok: true, updated: 1 });
        expect((await recordData(rec))[`f${fieldsBy.sms_estado}`]).toBe('entregado');
        // Un «sent» tardío no lo hace retroceder.
        const late = { ...params, MessageStatus: 'sent' };
        expect(await svc.receive(token, { method: 'POST', query: {}, body: late, headers: { 'x-twilio-signature': twilioSignature(TW_TOKEN, form.StatusCallback!, late) } })).toEqual({
            ok: true,
            updated: 0,
        });
        expect((await messages())[0]!.status).toBe('entregado');
        // Token desconocido → 404 opaco.
        await expect(svc.receive('x'.repeat(32), { method: 'POST', query: {}, body: params, headers: {} })).rejects.toMatchObject({ status: 404 });
        // La página de la conexión muestra la URL de avisos y el total.
        const detail = await svc.connectionDetail(tenantId, admin(), id);
        expect(detail.delivery).toMatchObject({ mode: 'auto', url: form.StatusCallback });
        expect(detail.totals).toMatchObject({ sent_30d: 1, delivered_30d: 1, failed_30d: 0, segments_30d: 1 });
    });

    it('un aviso sin firma (BulkGate) sólo mueve un SMS de ESA conexión; el de otra conexión no cambia nada', async () => {
        const bgId = await connect('sms_bulkgate', { application_id: BG_APP, application_token: BG_TOKEN });
        const twId = await connectTwilio();
        const { listId, fieldsBy } = await seedClients();
        const rec = await addClient(listId, fieldsBy, 'Ana', '+573001112233');
        await svc.sendFromRecord(tenantId, admin(), 'clientes', rec, { connection_id: bgId, message: 'Hola', strip_accents: false, respect_hours: false });
        const [msg] = await messages();
        expect(msg!.providerMessageId).toMatch(/^idx/);
        // BulkGate no recibe URL por mensaje: la de la conexión se pega en su portal.
        const detail = await svc.connectionDetail(tenantId, admin(), bgId);
        expect(detail.delivery.mode).toBe('manual');
        const bgToken = detail.delivery.url.split('/').pop()!;
        const twToken = (await svc.connectionDetail(tenantId, admin(), twId)).delivery.url.split('/').pop()!;
        // El GET de prueba de BulkGate (sin datos) contesta 200.
        expect(await svc.receive(bgToken, { method: 'GET', query: {}, body: null, headers: {} })).toEqual({ ok: true, updated: 0 });
        // El mismo id por la URL de OTRA conexión (Twilio exige firma; una sin firma tampoco sirve).
        await expect(svc.receive(twToken, { method: 'GET', query: { status: '1', smsID: msg!.providerMessageId! }, body: null, headers: {} })).resolves.toEqual({ ok: true, updated: 0 });
        expect((await messages())[0]!.status).toBe('enviado');
        // Por la suya, sí.
        expect(await svc.receive(bgToken, { method: 'GET', query: { status: '1', smsID: msg!.providerMessageId!, price: '1' }, body: null, headers: {} })).toEqual({ ok: true, updated: 1 });
        expect((await recordData(rec))[`f${fieldsBy.sms_estado}`]).toBe('entregado');
        // Un id que no mandamos no crea nada ni falla.
        expect(await svc.receive(bgToken, { method: 'GET', query: { status: '3', smsID: 'idx-ajeno' }, body: null, headers: {} })).toEqual({ ok: true, updated: 0 });
    });

    it('Infobip y LabsMobile: el aviso llega a la URL que viajó con el envío y se ata por nuestra referencia', async () => {
        const ibId = await connect('sms_infobip', { base_url: IB_BASE, api_key: IB_KEY });
        const lmId = await connect('sms_labsmobile', { username: LM_USER, api_token: LM_TOKEN });
        const { listId, fieldsBy } = await seedClients();
        const ana = await addClient(listId, fieldsBy, 'Ana', '+573001112233');
        const beto = await addClient(listId, fieldsBy, 'Beto', '+573004445566');
        await svc.sendFromRecord(tenantId, admin(), 'clientes', ana, { connection_id: ibId, message: 'Hola Ana', strip_accents: false, respect_hours: false });
        await svc.sendFromRecord(tenantId, admin(), 'clientes', beto, { connection_id: lmId, message: 'Hola Beto', strip_accents: false, respect_hours: false });
        const [ibMsg, lmMsg] = await messages();
        const ibBody = JSON.parse(sent[0]!.raw) as { messages: Array<{ webhooks: { delivery: { url: string } } }> };
        const ibToken = ibBody.messages[0]!.webhooks.delivery.url.split('/').pop()!;
        const lmToken = String((JSON.parse(sent[1]!.raw) as { ackurl: string }).ackurl).split('/').pop()!;
        expect(
            await svc.receive(ibToken, {
                method: 'POST',
                query: {},
                headers: {},
                body: { results: [{ messageId: ibMsg!.reference, status: { groupName: 'UNDELIVERABLE', name: 'UNDELIVERABLE_NOT_DELIVERED', description: 'Message sent not delivered' }, callbackData: ibMsg!.reference }] },
            }),
        ).toEqual({ ok: true, updated: 1 });
        const ibAfter = (await messages()).find((m) => m.id === ibMsg!.id)!;
        expect(ibAfter.status).toBe('fallido');
        expect(ibAfter.error).toContain('Message sent not delivered');
        expect((await recordData(ana))[`f${fieldsBy.sms_estado}`]).toBe('fallido');
        expect(await svc.receive(lmToken, { method: 'GET', query: { acklevel: 'handset', status: 'ok', subid: lmMsg!.reference, msisdn: '573004445566' }, body: null, headers: {} })).toEqual({
            ok: true,
            updated: 1,
        });
        expect((await recordData(beto))[`f${fieldsBy.sms_estado}`]).toBe('entregado');
    });

    it('Onurix no avisa: se pregunta el estado hasta que llega el final', async () => {
        const id = await connect('sms_onurix', { client_id: OX_CLIENT, key: OX_KEY });
        const { listId, fieldsBy } = await seedClients();
        const rec = await addClient(listId, fieldsBy, 'Ana', '3001112233');
        const res = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec, { connection_id: id, message: 'Hola Ana', strip_accents: false, respect_hours: false });
        expect(res.ok).toBe(true);
        const [msg] = await messages();
        expect(msg!.nextPollAt).not.toBeNull();
        const later = new Date(Date.now() + 6 * 60_000);
        expect(await svc.pollStatuses(later)).toBe(0); // todavía «Enviado»
        onurixState = 'Entregado';
        expect(await svc.pollStatuses(new Date(later.getTime() + 6 * 60_000))).toBe(1);
        const after = (await messages())[0]!;
        expect(after.status).toBe('entregado');
        expect(after.nextPollAt).toBeNull();
        expect((await recordData(rec))[`f${fieldsBy.sms_estado}`]).toBe('entregado');
    });

    // ── Envío a una selección ───────────────────────────────────────────

    it('a una selección: la vista previa cuenta quién no tiene teléfono y los SMS; la cola manda uno por uno y deja el resultado por fila', async () => {
        const id = await connect('sms_labsmobile', { username: LM_USER, api_token: LM_TOKEN, rate: '50' });
        const { listId, fieldsBy } = await seedClients();
        const ana = await addClient(listId, fieldsBy, 'Ana', '+573001112233');
        const beto = await addClient(listId, fieldsBy, 'Beto', '+573004445566');
        const sinTel = await addClient(listId, fieldsBy, 'Carla', null);
        const input = { connection_id: id, record_ids: [ana, beto, sinTel], message: 'Hola {{nombre}}, ¿confirmas tu cita?', strip_accents: false, respect_hours: false };
        const preview = await svc.bulkPreview(tenantId, admin(), 'clientes', input);
        expect(preview).toMatchObject({ total: 3, sendable: 2, segments_total: 2, scheduled_for: null, ucs2: 0 });
        expect(preview.missing).toEqual([{ record_id: sinTel, title: 'Carla', reason: 'No tiene teléfono.' }]);
        expect(preview.sample[0]).toMatchObject({ to: '+573001112233', text: 'Hola Ana, ¿confirmas tu cita?' });
        const res = await svc.bulkSend(tenantId, admin(), 'clientes', input);
        expect(res).toMatchObject({ queued: 2, skipped: 1, scheduled_for: null });
        expect(sent).toHaveLength(0); // sale por la cola, no en el acto
        expect((await recordData(ana))[`f${fieldsBy.sms_estado}`]).toBe('en_cola');
        expect(await svc.drain()).toBe(2);
        expect(sent.map((s) => s.text)).toEqual(['Hola Ana, ¿confirmas tu cita?', 'Hola Beto, ¿confirmas tu cita?']);
        const batch = await svc.batchStatus(tenantId, admin(), 'clientes', res.batch_id);
        expect(batch.done).toBe(true);
        expect(batch.counts).toEqual({ enviado: 2 });
        expect(batch.rows.map((r) => r.title)).toEqual(['Ana', 'Beto']);
        // El texto no queda guardado una vez que salió.
        expect((await messages()).every((m) => m.body === null)).toBe(true);
        // Otro usuario sin administrar la lista no ve el detalle del envío ajeno.
        await expect(svc.batchStatus(tenantId, { userId: agentId, role: 'agent' }, 'clientes', res.batch_id)).rejects.toMatchObject({ status: 404 });
        // Un agente que no puede editar un registro ajeno lo ve como «no puedes editar».
        await pg.db
            .update(lists)
            .set({ settings: { ...(await listsService.get(tenantId, 'clientes')).settings, permissions: { permissions: { agent: { view: 'all', create: true, edit: 'own', delete: 'none', fields_hidden: [] } } } } })
            .where(eq(lists.id, listId));
        const agentPreview = await svc.bulkPreview(tenantId, { userId: agentId, role: 'agent' }, 'clientes', input);
        expect(agentPreview.sendable).toBe(0);
        expect(agentPreview.missing.every((m) => m.reason === 'No puedes editar este registro.')).toBe(true);
    });

    // ── Ley 2300: horario ───────────────────────────────────────────────

    it('Ley 2300: fuera de la franja queda PROGRAMADO para el siguiente momento permitido (festivo incluido) y sale solo', async () => {
        // Domingo 1 de noviembre de 2026, 10:00 en Bogotá. El lunes 2 es festivo (Todos los Santos).
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-01T15:00:00Z'));
        const id = await connectTwilio();
        const { listId, fieldsBy } = await seedClients();
        const rec = await addClient(listId, fieldsBy, 'Ana', '+573001112233');
        const res = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec, { connection_id: id, message: 'Tu factura vence mañana', strip_accents: false, respect_hours: true });
        expect(res.status).toBe('programado');
        const when = nextCommercialSendTime(new Date(), 'America/Bogota');
        expect(res.scheduled_for).toBe(when.toISOString());
        expect(res.scheduled_for).toBe('2026-11-03T12:00:00.000Z'); // martes 3, 07:00 en Bogotá
        expect(sent).toHaveLength(0);
        expect((await recordData(rec))[`f${fieldsBy.sms_estado}`]).toBe('programado');
        // Mientras está programado, el texto se guarda (para mandarlo); el tic de antes no lo toca.
        expect((await messages())[0]!.body).toBe('Tu factura vence mañana');
        expect(await svc.drain({ now: new Date('2026-11-02T20:00:00Z') })).toBe(0);
        // Llegó la hora: sale.
        vi.setSystemTime(new Date('2026-11-03T12:01:00Z'));
        expect(await svc.drain()).toBe(1);
        expect(sent).toHaveLength(1);
        const after = (await messages())[0]!;
        expect(after.status).toBe('enviado');
        expect(after.body).toBeNull();
        const logs = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(and(eq(activity.recordId, rec), eq(activity.action, 'sms'))).orderBy(activity.id));
        expect(logs.map((l) => (l.diff as { sms: { event: string } }).sms.event)).toEqual(['scheduled', 'sent']);
    });

    // ── Automatizaciones ────────────────────────────────────────────────

    it('automatización «Enviar SMS»: corre con el motor real, manda y escribe en el registro; «Probar ahora» NO manda', async () => {
        const id = await connect('sms_infobip', { base_url: IB_BASE, api_key: IB_KEY });
        const { listId, fieldsBy } = await seedClients();
        const rec = await addClient(listId, fieldsBy, 'Ana', '+573001112233');
        const values = { to: '{{telefono}}', message: 'Hola {{nombre}}, ya está tu pedido', strip_accents: true, respect_hours: false };
        const [auto] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(automations)
                .values({
                    tenantId,
                    listId,
                    name: 'Aviso por SMS',
                    triggerType: 'record_created',
                    triggerConfig: {},
                    actions: [{ type: 'connector_action', config: { connection_id: id, action_key: 'send_sms', values } }],
                    isActive: true,
                })
                .returning(),
        );
        // «Probar ahora» resuelve las variables contra un registro real y NO manda.
        const test = await svc.testSend(tenantId, admin(), 'clientes', { connection_id: id, values, send: false });
        expect(test).toMatchObject({ ok: true, simulated: true, to: '+573001112233', text: 'Hola Ana, ya esta tu pedido', segments: 1, sample_record_id: rec });
        expect(sent).toHaveLength(0);
        expect(JSON.stringify(test)).not.toContain(IB_KEY);
        // «Enviarme una prueba» sin número rebota; con número sí manda (y no toca el registro).
        await expect(svc.testSend(tenantId, admin(), 'clientes', { connection_id: id, values, send: true })).rejects.toMatchObject({ status: 400 });
        const mine = await svc.testSend(tenantId, admin(), 'clientes', { connection_id: id, values, send: true, to: '+573009998877' });
        expect(mine).toMatchObject({ ok: true, to: '+573009998877' });
        expect(sent).toHaveLength(1);
        expect((await recordData(rec))[`f${fieldsBy.sms_estado}`]).toBeUndefined();

        await engine.process({ tenantId, listId, recordId: rec, trigger: 'record_created', after: await recordData(rec) });
        const [run] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto!.id)));
        const log = run!.actionsLog as Array<{ status: string; message: string }>;
        expect(log[0]!.status).toBe('success');
        expect(log[0]!.message).toContain('envió 1 SMS a +573001112233');
        expect(sent).toHaveLength(2);
        expect(sent[1]!.text).toBe('Hola Ana, ya esta tu pedido');
        expect((await recordData(rec))[`f${fieldsBy.sms_estado}`]).toBe('enviado');
        const msg = (await messages()).find((m) => m.source === 'automation')!;
        expect(msg.automationId).toBe(auto!.id);
    });

    // ── Problemas ───────────────────────────────────────────────────────

    it('una credencial rechazada o sin saldo abre un problema de la conexión; un número inválido no; vuelve a mandar y se cierra solo', async () => {
        const id = await connectTwilio();
        const { listId, fieldsBy } = await seedClients();
        const rec = await addClient(listId, fieldsBy, 'Ana', '+573001110000');
        const bad = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec, { connection_id: id, message: 'Hola', strip_accents: false, respect_hours: false });
        expect(bad).toMatchObject({ ok: false, status: 'fallido' });
        expect(bad.error).toMatch(/número/i);
        expect(incidents).toHaveLength(0);
        expect((await recordData(rec))[`f${fieldsBy.sms_estado}`]).toBe('fallido');

        await withTenant(pg.db, tenantId, (tx) => tx.update(records).set({ data: { ...{}, [`f${fieldsBy.nombre}`]: 'Ana', [`f${fieldsBy.telefono}`]: '+573001112233' } }).where(eq(records.id, rec)));
        override = { status: 401, body: JSON.stringify({ code: 20003, message: 'Authenticate', status: 401 }) };
        const revoked = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec, { connection_id: id, message: 'Hola', strip_accents: false, respect_hours: false });
        expect(revoked.ok).toBe(false);
        expect(incidents).toHaveLength(1);
        expect(incidents[0]).toMatchObject({ key: `connection:${id}`, source: 'connection' });
        override = null;
        const ok = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec, { connection_id: id, message: 'Hola', strip_accents: false, respect_hours: false });
        expect(ok.ok).toBe(true);
        expect(resolved).toContain(`connection:${id}`);
    });

    it('un SMS que quedó «enviando» por un corte se marca fallido (no se reintenta: podría llegar dos veces)', async () => {
        const id = await connectTwilio();
        const { listId, fieldsBy } = await seedClients();
        const rec = await addClient(listId, fieldsBy, 'Ana', '+573001112233');
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(smsMessages).values({
                tenantId,
                connectionId: id,
                provider: 'sms_twilio',
                listId,
                recordId: rec,
                source: 'bulk',
                toPhone: '+573001112233',
                body: 'Hola',
                segments: 1,
                encoding: 'gsm7',
                status: 'enviando',
                reference: 'scolgado01',
                claimedAt: new Date(Date.now() - 20 * 60_000),
            }),
        );
        expect(await svc.recoverStuck()).toBe(1);
        const [msg] = await messages();
        expect(msg!.status).toBe('fallido');
        expect(msg!.body).toBeNull();
        expect(msg!.error).toMatch(/no se sabe si salió/);
        expect((await recordData(rec))[`f${fieldsBy.sms_estado}`]).toBe('fallido');
        expect(await svc.drain()).toBe(0);
        expect(sent).toHaveLength(0);
    });

    // ── Permisos, asistente y RLS ───────────────────────────────────────

    it('permisos: mandar exige poder editar el registro; el teléfono oculto no se usa; la página de la conexión es de quien la edita', async () => {
        const id = await connectTwilio();
        const { listId, fieldsBy } = await seedClients();
        const rec = await addClient(listId, fieldsBy, 'Ana', '+573001112233');
        await expect(
            svc.sendFromRecord(tenantId, { userId: agentId, role: 'viewer' }, 'clientes', rec, { connection_id: id, message: 'x', strip_accents: false, respect_hours: false }),
        ).rejects.toMatchObject({ status: 404 });
        await expect(svc.connectionDetail(tenantId, { userId: agentId, role: 'agent' }, id)).rejects.toMatchObject({ status: 403 });
        const viewerInfo = await svc.recordInfo(tenantId, { userId: agentId, role: 'viewer' }, 'clientes', rec);
        expect(viewerInfo.can_send).toBe(false);
        await pg.db
            .update(lists)
            .set({
                settings: {
                    ...(await listsService.get(tenantId, 'clientes')).settings,
                    permissions: { permissions: { agent: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: ['telefono'] } } },
                },
            })
            .where(eq(lists.id, listId));
        const agent = { userId: agentId, role: 'agent' as const };
        const info = await svc.recordInfo(tenantId, agent, 'clientes', rec);
        expect(info.recipient).toBeNull();
        expect(info.can_send).toBe(true);
        const blind = await svc.sendFromRecord(tenantId, agent, 'clientes', rec, { connection_id: id, message: 'x', strip_accents: false, respect_hours: false });
        expect(blind.ok).toBe(false);
        expect(blind.error).toMatch(/Falta el número/);
        expect(sent).toHaveLength(0);
    });

    it('asistente / MCP: ve las conexiones de SMS y las columnas, nunca la credencial', async () => {
        const id = await connectTwilio();
        await seedClients();
        const conns = await connectors.list(tenantId, adminId, 'admin');
        const list = await listsService.get(tenantId, 'clientes');
        const block = smsSchema(conns, list.settings, await fieldsService.listByListId(tenantId, list.id));
        expect(block).toMatchObject({ connections: [{ connection_id: id, provider: 'Twilio' }], list_columns: { phone: 'telefono', last_at: 'sms_ultimo', last_status: 'sms_estado' } });
        expect(JSON.stringify(block)).not.toContain(TW_TOKEN);
        expect(String(block!.rules)).toContain('Ley 2300');
        // Y la acción está en el catálogo de la conexión, con sus parámetros.
        const action = conns.find((c) => c.id === id)!.actions.find((a) => a.key === 'send_sms');
        expect(action?.params.map((p) => p.key)).toEqual(['to', 'message', 'sender', 'strip_accents', 'respect_hours']);
    });

    it('RLS: los SMS de una empresa no se ven ni se escriben desde otra', async () => {
        const id = await connectTwilio();
        const { listId, fieldsBy } = await seedClients();
        const rec = await addClient(listId, fieldsBy, 'Ana', '+573001112233');
        await svc.sendFromRecord(tenantId, admin(), 'clientes', rec, { connection_id: id, message: 'Hola', strip_accents: false, respect_hours: false });
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(smsMessages))).toHaveLength(1);
        expect(await withTenant(pg.db, otherTenantId, (tx) => tx.select().from(smsMessages))).toHaveLength(0);
        await expect(
            withTenant(pg.db, otherTenantId, (tx) =>
                tx.insert(smsMessages).values({ tenantId, connectionId: id, provider: 'sms_twilio', source: 'manual', toPhone: '+1', segments: 1, encoding: 'gsm7', status: 'enviado', reference: 'sajeno01' }),
            ),
        ).rejects.toThrow();
        // Y un batch de otra empresa no existe para ésta.
        await expect(svc.batchStatus(otherTenantId, { userId: adminId, role: 'admin' }, String(listId), `b${'0'.repeat(20)}`)).rejects.toBeTruthy();
    });
});
