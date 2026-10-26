import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildWhatsappTemplateComponents,
    customRoleKey,
    type Capability,
    nextWhatsappStatus,
    renderWhatsappTemplate,
    suggestWhatsappFields,
    whatsappIdVariants,
    whatsappRecipient,
    whatsappTemplateVariables,
    whatsappWindowOpen,
} from '@imagina-base/shared';

/**
 * D3 — WhatsApp oficial (Meta WhatsApp Cloud API) de punta a punta con
 * Postgres real. La Graph API se simula en el borde de red (`safeWebhookFetch`),
 * así el test ejercita TODO lo nuestro: conectar (verificado contra Meta, con
 * el `appsecret_proof`), la URL de avisos (verificación GET y firma del POST),
 * el contacto que se crea o se actualiza por teléfono, el último mensaje SIN
 * historial, el aviso repetido, las plantillas, el cuerpo EXACTO de un envío,
 * la ventana de 24 h, los estados y el problema por token inválido.
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
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import {
    activity,
    automationRuns,
    automations,
    connections,
    fields,
    lists,
    records,
    tenants,
    users,
    whatsappContacts,
    whatsappHooks,
    whatsappTemplates,
} from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { IncidentHub, type IncidentReport } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { assertWhatsappTemplateAction, whatsappSchema } from '../src/ai/tools/whatsapp-ai';
import { remapWhatsappConnectionConfig } from '../src/platform/tenant-transfer.remap';
import { emptyMaps } from '../src/platform/tenant-transfer.remap';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { appSecretProof, isSystemicMetaError, metaErrorText, parseMetaError } from '../src/whatsapp/whatsapp-graph';
import { inboundText, parseMetaWebhook, verifyMetaSignature } from '../src/whatsapp/whatsapp-webhook';
import { WHATSAPP_WINDOW_CLOSED, WhatsappService, channelValue, mergeVariables } from '../src/whatsapp/whatsapp.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const GRAPH = 'https://graph.facebook.com/v26.0';
const PHONE_ID = '109876543210987';
const WABA_ID = '201234567890123';
const TOKEN = 'EAAG-token-bueno';
const APP_SECRET = 'secreto-de-la-app-de-meta-0123456';

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

const RECORDATORIO = [
    { type: 'HEADER', format: 'DOCUMENT' },
    { type: 'BODY', text: 'Hola {{1}}, tu factura {{2}} vence el {{3}}.', example: { body_text: [['Ana', 'FAC-1', '30/10']] } },
    { type: 'FOOTER', text: 'Acme S.A.' },
    {
        type: 'BUTTONS',
        buttons: [
            { type: 'URL', text: 'Pagar', url: 'https://pagos.acme.test/{{1}}' },
            { type: 'QUICK_REPLY', text: 'Ya pagué' },
        ],
    },
];
const BIENVENIDA = [
    { type: 'HEADER', format: 'TEXT', text: 'Hola {{nombre}}' },
    { type: 'BODY', text: 'Gracias {{nombre}} por escribirnos.', example: { body_text_named_params: [{ param_name: 'nombre', example: 'Ana' }] } },
];

function sign(body: string, secret = APP_SECRET): string {
    return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

function inboundPayload(opts: { id: string; from: string; text?: string; name?: string; ts?: number; type?: string; phoneId?: string }): string {
    const ts = opts.ts ?? Math.floor(Date.now() / 1000);
    const msg: Record<string, unknown> =
        (opts.type ?? 'text') === 'text'
            ? { from: opts.from, id: opts.id, timestamp: String(ts), type: 'text', text: { body: opts.text ?? '' } }
            : { from: opts.from, id: opts.id, timestamp: String(ts), type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: opts.text ?? '' } };
    return JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
            {
                id: WABA_ID,
                changes: [
                    {
                        field: 'messages',
                        value: {
                            messaging_product: 'whatsapp',
                            metadata: { display_phone_number: '573000000000', phone_number_id: opts.phoneId ?? PHONE_ID },
                            contacts: [{ profile: { name: opts.name ?? 'Ana Gómez' }, wa_id: opts.from }],
                            messages: [msg],
                        },
                    },
                ],
            },
        ],
    });
}

function statusPayload(id: string, status: string, recipient: string, errors?: unknown[]): string {
    return JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
            {
                id: WABA_ID,
                changes: [
                    {
                        field: 'messages',
                        value: {
                            messaging_product: 'whatsapp',
                            metadata: { display_phone_number: '573000000000', phone_number_id: PHONE_ID },
                            statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: recipient, ...(errors ? { errors } : {}) }],
                        },
                    },
                ],
            },
        ],
    });
}

describe('WhatsApp oficial — Meta Cloud API (D3)', () => {
    let pg: TestPg;
    let connectors: ConnectorsService;
    let svc: WhatsappService;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let engine: AutomationEngine;
    let dispatcher: CapturingDispatcher;
    let incidents: IncidentReport[];
    let tenantId: number;
    let otherTenantId: number;
    let adminId: number;
    let agentId: number;
    let sent: Array<Record<string, unknown>>;
    let tokenOk: string;
    /** Lo que recibe el motor de campos con IA cuando WhatsApp escribe en un registro. */
    const aiChanges: Array<{ recordId: number; after: Record<string, unknown> }> = [];

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
            { onChange: async (e: { recordId: number; after: Record<string, unknown> }) => void aiChanges.push(e) } as never,
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

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        otherTenantId = t2!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme.test', passwordHash: 'x', name: 'Ada' }).returning();
        adminId = u!.id;
        const [a] = await pg.db.insert(users).values({ email: 'agent@acme.test', passwordHash: 'x', name: 'Agus' }).returning();
        agentId = a!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        net.calls.length = 0;
        sent = [];
        incidents.length = 0;
        dispatcher.events.length = 0;
        tokenOk = TOKEN;
        fakeGraph();
        for (const tid of [tenantId, otherTenantId]) {
            await withTenant(pg.db, tid, async (tx) => {
                await tx.delete(whatsappContacts).where(eq(whatsappContacts.tenantId, tid));
                await tx.delete(whatsappTemplates).where(eq(whatsappTemplates.tenantId, tid));
                await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tid));
                await tx.delete(automations).where(eq(automations.tenantId, tid));
                await tx.delete(activity).where(eq(activity.tenantId, tid));
                await tx.delete(records).where(eq(records.tenantId, tid));
                await tx.delete(fields).where(eq(fields.tenantId, tid));
                await tx.delete(lists).where(eq(lists.tenantId, tid));
            });
            await pg.db.delete(whatsappHooks).where(eq(whatsappHooks.tenantId, tid));
            await withTenant(pg.db, tid, (tx) => tx.delete(connections).where(eq(connections.tenantId, tid)));
        }
    });

    // ── La Graph API simulada ───────────────────────────────────────────

    function fakeGraph(): void {
        let n = 0;
        net.handler = (call) => {
            const url = new URL(call.url);
            const auth = call.headers?.authorization ?? '';
            if (!url.href.startsWith(GRAPH)) return { status: 404, body: '' };
            if (auth !== `Bearer ${tokenOk}`) {
                return { status: 401, body: JSON.stringify({ error: { message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190, error_subcode: 463 } }) };
            }
            if (url.searchParams.get('appsecret_proof') !== appSecretProof(tokenOk, APP_SECRET)) {
                return { status: 400, body: JSON.stringify({ error: { message: 'Invalid appsecret_proof provided in the API argument', type: 'GraphMethodException', code: 100 } }) };
            }
            const path = url.pathname.replace('/v26.0/', '');
            if (path === PHONE_ID && call.method === 'GET') {
                return { status: 200, body: JSON.stringify({ display_phone_number: '+57 300 000 0000', verified_name: 'Acme', quality_rating: 'GREEN', id: PHONE_ID }) };
            }
            if (path === `${WABA_ID}/phone_numbers`) return { status: 200, body: JSON.stringify({ data: [{ id: PHONE_ID }] }) };
            if (path === `${WABA_ID}/message_templates`) {
                if (url.searchParams.get('after') === 'p2') {
                    return {
                        status: 200,
                        body: JSON.stringify({
                            data: [{ id: '3', name: 'promo_rechazada', language: 'es', status: 'REJECTED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Promo' }], rejected_reason: 'PROMOTIONAL' }],
                            paging: { cursors: { before: 'p1', after: 'p3' } },
                        }),
                    };
                }
                return {
                    status: 200,
                    body: JSON.stringify({
                        data: [
                            { id: '1', name: 'recordatorio_pago', language: 'es', status: 'APPROVED', category: 'UTILITY', parameter_format: 'POSITIONAL', components: RECORDATORIO },
                            { id: '2', name: 'bienvenida', language: 'es_MX', status: 'APPROVED', category: 'UTILITY', parameter_format: 'NAMED', components: BIENVENIDA },
                        ],
                        paging: { cursors: { before: 'p0', after: 'p2' }, next: `${GRAPH}/${WABA_ID}/message_templates?after=p2` },
                    }),
                };
            }
            if (path === `${WABA_ID}/subscribed_apps`) {
                return { status: 200, body: JSON.stringify(call.method === 'POST' ? { success: true } : { data: [{ whatsapp_business_api_data: { id: '9' } }] }) };
            }
            if (path === `${PHONE_ID}/messages` && call.method === 'POST') {
                const body = JSON.parse(call.body ?? '{}') as Record<string, unknown>;
                sent.push(body);
                n++;
                return { status: 200, body: JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.TEST${n}` }] }) };
            }
            return { status: 404, body: JSON.stringify({ error: { message: 'Unknown path', code: 100, error_subcode: 33 } }) };
        };
    }

    async function connect(): Promise<number> {
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'whatsapp_cloud', {
            fields: { access_token: TOKEN, phone_number_id: PHONE_ID, waba_id: WABA_ID, app_secret: APP_SECRET },
            visibility: 'workspace',
        });
        return connection.id;
    }

    const admin = (): { userId: number; role: 'admin' } => ({ userId: adminId, role: 'admin' });

    /** Lista «Clientes» con nombre, teléfono y las columnas de WhatsApp preparadas, conectada como lista de entrada. */
    async function seedContacts(connId: number): Promise<{ listId: number; fieldsBy: Record<string, number> }> {
        const list = await listsService.create(tenantId, { name: 'Clientes', slug: 'clientes' });
        await fieldsService.create(tenantId, 'clientes', { label: 'Nombre', type: 'text' });
        await fieldsService.create(tenantId, 'clientes', { label: 'Teléfono', type: 'phone', config: { default_country: 'CO' } });
        await fieldsService.create(tenantId, 'clientes', { label: 'Factura', type: 'text' });
        const cols = await svc.setupListColumns(tenantId, admin(), 'clientes');
        await svc.updateConfig(tenantId, admin(), connId, { inbound_list_id: list.id, create_contacts: true });
        const all = await fieldsService.listByListId(tenantId, list.id);
        const fieldsBy: Record<string, number> = {};
        for (const f of all) fieldsBy[f.slug] = f.id;
        expect(cols.fields.phone).toBe(fieldsBy.telefono);
        return { listId: list.id, fieldsBy };
    }

    async function listRecords(listId: number): Promise<Array<{ id: number; data: Record<string, unknown> }>> {
        const rows = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(and(eq(records.tenantId, tenantId), eq(records.listId, listId))));
        return rows.map((r) => ({ id: r.id, data: r.data as Record<string, unknown> })).sort((a, b) => a.id - b.id);
    }

    async function hook(connId: number): Promise<{ token: string; verifyToken: string }> {
        return svc.ensureHook(tenantId, connId);
    }

    // ── Piezas puras ────────────────────────────────────────────────────

    it('piezas puras: firma, avisos, plantillas, estados, ventana y teléfonos', () => {
        const body = inboundPayload({ id: 'wamid.A', from: '573001112233', text: 'Hola' });
        expect(verifyMetaSignature(APP_SECRET, body, sign(body))).toBe(true);
        expect(verifyMetaSignature(APP_SECRET, body, sign(body, 'otro'))).toBe(false);
        expect(verifyMetaSignature(APP_SECRET, `${body} `, sign(body))).toBe(false);
        expect(verifyMetaSignature(APP_SECRET, body, undefined)).toBe(false);
        expect(verifyMetaSignature('', body, sign(body))).toBe(false);

        const parsed = parseMetaWebhook(JSON.parse(body));
        expect(parsed.messages).toHaveLength(1);
        expect(parsed.messages[0]).toMatchObject({ waId: '573001112233', profileName: 'Ana Gómez', text: 'Hola', type: 'text', phoneNumberId: PHONE_ID });
        expect(inboundText({ type: 'image', image: { caption: 'la factura' } })).toBe('[Imagen] la factura');
        expect(inboundText({ type: 'audio', audio: { voice: true } })).toBe('[Nota de voz]');
        expect(inboundText({ type: 'document', document: { filename: 'rut.pdf' } })).toBe('[Documento] rut.pdf');
        expect(inboundText({ type: 'interactive', interactive: { button_reply: { title: 'Sí, confirmo' } } })).toBe('Sí, confirmo');

        // Plantilla posicional con documento en el encabezado y botón con URL dinámica.
        expect(whatsappTemplateVariables(RECORDATORIO, 'POSITIONAL').map((v) => v.key)).toEqual(['body.1', 'body.2', 'body.3', 'button.0']);
        const missing = buildWhatsappTemplateComponents(RECORDATORIO, 'POSITIONAL', { variables: { 'body.1': 'Ana' } });
        expect(missing.ok).toBe(false);
        const built = buildWhatsappTemplateComponents(RECORDATORIO, 'POSITIONAL', {
            variables: { 'body.1': 'Ana\nGómez', 'body.2': 'FAC-9', 'body.3': '30/10/2026', 'button.0': 'abc123' },
            header_media: 'https://files.acme.test/FAC-9.pdf',
        });
        expect(built).toEqual({
            ok: true,
            components: [
                { type: 'header', parameters: [{ type: 'document', document: { link: 'https://files.acme.test/FAC-9.pdf', filename: 'FAC-9.pdf' } }] },
                { type: 'body', parameters: [{ type: 'text', text: 'Ana Gómez' }, { type: 'text', text: 'FAC-9' }, { type: 'text', text: '30/10/2026' }] },
                { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc123' }] },
            ],
        });
        expect(buildWhatsappTemplateComponents(RECORDATORIO, 'POSITIONAL', { variables: { 'body.1': 'a', 'body.2': 'b', 'body.3': 'c', 'button.0': 'd' }, header_media: 'http://inseguro' }).ok).toBe(false);
        // Plantilla con parámetros CON NOMBRE.
        const named = buildWhatsappTemplateComponents(BIENVENIDA, 'NAMED', { variables: { 'header.nombre': 'Ana', 'body.nombre': 'Ana' } });
        expect(named).toEqual({
            ok: true,
            components: [
                { type: 'header', parameters: [{ type: 'text', parameter_name: 'nombre', text: 'Ana' }] },
                { type: 'body', parameters: [{ type: 'text', parameter_name: 'nombre', text: 'Ana' }] },
            ],
        });
        expect(renderWhatsappTemplate(RECORDATORIO, 'POSITIONAL', { 'body.1': 'Ana', 'body.2': 'FAC-9' }).text).toBe(
            '[Documento]\n\nHola Ana, tu factura FAC-9 vence el {{3}}.\n\nAcme S.A.',
        );

        // Estados: sólo avanzan; un «entregado» tardío no pisa un «leído»; fallido gana salvo leído.
        expect(nextWhatsappStatus(null, 'enviado')).toBe('enviado');
        expect(nextWhatsappStatus('enviado', 'leido')).toBe('leido');
        expect(nextWhatsappStatus('leido', 'entregado')).toBeNull();
        expect(nextWhatsappStatus('entregado', 'fallido')).toBe('fallido');
        expect(nextWhatsappStatus('leido', 'fallido')).toBeNull();
        expect(nextWhatsappStatus('fallido', 'entregado')).toBeNull();

        expect(whatsappWindowOpen(new Date(Date.now() - 23 * 3600_000))).toBe(true);
        expect(whatsappWindowOpen(new Date(Date.now() - 25 * 3600_000))).toBe(false);
        expect(whatsappWindowOpen(null)).toBe(false);

        expect(whatsappIdVariants('5215512345678')).toEqual(['5215512345678', '525512345678']);
        expect(whatsappIdVariants('5491112345678')).toEqual(['5491112345678', '541112345678']);
        expect(whatsappRecipient('+57 300 111 2233')).toEqual({ ok: true, digits: '573001112233' });
        expect(whatsappRecipient('3001112233', 'CO')).toEqual({ ok: true, digits: '573001112233' });
        expect(whatsappRecipient('3001112233').ok).toBe(false);

        // Errores de Meta en lenguaje claro; los de la conexión abren un problema.
        const expired = parseMetaError(401, JSON.stringify({ error: { code: 190, message: 'expired' } }))!;
        expect(metaErrorText(expired)).toMatch(/token de acceso venció/);
        expect(isSystemicMetaError(expired)).toBe(true);
        const window = parseMetaError(400, JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }))!;
        expect(metaErrorText(window)).toMatch(/24 h/);
        expect(isSystemicMetaError(window)).toBe(false);

        expect(mergeVariables('{"body.1": "{{x}}", "otra": "y"}', (s) => s.replace('{{x}}', 'Ana'))).toEqual({ 'body.1': 'Ana' });
        expect(channelValue('direction', 'in', { type: 'select', config: {} })).toBe('entrante');
        expect(channelValue('status', 'leido', { type: 'text', config: {} })).toBe('Leído');
        expect(suggestWhatsappFields([{ id: 5, slug: 'celular', type: 'phone' }]).phone).toBe(5);

        // Migración de empresa: la lista de entrada se re-mapea; una que no viajó queda vacía.
        const maps = emptyMaps();
        maps.list.set(10, 99);
        expect(remapWhatsappConnectionConfig('whatsapp_cloud', { whatsapp: { inbound_list_id: 10, create_contacts: true } }, maps)).toEqual({
            whatsapp: { inbound_list_id: 99, create_contacts: true },
        });
        expect(remapWhatsappConnectionConfig('whatsapp_cloud', { whatsapp: { inbound_list_id: 11 } }, maps)).toEqual({ whatsapp: { inbound_list_id: null } });
    });

    // ── Conectar ────────────────────────────────────────────────────────

    it('conectar verifica contra Meta: token malo, clave de app equivocada e ID ajeno no se guardan', async () => {
        const base = { phone_number_id: PHONE_ID, waba_id: WABA_ID, app_secret: APP_SECRET };
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'whatsapp_cloud', { fields: { ...base, access_token: 'EAAG-vencido' }, visibility: 'workspace' }),
        ).rejects.toThrow(/token de acceso venció/);
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'whatsapp_cloud', { fields: { ...base, access_token: TOKEN, app_secret: 'otra-clave' }, visibility: 'workspace' }),
        ).rejects.toThrow(/clave secreta de la app no corresponde/);
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'whatsapp_cloud', { fields: { ...base, access_token: TOKEN, phone_number_id: '+57 300' }, visibility: 'workspace' }),
        ).rejects.toThrow(/sólo números/);
        expect(await connectors.list(tenantId, adminId, 'admin')).toHaveLength(0);

        const id = await connect();
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, id)));
        expect(JSON.stringify(row!.secrets)).not.toContain(TOKEN);
        expect(JSON.stringify(row!.secrets)).not.toContain(APP_SECRET);
        expect((row!.config as Record<string, unknown>).account_label).toBe('+57 300 000 0000 · Acme');
        // Cada llamada a Meta lleva el appsecret_proof (y nunca la clave en claro).
        expect(net.calls.every((c) => !c.url.includes(APP_SECRET))).toBe(true);
    });

    // ── URL de avisos ───────────────────────────────────────────────────

    it('avisos: verificación GET, firma mala 401, token desconocido 404', async () => {
        const id = await connect();
        const h = await hook(id);
        expect(await svc.verifyChallenge(h.token, { 'hub.mode': 'subscribe', 'hub.verify_token': h.verifyToken, 'hub.challenge': '1158201444' })).toBe('1158201444');
        await expect(svc.verifyChallenge(h.token, { 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': 'x' })).rejects.toMatchObject({ status: 403 });
        await expect(svc.verifyChallenge('TokenQueNoExiste0000000', { 'hub.mode': 'subscribe' })).rejects.toMatchObject({ status: 404 });

        const body = inboundPayload({ id: 'wamid.X', from: '573001112233', text: 'hola' });
        await expect(svc.receive(h.token, body, sign(body, 'clave-falsa'))).rejects.toMatchObject({ status: 401 });
        await expect(svc.receive(h.token, body, undefined)).rejects.toMatchObject({ status: 401 });
        await expect(svc.receive('TokenQueNoExiste0000000', body, sign(body))).rejects.toMatchObject({ status: 404 });
        // Nada se procesó.
        const contacts = await withTenant(pg.db, tenantId, (tx) => tx.select().from(whatsappContacts));
        expect(contacts).toHaveLength(0);
    });

    // ── Mensajes entrantes ──────────────────────────────────────────────

    it('un mensaje entrante crea el contacto por teléfono, deja SÓLO el último mensaje y corre el disparador; el repetido no se procesa', async () => {
        const id = await connect();
        const { listId, fieldsBy } = await seedContacts(id);
        const h = await hook(id);
        const t1 = Math.floor(Date.now() / 1000) - 60;
        const body1 = inboundPayload({ id: 'wamid.IN1', from: '573001112233', text: 'Hola, ¿tienen turno?', name: 'Ana Gómez', ts: t1 });
        await svc.receive(h.token, body1, sign(body1));
        let rows = await listRecords(listId);
        expect(rows).toHaveLength(1);
        const rec = rows[0]!;
        expect(rec.data[`f${fieldsBy.telefono}`]).toBe('+573001112233');
        expect(rec.data[`f${fieldsBy.nombre}`]).toBe('Ana Gómez');
        expect(rec.data[`f${fieldsBy.whatsapp_ultimo_mensaje}`]).toBe('Hola, ¿tienen turno?');
        expect(rec.data[`f${fieldsBy.whatsapp_direccion}`]).toBe('entrante');
        expect(rec.data[`f${fieldsBy.whatsapp_nombre}`]).toBe('Ana Gómez');
        expect(rec.data[`f${fieldsBy.whatsapp_fecha}`]).toBe(new Date(t1 * 1000).toISOString());
        const ev = dispatcher.events.find((e) => e.trigger === 'whatsapp_message_received');
        expect(ev?.whatsapp).toMatchObject({ texto: 'Hola, ¿tienen turno?', de: '+573001112233', nombre: 'Ana Gómez', tipo: 'text', conexion_id: id });
        expect(ev?.recordId).toBe(rec.id);

        // El mismo aviso otra vez (Meta reintenta): no pasa nada.
        dispatcher.events.length = 0;
        await svc.receive(h.token, body1, sign(body1));
        expect(dispatcher.events.filter((e) => e.trigger === 'whatsapp_message_received')).toHaveLength(0);

        // Un segundo mensaje del MISMO número (otra forma) actualiza el mismo registro: queda sólo el último.
        const body2 = inboundPayload({ id: 'wamid.IN2', from: '573001112233', text: 'Ya vi, gracias', type: 'image' });
        await svc.receive(h.token, body2, sign(body2));
        rows = await listRecords(listId);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.data[`f${fieldsBy.whatsapp_ultimo_mensaje}`]).toBe('[Imagen] Ya vi, gracias');
        // Un «Campo con IA» que lee el último mensaje se recalcula solo: el motor recibe el cambio.
        expect(aiChanges.some((c) => c.recordId === rec.id && c.after[`f${fieldsBy.whatsapp_ultimo_mensaje}`] === '[Imagen] Ya vi, gracias')).toBe(true);

        // La actividad anota que llegó un mensaje, SIN el texto.
        const act = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(and(eq(activity.recordId, rec.id), eq(activity.action, 'whatsapp'))));
        expect(act).toHaveLength(2);
        expect(JSON.stringify(act.map((a) => a.diff))).not.toContain('turno');
        expect(JSON.stringify(act.map((a) => a.diff))).not.toContain('gracias');
        expect(act[0]!.diff).toMatchObject({ whatsapp: { event: 'received' } });

        // Un número registrado sin el «1» de México se encuentra igual.
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({ tenantId, listId, data: { [`f${fieldsBy.telefono}`]: '+525512345678', [`f${fieldsBy.nombre}`]: 'Carlos' }, createdBy: adminId }),
        );
        const body3 = inboundPayload({ id: 'wamid.IN3', from: '5215512345678', text: 'Buenas' });
        await svc.receive(h.token, body3, sign(body3));
        rows = await listRecords(listId);
        expect(rows).toHaveLength(2);
        expect(rows.find((r) => r.data[`f${fieldsBy.nombre}`] === 'Carlos')!.data[`f${fieldsBy.whatsapp_ultimo_mensaje}`]).toBe('Buenas');
    });

    it('sin «crear el contacto» un número desconocido sólo abre la ventana; un aviso de otro número de la app se enruta a SU conexión', async () => {
        const id = await connect();
        const { listId } = await seedContacts(id);
        await svc.updateConfig(tenantId, admin(), id, { inbound_list_id: listId, create_contacts: false });
        const h = await hook(id);
        const body = inboundPayload({ id: 'wamid.N1', from: '573209998877', text: 'hola' });
        await svc.receive(h.token, body, sign(body));
        expect(await listRecords(listId)).toHaveLength(0);
        const [c] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(whatsappContacts));
        expect(c!.phone).toBe('573209998877');
        expect(c!.lastInboundAt).not.toBeNull();

        // Un aviso de un número que no es de ninguna conexión de la empresa se ignora.
        const other = inboundPayload({ id: 'wamid.N2', from: '573209998877', text: 'x', phoneId: '999999999999999' });
        await svc.receive(h.token, other, sign(other));
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(whatsappContacts))).toHaveLength(1);
    });

    // ── Plantillas ──────────────────────────────────────────────────────

    it('sincroniza TODAS las plantillas (paginando) y la copia sigue a Meta', async () => {
        const id = await connect();
        const all = await svc.refreshTemplates(tenantId, admin(), id);
        expect(all.map((t) => `${t.name}|${t.language}|${t.status}`)).toEqual(['bienvenida|es_MX|APPROVED', 'promo_rechazada|es|REJECTED', 'recordatorio_pago|es|APPROVED']);
        expect(all.find((t) => t.name === 'promo_rechazada')?.rejected_reason).toBe('PROMOTIONAL');
        expect((await svc.templatesOf(tenantId, id, true)).map((t) => t.name)).toEqual(['bienvenida', 'recordatorio_pago']);
        // Un agente no actualiza las plantillas (es configuración de la conexión).
        await expect(svc.refreshTemplates(tenantId, { userId: agentId, role: 'agent' }, id)).rejects.toMatchObject({ status: 403 });
    });

    // ── Enviar ──────────────────────────────────────────────────────────

    it('envía una plantilla con variables y documento desde la ficha: el cuerpo EXACTO que recibe Meta, el último mensaje y los estados', async () => {
        const id = await connect();
        const { listId, fieldsBy } = await seedContacts(id);
        await svc.refreshTemplates(tenantId, admin(), id);
        const [rec] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(records)
                .values({ tenantId, listId, data: { [`f${fieldsBy.nombre}`]: 'Ana', [`f${fieldsBy.telefono}`]: '+573001112233', [`f${fieldsBy.factura}`]: 'FAC-9' }, createdBy: adminId })
                .returning(),
        );
        const res = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec!.id, {
            connection_id: id,
            kind: 'template',
            template: 'recordatorio_pago',
            language: 'es',
            variables: { 'body.1': '{{nombre}}', 'body.2': '{{factura}}', 'body.3': '30/10/2026', 'button.0': 'pagar/{{factura}}' },
            header_media: 'https://files.acme.test/{{factura}}.pdf',
        });
        expect(res.ok).toBe(true);
        expect(res.message_id).toBe('wamid.TEST1');
        expect(sent).toEqual([
            {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: '573001112233',
                type: 'template',
                template: {
                    name: 'recordatorio_pago',
                    language: { code: 'es' },
                    components: [
                        { type: 'header', parameters: [{ type: 'document', document: { link: 'https://files.acme.test/FAC-9.pdf', filename: 'FAC-9.pdf' } }] },
                        { type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'FAC-9' }, { type: 'text', text: '30/10/2026' }] },
                        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'pagar/FAC-9' }] },
                    ],
                },
            },
        ]);
        expect(res.request?.url).not.toContain(appSecretProof(TOKEN, APP_SECRET));
        let [data] = (await listRecords(listId)).map((r) => r.data);
        expect(data![`f${fieldsBy.whatsapp_ultimo_mensaje}`]).toBe('[Documento]\n\nHola Ana, tu factura FAC-9 vence el 30/10/2026.\n\nAcme S.A.');
        expect(data![`f${fieldsBy.whatsapp_direccion}`]).toBe('saliente');
        expect(data![`f${fieldsBy.whatsapp_estado}`]).toBe('enviado');
        const act = await withTenant(pg.db, tenantId, (tx) => tx.select().from(activity).where(and(eq(activity.recordId, rec!.id), eq(activity.action, 'whatsapp'))));
        expect(act[0]!.diff).toEqual({ whatsapp: { event: 'sent', kind: 'template', template: 'recordatorio_pago', language: 'es', connection: expect.any(String) } });
        expect(act[0]!.userId).toBe(adminId);

        // Estados: leído antes que entregado (llegan desordenados), y un fallido de un envío VIEJO no toca nada.
        const h = await hook(id);
        for (const st of ['read', 'delivered']) {
            const b = statusPayload('wamid.TEST1', st, '573001112233');
            await svc.receive(h.token, b, sign(b));
        }
        [data] = (await listRecords(listId)).map((r) => r.data);
        expect(data![`f${fieldsBy.whatsapp_estado}`]).toBe('leido');
        const old = statusPayload('wamid.VIEJO', 'failed', '573001112233', [{ code: 131026, title: 'Undeliverable' }]);
        await svc.receive(h.token, old, sign(old));
        [data] = (await listRecords(listId)).map((r) => r.data);
        expect(data![`f${fieldsBy.whatsapp_estado}`]).toBe('leido');

        // Un segundo envío que falla en la entrega deja el motivo traducido.
        await svc.sendFromRecord(tenantId, admin(), 'clientes', rec!.id, {
            connection_id: id,
            kind: 'template',
            template: 'bienvenida',
            variables: { 'header.nombre': 'Ana', 'body.nombre': 'Ana' },
        });
        expect((sent[1]!.template as Record<string, unknown>).language).toEqual({ code: 'es_MX' });
        const fail = statusPayload('wamid.TEST2', 'failed', '573001112233', [{ code: 131026, title: 'Message undeliverable', error_data: { details: 'x' } }]);
        await svc.receive(h.token, fail, sign(fail));
        [data] = (await listRecords(listId)).map((r) => r.data);
        expect(data![`f${fieldsBy.whatsapp_estado}`]).toBe('fallido');
        expect(String(data![`f${fieldsBy.whatsapp_detalle}`])).toMatch(/no se pudo entregar/);
        expect(incidents).toHaveLength(0);
    });

    it('texto libre: con la ventana cerrada NO sale; después de que el contacto escribe, sí', async () => {
        const id = await connect();
        const { listId, fieldsBy } = await seedContacts(id);
        const [rec] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({ tenantId, listId, data: { [`f${fieldsBy.nombre}`]: 'Luis', [`f${fieldsBy.telefono}`]: '+573104445566' }, createdBy: adminId }).returning(),
        );
        const closed = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec!.id, { connection_id: id, kind: 'text', text: 'Hola {{nombre}}', variables: {} });
        expect(closed.ok).toBe(false);
        expect(closed.error).toBe(WHATSAPP_WINDOW_CLOSED);
        expect(sent).toHaveLength(0);

        // Un mensaje de hace 25 h tampoco abre la ventana.
        const h = await hook(id);
        const stale = inboundPayload({ id: 'wamid.OLD', from: '573104445566', text: 'viejo', ts: Math.floor(Date.now() / 1000) - 25 * 3600 });
        await svc.receive(h.token, stale, sign(stale));
        expect((await svc.sendFromRecord(tenantId, admin(), 'clientes', rec!.id, { connection_id: id, kind: 'text', text: 'Hola', variables: {} })).error).toBe(WHATSAPP_WINDOW_CLOSED);

        const fresh = inboundPayload({ id: 'wamid.NEW', from: '573104445566', text: '¿Me ayudas?' });
        await svc.receive(h.token, fresh, sign(fresh));
        const info = await svc.recordInfo(tenantId, admin(), 'clientes', rec!.id);
        expect(info.connections[0]!.window_open).toBe(true);
        expect(info.recipient).toBe('+573104445566');
        const open = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec!.id, { connection_id: id, kind: 'text', text: 'Hola {{nombre}}, claro', variables: {} });
        expect(open.ok).toBe(true);
        expect(sent).toEqual([{ messaging_product: 'whatsapp', recipient_type: 'individual', to: '573104445566', type: 'text', text: { preview_url: false, body: 'Hola Luis, claro' } }]);
    });

    it('automatización: «Enviar plantilla» corre de verdad y escribe en el registro; «texto» con la ventana cerrada falla sin enviar', async () => {
        const id = await connect();
        const { listId, fieldsBy } = await seedContacts(id);
        await svc.refreshTemplates(tenantId, admin(), id);
        const [rec] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({ tenantId, listId, data: { [`f${fieldsBy.nombre}`]: 'Ana', [`f${fieldsBy.telefono}`]: '+573001112233', [`f${fieldsBy.factura}`]: 'FAC-1' }, createdBy: adminId }).returning(),
        );
        const [auto] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(automations)
                .values({
                    tenantId,
                    listId,
                    name: 'Recordar pago',
                    triggerType: 'record_created',
                    triggerConfig: {},
                    actions: [
                        {
                            type: 'connector_action',
                            config: {
                                connection_id: id,
                                action_key: 'send_template',
                                values: {
                                    to: '{{telefono}}',
                                    template: 'recordatorio_pago',
                                    language: 'es',
                                    variables: { 'body.1': '{{nombre}}', 'body.2': '{{factura}}', 'body.3': 'mañana', 'button.0': '{{factura}}' },
                                    header_media: 'https://files.acme.test/{{factura}}.pdf',
                                },
                            },
                        },
                        { type: 'connector_action', config: { connection_id: id, action_key: 'send_text', values: { to: '{{telefono}}', text: 'Hola' } } },
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
        expect(log[1]!.status).toBe('failed');
        expect(log[1]!.message).toContain(WHATSAPP_WINDOW_CLOSED);
        expect(sent).toHaveLength(1);
        expect(((sent[0]!.template as Record<string, unknown>).components as unknown[])[1]).toEqual({
            type: 'body',
            parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'FAC-1' }, { type: 'text', text: 'mañana' }],
        });
        const after = (await listRecords(listId))[0]!.data;
        expect(after[`f${fieldsBy.whatsapp_estado}`]).toBe('enviado');
        expect(String(after[`f${fieldsBy.whatsapp_ultimo_mensaje}`])).toContain('Hola Ana, tu factura FAC-1');
    });

    it('un token inválido abre un problema de la conexión; una plantilla sin aprobar o sin variables no se manda', async () => {
        const id = await connect();
        const { listId, fieldsBy } = await seedContacts(id);
        await svc.refreshTemplates(tenantId, admin(), id);
        const [rec] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({ tenantId, listId, data: { [`f${fieldsBy.nombre}`]: 'Ana', [`f${fieldsBy.telefono}`]: '+573001112233' }, createdBy: adminId }).returning(),
        );
        const rejected = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec!.id, { connection_id: id, kind: 'template', template: 'promo_rechazada', variables: {} });
        expect(rejected.error).toMatch(/no está aprobada/);
        const missing = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec!.id, { connection_id: id, kind: 'template', template: 'recordatorio_pago', variables: { 'body.1': 'Ana' } });
        expect(missing.error).toMatch(/Falta completar/);
        expect(sent).toHaveLength(0);

        // Meta revocó el token: el envío falla con el motivo y se abre UN problema de la conexión.
        tokenOk = 'EAAG-otro-token';
        const res = await svc.sendFromRecord(tenantId, admin(), 'clientes', rec!.id, {
            connection_id: id,
            kind: 'template',
            template: 'bienvenida',
            variables: { 'header.nombre': 'Ana', 'body.nombre': 'Ana' },
        });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/token de acceso venció/);
        expect(res.response?.status).toBe(401);
        expect(incidents).toHaveLength(1);
        expect(incidents[0]).toMatchObject({ key: `connection:${id}`, source: 'connection' });
    });

    it('permisos: mandar desde la ficha exige poder editar el registro; la configuración es del admin', async () => {
        const id = await connect();
        const { listId, fieldsBy } = await seedContacts(id);
        const [rec] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({ tenantId, listId, data: { [`f${fieldsBy.telefono}`]: '+573001112233' }, createdBy: adminId }).returning(),
        );
        // Un lector no alcanza el registro para editarlo.
        await expect(
            svc.sendFromRecord(tenantId, { userId: agentId, role: 'viewer' }, 'clientes', rec!.id, { connection_id: id, kind: 'text', text: 'x', variables: {} }),
        ).rejects.toMatchObject({ status: 404 });
        await expect(svc.connectionDetail(tenantId, { userId: agentId, role: 'agent' }, id)).rejects.toMatchObject({ status: 403 });
        await expect(svc.updateConfig(tenantId, { userId: agentId, role: 'manager' }, id, { inbound_list_id: null, create_contacts: false })).rejects.toMatchObject({ status: 403 });
        const info = await svc.recordInfo(tenantId, { userId: agentId, role: 'viewer' }, 'clientes', rec!.id);
        expect(info.can_send).toBe(false);

        // Un agente que edita todo pero NO ve el teléfono: no se le muestra ni se usa por defecto.
        await pg.db
            .update(lists)
            .set({
                settings: {
                    permissions: { permissions: { agent: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: ['telefono'] } } },
                    whatsapp: (await listsService.get(tenantId, 'clientes')).settings.whatsapp,
                },
            })
            .where(eq(lists.id, listId));
        const agent = { userId: agentId, role: 'agent' as const };
        const hiddenInfo = await svc.recordInfo(tenantId, agent, 'clientes', rec!.id);
        expect(hiddenInfo.recipient).toBeNull();
        expect(hiddenInfo.can_send).toBe(true);
        sent = [];
        const blind = await svc.sendFromRecord(tenantId, agent, 'clientes', rec!.id, { connection_id: id, kind: 'text', text: 'x', variables: {} });
        expect(blind.ok).toBe(false);
        expect(blind.request).toBeNull();
        expect(sent).toHaveLength(0);

        // Rol PROPIO y EQUIPOS cuentan como en el resto de la app (list-acl con el actor completo).
        const noAccess = { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] } as const;
        const editAll = { view: 'all', create: false, edit: 'all', delete: 'none', fields_hidden: [] } as const;
        await pg.db
            .update(lists)
            .set({
                settings: {
                    permissions: { permissions: { agent: noAccess, viewer: noAccess, [customRoleKey(7)]: editAll }, teams: { '41': editAll } },
                    whatsapp: (await listsService.get(tenantId, 'clientes')).settings.whatsapp,
                },
            })
            .where(eq(lists.id, listId));
        const editCaps: Capability[] = ['view_records', 'edit_records'];
        const viewCaps: Capability[] = ['view_records'];
        const textInput = { connection_id: id, kind: 'text' as const, text: 'x', variables: {} };
        // Un agente sin acceso por rol no alcanza el registro…
        await expect(svc.sendFromRecord(tenantId, agent, 'clientes', rec!.id, textInput)).rejects.toMatchObject({ status: 404 });
        // …pero su EQUIPO sí le da edición en esta lista.
        const byTeam = { ...agent, teamIds: [41] };
        expect((await svc.recordInfo(tenantId, byTeam, 'clientes', rec!.id)).can_send).toBe(true);
        // (Llega hasta el envío: lo que la frena es la ventana de 24 h, no el acceso.)
        const teamSend = await svc.sendFromRecord(tenantId, byTeam, 'clientes', rec!.id, textInput);
        expect(teamSend.error).toMatch(/ventana de 24 h/i);
        // Un rol propio (base Lector) con su fila de edición en la lista y la capacidad de editar: alcanza.
        const custom = { userId: agentId, role: 'viewer' as const, customRoleId: 7, capabilities: editCaps };
        expect((await svc.recordInfo(tenantId, custom, 'clientes', rec!.id)).can_send).toBe(true);
        // El mismo rol propio SIN la capacidad de editar no puede mandar, aunque la lista se lo deje.
        expect((await svc.recordInfo(tenantId, { ...custom, capabilities: viewCaps }, 'clientes', rec!.id)).can_send).toBe(false);
        // Y la muestra de «Probar ahora» respeta lo mismo: un registro que no alcanza no se usa
        // (ni pidiéndolo por id ni como «el último de la lista»); con el acceso del equipo, sí.
        const probe = (who: typeof agent & { teamIds?: number[] }, recordId?: number) =>
            svc.testSend(tenantId, who, 'clientes', { connection_id: id, kind: 'text', to: '+573009998877', values: { text: '{{telefono}}' }, ...(recordId ? { record_id: recordId } : {}) });
        expect((await probe(agent, rec!.id)).sample_record_id).toBeNull();
        expect((await probe(agent)).sample_record_id).toBeNull();
        expect((await probe(byTeam, rec!.id)).sample_record_id).toBe(rec!.id);
        expect((await probe(byTeam)).sample_record_id).toBe(rec!.id);
    });

    it('asistente / MCP: ve las cuentas y las plantillas APROBADAS (sin secretos) y valida la acción', async () => {
        const id = await connect();
        const { fieldsBy } = await seedContacts(id);
        await svc.refreshTemplates(tenantId, admin(), id);
        const tenantDb = new TenantDb(pg.db);
        const conns = await connectors.list(tenantId, adminId, 'admin');
        const list = await listsService.get(tenantId, 'clientes');
        const fieldsAll = await fieldsService.listByListId(tenantId, list.id);
        const schema = (await whatsappSchema(tenantDb, tenantId, conns, list.settings, fieldsAll)) as {
            connections: Array<{ connection_id: number; approved_templates: Array<{ name: string; variables: Array<{ key: string }> }> }>;
            list_columns: Record<string, string | null>;
        };
        expect(schema.connections).toHaveLength(1);
        expect(schema.connections[0]!.connection_id).toBe(id);
        const names = schema.connections[0]!.approved_templates.map((t) => t.name);
        expect(names).toContain('recordatorio_pago');
        expect(names).not.toContain('promo_rechazada');
        expect(schema.connections[0]!.approved_templates.find((t) => t.name === 'recordatorio_pago')!.variables.map((v) => v.key)).toEqual([
            'body.1',
            'body.2',
            'body.3',
            'button.0',
        ]);
        expect(schema.list_columns.phone).toBe('telefono');
        expect(fieldsBy.telefono).toBeGreaterThan(0);
        const raw = JSON.stringify(schema);
        expect(raw).not.toContain(TOKEN);
        expect(raw).not.toContain(APP_SECRET);

        await expect(assertWhatsappTemplateAction(tenantDb, tenantId, id, { template: 'no_existe' }, 'n.º 1')).rejects.toThrow(/no está aprobada/);
        await expect(
            assertWhatsappTemplateAction(tenantDb, tenantId, id, { template: 'recordatorio_pago', language: 'es', variables: { 'body.1': '{{nombre}}' } }, 'n.º 1'),
        ).rejects.toThrow(/body\.2, body\.3, button\.0/);
        await expect(
            assertWhatsappTemplateAction(
                tenantDb,
                tenantId,
                id,
                { template: 'recordatorio_pago', language: 'es', variables: JSON.stringify({ 'body.1': 'a', 'body.2': 'b', 'body.3': 'c', 'button.0': 'd' }) },
                'n.º 1',
            ),
        ).resolves.toBeUndefined();
    });

    it('RLS: las plantillas y los contactos de una empresa no se ven desde otra', async () => {
        const id = await connect();
        await svc.refreshTemplates(tenantId, admin(), id);
        await withTenant(pg.db, tenantId, (tx) => tx.insert(whatsappContacts).values({ tenantId, connectionId: id, phone: '573001112233', lastInboundAt: new Date() }));
        const mine = await withTenant(pg.db, tenantId, async (tx) => ({
            templates: await tx.select().from(whatsappTemplates),
            contacts: await tx.select().from(whatsappContacts),
        }));
        expect(mine.templates.length).toBeGreaterThan(0);
        expect(mine.contacts).toHaveLength(1);
        const theirs = await withTenant(pg.db, otherTenantId, async (tx) => ({
            templates: await tx.select().from(whatsappTemplates),
            contacts: await tx.select().from(whatsappContacts),
        }));
        expect(theirs.templates).toHaveLength(0);
        expect(theirs.contacts).toHaveLength(0);
        await expect(
            withTenant(pg.db, otherTenantId, (tx) => tx.insert(whatsappContacts).values({ tenantId, connectionId: id, phone: '1' })),
        ).rejects.toThrow();
    });
});
